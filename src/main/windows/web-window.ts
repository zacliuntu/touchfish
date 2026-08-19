import { createRequire } from 'node:module'

import type { DisplayInfo } from '../../shared/models'
import { configSchema } from '../config/schema'
import type { WebTargetController } from '../core/scene-orchestrator'

const WEB_PARTITION = 'persist:touchfish-web'

type NavigationEvent = { preventDefault(): void }
type RedirectDetails = NavigationEvent & { url: string }

export interface WebSessionLike {
  on(
    event: 'will-download',
    listener: (event: NavigationEvent) => void,
  ): unknown
  setPermissionRequestHandler?(
    handler: (
      webContents: unknown,
      permission: unknown,
      callback: (allowed: boolean) => void,
    ) => void,
  ): void
  setPermissionCheckHandler?(handler: () => boolean): void
  clearStorageData(): Promise<void>
}

export interface WebContentsLike {
  session: WebSessionLike
  on(
    event: 'will-navigate',
    listener: (event: NavigationEvent, url: string) => void,
  ): unknown
  on(
    event: 'will-redirect',
    listener: (details: RedirectDetails) => void,
  ): unknown
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'deny' },
  ): void
}

export interface WebWindowLike {
  webContents: WebContentsLike
  loadURL(url: string): Promise<void>
  setBounds(bounds: DisplayInfo['workArea']): void
  maximize(): void
  isDestroyed(): boolean
  destroy(): void
  on(event: 'closed', listener: () => void): unknown
}

export interface WebWindowDependencies {
  BrowserWindow: new (options: {
    webPreferences: {
      contextIsolation: true
      nodeIntegration: false
      sandbox: true
      partition: typeof WEB_PARTITION
    }
  }) => WebWindowLike
  session: { fromPartition(partition: typeof WEB_PARTITION): WebSessionLike }
  shell: { openExternal(url: string): Promise<void> }
}

function loadDefaultDependencies(): WebWindowDependencies {
  const require = createRequire(import.meta.url)
  const electron = require('electron') as WebWindowDependencies
  return {
    BrowserWindow: electron.BrowserWindow,
    session: electron.session,
    shell: electron.shell,
  }
}

function isHttpUrl(url: string): boolean {
  return configSchema.shape.web.safeParse({ url }).success
}

function isHttpsUrl(url: string): boolean {
  try {
    return new globalThis.URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export class UnsafeWebUrlError extends Error {
  constructor(url: string) {
    super(`Unsafe web URL: ${url}`)
    this.name = 'UnsafeWebUrlError'
  }
}

export class WebWindowUnavailableError extends Error {
  constructor() {
    super('Web window is unavailable')
    this.name = 'WebWindowUnavailableError'
  }
}

export class WebWindowController implements WebTargetController {
  private window: WebWindowLike | undefined
  private lastUrl: string | undefined
  private readonly securedSessions = new WeakSet<WebSessionLike>()

  constructor(
    private readonly dependencies: WebWindowDependencies = loadDefaultDependencies(),
  ) {}

  async ensureWindow(url: string): Promise<void> {
    if (!isHttpUrl(url)) {
      throw new UnsafeWebUrlError(url)
    }

    const window = this.window ?? this.createWindow()
    if (this.lastUrl !== url) {
      await window.loadURL(url)
      this.lastUrl = url
    }
  }

  async moveAndMaximize(display: DisplayInfo): Promise<void> {
    const window = this.window
    if (window === undefined || window.isDestroyed()) {
      throw new WebWindowUnavailableError()
    }

    window.setBounds({ ...display.workArea })
    window.maximize()
  }

  async clearData(): Promise<void> {
    const window = this.window
    const session =
      window !== undefined && !window.isDestroyed()
        ? window.webContents.session
        : this.dependencies.session.fromPartition(WEB_PARTITION)
    await session.clearStorageData()
  }

  destroy(): void {
    const window = this.window
    if (window !== undefined && !window.isDestroyed()) {
      window.destroy()
    }
    this.window = undefined
    this.lastUrl = undefined
  }

  private createWindow(): WebWindowLike {
    const window = new this.dependencies.BrowserWindow({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: WEB_PARTITION,
      },
    })
    this.window = window
    this.bindSecurity(window)
    window.on('closed', () => {
      if (this.window === window) {
        this.window = undefined
        this.lastUrl = undefined
      }
    })
    return window
  }

  private bindSecurity(window: WebWindowLike): void {
    window.webContents.on('will-navigate', (event, url) => {
      if (!isHttpUrl(url)) {
        event.preventDefault()
      }
    })
    window.webContents.on('will-redirect', (details) => {
      if (!isHttpUrl(details.url)) {
        details.preventDefault()
      }
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isHttpsUrl(url)) {
        try {
          void this.dependencies.shell.openExternal(url).catch(() => undefined)
        } catch {
          // External browser integration must not alter the deny decision.
        }
      }
      return { action: 'deny' }
    })
    this.bindSessionSecurity(window.webContents.session)
  }

  private bindSessionSecurity(session: WebSessionLike): void {
    if (this.securedSessions.has(session)) {
      return
    }
    this.securedSessions.add(session)
    session.on('will-download', (event) => event.preventDefault())
    session.setPermissionRequestHandler?.(
      (_contents, _permission, callback) => {
        callback(false)
      },
    )
    session.setPermissionCheckHandler?.(() => false)
  }
}
