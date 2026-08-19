import { describe, expect, test, vi } from 'vitest'

import { AutostartService } from './autostart-service'

describe('AutostartService', () => {
  test('uses Electron login settings exactly on Windows', async () => {
    const executablePath = 'C:\\Program Files\\TouchFish\\TouchFish.exe'
    const setLoginItemSettings = vi.fn()
    const getLoginItemSettings = vi.fn().mockReturnValue({ openAtLogin: true })
    const service = new AutostartService({
      platform: 'win32',
      app: {
        executablePath,
        setLoginItemSettings,
        getLoginItemSettings,
      },
      configHome: '/unused',
      fs: unreachableFs(),
    })

    await service.setEnabled(true)
    await service.setEnabled(false)

    expect(setLoginItemSettings).toHaveBeenNthCalledWith(1, {
      openAtLogin: true,
      path: executablePath,
      args: ['--hidden'],
    })
    expect(setLoginItemSettings).toHaveBeenNthCalledWith(2, {
      openAtLogin: false,
      path: executablePath,
      args: ['--hidden'],
    })
    await expect(service.isEnabled()).resolves.toBe(true)
    expect(getLoginItemSettings).toHaveBeenCalledExactlyOnceWith({
      path: executablePath,
      args: ['--hidden'],
    })
  })

  test('creates only a private user desktop entry on Linux', async () => {
    const handle = { writeFile: vi.fn(), sync: vi.fn(), close: vi.fn() }
    const fs = {
      mkdir: vi.fn(),
      open: vi.fn().mockResolvedValue(handle),
      rename: vi.fn(),
      unlink: vi.fn(),
      stat: vi.fn(),
    }
    const service = new AutostartService({
      platform: 'linux',
      app: { executablePath: '/opt/Touch Fish/bin/touch"fish' },
      configHome: '/home/ada/.config',
      fs,
    })

    await service.setEnabled(true)

    expect(fs.mkdir).toHaveBeenCalledWith('/home/ada/.config/autostart', {
      recursive: true,
      mode: 0o700,
    })
    expect(fs.open).toHaveBeenCalledWith(
      '/home/ada/.config/autostart/touchfish.desktop.tmp',
      'w',
      0o600,
    )
    expect(handle.writeFile).toHaveBeenCalledWith(
      '[Desktop Entry]\nName=TouchFish\nType=Application\nExec="/opt/Touch Fish/bin/touch\\"fish" --hidden\nX-GNOME-Autostart-enabled=true\n',
      'utf8',
    )
    expect(handle.sync).toHaveBeenCalledOnce()
    expect(handle.close).toHaveBeenCalledOnce()
    expect(fs.rename).toHaveBeenCalledWith(
      '/home/ada/.config/autostart/touchfish.desktop.tmp',
      '/home/ada/.config/autostart/touchfish.desktop',
    )
    expect(fs.unlink).not.toHaveBeenCalled()
  })

  test('closes a Linux temporary file handle when writing fails', async () => {
    const handle = {
      writeFile: vi.fn().mockRejectedValue(new Error('disk full')),
      sync: vi.fn(),
      close: vi.fn(),
    }
    const service = new AutostartService({
      platform: 'linux',
      app: { executablePath: '/opt/touchfish' },
      configHome: '/home/ada/.config',
      fs: { ...unreachableFs(), open: vi.fn().mockResolvedValue(handle) },
    })

    await expect(service.setEnabled(true)).rejects.toThrow('disk full')
    expect(handle.close).toHaveBeenCalledOnce()
  })

  test('only removes its user desktop entry and ignores a missing file', async () => {
    const unlink = vi.fn().mockRejectedValue({ code: 'ENOENT' })
    const service = new AutostartService({
      platform: 'linux',
      app: { executablePath: '/opt/touchfish' },
      configHome: '/home/ada/.config',
      fs: { ...unreachableFs(), unlink },
    })

    await expect(service.setEnabled(false)).resolves.toBeUndefined()
    expect(unlink).toHaveBeenCalledWith(
      '/home/ada/.config/autostart/touchfish.desktop',
    )
  })

  test('checks only its Linux desktop entry', async () => {
    const stat = vi.fn().mockResolvedValue({})
    const service = new AutostartService({
      platform: 'linux',
      app: { executablePath: '/opt/touchfish' },
      configHome: '/home/ada/.config',
      fs: { ...unreachableFs(), stat },
    })

    await expect(service.isEnabled()).resolves.toBe(true)
    expect(stat).toHaveBeenCalledWith(
      '/home/ada/.config/autostart/touchfish.desktop',
    )
  })
})

function unreachableFs() {
  return {
    mkdir: vi.fn(),
    open: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn(),
  }
}
