import { EventEmitter } from 'node:events'

import { describe, expect, test, vi } from 'vitest'

import type { DisplayInfo, ExternalTarget } from '../../../shared/models'
import {
  ForegroundWindowParseError,
  InvalidExternalTargetError,
  LinuxX11Adapter,
  UnsupportedLinuxSessionError,
  WindowPlacementError,
  type LinuxX11Dependencies,
  type SpawnLike,
} from './adapter'

const display: DisplayInfo = {
  id: 'HDMI-1',
  label: 'HDMI-1',
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 10, y: 20, width: 1900, height: 1040 },
}

function dependencies(
  overrides: Partial<LinuxX11Dependencies> = {},
): LinuxX11Dependencies {
  return {
    env: { XDG_SESSION_TYPE: 'X11', DISPLAY: ':0' },
    runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    readlink: vi.fn().mockResolvedValue('/usr/bin/example'),
    spawn: vi.fn(),
    Notification: class {
      show(): void {}
    },
    ...overrides,
  }
}

function target(overrides: Partial<ExternalTarget> = {}): ExternalTarget {
  return {
    executablePath: '/opt/example',
    args: ['--open', 'value with spaces'],
    matcher: null,
    ...overrides,
  }
}

class FakeChild extends EventEmitter implements SpawnLike {
  readonly unref = vi.fn()
}

