import { describe, expect, test, vi } from 'vitest'

import { defaultConfig } from '../config/schema'
import type {
  DisplayInfo,
  ExternalTarget,
  NativeWindow,
  PlatformAdapter,
  TouchFishConfig,
} from '../../shared/models'
import {
  SceneOrchestrator,
  type SceneLogger,
  type WebTargetController,
} from './scene-orchestrator'

const display = (id: string, primary = false): DisplayInfo => ({
  id,
  label: id,
  primary,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
})

const window = (overrides: Partial<NativeWindow> = {}): NativeWindow => ({
  id: 'window-1',
  pid: 1,
  title: 'Helpful App',
  nativeClass: 'HelpfulClass',
  executablePath: '/opt/helpful/app',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  visible: true,
  ...overrides,
})

const config = (overrides: Partial<TouchFishConfig> = {}): TouchFishConfig => ({
  ...defaultConfig,
  web: { ...defaultConfig.web },
  external: {
    executablePath: '/opt/helpful/app',
    args: [],
    matcher: {
      executablePath: '/opt/helpful/app',
      processName: 'app',
      nativeClass: 'HelpfulClass',
      titleHint: 'Helpful',
    },
  },
  ...overrides,
  multiDisplayTargets: {
    ...defaultConfig.multiDisplayTargets,
    ...overrides.multiDisplayTargets,
  },
})

class FakeAdapter implements PlatformAdapter {
  readonly kind = 'linux-x11' as const
  displays: DisplayInfo[] = [display('primary', true), display('secondary')]
  windows: NativeWindow[] = []
  readonly listDisplays = vi.fn(async () => this.displays)
  readonly listWindows = vi.fn(async () => this.windows)
  readonly launchExternal = vi.fn(async (_target: ExternalTarget) => undefined)
  readonly moveAndMaximize = vi.fn(
    async (_id: string, _display: DisplayInfo) => undefined,
  )
  readonly notify = vi.fn((_title: string, _body: string) => undefined)
  readonly captureForegroundWindow = vi.fn(async () => null)
}

class FakeWeb implements WebTargetController {
  readonly ensureWindow = vi.fn(async (_url: string) => undefined)
  readonly moveAndMaximize = vi.fn(async (_display: DisplayInfo) => undefined)
}

class FakeLogger implements SceneLogger {
  readonly info = vi.fn((_event: string, _data?: object) => undefined)
  readonly error = vi.fn((_event: string, _data?: object) => undefined)
}

const createSubject = (
  sleep: (milliseconds: number) => Promise<void> = async () => undefined,
) => {
  const adapter = new FakeAdapter()
  const web = new FakeWeb()
  const logger = new FakeLogger()
  return {
    adapter,
    web,
    logger,
    subject: new SceneOrchestrator(adapter, web, logger, sleep),
  }
}

