import { spawn as nodeSpawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import type {
  DisplayInfo,
  ExternalTarget,
  NativeWindow,
  PlatformAdapter,
  Rect,
} from '../../../shared/models'
import { runCommand, type CommandOutput } from '../command'
import {
  helperEnvelopeSchema,
  helperWindowSchema,
  type HelperWindow,
} from './contracts'

type CommandRunner = (
  file: string,
  args: readonly string[],
) => Promise<CommandOutput>

interface ElectronDisplay {
  id: number | string
  label: string
  bounds: Rect
  workArea: Rect
}

interface ElectronScreen {
  getAllDisplays(): readonly ElectronDisplay[]
  getPrimaryDisplay(): Pick<ElectronDisplay, 'id'>
  dipToScreenRect(window: null, rect: Rect): Rect
}

export interface SpawnLike {
  once(event: 'spawn' | 'error', listener: (...args: unknown[]) => void): this
  removeListener(
    event: 'spawn' | 'error',
    listener: (...args: unknown[]) => void,
  ): this
  unref(): void
}

type NotificationConstructor = new (options: {
  title: string
  body: string
}) => { show(): void }

export interface WindowsDependencies {
  screen: ElectronScreen
  runCommand: CommandRunner
  spawn: (
    executablePath: string,
    args: readonly string[],
    options: { detached: true; shell: false; stdio: 'ignore' },
  ) => SpawnLike
  Notification: NotificationConstructor
  helperPath: string
}

export class WindowsHelperError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`Windows helper failed: ${code}`)
    this.name = 'WindowsHelperError'
    this.code = code
  }
}

export class InvalidExternalTargetError extends Error {
  constructor() {
    super('External executable path is required')
    this.name = 'InvalidExternalTargetError'
  }
}

export class WindowsAdapter implements PlatformAdapter {
  readonly kind = 'windows' as const

  private readonly screen: ElectronScreen
  private readonly command: CommandRunner
  private readonly spawn: WindowsDependencies['spawn']
  private readonly notification: NotificationConstructor
  private readonly helperPath: string

  constructor(dependencies: Partial<WindowsDependencies> = {}) {
    const electron = missingElectronDependencies(dependencies)
      ? electronDefaults()
      : undefined
    this.screen = dependencies.screen ?? electron?.screen ?? unavailableScreen()
    this.command = dependencies.runCommand ?? runCommand
    this.spawn = dependencies.spawn ?? nodeSpawn
    this.notification =
      dependencies.Notification ??
      electron?.Notification ??
      unavailableNotification()
    this.helperPath = dependencies.helperPath ?? defaultHelperPath(electron)
  }

  async listDisplays(): Promise<DisplayInfo[]> {
    const primaryId = String(this.screen.getPrimaryDisplay().id)
    return this.screen.getAllDisplays().map((display) => {
      const id = String(display.id)
      return {
        id,
        label: display.label.trim() === '' ? `Display ${id}` : display.label,
        primary: id === primaryId,
        bounds: copyRect(display.bounds),
        workArea: copyRect(display.workArea),
      }
    })
  }

  async listWindows(): Promise<NativeWindow[]> {
    const result = await this.callHelper('list-windows', {})
    const parsed = helperWindowSchema.array().safeParse(result)
    if (!parsed.success) {
      throw new WindowsHelperError('INVALID_RESPONSE')
    }
    return parsed.data.map(toNativeWindow)
  }

  async captureForegroundWindow(): Promise<NativeWindow | null> {
    const result = await this.callHelper('foreground-window', {})
    if (result === null) {
      return null
    }
    const parsed = helperWindowSchema.safeParse(result)
    if (!parsed.success) {
      throw new WindowsHelperError('INVALID_RESPONSE')
    }
    return toNativeWindow(parsed.data)
  }

  async moveAndMaximize(windowId: string, display: DisplayInfo): Promise<void> {
    const physicalWorkArea = this.screen.dipToScreenRect(null, display.workArea)
    await this.callHelper('move-maximize', {
      windowId,
      workArea: copyRect(physicalWorkArea),
    })
  }

  launchExternal(target: ExternalTarget): Promise<void> {
    if (target.executablePath.trim() === '') {
      return Promise.reject(new InvalidExternalTargetError())
    }

    return new Promise((resolveLaunch, rejectLaunch) => {
      let child: SpawnLike
      try {
        child = this.spawn(target.executablePath, target.args, {
          detached: true,
          shell: false,
          stdio: 'ignore',
        })
      } catch (error) {
        rejectLaunch(error)
        return
      }

      const cleanup = (): void => {
        child.removeListener('spawn', onSpawn)
        child.removeListener('error', onError)
      }
      const onSpawn = (): void => {
        cleanup()
        resolveLaunch()
      }
      const onError = (error: unknown): void => {
        cleanup()
        rejectLaunch(error)
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
      child.unref()
    })
  }

  notify(title: string, body: string): void {
    try {
      new this.notification({ title, body }).show()
    } catch {
      // Notifications cannot affect scene execution.
    }
  }

  private async callHelper(
    command: 'list-windows' | 'foreground-window' | 'move-maximize',
    payload: object,
  ): Promise<unknown> {
    const encodedPayload = Buffer.from(
      JSON.stringify(payload),
      'utf8',
    ).toString('base64')
    let stdout: string
    try {
      ;({ stdout } = await this.command('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.helperPath,
        command,
        '--payload-base64',
        encodedPayload,
      ]))
    } catch {
      throw new WindowsHelperError('EXECUTION_FAILED')
    }

    let response: unknown
    try {
      response = JSON.parse(stdout.trim())
    } catch {
      throw new WindowsHelperError('INVALID_RESPONSE')
    }
    const envelope = helperEnvelopeSchema.safeParse(response)
    if (!envelope.success) {
      throw new WindowsHelperError('INVALID_RESPONSE')
    }
    if (!envelope.data.ok) {
      throw new WindowsHelperError(envelope.data.error.code)
    }
    return envelope.data.result
  }
}

function toNativeWindow(window: HelperWindow): NativeWindow {
  return {
    id: window.id,
    pid: window.pid,
    title: window.title,
    ...(window.nativeClass === undefined
      ? {}
      : { nativeClass: window.nativeClass }),
    ...(window.executablePath === undefined
      ? {}
      : { executablePath: window.executablePath }),
    bounds: copyRect(window.bounds),
    visible: window.visible,
  }
}

function copyRect(rect: Rect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function missingElectronDependencies(
  dependencies: Partial<WindowsDependencies>,
): boolean {
  return (
    dependencies.screen === undefined ||
    dependencies.Notification === undefined ||
    dependencies.helperPath === undefined
  )
}

function electronDefaults(): {
  screen: ElectronScreen
  Notification: NotificationConstructor
  app: { isPackaged: boolean; getAppPath(): string }
} {
  return createRequire(import.meta.url)('electron') as {
    screen: ElectronScreen
    Notification: NotificationConstructor
    app: { isPackaged: boolean; getAppPath(): string }
  }
}

function defaultHelperPath(
  electron: { app: { isPackaged: boolean; getAppPath(): string } } | undefined,
): string {
  if (electron?.app.isPackaged) {
    return join(process.resourcesPath, 'windows', 'window-helper.ps1')
  }
  return resolve(
    electron?.app.getAppPath() ?? process.cwd(),
    'resources/windows/window-helper.ps1',
  )
}

function unavailableScreen(): ElectronScreen {
  throw new Error('Electron screen dependency is required')
}

function unavailableNotification(): NotificationConstructor {
  throw new Error('Electron Notification dependency is required')
}
