import { join } from 'node:path'

export interface FileHandleLike {
  writeFile(contents: string, encoding: 'utf8'): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface AutostartFileSystem {
  mkdir(
    path: string,
    options: { recursive: true; mode: number },
  ): Promise<unknown>
  open(path: string, flags: 'w', mode: number): Promise<FileHandleLike>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  stat(path: string): Promise<unknown>
}

interface BaseAutostartDependencies {
  configHome: string
  fs: AutostartFileSystem
}

interface LinuxAutostartDependencies extends BaseAutostartDependencies {
  platform: 'linux'
  app: { executablePath: string }
}

interface WindowsAutostartDependencies extends BaseAutostartDependencies {
  platform: 'win32'
  app: {
    executablePath: string
    setLoginItemSettings(settings: {
      openAtLogin: boolean
      path: string
      args: string[]
    }): void
    getLoginItemSettings(settings: { path: string; args: string[] }): {
      openAtLogin: boolean
    }
  }
}

export type AutostartDependencies =
  LinuxAutostartDependencies | WindowsAutostartDependencies

export class AutostartService {
  constructor(private readonly dependencies: AutostartDependencies) {}

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.dependencies.platform === 'win32') {
      this.dependencies.app.setLoginItemSettings({
        openAtLogin: enabled,
        path: this.dependencies.app.executablePath,
        args: ['--hidden'],
      })
      return
    }

    if (enabled) {
      await this.enableLinux()
    } else {
      await this.disableLinux()
    }
  }

  async isEnabled(): Promise<boolean> {
    if (this.dependencies.platform === 'win32') {
      return this.dependencies.app.getLoginItemSettings({
        path: this.dependencies.app.executablePath,
        args: ['--hidden'],
      }).openAtLogin
    }

    try {
      await this.dependencies.fs.stat(this.desktopEntryPath())
      return true
    } catch (error: unknown) {
      if (isErrno(error, 'ENOENT')) {
        return false
      }
      throw error
    }
  }

  private async enableLinux(): Promise<void> {
    const directory = join(this.dependencies.configHome, 'autostart')
    const path = this.desktopEntryPath()
    const temporaryPath = `${path}.tmp`
    await this.dependencies.fs.mkdir(directory, {
      recursive: true,
      mode: 0o700,
    })

    let handle: FileHandleLike | undefined
    try {
      handle = await this.dependencies.fs.open(temporaryPath, 'w', 0o600)
      await handle.writeFile(this.desktopEntry(), 'utf8')
      await handle.sync()
    } finally {
      await handle?.close()
    }
    await this.dependencies.fs.rename(temporaryPath, path)
  }

  private async disableLinux(): Promise<void> {
    try {
      await this.dependencies.fs.unlink(this.desktopEntryPath())
    } catch (error: unknown) {
      if (!isErrno(error, 'ENOENT')) {
        throw error
      }
    }
  }

  private desktopEntryPath(): string {
    return join(this.dependencies.configHome, 'autostart', 'touchfish.desktop')
  }

  private desktopEntry(): string {
    const executable = this.dependencies.app.executablePath
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
    return [
      '[Desktop Entry]',
      'Name=TouchFish',
      'Type=Application',
      `Exec="${executable}" --hidden`,
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n')
  }
}

function isErrno(error: unknown, code: string): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
