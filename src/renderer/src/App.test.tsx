// @vitest-environment jsdom

import { StrictMode } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { defaultConfig } from '../../main/config/schema'
import type { TouchFishRendererApi } from '../../shared/ipc'
import type {
  DisplayInfo,
  NativeWindow,
  TouchFishConfig,
} from '../../shared/models'
import App from './App'

const primary: DisplayInfo = {
  id: 'primary',
  label: 'Built-in display',
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
}

const external: DisplayInfo = {
  id: 'external',
  label: 'External display',
  primary: false,
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
}

const third: DisplayInfo = {
  id: 'third',
  label: 'Portrait display',
  primary: false,
  bounds: { x: -1080, y: 0, width: 1080, height: 1920 },
  workArea: { x: -1080, y: 0, width: 1080, height: 1880 },
}

const capturedWindow: NativeWindow = {
  id: '42',
  pid: 100,
  title: 'DingTalk',
  nativeClass: 'DingTalk',
  executablePath: '/opt/apps/dingtalk/DingTalk',
  bounds: { x: 10, y: 20, width: 800, height: 600 },
  visible: true,
}

function config(overrides: Partial<TouchFishConfig> = {}): TouchFishConfig {
  const base: TouchFishConfig = {
    schemaVersion: defaultConfig.schemaVersion,
    web: { ...defaultConfig.web },
    external: {
      ...defaultConfig.external,
      args: [...defaultConfig.external.args],
      matcher: defaultConfig.external.matcher
        ? { ...defaultConfig.external.matcher }
        : null,
    },
    shortcut: defaultConfig.shortcut,
    startAtLogin: defaultConfig.startAtLogin,
    timeoutSeconds: defaultConfig.timeoutSeconds,
    language: defaultConfig.language,
    singleDisplayTarget: defaultConfig.singleDisplayTarget,
    swapOnTwoDisplays: defaultConfig.swapOnTwoDisplays,
    multiDisplayTargets: { ...defaultConfig.multiDisplayTargets },
    firstRunComplete: defaultConfig.firstRunComplete,
  }
  return {
    ...base,
    ...overrides,
  }
}

type ValueControl = { value: string }
type CheckedControl = { checked: boolean }
type DisabledControl = {
  disabled: boolean
  matches?(selector: string): boolean
}

function controlValue(element: unknown): string {
  return (element as ValueControl).value
}

function controlChecked(element: unknown): boolean {
  return (element as CheckedControl).checked
}

