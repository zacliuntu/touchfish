import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  DisplayInfo,
  ExternalTarget,
  NativeWindow,
  TouchFishConfig,
  WindowMatcher,
} from '../../shared/models'
import type { TouchFishRendererApi } from '../../shared/ipc'
import { en, type Translations } from '../../shared/i18n/en'
import { zhCN } from '../../shared/i18n/zh-CN'
import { DiagnosticsSection } from './components/DiagnosticsSection'
import { DisplayRulesSection } from './components/DisplayRulesSection'
import { ExternalTargetSection } from './components/ExternalTargetSection'
import { FirstRunWizard } from './components/FirstRunWizard'
import { GeneralSection } from './components/GeneralSection'
import { ShortcutSection } from './components/ShortcutSection'
import type { FieldErrors, Translate } from './components/types'
import { WebTargetSection } from './components/WebTargetSection'
import './styles.css'

type ActionState = { key: string; values?: Record<string, string | number> }
type ExclusiveAction = 'save' | 'capture' | 'migration' | 'choose-executable'
type SectionId =
  'web' | 'external' | 'displays' | 'shortcut' | 'general' | 'diagnostics'

interface ScrollableSettingsContent {
  scrollTop: number
  getBoundingClientRect(): { top: number }
  scrollTo(options: { top: number; behavior: 'auto' | 'smooth' }): void
}

interface InitializationData {
  config: TouchFishConfig
  displays: DisplayInfo[]
  windows: NativeWindow[]
  logs: Record<string, unknown>[]
  legacyProposal: { url: string } | null
  optionalLoadFailed: boolean
}

const initializationCache = new WeakMap<
  TouchFishRendererApi,
  Promise<InitializationData>
>()

const SCENE_ERROR_KEYS: Readonly<Record<string, string>> = {
  'scene-plan-failed': 'scene.errors.scenePlanFailed',
  'web-placement-failed': 'scene.errors.webPlacementFailed',
  'external-config-missing': 'scene.errors.externalConfigMissing',
  'external-launch-failed': 'scene.errors.externalLaunchFailed',
  'external-window-timeout': 'scene.errors.externalWindowTimeout',
  'external-placement-failed': 'scene.errors.externalPlacementFailed',
  'external-window-list-failed': 'scene.errors.externalWindowListFailed',
}

function resolveLocale(language: TouchFishConfig['language']): Translations {
  if (language === 'zh-CN') return zhCN
  if (language === 'en') return en
  return globalThis.navigator.language.toLowerCase().startsWith('zh')
    ? zhCN
    : en
}

function createTranslator(locale: Translations): Translate {
  return (key, values = {}) => {
    let result: unknown = locale
    for (const part of key.split('.')) {
      if (typeof result !== 'object' || result === null) return key
      result = (result as Record<string, unknown>)[part]
    }
    if (typeof result !== 'string') return key
    return Object.entries(values).reduce(
      (translated, [name, value]) =>
        translated.replaceAll(`{{${name}}}`, String(value)),
      result,
    )
  }
}

function cloneConfig(config: TouchFishConfig): TouchFishConfig {
  return globalThis.structuredClone(config)
}

function processNameFromPath(executablePath: string): string {
  return executablePath.split(/[\\/]/).filter(Boolean).at(-1) ?? executablePath
}

function matcherFromPath(executablePath: string): WindowMatcher | null {
  if (!executablePath.trim()) return null
  return {
    executablePath,
    processName: processNameFromPath(executablePath),
  }
}

function externalTargetWithPath(
  target: ExternalTarget,
  executablePath: string,
): ExternalTarget {
  return {
    ...target,
    executablePath,
    matcher: matcherFromPath(executablePath),
  }
}

