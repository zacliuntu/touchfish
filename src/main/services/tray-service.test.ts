import { describe, expect, test, vi } from 'vitest'

import { TrayService, type TrayLike } from './tray-service'

describe('TrayService', () => {
  test('rebuilds a Chinese menu whenever language or autostart state changes', async () => {
    const buildFromTemplate = vi.fn((template) => template)
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(),
    }
    const autostart = {
      isEnabled: vi.fn().mockResolvedValue(false),
      setEnabled: vi.fn(),
    }
    const service = new TrayService({
      Tray: trayClass(tray),
      Menu: { buildFromTemplate },
      icon: 'icon',
      locale: 'en-US',
      onOpenSettings: vi.fn(),
      onRunScene: vi.fn(),
      onQuit: vi.fn(),
      shortcut: { dispose: vi.fn() },
      autostart,
    })

    await service.initialize()
    service.setLanguage('zh-CN')
    service.setAutostartEnabled(true)

    expect(tray.setToolTip).toHaveBeenCalledWith('TouchFish')
    const latest = buildFromTemplate.mock.calls.at(-1)?.[0]
    expect(latest).toEqual([
      { label: '打开设置', click: expect.any(Function) },
      { label: '运行场景', click: expect.any(Function) },
      {
        label: '开机启动',
        type: 'checkbox',
        checked: true,
        click: expect.any(Function),
      },
      { label: '退出', click: expect.any(Function) },
    ])
  })

  test('routes menu actions and updates autostart only after its write succeeds', async () => {
    const buildFromTemplate = vi.fn((template) => template)
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(),
    }
    const onOpenSettings = vi.fn()
    const onRunScene = vi.fn()
    const autostart = {
      isEnabled: vi.fn().mockResolvedValue(false),
      setEnabled: vi.fn().mockResolvedValue(undefined),
    }
    const service = new TrayService({
      Tray: trayClass(tray),
      Menu: { buildFromTemplate },
      icon: 'icon',
      locale: 'zh-CN',
      onOpenSettings,
      onRunScene,
      onQuit: vi.fn(),
      shortcut: { dispose: vi.fn() },
      autostart,
    })
    await service.initialize()
    const menu = buildFromTemplate.mock.calls.at(-1)?.[0]

    menu?.[0]?.click?.()
    menu?.[1]?.click?.()
    await menu?.[2]?.click?.()

    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(onRunScene).toHaveBeenCalledOnce()
    expect(autostart.setEnabled).toHaveBeenCalledWith(true)
    expect(buildFromTemplate.mock.calls.at(-1)?.[0]?.[2]).toMatchObject({
      checked: true,
    })
  })

  test('quits in the explicit cleanup order and is idempotent', async () => {
    const order: string[] = []
    const buildFromTemplate = vi.fn((template) => template)
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(() => order.push('tray')),
    }
    const shortcut = { dispose: vi.fn(() => order.push('shortcut')) }
    const onQuit = vi.fn(() => order.push('app'))
    const service = new TrayService({
      Tray: trayClass(tray),
      Menu: { buildFromTemplate },
      icon: 'icon',
      locale: 'en-US',
      onOpenSettings: vi.fn(),
      onRunScene: vi.fn(),
      onQuit,
      shortcut,
      autostart: {
        isEnabled: vi.fn().mockResolvedValue(false),
        setEnabled: vi.fn(),
      },
    })
    await service.initialize()
    const menu = buildFromTemplate.mock.calls.at(-1)?.[0]

    menu?.[3]?.click?.()
    menu?.[3]?.click?.()

    expect(order).toEqual(['tray', 'shortcut', 'app'])
  })

  test('shares one in-flight initialization across concurrent callers', async () => {
    const enabled = deferred<boolean>()
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(),
    }
    const onConstruct = vi.fn()
    const isEnabled = vi.fn().mockReturnValue(enabled.promise)
    const service = createTrayService({ tray, onConstruct, isEnabled })

    const first = service.initialize()
    const second = service.initialize()
    expect(isEnabled).toHaveBeenCalledOnce()

    enabled.resolve(false)
    await Promise.all([first, second])

    expect(onConstruct).toHaveBeenCalledOnce()
  })

  test('does not create a tray when quit wins during initialization', async () => {
    const enabled = deferred<boolean>()
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(),
    }
    const onConstruct = vi.fn()
    const service = createTrayService({
      tray,
      onConstruct,
      isEnabled: vi.fn().mockReturnValue(enabled.promise),
    })

    const initializing = service.initialize()
    service.quit()
    enabled.resolve(false)
    await initializing

    expect(onConstruct).not.toHaveBeenCalled()
    expect(tray.setToolTip).not.toHaveBeenCalled()
  })

  test('clears a shared failed initialization so a later call can retry', async () => {
    const enabled = deferred<boolean>()
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(),
    }
    const onConstruct = vi.fn()
    const isEnabled = vi
      .fn()
      .mockReturnValueOnce(enabled.promise)
      .mockResolvedValueOnce(false)
    const service = createTrayService({ tray, onConstruct, isEnabled })

    const first = service.initialize()
    const second = service.initialize()
    enabled.reject(new Error('login settings unavailable'))
    await expect(Promise.all([first, second])).rejects.toThrow(
      'login settings unavailable',
    )

    await service.initialize()
    expect(isEnabled).toHaveBeenCalledTimes(2)
    expect(onConstruct).toHaveBeenCalledOnce()
  })
})

function createTrayService({
  tray,
  onConstruct,
  isEnabled,
}: {
  tray: TrayLike
  onConstruct: () => void
  isEnabled: () => Promise<boolean>
}): TrayService {
  return new TrayService({
    Tray: trayClass(tray, onConstruct),
    Menu: { buildFromTemplate: vi.fn((template) => template) },
    icon: 'icon',
    locale: 'en-US',
    onOpenSettings: vi.fn(),
    onRunScene: vi.fn(),
    onQuit: vi.fn(),
    shortcut: { dispose: vi.fn() },
    autostart: { isEnabled, setEnabled: vi.fn() },
  })
}

function deferred<Value>(): {
  promise: Promise<Value>
  resolve(value: Value): void
  reject(error: Error): void
} {
  let resolve!: (value: Value) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function trayClass<Tray extends object>(
  tray: Tray,
  onConstruct: () => void = () => undefined,
): new (icon: unknown) => Tray {
  return class {
    constructor(_icon: unknown) {
      onConstruct()
      return tray
    }
  } as unknown as new (icon: unknown) => Tray
}
