import { spawn as nodeSpawn } from 'node:child_process'
import { readlink as nodeReadlink } from 'node:fs/promises'
import { createRequire } from 'node:module'

import type {
  DisplayInfo,
  ExternalTarget,
  NativeWindow,
  PlatformAdapter,
} from '../../../shared/models'
import { runCommand, type CommandOutput } from '../command'
import { parseWmctrl } from './parse-wmctrl'
import { parseXrandr } from './parse-xrandr'

type CommandRunner = (
  file: string,
  args: readonly string[],
) => Promise<CommandOutput>

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

export interface LinuxX11Dependencies {
  env: Readonly<Record<string, string | undefined>>
  runCommand: CommandRunner
  readlink: (path: string) => Promise<string>
  spawn: (
    executablePath: string,
    args: readonly string[],
    options: { detached: true; shell: false; stdio: 'ignore' },
  ) => SpawnLike
  Notification: NotificationConstructor
}

export class UnsupportedLinuxSessionError extends Error {
  constructor() {
    super('Linux X11 session is required')
    this.name = 'UnsupportedLinuxSessionError'
  }
}

export class ForegroundWindowParseError extends Error {
  constructor() {
    super('Invalid active window identifier')
    this.name = 'ForegroundWindowParseError'
  }
}

export class InvalidExternalTargetError extends Error {
  constructor() {
    super('External executable path is required')
    this.name = 'InvalidExternalTargetError'
  }
}

export type WindowPlacementStep =
  'activate' | 'unmaximize' | 'move' | 'maximize'

export class WindowPlacementError extends Error {
  readonly failedSteps: readonly WindowPlacementStep[]

  constructor(failedSteps: readonly WindowPlacementStep[]) {
    super(`Window placement failed at ${failedSteps.length} step(s)`)
    this.name = 'WindowPlacementError'
    this.failedSteps = failedSteps
  }
}

export class LinuxX11Adapter implements PlatformAdapter {
  readonly kind = 'linux-x11' as const

  private readonly env: LinuxX11Dependencies['env']
  private readonly command: CommandRunner
  private readonly readlink: LinuxX11Dependencies['readlink']
  private readonly spawn: LinuxX11Dependencies['spawn']
  private readonly notification: NotificationConstructor

  constructor(dependencies: Partial<LinuxX11Dependencies> = {}) {
    this.env = dependencies.env ?? process.env

    if (
      this.env.XDG_SESSION_TYPE?.toLowerCase() !== 'x11' ||
      this.env.DISPLAY?.trim() === '' ||
      this.env.DISPLAY === undefined
    ) {
      throw new UnsupportedLinuxSessionError()
    }

    this.command = dependencies.runCommand ?? runCommand
    this.readlink = dependencies.readlink ?? nodeReadlink
    this.spawn = dependencies.spawn ?? nodeSpawn
    this.notification = dependencies.Notification ?? electronNotification()
  }

  async listDisplays(): Promise<DisplayInfo[]> {
    const { stdout } = await this.command('xrandr', ['--query'])
    return parseXrandr(stdout)
  }

  async listWindows(): Promise<NativeWindow[]> {
    const { stdout } = await this.command('wmctrl', ['-lpGx'])
    const windows = parseWmctrl(stdout)

    return Promise.all(
      windows.map(async (window) => {
        try {
          const executablePath = await this.readlink(`/proc/${window.pid}/exe`)
          return { ...window, executablePath }
        } catch {
          return { ...window }
        }
      }),
    )
  }

  async captureForegroundWindow(): Promise<NativeWindow | null> {
    const { stdout } = await this.command('xprop', [
      '-root',
      '_NET_ACTIVE_WINDOW',
    ])
    const activeWindowId = parseActiveWindowId(stdout)

    if (activeWindowId === null) {
      return null
    }

    const windows = await this.listWindows()
    return (
      windows.find(
        (window) => normalizeWindowId(window.id) === activeWindowId,
      ) ?? null
    )
  }

  launchExternal(target: ExternalTarget): Promise<void> {
    if (target.executablePath.trim() === '') {
      return Promise.reject(new InvalidExternalTargetError())
    }

    return new Promise((resolve, reject) => {
      let child: SpawnLike

      try {
        child = this.spawn(target.executablePath, target.args, {
          detached: true,
          shell: false,
          stdio: 'ignore',
        })
      } catch (error) {
        reject(error)
        return
      }

      const cleanup = (): void => {
        child.removeListener('spawn', onSpawn)
        child.removeListener('error', onError)
      }
      const onSpawn = (): void => {
        cleanup()
        resolve()
      }
      const onError = (error: unknown): void => {
        cleanup()
        reject(error)
      }

      child.once('spawn', onSpawn)
      child.once('error', onError)
      child.unref()
    })
  }

  async moveAndMaximize(windowId: string, display: DisplayInfo): Promise<void> {
    const steps: readonly [WindowPlacementStep, readonly string[]][] = [
      ['activate', ['-ia', windowId]],
      [
        'unmaximize',
        ['-ir', windowId, '-b', 'remove,maximized_vert,maximized_horz'],
      ],
      [
        'move',
        [
          '-ir',
          windowId,
          '-e',
          `0,${display.workArea.x},${display.workArea.y},${display.workArea.width},${display.workArea.height}`,
        ],
      ],
      [
        'maximize',
        ['-ir', windowId, '-b', 'add,maximized_vert,maximized_horz'],
      ],
    ]
    const failedSteps: WindowPlacementStep[] = []

    for (const [step, args] of steps) {
      try {
        await this.command('wmctrl', args)
      } catch {
        failedSteps.push(step)
      }
    }

    if (failedSteps.length > 0) {
      throw new WindowPlacementError(failedSteps)
    }
  }

  notify(title: string, body: string): void {
    try {
      new this.notification({ title, body }).show()
    } catch {
      // Notification errors cannot affect scene execution.
    }
  }
}

function parseActiveWindowId(stdout: string): string | null {
  const output = stdout.trim()

  if (
    /^_NET_ACTIVE_WINDOW(?:\(WINDOW\))?:\s*(?:not found\.?|no such atom on any window\.)$/i.test(
      output,
    )
  ) {
    return null
  }

  const match =
    /^_NET_ACTIVE_WINDOW(?:\(WINDOW\))?:\s*window id #\s*(0x[0-9a-f]+)\s*$/i.exec(
      output,
    )

  if (match === null) {
    throw new ForegroundWindowParseError()
  }

  return normalizeWindowId(match[1] ?? '')
}

function normalizeWindowId(value: string): string | null {
  const match = /^0x([0-9a-f]+)$/i.exec(value)

  if (match === null) {
    throw new ForegroundWindowParseError()
  }

  const digits = match[1]?.replace(/^0+/, '') ?? ''
  return digits === '' ? null : `0x${digits.toLowerCase()}`
}

function electronNotification(): NotificationConstructor {
  const electron = createRequire(import.meta.url)('electron') as {
    Notification: NotificationConstructor
  }
  return electron.Notification
}
