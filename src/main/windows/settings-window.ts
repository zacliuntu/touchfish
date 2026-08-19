import { createRequire } from 'node:module'
import { join as nodeJoin } from 'node:path'

export interface SettingsWindowLike {
  webContents: {
    session: {
      on(
        event: 'will-download',
        listener: (event: { preventDefault(): void }) => void,
      ): unknown
      setPermissionRequestHandler(
        handler: (
          webContents: unknown,
          permission: unknown,
          callback: (allowed: boolean) => void,
        ) => void,
      ): void
      setPermissionCheckHandler(handler: () => boolean): void
    }
    getLastWebPreferences(): {
      contextIsolation?: boolean
      nodeIntegration?: boolean
    }
    executeJavaScript(code: string): Promise<unknown>
    on(
      event: 'will-navigate' | 'will-redirect' | 'will-attach-webview',
      listener: (event: { preventDefault(): void }) => void,
    ): unknown
    setWindowOpenHandler(handler: () => { action: 'deny' }): void
  }
  loadURL(url: string): Promise<void>
  loadFile(path: string): Promise<void>
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  hide(): void
  isDestroyed(): boolean
  destroy(): void
  on(
    event: 'close' | 'closed',
    listener: (event?: { preventDefault(): void }) => void,
  ): unknown
}

export interface SettingsWindowDependencies {
  BrowserWindow: new (options: {
    width: number
    height: number
    show: false
    webPreferences: {
      preload: string
      contextIsolation: true
      nodeIntegration: false
      sandbox: true
    }
  }) => SettingsWindowLike
  join: typeof nodeJoin
  dirname: string
  rendererUrl: string | undefined
}

function loadDefaultDependencies(): SettingsWindowDependencies {
  const require = createRequire(import.meta.url)
  const electron = require('electron') as {
    BrowserWindow: SettingsWindowDependencies['BrowserWindow']
  }

  return {
    BrowserWindow: electron.BrowserWindow,
    join: nodeJoin,
    dirname: __dirname,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  }
}

export class SettingsWindowController {
  private window: SettingsWindowLike | undefined
  private destroying = false
  private readonly securedSessions = new WeakSet<object>()

  constructor(
    private readonly dependencies: SettingsWindowDependencies = loadDefaultDependencies(),
  ) {}

  async show(): Promise<void> {
    const window = await this.loadHidden()
    if (window.isMinimized()) {
      window.restore()
    }
    window.show()
    window.focus()
  }

  loadHidden(): Promise<SettingsWindowLike> {
    return this.window === undefined
      ? this.createWindow()
      : Promise.resolve(this.window)
  }

  hide(): void {
    if (this.window !== undefined && !this.window.isDestroyed()) {
      this.window.hide()
    }
  }

  ownsWebContents(candidate: unknown): boolean {
    return (
      this.window !== undefined &&
      !this.window.isDestroyed() &&
      candidate === this.window.webContents
    )
  }

  destroy(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) {
      this.window = undefined
      return
    }

    this.destroying = true
    window.destroy()
    this.window = undefined
    this.destroying = false
  }

  private async createWindow(): Promise<SettingsWindowLike> {
    const window = new this.dependencies.BrowserWindow({
      width: 960,
      height: 720,
      show: false,
      webPreferences: {
        preload: this.dependencies.join(
          this.dependencies.dirname,
          '../preload/index.js',
        ),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    this.window = window
    this.bindSecurity(window)
    window.on('close', (event) => {
      if (!this.destroying) {
        event?.preventDefault()
        window.hide()
      }
    })
    window.on('closed', () => {
      if (this.window === window) {
        this.window = undefined
      }
    })

    if (this.dependencies.rendererUrl !== undefined) {
      await window.loadURL(this.dependencies.rendererUrl)
    } else {
      await window.loadFile(
        this.dependencies.join(
          this.dependencies.dirname,
          '../renderer/index.html',
        ),
      )
    }
    return window
  }

  private bindSecurity(window: SettingsWindowLike): void {
    for (const event of [
      'will-navigate',
      'will-redirect',
      'will-attach-webview',
    ] as const) {
      window.webContents.on(event, (navigation) => navigation.preventDefault())
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const session = window.webContents.session
    if (!this.securedSessions.has(session)) {
      this.securedSessions.add(session)
      session.on('will-download', (event) => event.preventDefault())
      session.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      session.setPermissionCheckHandler(() => false)
    }
  }
}
