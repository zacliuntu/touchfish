import { describe, expect, it } from 'vitest'

import type { DisplayInfo } from '../../shared/models'
import {
  UnsafeWebUrlError,
  WebWindowUnavailableError,
  WebWindowController,
  type WebWindowDependencies,
} from './web-window'

class FakeSession {
  readonly events = new Map<string, (...args: never[]) => void>()
  readonly handlerCalls: string[] = []
  downloadHandler: ((event: { preventDefault(): void }) => void) | undefined
  permissionRequest:
    | ((
        webContents: unknown,
        permission: unknown,
        callback: (allowed: boolean) => void,
      ) => void)
    | undefined
  permissionCheck: (() => boolean) | undefined
  clearCount = 0

  on(event: string, listener: (...args: never[]) => void): this {
    this.handlerCalls.push(event)
    this.events.set(event, listener)
    if (event === 'will-download')
      this.downloadHandler = listener as typeof this.downloadHandler
    return this
  }

  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: unknown,
      callback: (allowed: boolean) => void,
    ) => void,
  ): void {
    this.handlerCalls.push('permission-request')
    this.permissionRequest = handler
  }

  setPermissionCheckHandler(handler: () => boolean): void {
    this.handlerCalls.push('permission-check')
    this.permissionCheck = handler
  }

  clearStorageData(): Promise<void> {
    this.clearCount += 1
    return Promise.resolve()
  }
}

class FakeWebContents {
  readonly events = new Map<string, (...args: never[]) => void>()
  readonly session: FakeSession
  openHandler: ((details: { url: string }) => { action: 'deny' }) | undefined

  constructor(session: FakeSession) {
    this.session = session
  }

  on(event: string, listener: (...args: never[]) => void): this {
    this.events.set(event, listener)
    return this
  }

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'deny' },
  ): void {
    this.openHandler = handler
  }

  emit(event: string, ...args: never[]): void {
    this.events.get(event)?.(...args)
  }
}

class FakeWebWindow {
  readonly events = new Map<string, (...args: never[]) => void>()
  readonly calls: string[] = []
  readonly webContents: FakeWebContents
  destroyed = false

  constructor(session: FakeSession) {
    this.webContents = new FakeWebContents(session)
  }

  loadURL(url: string): Promise<void> {
    this.calls.push(`loadURL:${url}`)
    return Promise.resolve()
  }

  setBounds(bounds: DisplayInfo['workArea']): void {
    this.calls.push(`bounds:${JSON.stringify(bounds)}`)
  }

  maximize(): void {
    this.calls.push('maximize')
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
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
  deps: WebWindowDependencies
  windows: FakeWebWindow[]
  options: unknown[]
  sessions: FakeSession[]
  opened: string[]
} {
  const windows: FakeWebWindow[] = []
  const options: unknown[] = []
  const sessions: FakeSession[] = []
  const opened: string[] = []
  const session = new FakeSession()
  sessions.push(session)
  return {
    deps: {
      BrowserWindow: class {
        constructor(options_: unknown) {
          options.push(options_)
          const window = new FakeWebWindow(session)
          windows.push(window)
          return window
        }
      } as unknown as WebWindowDependencies['BrowserWindow'],
      session: { fromPartition: () => session },
      shell: {
        openExternal: (url: string) => {
          opened.push(url)
          return Promise.resolve()
        },
      },
    },
    windows,
    options,
    sessions,
    opened,
  }
}

const display: DisplayInfo = {
  id: 'one',
  label: 'One',
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 10, y: 20, width: 1900, height: 1000 },
}

