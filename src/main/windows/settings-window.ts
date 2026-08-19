import { createRequire } from 'node:module'
import { join as nodeJoin } from 'node:path'

export interface SettingsWindowLike {
  webContents: {
    getLastWebPreferences(): {
      contextIsolation?: boolean
      nodeIntegration?: boolean
    }
    executeJavaScript(code: string): Promise<unknown>
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
}