function initialize(api: TouchFishRendererApi): Promise<InitializationData> {
  const cached = initializationCache.get(api)
  if (cached) return cached

  const initialization = api.loadConfig().then(async (loadedConfig) => {
    const [displayResult, windowResult, logResult, legacyResult] =
      await Promise.allSettled([
        api.listDisplays(),
        api.listWindows(),
        api.getDiagnostics({ limit: 25 }),
        api.getLegacyMigration(),
      ])
    return {
      config: loadedConfig,
      displays: displayResult.status === 'fulfilled' ? displayResult.value : [],
      windows: windowResult.status === 'fulfilled' ? windowResult.value : [],
      logs: logResult.status === 'fulfilled' ? logResult.value : [],
      legacyProposal:
        legacyResult.status === 'fulfilled' ? legacyResult.value : null,
      optionalLoadFailed: [
        displayResult,
        windowResult,
        logResult,
        legacyResult,
      ].some((result) => result.status === 'rejected'),
    }
  })
  initializationCache.set(api, initialization)
  void initialization.catch(() => {
    if (initializationCache.get(api) === initialization) {
      initializationCache.delete(api)
    }
  })
  return initialization
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new globalThis.URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

function detectDingTalkPreset(
  config: TouchFishConfig,
  nativeWindows: NativeWindow[],
): { config: TouchFishConfig; title: string } | null {
  if (
    config.firstRunComplete ||
    config.external.executablePath.trim() ||
    config.external.matcher !== null
  ) {
    return null
  }

  const tokens = ['dingtalk', '钉钉']
  const candidate = nativeWindows.find((nativeWindow) => {
    if (!nativeWindow.visible || !nativeWindow.executablePath) return false
    return [nativeWindow.executablePath, nativeWindow.nativeClass ?? ''].some(
      (value) => {
        const normalized = value.toLowerCase()
        return tokens.some((token) => normalized.includes(token))
      },
    )
  })
  if (!candidate?.executablePath) return null

  const executablePath = candidate.executablePath
  const matcher = matcherFromPath(executablePath)
  if (!matcher) return null
  return {
    config: {
      ...config,
      external: {
        executablePath,
        args: [],
        matcher: {
          ...matcher,
          ...(candidate.nativeClass
            ? { nativeClass: candidate.nativeClass }
            : {}),
          ...(candidate.title ? { titleHint: candidate.title } : {}),
        },
      },
    },
    title: candidate.title || matcher.processName,
  }
}

function FishMark() {
  return (
    <svg className="fish-mark" viewBox="0 0 44 32" aria-hidden="true">
      <path d="M4 16C10 7 19 4 29 7v18C19 28 10 25 4 16Z" />
      <path d="m29 11 10-6-2 11 2 11-10-6" />
      <circle cx="13" cy="14" r="1.6" />
      <path d="M20 7v18" />
    </svg>
  )
}

function NavIcon({ section }: { section: SectionId }) {
  const drawing = {
    web: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.3 2.45 3.5 5.45 3.5 9s-1.2 6.55-3.5 9M12 3c-2.3 2.45-3.5 5.45-3.5 9s1.2 6.55 3.5 9" />
      </>
    ),
    external: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 8h18" />
        <path d="M6.5 6h.01M9.5 6h.01" />
      </>
    ),
    displays: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M12 17v4M8 21h8" />
      </>
    ),
    shortcut: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="M6 9h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01" />
        <path d="M6 13h.01M9 13h.01M12 13h.01M15 13h3M7 16h10" />
      </>
    ),
    general: (
      <>
        <circle cx="12" cy="12" r="6.5" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.28 5.28 7.4 7.4M16.6 16.6l2.12 2.12M18.72 5.28 16.6 7.4M7.4 16.6l-2.12 2.12" />
      </>
    ),
    diagnostics: <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />,
  } satisfies Record<SectionId, ReactNode>

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      {drawing[section]}
    </svg>
  )
}

