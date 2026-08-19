import { readFile } from 'node:fs/promises'

import { describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn() },
}))

import { configSchema, defaultConfig } from './config/schema'
import { IPC_CHANNELS } from '../shared/ipc'
import type { DisplayInfo } from '../shared/models'
import electronViteConfig from '../../electron.vite.config'
import { createTouchFishApi } from '../preload/index'
import {
  IpcResponseValidationError,
  IpcValidationError,
  registerTouchFishIpc,
  TouchFishWindowCaptureError,
  type TouchFishIpcDependencies,
} from './ipc'

type Handler = (_event: unknown, request: unknown) => Promise<unknown>

const display = {
  id: 'display-1',
  label: 'Primary',
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
}

const nativeWindow = {
  id: 'window-1',
  pid: 42,
  title: 'Editor',
  nativeClass: 'editor',
  executablePath: '/usr/bin/editor',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  visible: true,
}

function createHarness() {
  const handlers = new Map<string, Handler>()
  const removeHandler = vi.fn((channel: string) => handlers.delete(channel))
  const calls: string[] = []
  let shortcutCallback: (() => void) | undefined
  const trustedSender = {}

  const dependencies: TouchFishIpcDependencies = {
    config: {
      load: vi.fn(async () => configSchema.parse(defaultConfig)),
      save: vi.fn(async () => {}),
    },
    platform: {
      listDisplays: vi.fn(async () => [display]),
      listWindows: vi.fn(async () => [nativeWindow]),
      captureForegroundWindow: vi.fn(async () => nativeWindow),
    },
    orchestrator: {
      run: vi.fn(async () => ({ status: 'success' as const, errors: [] })),
    },
    dialog: { showOpenFile: vi.fn(async () => ['/tmp/editor']) },
    shortcut: {
      set: vi.fn((_accelerator, callback) => {
        shortcutCallback = callback
        return { ok: true as const }
      }),
    },
    autostart: { setEnabled: vi.fn(async () => {}) },
    log: { recent: vi.fn(async () => [{ event: 'ok' }]) },
    web: { clearData: vi.fn(async () => {}) },
    settings: {
      hide: vi.fn(async () => {
        calls.push('hide')
      }),
      show: vi.fn(async () => {
        calls.push('show')
      }),
    },
    legacy: {
      inspect: vi.fn(async () => ({ url: 'https://example.test/legacy' })),
      apply: vi.fn(async () => ({ ok: true as const })),
    },
    isTrustedSender: vi.fn(
      (event: unknown) =>
        (event as { sender?: unknown } | undefined)?.sender === trustedSender,
    ),
    isTouchFishWindow: vi.fn(() => false),
    sleep: vi.fn(async (milliseconds) => {
      calls.push(`sleep:${milliseconds}`)
    }),
  }

  registerTouchFishIpc(
    {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler,
    },
    dependencies,
  )

  const invokeAs = (event: unknown, channel: string, request: unknown) => {
    const handler = handlers.get(channel)
    if (handler === undefined) throw new Error(`missing handler: ${channel}`)
    return handler(event, request)
  }
  const invoke = (channel: string, request: unknown) =>
    invokeAs({ sender: trustedSender }, channel, request)

  return {
    calls,
    dependencies,
    handlers,
    invoke,
    invokeAs,
    removeHandler,
    shortcutCallback: () => shortcutCallback,
  }
}

