import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

import { describe, expect, test, vi } from 'vitest'

import type { DisplayInfo, ExternalTarget } from '../../../shared/models'
import {
  InvalidExternalTargetError,
  WindowsAdapter,
  WindowsHelperError,
  type SpawnLike,
  type WindowsDependencies,
} from './adapter'

const helperPath = 'C:\\safe helper\\window-helper.ps1'
const sentinel = "C:\\unsafe path\\'; Write-Error pwned"

function dependencies(
  overrides: Partial<WindowsDependencies> = {},
): WindowsDependencies {
  return {
    screen: {
      getAllDisplays: () => [
        {
          id: 42,
          label: '',
          bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
          workArea: { x: -1910, y: 10, width: 1900, height: 1040 },
        },
        {
          id: 43,
          label: 'Main',
          bounds: { x: 0, y: 0, width: 2560, height: 1440 },
          workArea: { x: 0, y: 0, width: 2560, height: 1400 },
        },
      ],
      getPrimaryDisplay: () => ({ id: 43 }),
      dipToScreenRect: (_window, rect) => ({ ...rect }),
    },
    runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    spawn: vi.fn(),
    Notification: class {
      show(): void {}
    },
    helperPath,
    ...overrides,
  }
}

class FakeChild extends EventEmitter implements SpawnLike {
  readonly unref = vi.fn()
}

function helperResponse(result: unknown): string {
  return JSON.stringify({ protocolVersion: 1, ok: true, result })
}

function decodePayload(runCommand: ReturnType<typeof vi.fn>): unknown {
  const args = runCommand.mock.calls[0]?.[1] as string[]
  return JSON.parse(Buffer.from(args.at(-1) ?? '', 'base64').toString('utf8'))
}

const display: DisplayInfo = {
  id: '43',
  label: 'Main',
  primary: true,
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  workArea: { x: 0, y: 0, width: 2560, height: 1400 },
}