function controlDisabled(element: unknown): boolean {
  const control = element as DisabledControl
  return control.disabled || control.matches?.(':disabled') === true
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fakeApi(
  options: {
    loadedConfig?: TouchFishConfig
    displays?: DisplayInfo[]
    windows?: NativeWindow[]
    diagnostics?: Record<string, unknown>[]
    legacy?: { url: string } | null
  } = {},
): TouchFishRendererApi {
  return {
    loadConfig: vi.fn(async () => options.loadedConfig ?? config()),
    saveConfig: vi.fn(async () => undefined),
    listDisplays: vi.fn(async () => options.displays ?? [primary]),
    listWindows: vi.fn(async () => options.windows ?? [capturedWindow]),
    beginWindowCapture: vi.fn(async () => capturedWindow),
    runScene: vi.fn(async () => ({ status: 'success' as const, errors: [] })),
    chooseExecutable: vi.fn(async () => '/usr/bin/dingtalk'),
    setShortcut: vi.fn(async () => ({ ok: true as const })),
    setStartAtLogin: vi.fn(async () => undefined),
    getDiagnostics: vi.fn(async () => options.diagnostics ?? []),
    clearWebData: vi.fn(async () => undefined),
    getLegacyMigration: vi.fn(async () => options.legacy ?? null),
    applyLegacyMigration: vi.fn(async () => ({ ok: true as const })),
  }
}

async function renderApp(api = fakeApi()) {
  window.touchfish = api
  render(<App />)
  await screen.findByRole('heading', { name: 'Web target' })
  return api
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TouchFish settings', () => {
  test('shows all approved defaults on first run', async () => {
    await renderApp()

    expect(screen.getByText('Your first scene is ready')).not.toBeNull()
    expect(controlValue(screen.getByLabelText('Web URL'))).toBe(
      defaultConfig.web.url,
    )
    expect(controlValue(screen.getByLabelText('Launch timeout'))).toBe('15')
    expect(controlValue(screen.getByLabelText('Global shortcut'))).toBe(
      'Ctrl + Alt + Z',
    )
    expect(controlValue(screen.getByLabelText('Single-display target'))).toBe(
      'web',
    )
    expect(controlChecked(screen.getByLabelText('Start at login'))).toBe(true)
    expect(controlValue(screen.getByLabelText('Language'))).toBe('system')
  })

  test('loads required configuration first and degrades when optional sources fail', async () => {
    const api = fakeApi()
    vi.mocked(api.listDisplays).mockRejectedValue(new Error('no displays'))
    vi.mocked(api.listWindows).mockRejectedValue(new Error('no windows'))
    vi.mocked(api.getDiagnostics).mockRejectedValue(new Error('no logs'))
    vi.mocked(api.getLegacyMigration).mockRejectedValue(
      new Error('no migration'),
    )

    await renderApp(api)

    expect(
      screen.getByText(
        'Some display, window, or diagnostic information could not be loaded.',
      ),
    ).not.toBeNull()
    expect(api.loadConfig).toHaveBeenCalledTimes(1)
    for (const optionalCall of [
      api.listDisplays,
      api.listWindows,
      api.getDiagnostics,
      api.getLegacyMigration,
    ]) {
      expect(
        vi.mocked(api.loadConfig).mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(optionalCall).mock.invocationCallOrder[0]!)
    }
  })

  test('initializes each source once under React StrictMode', async () => {
    const api = fakeApi()
    window.touchfish = api

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findByRole('heading', { name: 'Web target' })

    expect(api.loadConfig).toHaveBeenCalledTimes(1)
    expect(api.listDisplays).toHaveBeenCalledTimes(1)
    expect(api.listWindows).toHaveBeenCalledTimes(1)
    expect(api.getDiagnostics).toHaveBeenCalledTimes(1)
    expect(api.getLegacyMigration).toHaveBeenCalledTimes(1)
  })

  test('retries required initialization after a rejected load on remount', async () => {
    const api = fakeApi()
    vi.mocked(api.loadConfig)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(config())
    window.touchfish = api

    render(<App />)
    expect(
      await screen.findByText('Could not load TouchFish settings.'),
    ).not.toBeNull()
    cleanup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Web target' })
    expect(api.loadConfig).toHaveBeenCalledTimes(2)
  })

  test('auto-fills a running DingTalk window on first run without hardcoded paths', async () => {
    const { executablePath: _executablePath, ...capturedWindowWithoutPath } =
      capturedWindow
    const withoutPath: NativeWindow = {
      ...capturedWindowWithoutPath,
      id: 'no-path',
    }
    const detected: NativeWindow = {
      ...capturedWindow,
      id: 'detected',
      title: 'Team chat',
      nativeClass: 'DingTalkMainWindow',
      executablePath: '/opt/dingtalk/DingTalk',
    }
    const api = await renderApp(
      fakeApi({
        loadedConfig: config({
          external: {
            executablePath: '',
            args: ['--stale'],
            matcher: null,
          },
        }),
        windows: [withoutPath, detected],
      }),
    )

    expect(controlValue(screen.getByLabelText('Executable path'))).toBe(
      '/opt/dingtalk/DingTalk',
    )
    expect(
      screen.getByText('DingTalk preset detected from Team chat.'),
    ).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1))
    expect(api.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        external: {
          executablePath: '/opt/dingtalk/DingTalk',
          args: [],
          matcher: {
            executablePath: '/opt/dingtalk/DingTalk',
            processName: 'DingTalk',
            nativeClass: 'DingTalkMainWindow',
            titleHint: 'Team chat',
          },
        },
      }),
    )
  })

  test('does not replace an already configured external target with a detected DingTalk window', async () => {
    await renderApp(
      fakeApi({
        loadedConfig: config({
          external: {
            executablePath: '/custom/my-app',
            args: ['--safe'],
            matcher: null,
          },
        }),
        windows: [capturedWindow],
      }),
    )

    expect(controlValue(screen.getByLabelText('Executable path'))).toBe(
      '/custom/my-app',
    )
    expect(screen.queryByText(/DingTalk preset detected/)).toBeNull()
  })

  test('does not trust a DingTalk browser page title as application identity', async () => {
    await renderApp(
      fakeApi({
        windows: [
          {
            ...capturedWindow,
            title: 'DingTalk - Chromium',
            nativeClass: 'chromium-browser',
            executablePath: '/usr/bin/chromium',
          },
        ],
      }),
    )

    expect(controlValue(screen.getByLabelText('Executable path'))).toBe('')
    expect(screen.queryByText(/DingTalk preset detected/)).toBeNull()
  })

  test('preserves matcher-only external configuration during first-run detection', async () => {
    await renderApp(
      fakeApi({
        loadedConfig: config({
          external: {
            executablePath: '',
            args: [],
            matcher: { executablePath: '', processName: '' },
          },
        }),
        windows: [capturedWindow],
      }),
    )

    expect(controlValue(screen.getByLabelText('Executable path'))).toBe('')
    expect(screen.queryByText(/DingTalk preset detected/)).toBeNull()
  })

  test('validates the URL and integer timeout from 1 through 120 before saving', async () => {
    const api = await renderApp()

    fireEvent.change(screen.getByLabelText('Web URL'), {
      target: { value: 'file:///tmp/nope' },
    })
    fireEvent.change(screen.getByLabelText('Launch timeout'), {
      target: { value: '3.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(
      await screen.findByText('Enter an http:// or https:// URL.'),
    ).not.toBeNull()
    expect(
      screen.getByText('Enter a whole number from 1 to 120.'),
    ).not.toBeNull()
    expect(api.saveConfig).not.toHaveBeenCalled()
  })

  test('selects an executable and captures a foreground window after a visible 3-2-1 countdown', async () => {
    const api = await renderApp()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Choose program' }))
    await act(async () => Promise.resolve())
    expect(controlValue(screen.getByLabelText('Executable path'))).toBe(
      '/usr/bin/dingtalk',
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Capture foreground window' }),
    )
    expect(screen.getByText(/Capturing in 3/).textContent).toContain(
      'Capturing in 3',
    )
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText(/Capturing in 2/).textContent).toContain(
      'Capturing in 2',
    )
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText(/Capturing in 1/).textContent).toContain(
      'Capturing in 1',
    )
    expect(api.beginWindowCapture).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1000))

    expect(api.beginWindowCapture).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Captured DingTalk')).not.toBeNull()
    expect(controlValue(screen.getByLabelText('Executable path'))).toBe(
      '/opt/apps/dingtalk/DingTalk',
    )
  })

  test('reports a cancelled foreground capture without changing the executable', async () => {
    const api = fakeApi({
      loadedConfig: config({
        external: { executablePath: '/old/app', args: [], matcher: null },
      }),
    })
    vi.mocked(api.beginWindowCapture).mockResolvedValue(null)
    await renderApp(api)
    vi.useFakeTimers()

    fireEvent.click(
      screen.getByRole('button', { name: 'Capture foreground window' }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(3000))

    expect(screen.getByText('Capture cancelled')).not.toBeNull()
    expect(controlValue(screen.getByLabelText('Executable path'))).toBe(
      '/old/app',
    )
  })

  test('allows only one choose or capture mutation at a time', async () => {
    const pendingChoice = deferred<string | null>()
    const api = fakeApi()
    vi.mocked(api.chooseExecutable).mockReturnValue(pendingChoice.promise)
    await renderApp(api)
    vi.useFakeTimers()
    const chooseButton = screen.getByRole('button', { name: 'Choose program' })
    const captureButton = screen.getByRole('button', {
      name: 'Capture foreground window',
    })

    fireEvent.click(chooseButton)
    fireEvent.click(chooseButton)
    fireEvent.click(captureButton)

    expect(api.chooseExecutable).toHaveBeenCalledTimes(1)
    expect(api.beginWindowCapture).not.toHaveBeenCalled()
    expect(controlDisabled(chooseButton)).toBe(true)
    expect(controlDisabled(captureButton)).toBe(true)
    expect(
      controlDisabled(screen.getByRole('button', { name: 'Save settings' })),
    ).toBe(true)

    await act(async () => {
      pendingChoice.resolve('/usr/bin/other-app')
      await Promise.resolve()
    })
    expect(controlDisabled(chooseButton)).toBe(false)
    expect(controlValue(screen.getByLabelText('Executable path'))).toBe(
      '/usr/bin/other-app',
    )
  })

  test('replaces captured identity atomically when the executable path is edited manually', async () => {
    const api = await renderApp(
      fakeApi({
        loadedConfig: config({
          firstRunComplete: true,
          external: {
            executablePath: '/old/DingTalk',
            args: ['--safe'],
            matcher: {
              executablePath: '/old/DingTalk',
              processName: 'DingTalk',
              nativeClass: 'DingTalkMainWindow',
              titleHint: 'Old chat',
            },
          },
        }),
      }),
    )

    fireEvent.change(screen.getByLabelText('Executable path'), {
      target: { value: 'C:\\Tools\\Other.exe' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1))
    expect(api.saveConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        external: {
          executablePath: 'C:\\Tools\\Other.exe',
          args: ['--safe'],
          matcher: {
            executablePath: 'C:\\Tools\\Other.exe',
            processName: 'Other.exe',
          },
        },
      }),
    )

    fireEvent.change(screen.getByLabelText('Executable path'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(2))
    expect(api.saveConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        external: expect.objectContaining({
          executablePath: '',
          matcher: null,
        }),
      }),
    )
  })

  test('shows exactly one target selector with one display', async () => {
    await renderApp(fakeApi({ displays: [primary] }))

    expect(screen.getAllByLabelText('Single-display target')).toHaveLength(1)
    expect(screen.queryByLabelText('Web display')).toBeNull()
    expect(screen.queryByLabelText('External app display')).toBeNull()
    expect(screen.queryByLabelText('Swap display assignments')).toBeNull()
  })

  test('moves the active navigation location when a section link is followed', async () => {
    await renderApp()
    const webLink = screen.getByRole('link', { name: 'Web target' })
    const diagnosticsLink = screen.getByRole('link', { name: 'Diagnostics' })
    const settingsContent =
      diagnosticsLink.ownerDocument.querySelector('.settings-content')!
    const diagnosticsSection =
      diagnosticsLink.ownerDocument.getElementById('diagnostics')!
    const scrollTo = vi.fn()
    Object.defineProperty(settingsContent, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })
    Object.defineProperty(settingsContent, 'scrollTop', {
      configurable: true,
      value: 100,
      writable: true,
    })
    vi.spyOn(settingsContent, 'getBoundingClientRect').mockReturnValue({
      top: 72,
    } as unknown as ReturnType<typeof settingsContent.getBoundingClientRect>)
    vi.spyOn(diagnosticsSection, 'getBoundingClientRect').mockReturnValue({
      top: 719,
    } as unknown as ReturnType<typeof diagnosticsSection.getBoundingClientRect>)
    const replaceState = vi.spyOn(globalThis.history, 'replaceState')

    expect(webLink.getAttribute('aria-current')).toBe('location')
    expect(webLink.classList.contains('active')).toBe(true)
    expect(diagnosticsLink.getAttribute('aria-current')).toBeNull()

    expect(fireEvent.click(diagnosticsLink)).toBe(false)

    expect(webLink.getAttribute('aria-current')).toBeNull()
    expect(webLink.classList.contains('active')).toBe(false)
    expect(diagnosticsLink.getAttribute('aria-current')).toBe('location')
    expect(diagnosticsLink.classList.contains('active')).toBe(true)
    expect(replaceState).toHaveBeenCalledWith(null, '', '#diagnostics')
    expect(globalThis.location.hash).toBe('#diagnostics')
    expect(scrollTo).toHaveBeenCalledWith({
      top: 747,
      behavior: 'smooth',
    })
    expect(globalThis.scrollY).toBe(0)
  })

  test('shows two-display mapping and swaps web and external assignments', async () => {
    await renderApp(fakeApi({ displays: [primary, external] }))

    expect(screen.getByText('Web → Built-in display')).not.toBeNull()
    expect(screen.getByText('External app → External display')).not.toBeNull()
    fireEvent.click(screen.getByLabelText('Swap display assignments'))
    expect(screen.getByText('Web → External display')).not.toBeNull()
    expect(screen.getByText('External app → Built-in display')).not.toBeNull()
    expect(screen.queryByLabelText('Web display')).toBeNull()
  })

  test('shows per-target display selectors only with three or more displays', async () => {
    await renderApp(fakeApi({ displays: [primary, external, third] }))

    fireEvent.change(screen.getByLabelText('Web display'), {
      target: { value: 'third' },
    })
    fireEvent.change(screen.getByLabelText('External app display'), {
      target: { value: 'external' },
    })
    expect(controlValue(screen.getByLabelText('Web display'))).toBe('third')
    expect(controlValue(screen.getByLabelText('External app display'))).toBe(
      'external',
    )
    expect(screen.queryByLabelText('Swap display assignments')).toBeNull()
  })

  test('reports a shortcut conflict and does not save', async () => {
    const api = fakeApi()
    vi.mocked(api.setShortcut).mockResolvedValue({
      ok: false,
      reason: 'conflict',
    })
    await renderApp(api)

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(
      await screen.findByText('That shortcut is already in use.'),
    ).not.toBeNull()
    expect(api.setStartAtLogin).not.toHaveBeenCalled()
    expect(api.saveConfig).not.toHaveBeenCalled()
  })

  test('keeps the draft and stops when shortcut registration throws', async () => {
    const api = fakeApi()
    vi.mocked(api.setShortcut).mockRejectedValue(
      new Error('registration failed'),
    )
    await renderApp(api)
    const recorder = screen.getByLabelText('Global shortcut')
    fireEvent.keyDown(recorder, { key: 'x', altKey: true })

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Could not save settings.')).not.toBeNull()
    expect(controlValue(recorder)).toBe('Alt + X')
    expect(api.setStartAtLogin).not.toHaveBeenCalled()
    expect(api.saveConfig).not.toHaveBeenCalled()
  })

  test('rolls back the shortcut when autostart fails', async () => {
    const api = fakeApi({
      loadedConfig: config({
        shortcut: 'Alt+X',
        startAtLogin: false,
        firstRunComplete: true,
      }),
    })
    vi.mocked(api.setStartAtLogin).mockRejectedValue(new Error('denied'))
    await renderApp(api)
    const recorder = screen.getByLabelText('Global shortcut')
    fireEvent.keyDown(recorder, { key: 'z', ctrlKey: true, altKey: true })
    fireEvent.click(screen.getByLabelText('Start at login'))

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Could not save settings.')).not.toBeNull()
    expect(api.setShortcut).toHaveBeenNthCalledWith(1, {
      accelerator: 'CommandOrControl+Alt+Z',
    })
    expect(api.setShortcut).toHaveBeenNthCalledWith(2, {
      accelerator: 'Alt+X',
    })
    expect(api.saveConfig).not.toHaveBeenCalled()
    expect(controlValue(recorder)).toBe('Ctrl + Alt + Z')
    expect(controlChecked(screen.getByLabelText('Start at login'))).toBe(true)
  })

  test('rolls back autostart and shortcut when config persistence fails', async () => {
    const api = fakeApi({
      loadedConfig: config({
        shortcut: 'Alt+X',
        startAtLogin: false,
        firstRunComplete: true,
      }),
    })
    vi.mocked(api.saveConfig).mockRejectedValue(new Error('disk full'))
    await renderApp(api)
    const recorder = screen.getByLabelText('Global shortcut')
    fireEvent.keyDown(recorder, { key: 'z', ctrlKey: true, altKey: true })
    fireEvent.click(screen.getByLabelText('Start at login'))

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Could not save settings.')).not.toBeNull()
    expect(api.setStartAtLogin).toHaveBeenNthCalledWith(1, { enabled: true })
    expect(api.setStartAtLogin).toHaveBeenNthCalledWith(2, { enabled: false })
    expect(api.setShortcut).toHaveBeenNthCalledWith(2, {
      accelerator: 'Alt+X',
    })
    expect(controlValue(recorder)).toBe('Ctrl + Alt + Z')
    expect(controlChecked(screen.getByLabelText('Start at login'))).toBe(true)
  })

  test('warns when autostart rollback throws and still attempts shortcut rollback', async () => {
    const api = fakeApi({
      loadedConfig: config({
        shortcut: 'Alt+X',
        startAtLogin: false,
        firstRunComplete: true,
      }),
    })
    vi.mocked(api.setStartAtLogin)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rollback denied'))
    vi.mocked(api.saveConfig).mockRejectedValue(new Error('disk full'))
    await renderApp(api)
    fireEvent.keyDown(screen.getByLabelText('Global shortcut'), {
      key: 'z',
      ctrlKey: true,
    })
    fireEvent.click(screen.getByLabelText('Start at login'))

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(
      await screen.findByText(
        'Saving failed, and system settings could not be fully restored. System settings may differ from the saved configuration.',
      ),
    ).not.toBeNull()
    expect(api.setStartAtLogin).toHaveBeenCalledTimes(2)
    expect(api.setShortcut).toHaveBeenNthCalledWith(2, {
      accelerator: 'Alt+X',
    })
    expect(controlValue(screen.getByLabelText('Global shortcut'))).toBe(
      'Ctrl + Z',
    )
  })

  test('warns when shortcut rollback conflicts after autostart rollback succeeds', async () => {
    const api = fakeApi({
      loadedConfig: config({
        shortcut: 'Alt+X',
        startAtLogin: false,
        firstRunComplete: true,
      }),
    })
    vi.mocked(api.setShortcut)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'conflict' })
    vi.mocked(api.saveConfig).mockRejectedValue(new Error('disk full'))
    await renderApp(api)
    fireEvent.keyDown(screen.getByLabelText('Global shortcut'), {
      key: 'z',
      ctrlKey: true,
    })
    fireEvent.click(screen.getByLabelText('Start at login'))

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    const warning = await screen.findByText(
      'Saving failed, and system settings could not be fully restored. System settings may differ from the saved configuration.',
    )
    expect(warning.getAttribute('role')).toBe('alert')
    expect(api.setStartAtLogin).toHaveBeenNthCalledWith(2, { enabled: false })
    expect(api.setShortcut).toHaveBeenCalledTimes(2)
  })

  test('disables settings and actions while a save is in flight', async () => {
    const pendingShortcut = deferred<{ ok: true }>()
    const api = fakeApi()
    vi.mocked(api.setShortcut).mockReturnValue(pendingShortcut.promise)
    await renderApp(api)
    const saveButton = screen.getByRole('button', { name: 'Save settings' })

    fireEvent.click(saveButton)

    await waitFor(() => expect(controlDisabled(saveButton)).toBe(true))
    expect(controlDisabled(screen.getByLabelText('Web URL'))).toBe(true)
    expect(controlDisabled(screen.getByLabelText('Global shortcut'))).toBe(true)
    expect(controlDisabled(screen.getByLabelText('Language'))).toBe(true)
    expect(
      controlDisabled(screen.getByRole('button', { name: 'Choose program' })),
    ).toBe(true)
    expect(
      controlDisabled(screen.getByRole('button', { name: 'Run scene' })),
    ).toBe(true)

    pendingShortcut.resolve({ ok: true })
    expect(await screen.findByText('All changes saved.')).not.toBeNull()
  })

  test('uses the latest successful save as the rollback snapshot', async () => {
    const api = await renderApp(
      fakeApi({
        loadedConfig: config({
          shortcut: 'Alt+X',
          startAtLogin: false,
          firstRunComplete: true,
        }),
      }),
    )
    const recorder = screen.getByLabelText('Global shortcut')
    fireEvent.keyDown(recorder, { key: 'y', altKey: true })
    fireEvent.click(screen.getByLabelText('Start at login'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await screen.findByText('All changes saved.')

    vi.mocked(api.saveConfig).mockRejectedValueOnce(new Error('disk full'))
    fireEvent.keyDown(recorder, { key: 'z', ctrlKey: true })
    fireEvent.click(screen.getByLabelText('Start at login'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Could not save settings.')).not.toBeNull()
    expect(api.setStartAtLogin).toHaveBeenLastCalledWith({ enabled: true })
    expect(api.setShortcut).toHaveBeenLastCalledWith({ accelerator: 'Alt+Y' })
  })

  test('records a keyboard shortcut as readable text and saves a canonical Electron accelerator', async () => {
    const api = await renderApp()
    const recorder = screen.getByLabelText('Global shortcut')

    expect(
      fireEvent.keyDown(recorder, { key: 'z', ctrlKey: true, altKey: true }),
    ).toBe(false)
    expect(controlValue(recorder)).toBe('Ctrl + Alt + Z')
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() =>
      expect(api.setShortcut).toHaveBeenCalledWith({
        accelerator: 'CommandOrControl+Alt+Z',
      }),
    )
  })

  test('ignores modifier-only presses and records function, arrow, and space keys', async () => {
    await renderApp()
    const recorder = screen.getByLabelText('Global shortcut')

    const original = controlValue(recorder)
    expect(fireEvent.keyDown(recorder, { key: 'Control', ctrlKey: true })).toBe(
      true,
    )
    expect(controlValue(recorder)).toBe(original)

    fireEvent.keyDown(recorder, { key: 'F5', shiftKey: true })
    expect(controlValue(recorder)).toBe('Shift + F5')
    fireEvent.keyDown(recorder, { key: 'ArrowLeft', altKey: true })
    expect(controlValue(recorder)).toBe('Alt + Left')
    fireEvent.keyDown(recorder, { key: ' ', ctrlKey: true, shiftKey: true })
    expect(controlValue(recorder)).toBe('Ctrl + Shift + Space')
  })

  test('does not trap Tab or unsupported and unmodified keys in the shortcut recorder', async () => {
    await renderApp()
    const recorder = screen.getByLabelText('Global shortcut')
    const nextControl = screen.getByLabelText('Language')
    recorder.focus()

    expect(fireEvent.keyDown(recorder, { key: 'Tab' })).toBe(true)
    nextControl.focus()
    expect(recorder.ownerDocument.activeElement).toBe(nextControl)

    expect(fireEvent.keyDown(recorder, { key: 'Home' })).toBe(true)
    expect(fireEvent.keyDown(recorder, { key: 'z' })).toBe(true)
  })

  test('records Meta as Electron Super without conflating it with Ctrl', async () => {
    const api = await renderApp()
    const recorder = screen.getByLabelText('Global shortcut')

    expect(fireEvent.keyDown(recorder, { key: 'z', metaKey: true })).toBe(false)
    expect(controlValue(recorder)).toBe('Super + Z')
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() =>
      expect(api.setShortcut).toHaveBeenCalledWith({ accelerator: 'Super+Z' }),
    )
  })

  test('switches to Chinese and safely back to English from the header selector', async () => {
    await renderApp()

    fireEvent.change(screen.getByLabelText('Language'), {
      target: { value: 'zh-CN' },
    })

    expect(screen.getByRole('heading', { name: '网页目标' })).not.toBeNull()
    expect(screen.getByLabelText('网页 URL')).not.toBeNull()
    expect(screen.getByRole('button', { name: '保存设置' })).not.toBeNull()
    expect(screen.queryByText('Web target')).toBeNull()
    expect(screen.queryByText('Run scene')).toBeNull()

    fireEvent.change(screen.getByLabelText('快速选择语言'), {
      target: { value: 'en' },
    })

    expect(
      await screen.findByRole('heading', { name: 'Web target' }),
    ).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'External app' })).not.toBeNull()
    expect(screen.getByLabelText('Web URL')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Run scene' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Save settings' })).not.toBeNull()
  })

  test('requires explicit legacy migration confirmation', async () => {
    const api = await renderApp(
      fakeApi({ legacy: { url: 'https://e.gitee.com/import-me' } }),
    )

    expect(screen.getByText('Legacy shortcut found')).not.toBeNull()
    expect(api.applyLegacyMigration).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    expect(api.applyLegacyMigration).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))

    await waitFor(() =>
      expect(api.applyLegacyMigration).toHaveBeenCalledWith({
        confirmed: true,
        proposal: { url: 'https://e.gitee.com/import-me' },
      }),
    )
    expect(controlValue(screen.getByLabelText('Web URL'))).toBe(
      'https://e.gitee.com/import-me',
    )
  })

  test('guards legacy migration against repeated confirmation while busy', async () => {
    const pendingMigration = deferred<{ ok: true }>()
    const api = fakeApi({ legacy: { url: 'https://e.gitee.com/import-me' } })
    vi.mocked(api.applyLegacyMigration).mockReturnValue(
      pendingMigration.promise,
    )
    await renderApp(api)
    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    const confirmButton = screen.getByRole('button', {
      name: 'Confirm import',
    })
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(api.applyLegacyMigration).toHaveBeenCalledTimes(1)
    expect(controlDisabled(confirmButton)).toBe(true)
    expect(controlDisabled(cancelButton)).toBe(true)
    pendingMigration.resolve({ ok: true })
    expect(await screen.findByText('Legacy settings imported.')).not.toBeNull()
    expect(api.applyLegacyMigration).toHaveBeenCalledTimes(1)
  })

  test('does not let save race with a pending legacy migration', async () => {
    const pendingMigration = deferred<{ ok: true }>()
    const api = fakeApi({ legacy: { url: 'https://e.gitee.com/import-me' } })
    vi.mocked(api.applyLegacyMigration).mockReturnValue(
      pendingMigration.promise,
    )
    await renderApp(api)
    fireEvent.change(screen.getByLabelText('Web URL'), {
      target: { value: 'https://example.com/stale-draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    const saveButton = screen.getByRole('button', { name: 'Save settings' })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    fireEvent.click(saveButton)

    expect(controlDisabled(saveButton)).toBe(true)
    expect(api.setShortcut).not.toHaveBeenCalled()
    expect(api.saveConfig).not.toHaveBeenCalled()
    pendingMigration.resolve({ ok: true })
    expect(await screen.findByText('Legacy settings imported.')).not.toBeNull()
    expect(controlValue(screen.getByLabelText('Web URL'))).toBe(
      'https://e.gitee.com/import-me',
    )
    expect(api.saveConfig).not.toHaveBeenCalled()
  })

  test.each([
    ['success', 'Scene completed successfully.'],
    ['partial', 'Scene completed with some problems.'],
    ['failed', 'Scene failed.'],
    ['busy', 'A scene is already running.'],
  ] as const)('shows the %s Run Scene result', async (status, message) => {
    const api = fakeApi()
    vi.mocked(api.runScene).mockResolvedValue({
      status,
      errors: status === 'success' ? [] : ['example problem'],
    })
    await renderApp(api)

    fireEvent.click(screen.getByRole('button', { name: 'Run scene' }))

    expect(await screen.findByText(message)).not.toBeNull()
    if (status !== 'success')
      expect(
        screen.getByText('An unknown scene error occurred.'),
      ).not.toBeNull()
  })

  test('localizes every orchestrator error code and the unknown fallback after a language switch', async () => {
    const api = fakeApi()
    vi.mocked(api.runScene).mockResolvedValue({
      status: 'failed',
      errors: [
        'scene-plan-failed',
        'web-placement-failed',
        'external-config-missing',
        'external-launch-failed',
        'external-window-timeout',
        'external-placement-failed',
        'external-window-list-failed',
        'future-error-code',
      ],
    })
    await renderApp(api)

    fireEvent.click(screen.getByRole('button', { name: 'Run scene' }))
    expect(
      await screen.findByText('The display plan could not be created.'),
    ).not.toBeNull()
    expect(
      screen.getByText('The web window could not be placed.'),
    ).not.toBeNull()
    expect(
      screen.getByText('Configure an external app before running this scene.'),
    ).not.toBeNull()
    expect(
      screen.getByText('The external app could not be started.'),
    ).not.toBeNull()
    expect(
      screen.getByText('Timed out waiting for the external app window.'),
    ).not.toBeNull()
    expect(
      screen.getByText('The external app window could not be placed.'),
    ).not.toBeNull()
    expect(
      screen.getByText('External app windows could not be inspected.'),
    ).not.toBeNull()
    expect(screen.getByText('An unknown scene error occurred.')).not.toBeNull()
    expect(screen.queryByText('scene-plan-failed')).toBeNull()

    fireEvent.change(screen.getByLabelText('Language'), {
      target: { value: 'zh-CN' },
    })
    expect(screen.getByText('无法创建屏幕分配方案。')).not.toBeNull()
    expect(screen.getByText('无法放置网页窗口。')).not.toBeNull()
    expect(screen.getByText('运行此场景前，请先配置外部程序。')).not.toBeNull()
    expect(screen.getByText('无法启动外部程序。')).not.toBeNull()
    expect(screen.getByText('等待外部程序窗口超时。')).not.toBeNull()
    expect(screen.getByText('无法放置外部程序窗口。')).not.toBeNull()
    expect(screen.getByText('无法检查外部程序窗口。')).not.toBeNull()
    expect(screen.getByText('发生未知场景错误。')).not.toBeNull()
  })

  test('shows current display/window diagnostics and recent execution logs', async () => {
    await renderApp(
      fakeApi({
        displays: [primary, external],
        windows: [capturedWindow],
        diagnostics: [{ status: 'partial', event: 'scene-finished' }],
      }),
    )

    expect(screen.getAllByText('Built-in display').length).toBeGreaterThan(0)
    expect(screen.getByText('DingTalk')).not.toBeNull()
    expect(screen.getByText(/scene-finished/)).not.toBeNull()
  })

  test('clears web data and saves through shortcut, autostart, then config with explicit states', async () => {
    const api = await renderApp()

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear web and login data' }),
    )
    expect(
      await screen.findByText('Web and login data cleared.'),
    ).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('All changes saved.')).not.toBeNull()
    expect(api.setShortcut).toHaveBeenCalledWith({
      accelerator: 'CommandOrControl+Alt+Z',
    })
    expect(api.setStartAtLogin).toHaveBeenCalledWith({ enabled: true })
    expect(api.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ firstRunComplete: true }),
    )
    expect(vi.mocked(api.setShortcut).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.setStartAtLogin).mock.invocationCallOrder[0]!,
    )
    expect(
      vi.mocked(api.setStartAtLogin).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(api.saveConfig).mock.invocationCallOrder[0]!)
  })

  test('shows an explicit error when saving fails', async () => {
    const api = fakeApi()
    vi.mocked(api.saveConfig).mockRejectedValue(new Error('disk full'))
    await renderApp(api)

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Could not save settings.')).not.toBeNull()
  })
})