describe('SceneOrchestrator', () => {
  test('runs a single-display web scene without touching external windows', async () => {
    const { adapter, web, logger, subject } = createSubject()
    adapter.displays = [display('primary', true)]

    await expect(
      subject.run(config({ singleDisplayTarget: 'web' })),
    ).resolves.toEqual({ status: 'success', errors: [] })
    expect(web.ensureWindow).toHaveBeenCalledOnce()
    expect(web.moveAndMaximize).toHaveBeenCalledWith(adapter.displays[0])
    expect(adapter.listWindows).not.toHaveBeenCalled()
    expect(adapter.launchExternal).not.toHaveBeenCalled()
    expect(adapter.notify).toHaveBeenCalledWith(
      'TouchFish',
      'Scene setup completed successfully.',
    )
    expect(logger.info).toHaveBeenCalledWith('scene-run-finished', {
      status: 'success',
      errors: [],
    })
  })

  test('runs a single-display external scene without touching web', async () => {
    const { adapter, web, subject } = createSubject()
    adapter.displays = [display('primary', true)]
    adapter.windows = [window()]

    await expect(
      subject.run(config({ singleDisplayTarget: 'external' })),
    ).resolves.toEqual({ status: 'success', errors: [] })
    expect(adapter.moveAndMaximize).toHaveBeenCalledWith(
      'window-1',
      adapter.displays[0],
    )
    expect(web.ensureWindow).not.toHaveBeenCalled()
    expect(web.moveAndMaximize).not.toHaveBeenCalled()
  })

  test('moves an existing matching external window directly', async () => {
    const { adapter, subject } = createSubject()
    adapter.windows = [window()]

    await expect(subject.run(config())).resolves.toEqual({
      status: 'success',
      errors: [],
    })
    expect(adapter.launchExternal).not.toHaveBeenCalled()
    expect(adapter.moveAndMaximize).toHaveBeenCalledWith(
      'window-1',
      adapter.displays[1],
    )
  })

  test('launches then polls for a missing external window before moving it', async () => {
    const sleep = vi.fn(async () => {
      adapter.windows = [window()]
    })
    const { adapter, subject } = createSubject(sleep)

    await expect(subject.run(config({ timeoutSeconds: 1 }))).resolves.toEqual({
      status: 'success',
      errors: [],
    })
    expect(adapter.launchExternal).toHaveBeenCalledOnce()
    expect(sleep).toHaveBeenCalledOnce()
    expect(adapter.listWindows).toHaveBeenCalledTimes(2)
    expect(adapter.moveAndMaximize).toHaveBeenCalledWith(
      'window-1',
      adapter.displays[1],
    )
  })

  test('returns partial when external window times out after web succeeds', async () => {
    const { adapter, web, logger, subject } = createSubject()

    await expect(subject.run(config({ timeoutSeconds: 1 }))).resolves.toEqual({
      status: 'partial',
      errors: ['external-window-timeout'],
    })
    expect(web.ensureWindow).toHaveBeenCalledOnce()
    expect(adapter.notify).toHaveBeenCalledWith(
      'TouchFish',
      'Scene setup partially completed.',
    )
    expect(logger.info).toHaveBeenCalledWith('scene-run-finished', {
      status: 'partial',
      errors: ['external-window-timeout'],
    })
  })

  test('keeps the external timeout error when web placement has already failed', async () => {
    const { adapter, web, logger, subject } = createSubject()
    web.ensureWindow.mockRejectedValueOnce(new Error('web unavailable'))

    await expect(subject.run(config({ timeoutSeconds: 1 }))).resolves.toEqual({
      status: 'failed',
      errors: ['web-placement-failed', 'external-window-timeout'],
    })
    expect(adapter.notify).toHaveBeenCalledWith(
      'TouchFish',
      'Scene setup failed.',
    )
    expect(logger.info).toHaveBeenCalledWith('scene-run-finished', {
      status: 'failed',
      errors: ['web-placement-failed', 'external-window-timeout'],
    })
  })

  test('returns busy without starting a second overlapping scene run', async () => {
    let release!: () => void
    const { adapter, logger, subject } = createSubject(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const first = subject.run(config({ timeoutSeconds: 1 }))
    await vi.waitFor(() =>
      expect(adapter.launchExternal).toHaveBeenCalledOnce(),
    )

    await expect(subject.run(config({ timeoutSeconds: 1 }))).resolves.toEqual({
      status: 'busy',
      errors: [],
    })
    expect(adapter.listDisplays).toHaveBeenCalledOnce()
    expect(adapter.notify).toHaveBeenCalledWith(
      'TouchFish',
      'A scene is already running.',
    )
    expect(logger.info).toHaveBeenCalledWith('scene-run-finished', {
      status: 'busy',
      errors: [],
    })
    release()
    await first
  })

  test('selects only visible windows using exact matcher tiers and deterministic size/id ties', async () => {
    const { adapter, subject } = createSubject()
    adapter.displays = [display('primary', true)]
    adapter.windows = [
      window({
        id: 'z',
        executablePath: '/elsewhere/other',
        nativeClass: 'HelpfulClass',
        bounds: { x: 0, y: 0, width: 9999, height: 9999 },
      }),
      window({
        id: 'b',
        executablePath: '/opt/helpful/app',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
      window({
        id: 'a',
        executablePath: '/opt/helpful/app',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
      window({
        id: 'large',
        executablePath: '/opt/helpful/app',
        bounds: { x: 0, y: 0, width: 200, height: 100 },
      }),
      window({
        id: 'hidden',
        executablePath: '/opt/helpful/app',
        visible: false,
        bounds: { x: 0, y: 0, width: 10000, height: 10000 },
      }),
    ]

    await subject.run(config({ singleDisplayTarget: 'external' }))
    expect(adapter.moveAndMaximize).toHaveBeenCalledWith(
      'large',
      adapter.displays[0],
    )

    adapter.windows = [
      window({
        id: 'b',
        executablePath: '/opt/helpful/app',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
      window({
        id: 'a',
        executablePath: '/opt/helpful/app',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]
    await subject.run(config({ singleDisplayTarget: 'external' }))
    expect(adapter.moveAndMaximize).toHaveBeenLastCalledWith(
      'a',
      adapter.displays[0],
    )

    adapter.windows = [
      window({
        id: 'class',
        executablePath: '/elsewhere/other',
        nativeClass: 'HelpfulClass',
      }),
      window({
        id: 'process',
        executablePath: '/elsewhere/app',
        nativeClass: 'Nope',
      }),
      window({
        id: 'title',
        executablePath: '/elsewhere/none',
        nativeClass: 'Nope',
        title: 'Helpful App',
      }),
    ]
    await subject.run(
      config({
        singleDisplayTarget: 'external',
        external: {
          ...defaultConfig.external,
          args: [...defaultConfig.external.args],
          matcher: {
            executablePath: '/missing',
            nativeClass: 'HelpfulClass',
            processName: 'app',
            titleHint: 'Helpful',
          },
        },
      }),
    )
    expect(adapter.moveAndMaximize).toHaveBeenLastCalledWith(
      'class',
      adapter.displays[0],
    )

    adapter.windows = [
      window({
        id: 'process',
        executablePath: 'C:\\Apps\\app',
        nativeClass: 'Nope',
      }),
      window({
        id: 'title',
        executablePath: '/elsewhere/none',
        nativeClass: 'Nope',
        title: 'Helpful App',
      }),
    ]
    await subject.run(
      config({
        singleDisplayTarget: 'external',
        external: {
          ...defaultConfig.external,
          args: [...defaultConfig.external.args],
          matcher: {
            executablePath: '/missing',
            nativeClass: 'missing',
            processName: 'app',
            titleHint: 'Helpful',
          },
        },
      }),
    )
    expect(adapter.moveAndMaximize).toHaveBeenLastCalledWith(
      'process',
      adapter.displays[0],
    )

    adapter.windows = [
      window({
        id: 'title',
        executablePath: '/elsewhere/none',
        nativeClass: 'Nope',
        title: 'Helpful App',
      }),
    ]
    await subject.run(
      config({
        singleDisplayTarget: 'external',
        external: {
          ...defaultConfig.external,
          args: [...defaultConfig.external.args],
          matcher: {
            executablePath: '/missing',
            nativeClass: 'missing',
            processName: 'missing',
            titleHint: 'Helpful',
          },
        },
      }),
    )
    expect(adapter.moveAndMaximize).toHaveBeenLastCalledWith(
      'title',
      adapter.displays[0],
    )
  })

  test('notifies about fallback and returns partial when web placement fails but external succeeds', async () => {
    const { adapter, web, logger, subject } = createSubject()
    adapter.displays = [
      display('primary', true),
      display('secondary'),
      display('third'),
    ]
    adapter.windows = [window()]
    web.ensureWindow.mockRejectedValueOnce(new Error('secret url failure'))

    await expect(subject.run(config())).resolves.toEqual({
      status: 'partial',
      errors: ['web-placement-failed'],
    })
    expect(adapter.notify).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('scene-plan-fallback')
    expect(logger.error).toHaveBeenCalledWith('web-placement-failed', {
      target: 'web',
      displayId: 'primary',
    })
  })

  test('still launches and places external after a web placement failure', async () => {
    let adapter!: FakeAdapter
    const sleep = vi.fn(async () => {
      adapter.windows = [window()]
    })
    const created = createSubject(sleep)
    adapter = created.adapter
    created.web.ensureWindow.mockRejectedValueOnce(new Error('web unavailable'))

    await expect(
      created.subject.run(config({ timeoutSeconds: 1 })),
    ).resolves.toEqual({ status: 'partial', errors: ['web-placement-failed'] })
    expect(adapter.launchExternal).toHaveBeenCalledOnce()
    expect(adapter.moveAndMaximize).toHaveBeenCalledWith(
      'window-1',
      adapter.displays[1],
    )
  })

  test('reports an external configuration error and releases its lock after an exception', async () => {
    const { adapter, logger, subject } = createSubject()
    adapter.listDisplays.mockRejectedValueOnce(new Error('boom'))

    await expect(subject.run(config())).resolves.toEqual({
      status: 'failed',
      errors: ['scene-plan-failed'],
    })
    expect(adapter.notify).toHaveBeenCalledWith(
      'TouchFish',
      'Scene setup failed.',
    )
    expect(logger.info).toHaveBeenCalledWith('scene-run-finished', {
      status: 'failed',
      errors: ['scene-plan-failed'],
    })
    adapter.displays = [display('primary', true)]
    await expect(
      subject.run(
        config({
          singleDisplayTarget: 'external',
          external: {
            ...defaultConfig.external,
            args: [...defaultConfig.external.args],
            matcher: null,
          },
        }),
      ),
    ).resolves.toEqual({
      status: 'failed',
      errors: ['external-config-missing'],
    })
    expect(adapter.listWindows).not.toHaveBeenCalled()
    expect(adapter.launchExternal).not.toHaveBeenCalled()
  })

  test('returns failed instead of throwing when no displays are available', async () => {
    const { adapter, subject } = createSubject()
    adapter.displays = []

    await expect(subject.run(config())).resolves.toEqual({
      status: 'failed',
      errors: ['scene-plan-failed'],
    })
  })
})