describe('TouchFish IPC bridge', () => {
  test('keeps Electron external to the sandboxed preload bundle', () => {
    expect(
      electronViteConfig.preload?.build?.rollupOptions?.external,
    ).toContain('electron')
  })

  test('exposes exactly the frozen constrained renderer API', async () => {
    const invoke = vi.fn(async () => undefined)
    const api = createTouchFishApi(invoke)
    expect(Object.keys(api).sort()).toEqual([
      'applyLegacyMigration',
      'beginWindowCapture',
      'chooseExecutable',
      'clearWebData',
      'getDiagnostics',
      'getLegacyMigration',
      'listDisplays',
      'listWindows',
      'loadConfig',
      'runScene',
      'saveConfig',
      'setShortcut',
      'setStartAtLogin',
    ])
    expect(Object.isFrozen(api)).toBe(true)
    await api.loadConfig()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.loadConfig, undefined)

    const source = await readFile(
      new globalThis.URL('../preload/index.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('Object.freeze')
    expect(source).not.toMatch(/\b(send|fs|process|shell)\b/)
  })

  test('registers and cleans up one handler for every channel', () => {
    const harness = createHarness()
    expect(harness.handlers.size).toBe(Object.keys(IPC_CHANNELS).length)
    const cleanup = registerTouchFishIpc(
      { handle: vi.fn(), removeHandler: harness.removeHandler },
      harness.dependencies,
    )
    cleanup()
    expect(harness.removeHandler).toHaveBeenCalledTimes(
      Object.keys(IPC_CHANNELS).length,
    )
  })

  test.each([
    [IPC_CHANNELS.saveConfig, defaultConfig, 'save'],
    [IPC_CHANNELS.runScene, undefined, 'run'],
    [IPC_CHANNELS.chooseExecutable, undefined, 'choose'],
  ])(
    'rejects an unauthorized sender before %s can reach services',
    async (channel, request, _service) => {
      const harness = createHarness()

      await expect(
        harness.invokeAs({ sender: {} }, channel, request),
      ).rejects.toThrow('Unauthorized TouchFish IPC sender')
      expect(harness.dependencies.config.save).not.toHaveBeenCalled()
      expect(harness.dependencies.orchestrator.run).not.toHaveBeenCalled()
      expect(harness.dependencies.dialog.showOpenFile).not.toHaveBeenCalled()
    },
  )

  test.each([
    [IPC_CHANNELS.saveConfig, { ...defaultConfig, extra: true }, 'config'],
    [IPC_CHANNELS.setShortcut, { accelerator: '' }, 'shortcut'],
    [IPC_CHANNELS.setStartAtLogin, { enabled: true, extra: true }, 'autostart'],
    [IPC_CHANNELS.getDiagnostics, { limit: 201 }, 'diagnostics'],
    [IPC_CHANNELS.clearWebData, {}, 'web'],
    [
      IPC_CHANNELS.applyLegacyMigration,
      { confirmed: false, proposal: { url: 'https://example.test' } },
      'migration',
    ],
  ])(
    'rejects invalid %s requests before calling a service',
    async (channel, request, service) => {
      const harness = createHarness()
      await expect(harness.invoke(channel, request)).rejects.toBeInstanceOf(
        IpcValidationError,
      )
      if (service === 'config')
        expect(harness.dependencies.config.save).not.toHaveBeenCalled()
      if (service === 'shortcut')
        expect(harness.dependencies.shortcut.set).not.toHaveBeenCalled()
      if (service === 'autostart')
        expect(harness.dependencies.autostart.setEnabled).not.toHaveBeenCalled()
      if (service === 'diagnostics')
        expect(harness.dependencies.log.recent).not.toHaveBeenCalled()
      if (service === 'web')
        expect(harness.dependencies.web.clearData).not.toHaveBeenCalled()
      if (service === 'migration')
        expect(harness.dependencies.legacy.apply).not.toHaveBeenCalled()
    },
  )

  test('rejects service data that violates its response schema', async () => {
    const harness = createHarness()
    vi.mocked(harness.dependencies.platform.listDisplays).mockResolvedValueOnce(
      [{ ...display, unknown: true }] as unknown as DisplayInfo[],
    )
    await expect(
      harness.invoke(IPC_CHANNELS.listDisplays, undefined),
    ).rejects.toBeInstanceOf(IpcResponseValidationError)
  })

  test('captures after hiding settings and always restores it', async () => {
    const harness = createHarness()
    vi.mocked(
      harness.dependencies.platform.captureForegroundWindow,
    ).mockImplementationOnce(async () => {
      harness.calls.push('capture')
      return nativeWindow
    })
    await expect(
      harness.invoke(IPC_CHANNELS.beginWindowCapture, undefined),
    ).resolves.toEqual(nativeWindow)
    expect(harness.calls).toEqual(['hide', 'sleep:500', 'capture', 'show'])
  })

  test('returns null capture and restores settings after capture failures', async () => {
    const nullHarness = createHarness()
    vi.mocked(
      nullHarness.dependencies.platform.captureForegroundWindow,
    ).mockResolvedValueOnce(null)
    await expect(
      nullHarness.invoke(IPC_CHANNELS.beginWindowCapture, undefined),
    ).resolves.toBeNull()
    expect(nullHarness.dependencies.settings.show).toHaveBeenCalledOnce()

    const failureHarness = createHarness()
    vi.mocked(
      failureHarness.dependencies.platform.captureForegroundWindow,
    ).mockRejectedValueOnce(new Error('no access'))
    await expect(
      failureHarness.invoke(IPC_CHANNELS.beginWindowCapture, undefined),
    ).rejects.toThrow('no access')
    expect(failureHarness.dependencies.settings.show).toHaveBeenCalledOnce()
  })

  test('rejects TouchFish-owned captured windows and restores settings', async () => {
    const harness = createHarness()
    vi.mocked(harness.dependencies.isTouchFishWindow).mockReturnValueOnce(true)
    await expect(
      harness.invoke(IPC_CHANNELS.beginWindowCapture, undefined),
    ).rejects.toBeInstanceOf(TouchFishWindowCaptureError)
    expect(harness.dependencies.settings.show).toHaveBeenCalledOnce()
  })

  test('only applies a confirmed legacy migration and runs shortcut callbacks safely', async () => {
    const harness = createHarness()
    await harness.invoke(IPC_CHANNELS.applyLegacyMigration, {
      confirmed: true,
      proposal: { url: 'https://example.test/legacy' },
    })
    expect(harness.dependencies.legacy.apply).toHaveBeenCalledWith({
      url: 'https://example.test/legacy',
    })

    await harness.invoke(IPC_CHANNELS.setShortcut, {
      accelerator: 'Ctrl+Alt+Z',
    })
    harness.shortcutCallback()?.()
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    expect(harness.dependencies.orchestrator.run).toHaveBeenCalled()
  })
})
