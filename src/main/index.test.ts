import { win32 } from 'node:path'

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}))

import type { PlatformAdapter, TouchFishConfig } from '../shared/models'
import { IPC_CHANNELS } from '../shared/ipc'
import { configSchema, defaultConfig } from './config/schema'
import { registerTouchFishIpc } from './ipc'
import type { ShortcutSetResult } from './services/shortcut-service'
import { TrayService } from './services/tray-service'
import {
  bootstrapTouchFish,
  createCoordinatedConfigStore,
  createCoordinatedTrayAutostart,
  createTrayErrorHandler,
  enrichFirstRunWithDingTalk,
  resolveSceneNotification,
  type ApplicationRuntime,
  type BootstrapDependencies,
  type LifecycleApp,
} from './index'

describe('bootstrapTouchFish', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('requests the instance lock synchronously before readiness', () => {
    const order: string[] = []
    const fixture = createFixture({ order })
    fixture.app.requestSingleInstanceLock = vi.fn(() => {
      order.push('lock')
      return true
    })
    fixture.app.whenReady = vi.fn(() => {
      order.push('ready')
      return Promise.resolve()
    })

    bootstrapTouchFish(fixture.dependencies)

    expect(order.slice(0, 2)).toEqual(['lock', 'ready'])
  })

  test('quits a secondary instance without asking for readiness or initializing', async () => {
    const fixture = createFixture()
    fixture.app.requestSingleInstanceLock = vi.fn(() => false)

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    expect(fixture.app.quit).toHaveBeenCalledOnce()
    expect(fixture.app.whenReady).not.toHaveBeenCalled()
    expect(fixture.dependencies.createWindowsAdapter).not.toHaveBeenCalled()
    expect(fixture.dependencies.createRuntime).not.toHaveBeenCalled()
  })

  test('focuses settings for a second instance after readiness', async () => {
    const fixture = createFixture()
    fixture.config.firstRunComplete = true
    const handle = bootstrapTouchFish(fixture.dependencies)
    fixture.app.emit('second-instance')

    await handle.initialized
    await flushPromises()

    expect(fixture.runtime.settings.show).toHaveBeenCalledOnce()
  })

  test.each([
    ['win32', 'createWindowsAdapter', 'createLinuxAdapter'],
    ['linux', 'createLinuxAdapter', 'createWindowsAdapter'],
  ] as const)(
    'constructs only the %s adapter',
    async (platform, selectedFactory, wrongFactory) => {
      const fixture = createFixture({ platform })

      const handle = bootstrapTouchFish(fixture.dependencies)
      await handle.initialized

      expect(fixture.dependencies[selectedFactory]).toHaveBeenCalledOnce()
      expect(fixture.dependencies[wrongFactory]).not.toHaveBeenCalled()
      expect(fixture.dependencies.createRuntime).toHaveBeenCalledOnce()
    },
  )

  test('reports Wayland clearly and quits without constructing an adapter', async () => {
    const fixture = createFixture({
      platform: 'linux',
      env: { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' },
      systemLocale: 'zh-CN',
    })

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    expect(fixture.dependencies.reportError).toHaveBeenCalledWith(
      'TouchFish',
      expect.stringContaining('X11'),
    )
    expect(fixture.dependencies.createLinuxAdapter).not.toHaveBeenCalled()
    expect(fixture.dependencies.createWindowsAdapter).not.toHaveBeenCalled()
    expect(fixture.dependencies.createRuntime).not.toHaveBeenCalled()
    expect(fixture.app.quit).toHaveBeenCalledOnce()
  })

  test('reports an unsupported operating system and quits cleanly', async () => {
    const fixture = createFixture({ platform: 'darwin' })

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    expect(fixture.dependencies.reportError).toHaveBeenCalledWith(
      'TouchFish',
      expect.stringContaining('Windows'),
    )
    expect(fixture.dependencies.createRuntime).not.toHaveBeenCalled()
    expect(fixture.app.quit).toHaveBeenCalledOnce()
  })

  test('loads config, applies autostart, initializes tray, registers shortcut, then shows first-run settings', async () => {
    const order: string[] = []
    const fixture = createFixture({ order })

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    expect(order).toEqual([
      'adapter:windows',
      'runtime',
      'config:load',
      'autostart:set',
      'tray:initialize',
      'tray:language',
      'tray:autostart',
      'shortcut:set',
      'settings:show',
    ])
    expect(fixture.runtime.autostart.setEnabled).toHaveBeenCalledWith(true)
    expect(fixture.runtime.tray.setLanguage).toHaveBeenCalledWith('system')
    expect(fixture.runtime.tray.setAutostartEnabled).toHaveBeenCalledWith(true)
  })

  test('persists an installed DingTalk preset before opening the renderer', async () => {
    const order: string[] = []
    const fixture = createFixture({ order, platform: 'linux' })
    fixture.dependencies.accessCandidate = vi.fn(async () => {
      order.push('dingtalk:probe')
    })

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    expect(fixture.runtime.config.save).toHaveBeenCalledWith(
      expect.objectContaining({
        external: expect.objectContaining({
          executablePath: '/opt/apps/com.alibabainc.dingtalk/files/Elevator.sh',
        }),
      }),
    )
    expect(order.indexOf('config:save')).toBeLessThan(
      order.indexOf('settings:show'),
    )
  })

  test('hidden startup suppresses settings while still starting services', async () => {
    const fixture = createFixture({ argv: ['touchfish', '--hidden'] })

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    expect(fixture.runtime.tray.initialize).toHaveBeenCalledOnce()
    expect(fixture.runtime.settings.show).not.toHaveBeenCalled()
  })

  test('run-scene runs exactly once after readiness even when hidden', async () => {
    const fixture = createFixture({
      argv: ['touchfish', '--hidden', '--run-scene'],
    })

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    expect(fixture.runtime.settings.show).not.toHaveBeenCalled()
    expect(fixture.runtime.orchestrator.run).toHaveBeenCalledOnce()
    expect(fixture.runtime.orchestrator.run).toHaveBeenCalledWith(
      fixture.config,
    )
  })

  test('shortcut callback reloads the latest config and runs one scene', async () => {
    const fixture = createFixture()
    const latest = cloneConfig({ web: { url: 'https://latest.example' } })
    fixture.runtime.config.load = vi
      .fn()
      .mockResolvedValueOnce(fixture.config)
      .mockResolvedValueOnce(latest)

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized
    const callback = fixture.runtime.shortcut.set.mock.calls[0]?.[1]
    await callback?.()

    expect(fixture.runtime.config.load).toHaveBeenCalledTimes(2)
    expect(fixture.runtime.orchestrator.run).toHaveBeenCalledOnce()
    expect(fixture.runtime.orchestrator.run).toHaveBeenCalledWith(latest)
  })

  test('communicates and logs shortcut conflicts without aborting startup', async () => {
    const fixture = createFixture()
    fixture.runtime.shortcut.set.mockReturnValue({
      ok: false,
      reason: 'conflict',
    })

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    expect(fixture.runtime.logger.error).toHaveBeenCalledWith(
      'shortcut-conflict',
    )
    expect(fixture.dependencies.reportError).toHaveBeenCalledWith(
      'TouchFish',
      expect.stringContaining('shortcut'),
    )
    expect(fixture.runtime.settings.show).toHaveBeenCalledOnce()
  })

  test('cleans up owned services exactly once', async () => {
    const fixture = createFixture()
    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized

    fixture.app.emit('before-quit')
    fixture.app.emit('will-quit')
    handle.dispose()

    expect(fixture.runtime.shortcut.dispose).toHaveBeenCalledOnce()
    expect(fixture.runtime.disposeIpc).toHaveBeenCalledOnce()
    expect(fixture.runtime.settings.destroy).toHaveBeenCalledOnce()
    expect(fixture.runtime.web.destroy).toHaveBeenCalledOnce()
    expect(fixture.runtime.tray.dispose).toHaveBeenCalledOnce()
  })

  test('contains and reports a rejected startup service without an unhandled rejection', async () => {
    const fixture = createFixture()
    fixture.runtime.autostart.setEnabled.mockRejectedValue(
      new Error('autostart unavailable'),
    )
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      const handle = bootstrapTouchFish(fixture.dependencies)
      await handle.initialized
      await flushPromises()

      expect(unhandled).not.toHaveBeenCalled()
      expect(fixture.runtime.logger.error).toHaveBeenCalledWith(
        'autostart-startup-failed',
        { errorName: 'Error' },
      )
      expect(fixture.dependencies.reportError).toHaveBeenCalled()
      expect(fixture.runtime.tray.initialize).toHaveBeenCalledOnce()
      expect(fixture.runtime.settings.show).toHaveBeenCalledOnce()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  test('contains readiness failure when locale and error reporting also throw', async () => {
    const fixture = createFixture()
    fixture.app.whenReady.mockRejectedValue(new Error('ready failed'))
    Object.defineProperty(fixture.dependencies, 'systemLocale', {
      configurable: true,
      get: () => {
        throw new Error('locale unavailable before ready')
      },
    })
    fixture.dependencies.reportError = vi.fn(() => {
      throw new Error('dialog unavailable')
    })

    const handle = bootstrapTouchFish(fixture.dependencies)

    await expect(handle.initialized).resolves.toBeUndefined()
    expect(fixture.app.quit).toHaveBeenCalledOnce()
    expect(fixture.dependencies.createRuntime).not.toHaveBeenCalled()
  })

  test('routes tray toggle errors through sanitized diagnostics and localized reporting', () => {
    const fixture = createFixture({ systemLocale: 'en-US' })
    const handler = createTrayErrorHandler(
      fixture.runtime.logger,
      fixture.dependencies,
      () => 'zh-CN',
    )

    handler(new Error('secret executable path'))

    expect(fixture.runtime.logger.error).toHaveBeenCalledWith(
      'tray-autostart-toggle-failed',
      { errorName: 'Error' },
    )
    expect(fixture.dependencies.reportError).toHaveBeenCalledWith(
      'TouchFish',
      '无法更改开机启动设置。',
    )
  })

  test('tray Quit delegates cleanup to the composition root exactly once', async () => {
    const fixture = createFixture()
    const buildFromTemplate = vi.fn((template) => template)
    const nativeTray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(),
    }
    fixture.app.quit = vi.fn(() => fixture.app.emit('before-quit'))
    const tray = new TrayService({
      Tray: trayClass(nativeTray),
      Menu: { buildFromTemplate },
      icon: 'icon',
      locale: 'en-US',
      onOpenSettings: vi.fn(),
      onRunScene: vi.fn(),
      onQuit: fixture.app.quit,
      autostart: {
        isEnabled: vi.fn().mockResolvedValue(false),
        setEnabled: vi.fn(),
      },
    })
    const runtime: ApplicationRuntime = { ...fixture.runtime, tray }
    fixture.dependencies.createRuntime = vi.fn(async () => runtime)

    const handle = bootstrapTouchFish(fixture.dependencies)
    await handle.initialized
    const menu = buildFromTemplate.mock.calls.at(-1)?.[0]
    menu?.[3]?.click?.()
    handle.dispose()

    expect(fixture.app.quit).toHaveBeenCalledOnce()
    expect(fixture.runtime.shortcut.dispose).toHaveBeenCalledOnce()
    expect(nativeTray.destroy).toHaveBeenCalledOnce()
  })

  test('does not create a runtime when quit wins during adapter loading', async () => {
    const fixture = createFixture()
    const adapter = deferred<PlatformAdapter>()
    fixture.dependencies.createWindowsAdapter = vi
      .fn()
      .mockReturnValue(adapter.promise)

    const handle = bootstrapTouchFish(fixture.dependencies)
    await vi.waitFor(() =>
      expect(fixture.dependencies.createWindowsAdapter).toHaveBeenCalledOnce(),
    )
    fixture.app.emit('before-quit')
    adapter.resolve(fixture.adapter)
    await handle.initialized

    expect(fixture.dependencies.createRuntime).not.toHaveBeenCalled()
    expect(fixture.runtime.config.load).not.toHaveBeenCalled()
  })

  test('disposes a runtime acquired after quit without starting it', async () => {
    const fixture = createFixture()
    const acquired = deferred<ApplicationRuntime>()
    fixture.dependencies.createRuntime = vi
      .fn()
      .mockReturnValue(acquired.promise)

    const handle = bootstrapTouchFish(fixture.dependencies)
    await vi.waitFor(() =>
      expect(fixture.dependencies.createRuntime).toHaveBeenCalledOnce(),
    )
    fixture.app.emit('before-quit')
    acquired.resolve(fixture.runtime)
    await handle.initialized
    fixture.app.emit('before-quit')
    fixture.app.emit('will-quit')
    handle.dispose()

    expect(fixture.runtime.config.load).not.toHaveBeenCalled()
    expectRuntimeDisposedOnce(fixture.runtime)
  })

  test('stops startup at the next awaited boundary and disposes once', async () => {
    const fixture = createFixture()
    const loading = deferred<TouchFishConfig>()
    fixture.runtime.config.load.mockReturnValue(loading.promise)

    const handle = bootstrapTouchFish(fixture.dependencies)
    await vi.waitFor(() =>
      expect(fixture.runtime.config.load).toHaveBeenCalledOnce(),
    )
    fixture.app.emit('before-quit')
    loading.resolve(fixture.config)
    await handle.initialized
    fixture.app.emit('before-quit')
    handle.dispose()

    expect(fixture.runtime.autostart.setEnabled).not.toHaveBeenCalled()
    expect(fixture.runtime.tray.initialize).not.toHaveBeenCalled()
    expect(fixture.runtime.shortcut.set).not.toHaveBeenCalled()
    expect(fixture.runtime.settings.show).not.toHaveBeenCalled()
    expectRuntimeDisposedOnce(fixture.runtime)
  })
})

describe('resolveSceneNotification', () => {
  test('uses explicit Chinese scene messages', () => {
    const config = cloneConfig({ language: 'zh-CN' })

    expect(resolveSceneNotification('busy', config, 'en-US')).toBe(
      '已有场景正在运行。',
    )
    expect(resolveSceneNotification('fallback', config, 'en-US')).toBe(
      '正在使用备用屏幕分配。',
    )
    expect(resolveSceneNotification('success', config, 'en-US')).toBe(
      '场景运行成功。',
    )
  })

  test('uses English scene messages when following an English system locale', () => {
    const config = cloneConfig({ language: 'system' })

    expect(resolveSceneNotification('partial', config, 'en-GB')).toBe(
      'Scene completed with some problems.',
    )
    expect(resolveSceneNotification('failed', config, 'en-GB')).toBe(
      'Scene failed.',
    )
  })
})

describe('production state coordinators', () => {
  test('tray autostart loads the latest config and persists the new value', async () => {
    let latest = cloneConfig({ startAtLogin: false })
    const rawConfig = {
      load: vi.fn(async () => globalThis.structuredClone(latest)),
      save: vi.fn(async (config: TouchFishConfig) => {
        latest = globalThis.structuredClone(config)
      }),
    }
    const osAutostart = {
      isEnabled: vi.fn().mockResolvedValue(false),
      setEnabled: vi.fn().mockResolvedValue(undefined),
    }
    const autostart = createCoordinatedTrayAutostart(
      rawConfig,
      osAutostart,
      vi.fn(),
    )

    await autostart.setEnabled(true)

    expect(rawConfig.load).toHaveBeenCalledOnce()
    expect(osAutostart.setEnabled).toHaveBeenCalledWith(true)
    expect(rawConfig.save).toHaveBeenCalledWith(
      expect.objectContaining({ startAtLogin: true }),
    )
    expect(latest.startAtLogin).toBe(true)
  })

  test('IPC config save refreshes tray language and autostart after persistence', async () => {
    const rawConfig = {
      load: vi.fn().mockResolvedValue(cloneConfig()),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const tray = {
      setLanguage: vi.fn(),
      setAutostartEnabled: vi.fn(),
    }
    const coordinated = createCoordinatedConfigStore(rawConfig, tray)
    const save = registeredSaveHandler(coordinated)
    const updated = cloneConfig({
      language: 'zh-CN',
      startAtLogin: false,
    })

    await save({}, updated)

    expect(rawConfig.save).toHaveBeenCalledWith(updated)
    expect(tray.setLanguage).toHaveBeenCalledWith('zh-CN')
    expect(tray.setAutostartEnabled).toHaveBeenCalledWith(false)
  })

  test('tray config-save failure rolls OS back and leaves its check state unchanged', async () => {
    const previous = cloneConfig({ startAtLogin: false })
    const saveError = new Error('config disk full')
    const rawConfig = {
      load: vi.fn().mockResolvedValue(previous),
      save: vi.fn().mockRejectedValue(saveError),
    }
    const osAutostart = {
      isEnabled: vi.fn().mockResolvedValue(false),
      setEnabled: vi.fn().mockResolvedValue(undefined),
    }
    const onRollbackError = vi.fn()
    const autostart = createCoordinatedTrayAutostart(
      rawConfig,
      osAutostart,
      onRollbackError,
    )
    const buildFromTemplate = vi.fn((template) => template)
    const onError = vi.fn()
    const service = new TrayService({
      Tray: trayClass({
        setToolTip: vi.fn(),
        setContextMenu: vi.fn(),
        destroy: vi.fn(),
      }),
      Menu: { buildFromTemplate },
      icon: 'icon',
      locale: 'en-US',
      onOpenSettings: vi.fn(),
      onRunScene: vi.fn(),
      onQuit: vi.fn(),
      onError,
      autostart,
    })
    await service.initialize()
    const menu = buildFromTemplate.mock.calls.at(-1)?.[0]

    menu?.[2]?.click?.()
    await flushPromises()

    expect(osAutostart.setEnabled.mock.calls).toEqual([[true], [false]])
    expect(onRollbackError).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(saveError)
    expect(buildFromTemplate.mock.calls.at(-1)?.[0]?.[2]).toMatchObject({
      checked: false,
    })
  })

  test('failed settings config save does not change tray state', async () => {
    const saveError = new Error('config write failed')
    const rawConfig = {
      load: vi.fn().mockResolvedValue(cloneConfig()),
      save: vi.fn().mockRejectedValue(saveError),
    }
    const tray = {
      setLanguage: vi.fn(),
      setAutostartEnabled: vi.fn(),
    }
    const coordinated = createCoordinatedConfigStore(rawConfig, tray)
    const save = registeredSaveHandler(coordinated)

    await expect(
      save({}, cloneConfig({ language: 'zh-CN', startAtLogin: false })),
    ).rejects.toBe(saveError)

    expect(tray.setLanguage).not.toHaveBeenCalled()
    expect(tray.setAutostartEnabled).not.toHaveBeenCalled()
  })

  test('committed config save contains one tray sync failure and still runs the other sync', async () => {
    const languageError = new Error('menu language refresh failed')
    const rawConfig = {
      load: vi.fn().mockResolvedValue(cloneConfig()),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const tray = {
      setLanguage: vi.fn(() => {
        throw languageError
      }),
      setAutostartEnabled: vi.fn(),
    }
    const onTraySyncError = vi.fn()
    const coordinated = createCoordinatedConfigStore(
      rawConfig,
      tray,
      onTraySyncError,
    )
    const updated = cloneConfig({
      language: 'zh-CN',
      startAtLogin: false,
    })

    await expect(coordinated.save(updated)).resolves.toBeUndefined()

    expect(rawConfig.save).toHaveBeenCalledWith(updated)
    expect(tray.setLanguage).toHaveBeenCalledWith('zh-CN')
    expect(tray.setAutostartEnabled).toHaveBeenCalledWith(false)
    expect(onTraySyncError).toHaveBeenCalledWith('language', languageError)
  })

  test('rollback failure reports the rollback error but rejects with the original save error', async () => {
    const previous = cloneConfig({ startAtLogin: false })
    const saveError = new Error('config disk full')
    const rollbackError = new Error('OS rollback failed')
    const rawConfig = {
      load: vi.fn().mockResolvedValue(previous),
      save: vi.fn().mockRejectedValue(saveError),
    }
    const osAutostart = {
      isEnabled: vi.fn().mockResolvedValue(false),
      setEnabled: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(rollbackError),
    }
    const onRollbackError = vi.fn()
    const autostart = createCoordinatedTrayAutostart(
      rawConfig,
      osAutostart,
      onRollbackError,
    )
    const buildFromTemplate = vi.fn((template) => template)
    const onError = vi.fn()
    const service = new TrayService({
      Tray: trayClass({
        setToolTip: vi.fn(),
        setContextMenu: vi.fn(),
        destroy: vi.fn(),
      }),
      Menu: { buildFromTemplate },
      icon: 'icon',
      locale: 'en-US',
      onOpenSettings: vi.fn(),
      onRunScene: vi.fn(),
      onQuit: vi.fn(),
      onError,
      autostart,
    })
    await service.initialize()
    const menu = buildFromTemplate.mock.calls.at(-1)?.[0]
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      menu?.[2]?.click?.()
      await flushPromises()

      expect(osAutostart.setEnabled.mock.calls).toEqual([[true], [false]])
      expect(onRollbackError).toHaveBeenCalledWith(rollbackError)
      expect(onError).toHaveBeenCalledWith(saveError)
      expect(buildFromTemplate.mock.calls.at(-1)?.[0]?.[2]).toMatchObject({
        checked: false,
      })
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('enrichFirstRunWithDingTalk', () => {
  test('uses the deterministic Linux launcher preset when installed', async () => {
    const config = cloneConfig()
    const access = vi.fn(async (path: string) => {
      if (path !== '/opt/apps/com.alibabainc.dingtalk/files/Elevator.sh') {
        throw new Error('missing')
      }
    })

    const result = await enrichFirstRunWithDingTalk(config, {
      platform: 'linux',
      env: {},
      access,
    })

    expect(result.external).toEqual({
      executablePath: '/opt/apps/com.alibabainc.dingtalk/files/Elevator.sh',
      args: [],
      matcher: {
        executablePath: '/opt/apps/com.alibabainc.dingtalk/files/Elevator.sh',
        processName: 'com.alibabainc.dingtalk',
        nativeClass: 'com.alibabainc.dingtalk',
      },
    })
  })

  test('builds Windows candidates only from non-empty environment roots', async () => {
    const config = cloneConfig()
    const expected = win32.join(
      'C:\\Users\\Zac\\AppData\\Local',
      'DingTalk',
      'main',
      'current',
      'DingTalk.exe',
    )
    const access = vi.fn(async (path: string) => {
      if (path !== expected) throw new Error('missing')
    })

    const result = await enrichFirstRunWithDingTalk(config, {
      platform: 'win32',
      env: {
        LOCALAPPDATA: 'C:\\Users\\Zac\\AppData\\Local',
        ProgramFiles: '',
      },
      access,
    })

    expect(access.mock.calls.flat()).not.toContain(
      win32.join('DingTalk', 'DingTalk.exe'),
    )
    expect(result.external).toEqual({
      executablePath: expected,
      args: [],
      matcher: {
        executablePath: expected,
        processName: 'DingTalk.exe',
      },
    })
  })

  test.each([
    ['no candidate', vi.fn().mockRejectedValue(new Error('missing'))],
    ['probe error', vi.fn().mockRejectedValue(new TypeError('probe failed'))],
  ])('leaves config unchanged on %s', async (_case, access) => {
    const config = cloneConfig()

    const result = await enrichFirstRunWithDingTalk(config, {
      platform: 'linux',
      env: {},
      access,
    })

    expect(result).toBe(config)
  })

  test.each([
    cloneConfig({ firstRunComplete: true }),
    cloneConfig({
      external: {
        executablePath: '/custom/app',
        args: [],
        matcher: null,
      },
    }),
    cloneConfig({
      external: {
        executablePath: '',
        args: [],
        matcher: {
          executablePath: '/custom/app',
          processName: 'app',
        },
      },
    }),
  ])('never overwrites existing setup', async (config) => {
    const access = vi.fn().mockResolvedValue(undefined)

    const result = await enrichFirstRunWithDingTalk(config, {
      platform: 'linux',
      env: {},
      access,
    })

    expect(result).toBe(config)
    expect(access).not.toHaveBeenCalled()
  })
})

type FixtureOptions = {
  order?: string[]
  platform?: (typeof process)['platform']
  env?: Readonly<Record<string, string | undefined>>
  argv?: readonly string[]
  systemLocale?: string
}

function createFixture(options: FixtureOptions = {}) {
  const order = options.order ?? []
  const app = new FakeApp()
  const config = cloneConfig()
  const adapter = fakeAdapter()
  const runtime = createRuntime(config, order)
  const dependencies: BootstrapDependencies = {
    app,
    platform: options.platform ?? 'win32',
    env:
      options.env ??
      (options.platform === 'linux'
        ? { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }
        : {}),
    argv: options.argv ?? ['touchfish'],
    systemLocale: options.systemLocale ?? 'en-US',
    accessCandidate: vi.fn().mockRejectedValue(new Error('not installed')),
    createWindowsAdapter: vi.fn(async () => {
      order.push('adapter:windows')
      return adapter
    }),
    createLinuxAdapter: vi.fn(async () => {
      order.push('adapter:linux')
      return adapter
    }),
    createRuntime: vi.fn(async () => {
      order.push('runtime')
      return runtime
    }),
    reportError: vi.fn(),
  }
  return { app, adapter, config, dependencies, runtime }
}

function createRuntime(config: TouchFishConfig, order: string[]) {
  return {
    config: {
      load: vi.fn(async () => {
        order.push('config:load')
        return config
      }),
      save: vi.fn(async () => {
        order.push('config:save')
      }),
    },
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    autostart: {
      setEnabled: vi.fn(async (_enabled: boolean) => {
        order.push('autostart:set')
      }),
    },
    tray: {
      initialize: vi.fn(async () => {
        order.push('tray:initialize')
      }),
      setLanguage: vi.fn(() => order.push('tray:language')),
      setAutostartEnabled: vi.fn(() => order.push('tray:autostart')),
      dispose: vi.fn(),
    },
    shortcut: {
      set: vi.fn(
        (
          _accelerator: string,
          _callback: () => void | Promise<void>,
        ): ShortcutSetResult => {
          order.push('shortcut:set')
          return { ok: true }
        },
      ),
      dispose: vi.fn(),
    },
    settings: {
      show: vi.fn(async () => {
        order.push('settings:show')
      }),
      destroy: vi.fn(),
    },
    web: { destroy: vi.fn() },
    orchestrator: { run: vi.fn().mockResolvedValue({ status: 'success' }) },
    disposeIpc: vi.fn(),
  } satisfies ApplicationRuntime
}

class FakeApp implements LifecycleApp {
  requestSingleInstanceLock = vi.fn(() => true)
  quit = vi.fn()
  whenReady = vi.fn(() => Promise.resolve())
  private listeners = new Map<string, Array<() => void>>()

  on(event: string, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
}

function fakeAdapter(): PlatformAdapter {
  return {
    kind: 'windows',
    listDisplays: vi.fn(),
    listWindows: vi.fn(),
    captureForegroundWindow: vi.fn(),
    launchExternal: vi.fn(),
    moveAndMaximize: vi.fn(),
    notify: vi.fn(),
  }
}

function cloneConfig(
  overrides: Partial<TouchFishConfig> = {},
): TouchFishConfig {
  return configSchema.parse({ ...defaultConfig, ...overrides })
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
}

function deferred<Value>(): {
  promise: Promise<Value>
  resolve(value: Value): void
} {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function expectRuntimeDisposedOnce(runtime: ReturnType<typeof createRuntime>) {
  expect(runtime.shortcut.dispose).toHaveBeenCalledOnce()
  expect(runtime.disposeIpc).toHaveBeenCalledOnce()
  expect(runtime.settings.destroy).toHaveBeenCalledOnce()
  expect(runtime.web.destroy).toHaveBeenCalledOnce()
  expect(runtime.tray.dispose).toHaveBeenCalledOnce()
}

function trayClass<Tray extends object>(
  tray: Tray,
): new (icon: unknown) => Tray {
  return class {
    constructor(_icon: unknown) {
      return tray
    }
  } as unknown as new (icon: unknown) => Tray
}

function registeredSaveHandler(config: {
  load(): Promise<TouchFishConfig>
  save(value: TouchFishConfig): Promise<void>
}) {
  const handlers = new Map<
    string,
    (event: unknown, request: unknown) => Promise<unknown>
  >()
  registerTouchFishIpc(
    {
      handle: (channel, listener) => handlers.set(channel, listener),
      removeHandler: (channel) => handlers.delete(channel),
    },
    {
      config,
      platform: fakeAdapter(),
      orchestrator: {
        run: vi.fn().mockResolvedValue({ status: 'success', errors: [] }),
      },
      dialog: { showOpenFile: vi.fn().mockResolvedValue([]) },
      shortcut: { set: vi.fn().mockReturnValue({ ok: true }) },
      autostart: { setEnabled: vi.fn().mockResolvedValue(undefined) },
      log: { recent: vi.fn().mockResolvedValue([]) },
      web: { clearData: vi.fn().mockResolvedValue(undefined) },
      settings: {
        hide: vi.fn(),
        show: vi.fn(),
      },
      legacy: {
        inspect: vi.fn().mockResolvedValue(null),
        apply: vi.fn().mockResolvedValue({ ok: false, reason: 'no-proposal' }),
      },
      isTouchFishWindow: vi.fn().mockReturnValue(false),
      sleep: vi.fn().mockResolvedValue(undefined),
    },
  )
  const save = handlers.get(IPC_CHANNELS.saveConfig)
  if (save === undefined) throw new Error('save handler was not registered')
  return save
}