describe('LinuxX11Adapter', () => {
  test.each([
    [{ XDG_SESSION_TYPE: undefined, DISPLAY: ':0' }],
    [{ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }],
    [{ XDG_SESSION_TYPE: ' x11 ', DISPLAY: ':0' }],
    [{ XDG_SESSION_TYPE: 'X11', DISPLAY: undefined }],
    [{ XDG_SESSION_TYPE: 'X11', DISPLAY: '   ' }],
  ])(
    'rejects an unsupported session without exposing environment values',
    (env) => {
      try {
        new LinuxX11Adapter(dependencies({ env }))
        throw new Error('Expected constructor to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedLinuxSessionError)
        expect((error as Error).message).not.toContain('wayland')
        expect((error as Error).message).not.toContain(':0')
      }
    },
  )

  test('validates an unsupported default session before resolving Electron', () => {
    expect(
      () =>
        new LinuxX11Adapter({
          env: { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' },
        }),
    ).toThrow(UnsupportedLinuxSessionError)
  })

  test('accepts the session type case-insensitively', () => {
    expect(
      new LinuxX11Adapter(
        dependencies({ env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' } }),
      ).kind,
    ).toBe('linux-x11')
  })

  test('lists parsed displays with an argument array', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: 'HDMI-1 connected primary 1920x1080+0+0\n',
      stderr: '',
    })
    const adapter = new LinuxX11Adapter(dependencies({ runCommand }))

    await expect(adapter.listDisplays()).resolves.toEqual([
      {
        ...display,
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ])
    expect(runCommand).toHaveBeenCalledWith('xrandr', ['--query'])
  })

  test('adds executable paths per window without changing order or failing on one lookup', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout:
        '0x0000000A 0 12 0 0 10 20 app.One host First\n' +
        '0x0000000B 0 13 1 2 30 40 app.Two host Second\n',
      stderr: '',
    })
    const readlink = vi
      .fn()
      .mockResolvedValueOnce('/usr/bin/one')
      .mockRejectedValueOnce(new Error('not accessible'))
    const adapter = new LinuxX11Adapter(dependencies({ runCommand, readlink }))

    await expect(adapter.listWindows()).resolves.toEqual([
      expect.objectContaining({
        id: '0x0000000a',
        pid: 12,
        executablePath: '/usr/bin/one',
      }),
      expect.not.objectContaining({ executablePath: expect.anything() }),
    ])
    expect(runCommand).toHaveBeenCalledWith('wmctrl', ['-lpGx'])
    expect(readlink).toHaveBeenNthCalledWith(1, '/proc/12/exe')
    expect(readlink).toHaveBeenNthCalledWith(2, '/proc/13/exe')
  })

  test('returns the active window using a case-insensitive canonical id', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: '_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0000000A\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '0x0000000a 0 12 0 0 10 20 app.One host First\n',
        stderr: '',
      })
    const adapter = new LinuxX11Adapter(dependencies({ runCommand }))

    await expect(adapter.captureForegroundWindow()).resolves.toMatchObject({
      id: '0x0000000a',
    })
    expect(runCommand).toHaveBeenNthCalledWith(1, 'xprop', [
      '-root',
      '_NET_ACTIVE_WINDOW',
    ])
  })

  test.each([
    '_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0',
    '_NET_ACTIVE_WINDOW: not found',
    '_NET_ACTIVE_WINDOW: no such atom on any window.',
  ])('returns null when no active window value exists', async (stdout) => {
    const runCommand = vi.fn().mockResolvedValue({ stdout, stderr: '' })
    const adapter = new LinuxX11Adapter(dependencies({ runCommand }))

    await expect(adapter.captureForegroundWindow()).resolves.toBeNull()
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  test.each([
    '_NET_ACTIVE_WINDOW(WINDOW): window id # bad-value',
    '_NET_ACTIVE_WINDOW: 0x12 and 0x13',
    'garbage 0x12',
    'totally malformed',
  ])(
    'rejects malformed active window output without echoing it',
    async (stdout) => {
      const adapter = new LinuxX11Adapter(
        dependencies({
          runCommand: vi.fn().mockResolvedValue({ stdout, stderr: '' }),
        }),
      )

      try {
        await adapter.captureForegroundWindow()
        throw new Error('Expected captureForegroundWindow to reject')
      } catch (error) {
        expect(error).toBeInstanceOf(ForegroundWindowParseError)
        expect((error as Error).message).not.toContain(stdout)
      }
    },
  )

  test('returns null when the active id has no wmctrl window', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: '_NET_ACTIVE_WINDOW: window id # 0x12',
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const adapter = new LinuxX11Adapter(dependencies({ runCommand }))

    await expect(adapter.captureForegroundWindow()).resolves.toBeNull()
  })

  test('spawns external targets with raw path and arguments then resolves on spawn', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const adapter = new LinuxX11Adapter(dependencies({ spawn }))
    const launched = adapter.launchExternal(target())

    expect(spawn).toHaveBeenCalledWith(
      '/opt/example',
      ['--open', 'value with spaces'],
      { detached: true, shell: false, stdio: 'ignore' },
    )
    expect(child.unref).toHaveBeenCalledOnce()
    child.emit('spawn')
    await expect(launched).resolves.toBeUndefined()
  })

  test('rejects invalid paths, synchronous spawn failure, and spawn errors', async () => {
    const invalid = new LinuxX11Adapter(dependencies())
    await expect(
      invalid.launchExternal(target({ executablePath: '  ' })),
    ).rejects.toBeInstanceOf(InvalidExternalTargetError)

    const synchronous = new LinuxX11Adapter(
      dependencies({
        spawn: vi.fn(() => {
          throw new Error('nope')
        }),
      }),
    )
    await expect(synchronous.launchExternal(target())).rejects.toThrow('nope')

    const child = new FakeChild()
    const asynchronous = new LinuxX11Adapter(
      dependencies({ spawn: vi.fn().mockReturnValue(child) }),
    )
    const launched = asynchronous.launchExternal(target())
    child.emit('error', new Error('not found'))
    await expect(launched).rejects.toThrow('not found')
  })

  test('tries every placement step in order and aggregates stable step codes', async () => {
    const runCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error('/secret/one'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('/secret/two'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const adapter = new LinuxX11Adapter(dependencies({ runCommand }))

    try {
      await adapter.moveAndMaximize('0x0000000A', display)
      throw new Error('Expected moveAndMaximize to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(WindowPlacementError)
      expect(error).toMatchObject({ failedSteps: ['activate', 'move'] })
      expect((error as Error).message).toContain('2')
      expect((error as Error).message).not.toContain('/secret')
    }

    expect(runCommand.mock.calls).toEqual([
      ['wmctrl', ['-ia', '0x0000000A']],
      [
        'wmctrl',
        ['-ir', '0x0000000A', '-b', 'remove,maximized_vert,maximized_horz'],
      ],
      ['wmctrl', ['-ir', '0x0000000A', '-e', '0,10,20,1900,1040']],
      [
        'wmctrl',
        ['-ir', '0x0000000A', '-b', 'add,maximized_vert,maximized_horz'],
      ],
    ])
  })

  test('passes notifications through and swallows notification failures', () => {
    const show = vi.fn()
    const adapter = new LinuxX11Adapter(
      dependencies({
        Notification: class {
          constructor(options: { title: string; body: string }) {
            expect(options).toEqual({ title: 'Title', body: 'Body' })
          }
          show = show
        },
      }),
    )
    adapter.notify('Title', 'Body')
    expect(show).toHaveBeenCalledOnce()

    const failing = new LinuxX11Adapter(
      dependencies({
        Notification: class {
          show(): void {
            throw new Error('notification error')
          }
        },
      }),
    )
    expect(() => failing.notify('Title', 'Body')).not.toThrow()
  })
})