describe('WindowsAdapter', () => {
  test('maps Electron displays without mutation including negative coordinates', async () => {
    const adapter = new WindowsAdapter(dependencies())

    await expect(adapter.listDisplays()).resolves.toEqual([
      {
        id: '42',
        label: 'Display 42',
        primary: false,
        bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
        workArea: { x: -1910, y: 10, width: 1900, height: 1040 },
      },
      display,
    ])
  })

  test('lists only strictly valid helper windows through a fixed PowerShell invocation', async () => {
    const fixtureUrl = new URL(
      '../../../../tests/fixtures/windows-helper-windows.json',
      import.meta.url,
    )
    const runCommand = vi.fn().mockResolvedValue({
      stdout: await readFile(fileURLToPath(fixtureUrl), 'utf8'),
      stderr: sentinel,
    })
    const adapter = new WindowsAdapter(dependencies({ runCommand }))

    await expect(adapter.listWindows()).resolves.toEqual([
      {
        id: '0x00000000000100aa',
        pid: 4242,
        title: '钉钉主窗口',
        nativeClass: '应用窗口',
        executablePath: 'C:\\程序文件\\示例\\应用.exe',
        bounds: { x: -1600, y: 20, width: 1200, height: 800 },
        visible: true,
      },
      {
        id: '0x00000000000100ab',
        pid: 4243,
        title: 'Second application',
        bounds: { x: 0, y: 0, width: 1000, height: 700 },
        visible: true,
      },
    ])
    expect(runCommand).toHaveBeenCalledWith('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath,
      'list-windows',
      '--payload-base64',
      'e30=',
    ])
  })

  test('captures foreground and moves through base64 JSON payloads only', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: helperResponse({
          id: '0x2',
          pid: 4,
          title: sentinel,
          bounds: { x: 0, y: 1, width: 2, height: 3 },
          visible: true,
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: helperResponse({}), stderr: '' })
    const adapter = new WindowsAdapter(dependencies({ runCommand }))

    await expect(adapter.captureForegroundWindow()).resolves.toMatchObject({
      id: '0x2',
      title: sentinel,
    })
    await expect(
      adapter.moveAndMaximize(sentinel, display),
    ).resolves.toBeUndefined()

    expect(runCommand.mock.calls[0]?.[1]).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath,
      'foreground-window',
      '--payload-base64',
      'e30=',
    ])
    expect(decodePayload(runCommand)).toEqual({})
    expect(runCommand.mock.calls[1]?.[1]).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath,
      'move-maximize',
      '--payload-base64',
      expect.any(String),
    ])
    expect(
      decodePayload({
        mock: { calls: [runCommand.mock.calls[1]] },
      } as ReturnType<typeof vi.fn>),
    ).toEqual({
      windowId: sentinel,
      workArea: display.workArea,
    })
    for (const [, args] of runCommand.mock.calls as [string, string[]][]) {
      expect(args.slice(0, -1).join(' ')).not.toContain(sentinel)
      expect(args.slice(0, -1).join(' ')).not.toContain(
        display.workArea.x.toString(),
      )
    }
  })

  test('converts DIP work area to physical pixels without mutating the display', async () => {
    const original: DisplayInfo = {
      ...display,
      workArea: { x: -1200, y: 10, width: 800, height: 600 },
    }
    const before = {
      ...original,
      bounds: { ...original.bounds },
      workArea: { ...original.workArea },
    }
    const runCommand = vi.fn().mockResolvedValue({
      stdout: helperResponse({}),
      stderr: '',
    })
    const dipToScreenRect = vi.fn().mockReturnValue({
      x: -1800,
      y: 15,
      width: 1200,
      height: 900,
    })
    const base = dependencies()
    const adapter = new WindowsAdapter(
      dependencies({
        runCommand,
        screen: { ...base.screen, dipToScreenRect },
      }),
    )

    await adapter.moveAndMaximize('0x2', original)

    expect(dipToScreenRect).toHaveBeenCalledWith(null, original.workArea)
    expect(decodePayload(runCommand)).toEqual({
      windowId: '0x2',
      workArea: { x: -1800, y: 15, width: 1200, height: 900 },
    })
    expect(original).toEqual(before)
  })

  test.each([
    ['invalid JSON', 'not-json', 'INVALID_RESPONSE'],
    [
      'wrong protocol',
      JSON.stringify({ protocolVersion: 2, ok: true, result: [] }),
      'INVALID_RESPONSE',
    ],
    [
      'failure response',
      JSON.stringify({
        protocolVersion: 1,
        ok: false,
        error: { code: 'WINDOW_NOT_FOUND', message: sentinel },
      }),
      'WINDOW_NOT_FOUND',
    ],
  ])('rejects %s with a stable helper error', async (_name, stdout, code) => {
    const adapter = new WindowsAdapter(
      dependencies({
        runCommand: vi.fn().mockResolvedValue({ stdout, stderr: sentinel }),
      }),
    )

    await expect(adapter.listWindows()).rejects.toMatchObject({
      name: 'WindowsHelperError',
      code,
      message: `Windows helper failed: ${code}`,
    })
  })

  test('rejects malformed helper window data', async () => {
    const adapter = new WindowsAdapter(
      dependencies({
        runCommand: vi.fn().mockResolvedValue({
          stdout: helperResponse([
            { id: '0x1', pid: -1, title: 'x', bounds: {}, visible: true },
          ]),
          stderr: '',
        }),
      }),
    )

    await expect(adapter.listWindows()).rejects.toBeInstanceOf(
      WindowsHelperError,
    )
  })

  test('launches raw target arguments without a shell and observes errors', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const adapter = new WindowsAdapter(dependencies({ spawn }))
    const launched = adapter.launchExternal({
      executablePath: sentinel,
      args: ['--title', sentinel],
      matcher: null,
    })
    expect(spawn).toHaveBeenCalledWith(sentinel, ['--title', sentinel], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    })
    child.emit('spawn')
    await expect(launched).resolves.toBeUndefined()

    await expect(
      new WindowsAdapter(dependencies()).launchExternal({
        executablePath: ' ',
        args: [],
        matcher: null,
      }),
    ).rejects.toBeInstanceOf(InvalidExternalTargetError)
    const failing = new FakeChild()
    const pending = new WindowsAdapter(
      dependencies({ spawn: vi.fn().mockReturnValue(failing) }),
    ).launchExternal({ executablePath: 'x', args: [], matcher: null })
    failing.emit('error', new Error('failed'))
    await expect(pending).rejects.toThrow('failed')
  })

  test('passes notifications through while swallowing notification failures', () => {
    const show = vi.fn()
    const adapter = new WindowsAdapter(
      dependencies({
        Notification: class {
          show = show
        },
      }),
    )
    adapter.notify('Title', 'Body')
    expect(show).toHaveBeenCalledOnce()
    expect(() =>
      new WindowsAdapter(
        dependencies({
          Notification: class {
            show(): void {
              throw new Error('no')
            }
          },
        }),
      ).notify('Title', 'Body'),
    ).not.toThrow()
  })

  test('helper is a fixed-command PInvoke program that never evaluates payload text', async () => {
    const source = await readFile(
      new URL(
        '../../../../resources/windows/window-helper.ps1',
        import.meta.url,
      ),
      'utf8',
    )
    expect(source).toContain("'list-windows'")
    expect(source).toContain("'foreground-window'")
    expect(source).toContain("'move-maximize'")
    expect(source).toContain(
      '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    )
    for (const api of [
      'EnumWindows',
      'IsWindowVisible',
      'GetWindowText',
      'GetClassName',
      'GetWindowThreadProcessId',
      'GetWindowRect',
      'GetForegroundWindow',
      'ShowWindowAsync',
      'SetWindowPos',
      'GetWindow',
      'GetWindowLong',
      'SetThreadDpiAwarenessContext',
    ]) {
      expect(source).toContain(api)
    }
    expect(source).not.toMatch(/Invoke-Expression|\biex\b/i)
    expect(/Invoke-Expression|\\biex\\b/i.test('iex')).toBe(false)
    expect(/Invoke-Expression|\biex\b/i.test('iex')).toBe(true)
    expect(source).not.toContain(sentinel)
  })

  test('helper enters per-monitor-v2 DPI awareness before dispatch', async () => {
    const source = await readFile(
      new URL(
        '../../../../resources/windows/window-helper.ps1',
        import.meta.url,
      ),
      'utf8',
    )
    const awarenessCall = source.indexOf(
      '[TouchFishNative]::SetThreadDpiAwarenessContext([IntPtr](-4))',
    )
    const failure = source.indexOf("Write-Failure 'DPI_AWARENESS_FAILED'")
    const dispatch = source.indexOf('switch ($command)')

    expect(awarenessCall).toBeGreaterThan(-1)
    expect(source).toContain('if ($previousDpiContext -eq [IntPtr]::Zero)')
    expect(failure).toBeGreaterThan(awarenessCall)
    expect(dispatch).toBeGreaterThan(failure)
  })

  test('helper reports movement failures before it can report success', async () => {
    const source = await readFile(
      new URL(
        '../../../../resources/windows/window-helper.ps1',
        import.meta.url,
      ),
      'utf8',
    )
    const setWindowPos = source.indexOf(
      '$moved = [TouchFishNative]::SetWindowPos',
    )
    const moveFailure = source.indexOf("Write-Failure 'WINDOW_MOVE_FAILED'")
    const showWindow = source.indexOf(
      '$maximized = [TouchFishNative]::ShowWindowAsync',
    )
    const maximizeFailure = source.indexOf(
      "Write-Failure 'WINDOW_MAXIMIZE_FAILED'",
    )
    const success = source.indexOf('Write-Envelope $true ([ordered]@{})')

    expect(setWindowPos).toBeGreaterThan(-1)
    expect(moveFailure).toBeGreaterThan(setWindowPos)
    expect(showWindow).toBeGreaterThan(moveFailure)
    expect(maximizeFailure).toBeGreaterThan(showWindow)
    expect(success).toBeGreaterThan(maximizeFailure)
  })
})
