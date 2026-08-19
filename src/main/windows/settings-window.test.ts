import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SettingsWindowController,
  type SettingsWindowDependencies,
} from './settings-window'

class FakeSettingsSession {
  downloadHandler: ((event: { preventDefault(): void }) => void) | undefined
  permissionRequest:
    | ((
        webContents: unknown,
        permission: unknown,
        callback: (allowed: boolean) => void,
      ) => void)
    | undefined
  permissionCheck: (() => boolean) | undefined

  on(
    event: string,
    listener: (event: { preventDefault(): void }) => void,
  ): this {
    if (event === 'will-download') this.downloadHandler = listener
    return this
  }

  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: unknown,
      callback: (allowed: boolean) => void,
    ) => void,
  ): void {
    this.permissionRequest = handler
  }

  setPermissionCheckHandler(handler: () => boolean): void {
    this.permissionCheck = handler
  }
}

class FakeSettingsWebContents {
  readonly events = new Map<string, (...args: never[]) => void>()
  readonly session = new FakeSettingsSession()
  openHandler: (() => { action: 'deny' }) | undefined

  getLastWebPreferences(): {
    contextIsolation: true
    nodeIntegration: false
  } {
    return { contextIsolation: true, nodeIntegration: false }
  }

  executeJavaScript(_code: string): Promise<undefined> {
    return Promise.resolve(undefined)
  }

  on(event: string, listener: (...args: never[]) => void): this {
    this.events.set(event, listener)
    return this
  }

  setWindowOpenHandler(handler: () => { action: 'deny' }): void {
    this.openHandler = handler
  }

  emit(event: string, ...args: never[]): void {
    this.events.get(event)?.(...args)
  }
}

class FakeSettingsWindow {
  readonly events = new Map<string, (...args: never[]) => void>()
  readonly calls: string[] = []
  minimized = false
  destroyed = false
  preventClose = false
  loadTarget: string | undefined
  readonly webContents = new FakeSettingsWebContents()

  loadURL(url: string): Promise<void> {
    this.loadTarget = url
    this.calls.push(`loadURL:${url}`)
    return Promise.resolve()
  }

  loadFile(path: string): Promise<void> {
    this.loadTarget = path
    this.calls.push(`loadFile:${path}`)
    return Promise.resolve()
  }

  isMinimized(): boolean {
    return this.minimized
  }

  restore(): void {
    this.calls.push('restore')
  }

  show(): void {
    this.calls.push('show')
  }

  focus(): void {
    this.calls.push('focus')
  }

  hide(): void {
    this.calls.push('hide')
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.calls.push('destroy')
    this.emit('closed')
  }

  on(event: string, listener: (...args: never[]) => void): this {
    this.events.set(event, listener)
    return this
  }

  emit(event: string, ...args: never[]): void {
    this.events.get(event)?.(...args)
  }
}

function createDependencies(): {
  deps: SettingsWindowDependencies
  windows: FakeSettingsWindow[]
  options: unknown[]
} {
  const windows: FakeSettingsWindow[] = []
  const options: unknown[] = []
  return {
    deps: {
      BrowserWindow: class {
        constructor(options_: unknown) {
          options.push(options_)
          const window = new FakeSettingsWindow()
          windows.push(window)
          return window
        }
      } as unknown as SettingsWindowDependencies['BrowserWindow'],
      join,
      dirname: '/app/out/main',
      rendererUrl: undefined,
    },
    windows,
    options,
  }
}

describe('SettingsWindowController', () => {
  it('loads the production window hidden for startup verification', async () => {
    const { deps, windows } = createDependencies()
    const controller = new SettingsWindowController(deps)

    const window = await controller.loadHidden()

    expect(window).toBe(windows[0])
    expect(windows[0]?.calls).toEqual([
      `loadFile:${join('/app/out/main', '../renderer/index.html')}`,
    ])
  })

  it('creates a hidden, isolated local window with the only preload', async () => {
    const { deps, windows, options } = createDependencies()
    const controller = new SettingsWindowController(deps)

    await controller.show()

    expect(options).toEqual([
      {
        width: 960,
        height: 720,
        show: false,
        webPreferences: {
          preload: join('/app/out/main', '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    ])
    expect(windows[0]?.loadTarget).toBe(
      join('/app/out/main', '../renderer/index.html'),
    )
    expect(windows[0]?.calls).toEqual([
      `loadFile:${join('/app/out/main', '../renderer/index.html')}`,
      'show',
      'focus',
    ])
  })

  it('uses the renderer development URL and reuses a minimized window', async () => {
    const { deps, windows } = createDependencies()
    deps.rendererUrl = 'http://localhost:5173'
    const controller = new SettingsWindowController(deps)

    await controller.show()
    const window = windows[0] as FakeSettingsWindow
    window.minimized = true
    await controller.show()

    expect(windows).toHaveLength(1)
    expect(window.calls).toEqual([
      'loadURL:http://localhost:5173',
      'show',
      'focus',
      'restore',
      'show',
      'focus',
    ])
  })

  it('denies renderer navigation, popups, downloads, permissions, and webviews', async () => {
    const { deps, windows } = createDependencies()
    const controller = new SettingsWindowController(deps)
    await controller.show()
    const contents = (windows[0] as FakeSettingsWindow).webContents

    for (const eventName of [
      'will-navigate',
      'will-redirect',
      'will-attach-webview',
    ]) {
      let prevented = false
      contents.emit(eventName, {
        preventDefault: () => (prevented = true),
      } as never)
      expect(prevented, eventName).toBe(true)
    }
    expect(contents.openHandler?.()).toEqual({ action: 'deny' })

    let downloadPrevented = false
    contents.session.downloadHandler?.({
      preventDefault: () => (downloadPrevented = true),
    })
    expect(downloadPrevented).toBe(true)
    let permissionGranted: boolean | undefined
    contents.session.permissionRequest?.(undefined, undefined, (allowed) => {
      permissionGranted = allowed
    })
    expect(permissionGranted).toBe(false)
    expect(contents.session.permissionCheck?.()).toBe(false)
  })

  it('only identifies the current live settings webContents as owned', async () => {
    const { deps, windows } = createDependencies()
    const controller = new SettingsWindowController(deps)
    await controller.show()
    const first = windows[0] as FakeSettingsWindow

    expect(controller.ownsWebContents(first.webContents)).toBe(true)
    expect(controller.ownsWebContents({})).toBe(false)

    first.emit('closed')
    expect(controller.ownsWebContents(first.webContents)).toBe(false)
  })

  it('hides user closes without creating a window and clears references after close or destroy', async () => {
    const { deps, windows } = createDependencies()
    const controller = new SettingsWindowController(deps)

    controller.hide()
    expect(windows).toHaveLength(0)

    await controller.show()
    const first = windows[0] as FakeSettingsWindow
    const event = { preventDefault: () => (first.preventClose = true) }
    first.emit('close', event as never)
    expect(first.preventClose).toBe(true)
    expect(first.calls).toContain('hide')

    first.emit('closed')
    await controller.show()
    expect(windows).toHaveLength(2)
    controller.destroy()
    expect(windows[1]?.calls).toContain('destroy')
  })
})
