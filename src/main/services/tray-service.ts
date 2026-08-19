import type { AppLanguage } from '../../shared/models'

import type { AutostartService } from './autostart-service'

export interface TrayLike {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  destroy(): void
}

interface MenuItem {
  label: string
  type?: 'checkbox'
  checked?: boolean
  click(): void | Promise<void>
}

export interface TrayServiceDependencies {
  Tray: new (icon: unknown) => TrayLike
  Menu: { buildFromTemplate(template: MenuItem[]): unknown }
  icon: unknown
  locale: string
  onOpenSettings(): void | Promise<void>
  onRunScene(): void | Promise<void>
  onQuit(): void
  onError?(error: unknown): void
  autostart: Pick<AutostartService, 'isEnabled' | 'setEnabled'>
}

export class TrayService {
  private tray: TrayLike | undefined
  private language: AppLanguage = 'system'
  private startAtLogin = false
  private quitting = false
  private initializing: Promise<void> | undefined

  constructor(private readonly dependencies: TrayServiceDependencies) {}

  initialize(): Promise<void> {
    if (this.tray !== undefined || this.quitting) {
      return Promise.resolve()
    }
    this.initializing ??= this.initializeOnce()
    return this.initializing
  }

  setLanguage(language: AppLanguage): void {
    this.language = language
    this.rebuildMenu()
  }

  setAutostartEnabled(enabled: boolean): void {
    this.startAtLogin = enabled
    this.rebuildMenu()
  }

  quit(): void {
    if (this.quitting) {
      return
    }
    this.quitting = true
    this.destroyTray()
    this.dependencies.onQuit()
  }

  dispose(): void {
    if (this.quitting) {
      return
    }
    this.quitting = true
    this.destroyTray()
  }

  private destroyTray(): void {
    this.tray?.destroy()
    this.tray = undefined
  }

  private rebuildMenu(): void {
    if (this.tray === undefined) {
      return
    }
    this.tray.setContextMenu(
      this.dependencies.Menu.buildFromTemplate(this.menuItems()),
    )
  }

  private async initializeOnce(): Promise<void> {
    try {
      const startAtLogin = await this.dependencies.autostart.isEnabled()
      if (this.quitting || this.tray !== undefined) {
        return
      }
      this.startAtLogin = startAtLogin
      const tray = new this.dependencies.Tray(this.dependencies.icon)
      this.tray = tray
      tray.setToolTip('TouchFish')
      this.rebuildMenu()
    } finally {
      this.initializing = undefined
    }
  }

  private menuItems(): MenuItem[] {
    const chinese = this.effectiveLocale().toLowerCase().startsWith('zh')
    return [
      {
        label: chinese ? '打开设置' : 'Open Settings',
        click: () => this.dependencies.onOpenSettings(),
      },
      {
        label: chinese ? '运行场景' : 'Run Scene',
        click: () => this.dependencies.onRunScene(),
      },
      {
        label: chinese ? '开机启动' : 'Start at Login',
        type: 'checkbox',
        checked: this.startAtLogin,
        click: () => {
          void this.toggleAutostart()
        },
      },
      {
        label: chinese ? '退出' : 'Quit',
        click: () => this.quit(),
      },
    ]
  }

  private effectiveLocale(): string {
    if (this.language === 'system') {
      return this.dependencies.locale
    }
    return this.language
  }

  private async toggleAutostart(): Promise<void> {
    const enabled = !this.startAtLogin
    try {
      await this.dependencies.autostart.setEnabled(enabled)
      this.startAtLogin = enabled
    } catch (error: unknown) {
      try {
        this.dependencies.onError?.(error)
      } catch {
        // Error reporting must not turn a handled menu failure into a rejection.
      }
    }
    this.rebuildMenu()
  }
}