describe('WebWindowController', () => {
  it('creates an isolated persistent web window with no preload', async () => {
    const { deps, windows, options } = createDependencies()
    const controller = new WebWindowController(deps)

    await controller.ensureWindow('https://example.test/path')

    expect(options).toEqual([
      {
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: 'persist:touchfish-web',
        },
      },
    ])
    expect(windows[0]?.calls).toEqual(['loadURL:https://example.test/path'])
  })

  it('rejects unsafe URLs before creating a window', async () => {
    const { deps, windows } = createDependencies()
    const controller = new WebWindowController(deps)

    for (const url of ['', 'file:///etc/passwd', 'javascript:alert(1)']) {
      await expect(controller.ensureWindow(url)).rejects.toBeInstanceOf(
        UnsafeWebUrlError,
      )
    }
    expect(windows).toHaveLength(0)
  })

  it('reuses the same URL, reloads a changed URL, and clears state on closed', async () => {
    const { deps, windows } = createDependencies()
    const controller = new WebWindowController(deps)

    await controller.ensureWindow('https://one.test')
    await controller.ensureWindow('https://one.test')
    await controller.ensureWindow('http://two.test')
    expect(windows).toHaveLength(1)
    expect(windows[0]?.calls).toEqual([
      'loadURL:https://one.test',
      'loadURL:http://two.test',
    ])

    windows[0]?.emit('closed')
    await controller.ensureWindow('https://one.test')
    expect(windows).toHaveLength(2)
    expect(windows[1]?.calls).toEqual(['loadURL:https://one.test'])
  })

  it('moves to a copy of the display work area before maximizing', async () => {
    const { deps, windows } = createDependencies()
    const controller = new WebWindowController(deps)
    await expect(controller.moveAndMaximize(display)).rejects.toBeInstanceOf(
      WebWindowUnavailableError,
    )
    await controller.ensureWindow('https://example.test')

    await controller.moveAndMaximize(display)
    expect(windows[0]?.calls.slice(-2)).toEqual([
      'bounds:{"x":10,"y":20,"width":1900,"height":1000}',
      'maximize',
    ])
    expect(display.workArea).toEqual({
      x: 10,
      y: 20,
      width: 1900,
      height: 1000,
    })
  })

  it('denies non-web navigation, popups, downloads, and permissions', async () => {
    const { deps, windows, sessions, opened } = createDependencies()
    const controller = new WebWindowController(deps)
    await controller.ensureWindow('https://example.test')
    const contents = windows[0]?.webContents as FakeWebContents
    const session = sessions[0] as FakeSession

    let navigationPrevented = false
    contents.emit(
      'will-navigate',
      { preventDefault: () => (navigationPrevented = true) } as never,
      'file:///bad' as never,
    )
    expect(navigationPrevented).toBe(true)
    let allowedPrevented = false
    contents.emit(
      'will-navigate',
      { preventDefault: () => (allowedPrevented = true) } as never,
      'https://safe.test' as never,
    )
    expect(allowedPrevented).toBe(false)

    expect(contents.openHandler?.({ url: 'https://outside.test' })).toEqual({
      action: 'deny',
    })
    expect(opened).toEqual(['https://outside.test'])
    expect(contents.openHandler?.({ url: 'http://outside.test' })).toEqual({
      action: 'deny',
    })
    expect(opened).toEqual(['https://outside.test'])
    expect(contents.openHandler?.({ url: 'not a URL' })).toEqual({
      action: 'deny',
    })
    expect(opened).toEqual(['https://outside.test'])

    let downloadPrevented = false
    session.downloadHandler?.({
      preventDefault: () => (downloadPrevented = true),
    })
    expect(downloadPrevented).toBe(true)
    let permissionGranted: boolean | undefined
    session.permissionRequest?.(undefined, undefined, (value) => {
      permissionGranted = value
    })
    expect(permissionGranted).toBe(false)
    expect(session.permissionCheck?.()).toBe(false)
  })

  it('denies unsafe server redirects while allowing HTTP and HTTPS redirects', async () => {
    const { deps, windows } = createDependencies()
    const controller = new WebWindowController(deps)
    await controller.ensureWindow('https://example.test')
    const contents = windows[0]?.webContents as FakeWebContents

    for (const url of ['file:///bad', 'javascript:alert(1)', 'not a URL']) {
      let prevented = false
      contents.emit('will-redirect', {
        url,
        preventDefault: () => (prevented = true),
      } as never)
      expect(prevented).toBe(true)
    }

    for (const url of ['http://safe.test', 'https://safe.test']) {
      let prevented = false
      contents.emit('will-redirect', {
        url,
        preventDefault: () => (prevented = true),
      } as never)
      expect(prevented).toBe(false)
    }
  })

  it('always denies a popup even if opening HTTPS externally fails', async () => {
    const { deps, windows } = createDependencies()
    deps.shell.openExternal = () => Promise.reject(new Error('no browser'))
    const controller = new WebWindowController(deps)
    await controller.ensureWindow('https://example.test')

    expect(
      windows[0]?.webContents.openHandler?.({ url: 'https://outside.test' }),
    ).toEqual({ action: 'deny' })
  })

  it('clears only the dedicated partition whether or not the window exists', async () => {
    const before = createDependencies()
    const controllerBefore = new WebWindowController(before.deps)
    await controllerBefore.clearData()
    expect(before.sessions[0]?.clearCount).toBe(1)
    expect(before.windows).toHaveLength(0)

    const after = createDependencies()
    const controllerAfter = new WebWindowController(after.deps)
    await controllerAfter.ensureWindow('https://example.test')
    await controllerAfter.clearData()
    expect(after.sessions[0]?.clearCount).toBe(1)
  })

  it('binds the dedicated session protections only once when a window is recreated', async () => {
    const { deps, windows, sessions } = createDependencies()
    const controller = new WebWindowController(deps)
    await controller.ensureWindow('https://one.test')
    windows[0]?.emit('closed')
    await controller.ensureWindow('https://two.test')

    expect(sessions[0]?.handlerCalls).toEqual([
      'will-download',
      'permission-request',
      'permission-check',
    ])
  })

  it('destroys the window and allows a fresh creation', async () => {
    const { deps, windows } = createDependencies()
    const controller = new WebWindowController(deps)
    await controller.ensureWindow('https://example.test')
    controller.destroy()
    await controller.ensureWindow('https://example.test')
    expect(windows).toHaveLength(2)
  })
})