function App() {
  const persistedConfig = useRef<TouchFishConfig | null>(null)
  const exclusiveActionRef = useRef<ExclusiveAction | null>(null)
  const [draft, setDraft] = useState<TouchFishConfig | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [windows, setWindows] = useState<NativeWindow[]>([])
  const [logs, setLogs] = useState<Record<string, unknown>[]>([])
  const [legacyProposal, setLegacyProposal] = useState<{ url: string } | null>(
    null,
  )
  const [confirmingLegacy, setConfirmingLegacy] = useState(false)
  const [timeoutText, setTimeoutText] = useState('')
  const [argsText, setArgsText] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [loadingError, setLoadingError] = useState(false)
  const [optionalLoadFailed, setOptionalLoadFailed] = useState(false)
  const [exclusiveAction, setExclusiveAction] =
    useState<ExclusiveAction | null>(null)
  const [saveState, setSaveState] = useState<ActionState | null>(null)
  const [webDataState, setWebDataState] = useState<ActionState | null>(null)
  const [captureState, setCaptureState] = useState<ActionState | null>(null)
  const [presetState, setPresetState] = useState<ActionState | null>(null)
  const [shortcutConflict, setShortcutConflict] = useState(false)
  const [migrationState, setMigrationState] = useState<ActionState | null>(null)
  const [sceneState, setSceneState] = useState<ActionState | null>(null)
  const [sceneErrors, setSceneErrors] = useState<string[]>([])
  const [sceneBusy, setSceneBusy] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('web')

  const t = useMemo(
    () => createTranslator(resolveLocale(draft?.language ?? 'system')),
    [draft?.language],
  )

  useEffect(() => {
    let active = true
    void initialize(window.touchfish)
      .then((loaded) => {
        if (!active) return
        const clonedConfig = cloneConfig(loaded.config)
        persistedConfig.current = cloneConfig(loaded.config)
        const detectedPreset = detectDingTalkPreset(
          clonedConfig,
          loaded.windows,
        )
        const effectiveConfig = detectedPreset?.config ?? clonedConfig
        setDraft(effectiveConfig)
        if (detectedPreset) {
          setPresetState({
            key: 'external.presetDetected',
            values: { title: detectedPreset.title },
          })
        }
        setTimeoutText(String(loaded.config.timeoutSeconds))
        setArgsText(effectiveConfig.external.args.join('\n'))
        setDisplays(loaded.displays)
        setWindows(loaded.windows)
        setLogs(loaded.logs)
        setLegacyProposal(loaded.legacyProposal)
        setOptionalLoadFailed(loaded.optionalLoadFailed)
      })
      .catch(() => {
        if (active) setLoadingError(true)
      })
    return () => {
      active = false
    }
  }, [])

  const stateText = (state: ActionState | null): string | undefined =>
    state ? t(state.key, state.values) : undefined

  const beginExclusiveAction = (action: ExclusiveAction): boolean => {
    if (exclusiveActionRef.current !== null) return false
    exclusiveActionRef.current = action
    setExclusiveAction(action)
    return true
  }

  const endExclusiveAction = (action: ExclusiveAction): void => {
    if (exclusiveActionRef.current !== action) return
    exclusiveActionRef.current = null
    setExclusiveAction(null)
  }

  const navigateToSection = (
    event: ReactMouseEvent,
    section: SectionId,
  ): void => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    setActiveSection(section)
    globalThis.history.replaceState(null, '', `#${section}`)

    const target = event.currentTarget.ownerDocument.getElementById(section)
    if (!target) return
    const behavior =
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'

    if (globalThis.innerWidth > 720) {
      const settingsContent = target.closest(
        '.settings-content',
      ) as ScrollableSettingsContent | null
      if (!settingsContent) return
      const targetTop = target.getBoundingClientRect().top
      const contentTop = settingsContent.getBoundingClientRect().top
      settingsContent.scrollTo({
        top: settingsContent.scrollTop + targetTop - contentTop,
        behavior,
      })
      return
    }

    target.scrollIntoView({ behavior, block: 'start' })
  }

  const updateDraft = (
    update: (current: TouchFishConfig) => TouchFishConfig,
  ): void => {
    setDraft((current) => (current ? update(current) : current))
    setSaveState(null)
  }

  const chooseExecutable = async (): Promise<void> => {
    const action = 'choose-executable' as const
    if (!beginExclusiveAction(action)) return
    try {
      const path = await window.touchfish.chooseExecutable()
      if (!path) return
      updateDraft((current) => ({
        ...current,
        external: externalTargetWithPath(current.external, path),
      }))
      setPresetState(null)
      setCaptureState(null)
    } catch {
      setCaptureState({ key: 'external.chooseError' })
    } finally {
      endExclusiveAction(action)
    }
  }

  const captureForeground = async (): Promise<void> => {
    const action = 'capture' as const
    if (!beginExclusiveAction(action)) return
    try {
      for (const count of [3, 2, 1]) {
        setCaptureState({ key: 'external.countdown', values: { count } })
        await delay(1000)
      }
      const nativeWindow = await window.touchfish.beginWindowCapture()
      if (!nativeWindow) {
        setCaptureState({ key: 'external.cancelled' })
        return
      }
      const executablePath = nativeWindow.executablePath ?? ''
      const matcher = matcherFromPath(executablePath)
      updateDraft((current) => ({
        ...current,
        external: {
          ...current.external,
          executablePath,
          matcher: matcher
            ? {
                ...matcher,
                ...(nativeWindow.nativeClass
                  ? { nativeClass: nativeWindow.nativeClass }
                  : {}),
                ...(nativeWindow.title
                  ? { titleHint: nativeWindow.title }
                  : {}),
              }
            : null,
        },
      }))
      setPresetState(null)
      setCaptureState({
        key: 'external.captured',
        values: { title: nativeWindow.title },
      })
    } catch {
      setCaptureState({ key: 'external.captureError' })
    } finally {
      endExclusiveAction(action)
    }
  }

  const clearWebData = async (): Promise<void> => {
    try {
      await window.touchfish.clearWebData()
      setWebDataState({ key: 'web.cleared' })
    } catch {
      setWebDataState({ key: 'web.clearError' })
    }
  }

  const applyLegacyMigration = async (): Promise<void> => {
    if (!legacyProposal) return
    const action = 'migration' as const
    if (!beginExclusiveAction(action)) return
    const proposal = legacyProposal
    try {
      const result = await window.touchfish.applyLegacyMigration({
        confirmed: true,
        proposal,
      })
      if (!result.ok) {
        setMigrationState({ key: 'firstRun.importError' })
        return
      }
      updateDraft((current) => ({ ...current, web: { url: proposal.url } }))
      setLegacyProposal(null)
      setConfirmingLegacy(false)
      setMigrationState({ key: 'firstRun.imported' })
    } catch {
      setMigrationState({ key: 'firstRun.importError' })
    } finally {
      endExclusiveAction(action)
    }
  }

  const runScene = async (): Promise<void> => {
    setSceneBusy(true)
    setSceneErrors([])
    try {
      const result = await window.touchfish.runScene()
      setSceneState({ key: `scene.${result.status}` })
      setSceneErrors(result.errors)
    } catch {
      setSceneState({ key: 'scene.error' })
    } finally {
      setSceneBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!draft || exclusiveActionRef.current !== null) return
    const nextErrors: FieldErrors = {}
    if (!isHttpUrl(draft.web.url)) nextErrors.url = true
    const timeout = Number(timeoutText)
    if (
      !/^\d+$/.test(timeoutText) ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 120
    ) {
      nextErrors.timeout = true
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const configToSave: TouchFishConfig = {
      ...draft,
      timeoutSeconds: timeout,
      external: {
        ...draft.external,
        args: argsText
          .split('\n')
          .map((argument) => argument.trim())
          .filter(Boolean),
      },
      firstRunComplete: true,
    }
    const previousConfig = persistedConfig.current
    if (!previousConfig) {
      setSaveState({ key: 'app.saveError' })
      return
    }
    const action = 'save' as const
    if (!beginExclusiveAction(action)) return
    let shortcutApplied = false
    let autostartApplied = false
    setSaveState(null)
    setShortcutConflict(false)
    try {
      const shortcutResult = await window.touchfish.setShortcut({
        accelerator: configToSave.shortcut,
      })
      if (!shortcutResult.ok) {
        setShortcutConflict(true)
        return
      }
      shortcutApplied = true
      await window.touchfish.setStartAtLogin({
        enabled: configToSave.startAtLogin,
      })
      autostartApplied = true
      await window.touchfish.saveConfig(configToSave)
      setDraft(configToSave)
      persistedConfig.current = cloneConfig(configToSave)
      setSaveState({ key: 'app.saved' })
    } catch {
      let rollbackFailed = false
      if (autostartApplied) {
        try {
          await window.touchfish.setStartAtLogin({
            enabled: previousConfig.startAtLogin,
          })
        } catch {
          rollbackFailed = true
        }
      }
      if (shortcutApplied) {
        try {
          const rollbackResult = await window.touchfish.setShortcut({
            accelerator: previousConfig.shortcut,
          })
          if (!rollbackResult.ok) rollbackFailed = true
        } catch {
          rollbackFailed = true
        }
      }
      setSaveState({
        key: rollbackFailed ? 'app.saveRollbackError' : 'app.saveError',
      })
    } finally {
      endExclusiveAction(action)
    }
  }

  if (loadingError)
    return (
      <main className="loading-screen" role="alert">
        {t('app.loadError')}
      </main>
    )
  if (!draft)
    return (
      <main className="loading-screen" role="status">
        {t('app.loading')}
      </main>
    )

  const exclusiveBusy = exclusiveAction !== null
  const saving = exclusiveAction === 'save'
  const captureBusy = exclusiveAction === 'capture'
  const migrationBusy = exclusiveAction === 'migration'

  const navItems = [
    ['web', 'nav.web'],
    ['external', 'nav.external'],
    ['displays', 'nav.displays'],
    ['shortcut', 'nav.shortcut'],
    ['general', 'nav.general'],
    ['diagnostics', 'nav.diagnostics'],
  ] as const

  return (
    <div className="app-shell">
      <fieldset
        className="control-surface"
        disabled={exclusiveBusy}
        aria-busy={exclusiveBusy}
      >
        <header className="app-header">
          <a className="brand" href="#web" aria-label={t('app.name')}>
            <FishMark />
            <span>{t('app.name')}</span>
          </a>
          <div className="header-actions">
            <label className="header-language">
              <span className="sr-only">{t('general.quickLanguage')}</span>
              <select
                value={draft.language}
                onChange={(event) => {
                  const language = event.currentTarget
                    .value as TouchFishConfig['language']
                  updateDraft((current) => ({
                    ...current,
                    language,
                  }))
                }}
              >
                <option value="system">{t('general.system')}</option>
                <option value="zh-CN">{t('general.chinese')}</option>
                <option value="en">{t('general.english')}</option>
              </select>
            </label>
            <button
              className="button primary run-button"
              type="button"
              onClick={() => void runScene()}
              disabled={sceneBusy}
            >
              {t('app.runScene')}
            </button>
          </div>
        </header>

        <nav className="section-nav" aria-label={t('nav.settings')}>
          {navItems.map(([id, key]) => (
            <a
              className={activeSection === id ? 'active' : ''}
              href={`#${id}`}
              key={id}
              aria-current={activeSection === id ? 'location' : undefined}
              onClick={(event) => navigateToSection(event, id)}
            >
              <span className="nav-symbol" aria-hidden="true">
                <NavIcon section={id} />
              </span>
              <span>{t(key)}</span>
            </a>
          ))}
        </nav>

        <main className="settings-content">
          {optionalLoadFailed ? (
            <p className="optional-load-warning" role="status">
              {t('app.optionalLoadWarning')}
            </p>
          ) : null}
          <FirstRunWizard
            t={t}
            showWelcome={!draft.firstRunComplete}
            legacyProposal={legacyProposal}
            confirmingLegacy={confirmingLegacy}
            migrationBusy={migrationBusy}
            migrationState={stateText(migrationState)}
            onReviewLegacy={() => setConfirmingLegacy(true)}
            onCancelLegacy={() => setConfirmingLegacy(false)}
            onConfirmLegacy={() => void applyLegacyMigration()}
          />
          <WebTargetSection
            t={t}
            url={draft.web.url}
            timeout={timeoutText}
            urlError={errors.url ? t('web.urlError') : undefined}
            timeoutError={errors.timeout ? t('web.timeoutError') : undefined}
            actionState={stateText(webDataState)}
            onUrlChange={(url) =>
              updateDraft((current) => ({ ...current, web: { url } }))
            }
            onTimeoutChange={(value) => {
              setTimeoutText(value)
              setSaveState(null)
            }}
            onClearWebData={() => void clearWebData()}
          />
          <ExternalTargetSection
            t={t}
            executablePath={draft.external.executablePath}
            argsText={argsText}
            captureState={stateText(captureState)}
            presetState={stateText(presetState)}
            busy={captureBusy}
            onPathChange={(executablePath) => {
              setPresetState(null)
              updateDraft((current) => ({
                ...current,
                external: externalTargetWithPath(
                  current.external,
                  executablePath,
                ),
              }))
            }}
            onArgsChange={(value) => {
              setArgsText(value)
              setSaveState(null)
            }}
            onChoose={() => void chooseExecutable()}
            onCapture={() => void captureForeground()}
          />
          <DisplayRulesSection
            t={t}
            displays={displays}
            singleTarget={draft.singleDisplayTarget}
            swap={draft.swapOnTwoDisplays}
            webDisplayId={draft.multiDisplayTargets.webDisplayId}
            externalDisplayId={draft.multiDisplayTargets.externalDisplayId}
            onSingleTargetChange={(singleDisplayTarget) =>
              updateDraft((current) => ({ ...current, singleDisplayTarget }))
            }
            onSwapChange={(swapOnTwoDisplays) =>
              updateDraft((current) => ({ ...current, swapOnTwoDisplays }))
            }
            onWebDisplayChange={(webDisplayId) =>
              updateDraft((current) => ({
                ...current,
                multiDisplayTargets: {
                  ...current.multiDisplayTargets,
                  webDisplayId,
                },
              }))
            }
            onExternalDisplayChange={(externalDisplayId) =>
              updateDraft((current) => ({
                ...current,
                multiDisplayTargets: {
                  ...current.multiDisplayTargets,
                  externalDisplayId,
                },
              }))
            }
          />
          <ShortcutSection
            t={t}
            value={draft.shortcut}
            conflict={shortcutConflict}
            onChange={(shortcut) => {
              setShortcutConflict(false)
              updateDraft((current) => ({ ...current, shortcut }))
            }}
          />
          <GeneralSection
            t={t}
            language={draft.language}
            startAtLogin={draft.startAtLogin}
            onLanguageChange={(language) =>
              updateDraft((current) => ({ ...current, language }))
            }
            onStartAtLoginChange={(startAtLogin) =>
              updateDraft((current) => ({ ...current, startAtLogin }))
            }
          />
          <DiagnosticsSection
            t={t}
            displays={displays}
            windows={windows}
            logs={logs}
            sceneState={stateText(sceneState)}
            sceneErrors={sceneErrors.map((error) =>
              t(SCENE_ERROR_KEYS[error] ?? 'scene.errors.unknown'),
            )}
          />
        </main>
      </fieldset>

      <footer className="save-band">
        {saveState ? (
          <p
            className={
              saveState.key === 'app.saveRollbackError'
                ? 'save-state critical'
                : saveState.key === 'app.saveError'
                  ? 'save-state error'
                  : 'save-state'
            }
            role={
              saveState.key === 'app.saveRollbackError' ? 'alert' : 'status'
            }
          >
            {stateText(saveState)}
          </p>
        ) : (
          <span className="save-state" />
        )}
        <button
          className="button primary save-button"
          type="button"
          disabled={exclusiveBusy}
          onClick={() => void save()}
        >
          {saving ? t('app.saving') : t('app.save')}
        </button>
      </footer>
    </div>
  )
}

export default App
