import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'

import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from 'electron'

import type {
  AppLanguage,
  NativeWindow,
  PlatformAdapter,
  TouchFishConfig,
} from '../shared/models'
import { sceneNotifications } from '../shared/i18n/scene-notifications'
import { ConfigStore } from './config/store'
import {
  SceneOrchestrator,
  type SceneLogger,
  type SceneNotificationKey,
  type SceneRunResult,
} from './core/scene-orchestrator'
import { registerTouchFishIpc } from './ipc'
import { runCommand } from './platform/command'
import { AutostartService } from './services/autostart-service'
import {
  LegacyLinuxMigration,
  type LegacyMigrationProposal,
  type LegacyMigrationResult,
} from './services/legacy-linux-migration'
import { LogStore } from './services/log-store'
import {
  ShortcutService,
  type ShortcutSetResult,
} from './services/shortcut-service'
import {
  TrayService,
  type TrayServiceDependencies,
} from './services/tray-service'
import { SettingsWindowController } from './windows/settings-window'
import { WebWindowController } from './windows/web-window'

type MaybePromise<Value> = Value | Promise<Value>
type RuntimePlatform = (typeof process)['platform']

export interface LifecycleApp {
  requestSingleInstanceLock(): boolean
  whenReady(): Promise<void>
  quit(): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface ApplicationRuntime {
  config: {
    load(): Promise<TouchFishConfig>
    save(config: TouchFishConfig): Promise<void>
  }
  logger: SceneLogger
  autostart: { setEnabled(enabled: boolean): Promise<void> }
  tray: {
    initialize(): Promise<void>
    setLanguage(language: AppLanguage): void
    setAutostartEnabled(enabled: boolean): void
    dispose(): void
  }
  shortcut: {
    set(
      accelerator: string,
      callback: () => void | Promise<void>,
    ): MaybePromise<ShortcutSetResult>
    dispose(): void
  }
  settings: { show(): MaybePromise<void>; destroy(): void }
  web: { destroy(): void }
  orchestrator: {
    run(config: TouchFishConfig): Promise<SceneRunResult>
  }
  disposeIpc(): void
}

export interface RuntimeControls {
  openSettings(): Promise<void>
  runScene(): Promise<void>
  quit(): void
}

export interface BootstrapDependencies {
  app: LifecycleApp
  platform: RuntimePlatform
  env: Readonly<Record<string, string | undefined>>
  argv: readonly string[]
  systemLocale: string
  accessCandidate(path: string): Promise<void>
  createWindowsAdapter(): MaybePromise<PlatformAdapter>
  createLinuxAdapter(): MaybePromise<PlatformAdapter>
  createRuntime(
    adapter: PlatformAdapter,
    controls: RuntimeControls,
  ): MaybePromise<ApplicationRuntime>
  reportError(title: string, message: string): void
}

export interface BootstrapHandle {
  initialized: Promise<void>
  dispose(): void
}

export interface DingTalkProbeDependencies {
  platform: RuntimePlatform
  env: Readonly<Record<string, string | undefined>>
  access(path: string): Promise<void>
  shouldStop?(): boolean
}

interface TrayIconImage {
  isEmpty(): boolean
}

export interface TrayIconDependencies {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  nativeImage: {
    createFromPath(path: string): TrayIconImage
  }
}

class UnsupportedPlatformError extends Error {
  constructor(readonly reason: 'linux-x11-required' | 'unsupported-os') {
    super(reason)
    this.name = 'UnsupportedPlatformError'
  }
}

export function bootstrapTouchFish(
  dependencies: BootstrapDependencies,
): BootstrapHandle {
  let runtime: ApplicationRuntime | undefined
  let stopping = false
  let startupSettled = false

  const disposeRuntime = (): void => {
    const ownedRuntime = runtime
    runtime = undefined
    if (ownedRuntime === undefined) return
    disposeSafely(() => ownedRuntime.shortcut.dispose())
    disposeSafely(ownedRuntime.disposeIpc)
    disposeSafely(() => ownedRuntime.settings.destroy())
    disposeSafely(() => ownedRuntime.web.destroy())
    disposeSafely(() => ownedRuntime.tray.dispose())
  }

  const dispose = (): void => {
    if (stopping) return
    stopping = true
    if (startupSettled) disposeRuntime()
  }

  const hasLock = dependencies.app.requestSingleInstanceLock()
  if (!hasLock) {
    startupSettled = true
    dependencies.app.quit()
    return { initialized: Promise.resolve(), dispose }
  }

  const controls: RuntimeControls = {
    openSettings: async () => {
      if (!stopping && runtime !== undefined) {
        await safeStep(
          runtime,
          dependencies,
          'settings-open-failed',
          'system',
          () => runtime?.settings.show(),
          () => stopping,
        )
      }
    },
    runScene: async () => {
      if (!stopping && runtime !== undefined) {
        await runLatestScene(
          runtime,
          dependencies,
          'scene-run-failed',
          undefined,
          () => stopping,
        )
      }
    },
    quit: () => quitSafely(dependencies.app),
  }

  dependencies.app.on('second-instance', () => {
    void initialized.then(() => controls.openSettings()).catch(() => undefined)
  })
  dependencies.app.on('window-all-closed', () => undefined)
  dependencies.app.on('before-quit', dispose)

  const initialized = dependencies.app
    .whenReady()
    .then(async () => {
      if (stopping) return
      try {
        const adapter = await selectAdapter(dependencies)
        if (stopping) return
        runtime = await dependencies.createRuntime(adapter, controls)
        if (stopping) return
        await startRuntime(runtime, dependencies, () => stopping)
      } catch (error: unknown) {
        if (stopping) return
        const message =
          error instanceof UnsupportedPlatformError
            ? messageForUnsupported(
                error.reason,
                safeSystemLocale(dependencies),
              )
            : localizedMessage(
                'startup-failed',
                'system',
                safeSystemLocale(dependencies),
              )
        reportSafely(dependencies, message)
        if (runtime !== undefined) {
          logSafely(runtime.logger, 'startup-failed', error)
        }
        dispose()
        quitSafely(dependencies.app)
      }
    })
    .catch(() => {
      if (stopping) return
      reportSafely(
        dependencies,
        localizedMessage(
          'startup-failed',
          'system',
          safeSystemLocale(dependencies),
        ),
      )
      dispose()
      quitSafely(dependencies.app)
    })
    .finally(() => {
      startupSettled = true
      if (stopping) disposeRuntime()
    })

  return { initialized, dispose }
}

export function loadTrayIcon(
  dependencies: TrayIconDependencies,
): TrayIconImage {
  const path = dependencies.isPackaged
    ? join(dependencies.resourcesPath, 'icons', 'tray.png')
    : join(dependencies.appPath, 'build', 'icons', '32x32.png')
  const icon = dependencies.nativeImage.createFromPath(path)
  if (icon.isEmpty()) {
    throw new Error(`Unable to load TouchFish tray icon: ${path}`)
  }
  return icon
}

export async function enrichFirstRunWithDingTalk(
  config: TouchFishConfig,
  dependencies: DingTalkProbeDependencies,
): Promise<TouchFishConfig> {
  if (
    config.firstRunComplete ||
    config.external.executablePath.trim() !== '' ||
    config.external.matcher !== null
  ) {
    return config
  }

  for (const candidate of dingTalkCandidates(dependencies)) {
    if (dependencies.shouldStop?.() === true) return config
    try {
      await dependencies.access(candidate)
    } catch {
      if (dependencies.shouldStop?.() === true) return config
      continue
    }
    if (dependencies.shouldStop?.() === true) return config

    const elevatorLauncher =
      candidate === '/opt/apps/com.alibabainc.dingtalk/files/Elevator.sh'
    const processName = elevatorLauncher
      ? 'com.alibabainc.dingtalk'
      : dependencies.platform === 'win32'
        ? win32.basename(candidate)
        : posix.basename(candidate)
    return {
      ...config,
      external: {
        executablePath: candidate,
        args: [],
        matcher: {
          executablePath: candidate,
          processName,
          ...(elevatorLauncher
            ? { nativeClass: 'com.alibabainc.dingtalk' }
            : {}),
        },
      },
    }
  }

  return config
}

export function resolveSceneNotification(
  key: SceneNotificationKey,
  config: TouchFishConfig,
  systemLocale: string,
): string {
  const locale = effectiveLocale(config.language, systemLocale).startsWith('zh')
    ? 'zh-CN'
    : 'en'
  return sceneNotifications[locale][key]
}

export function createTrayErrorHandler(
  logger: SceneLogger,
  dependencies: Pick<BootstrapDependencies, 'reportError' | 'systemLocale'>,
  getLanguage: () => AppLanguage,
): (error: unknown) => void {
  return (error) => {
    logSafely(logger, 'tray-autostart-toggle-failed', error)
    let language: AppLanguage = 'system'
    try {
      language = getLanguage()
    } catch {
      // System language is a safe fallback when current config is unavailable.
    }
    reportSafely(
      dependencies,
      localizedMessage(
        'tray-autostart-toggle-failed',
        language,
        safeSystemLocale(dependencies),
      ),
    )
  }
}

type ConfigAccess = {
  load(): Promise<TouchFishConfig>
  save(config: TouchFishConfig): Promise<void>
}

type TrayState = {
  setLanguage(language: AppLanguage): void
  setAutostartEnabled(enabled: boolean): void
}

export type TraySyncKind = 'language' | 'autostart'

type OsAutostart = {
  isEnabled(): Promise<boolean>
  setEnabled(enabled: boolean): Promise<void>
}

export function createCoordinatedConfigStore(
  config: ConfigAccess,
  tray: TrayState,
  onTraySyncError: (kind: TraySyncKind, error: unknown) => void = () =>
    undefined,
): ConfigAccess {
  return {
    load: () => config.load(),
    save: async (value) => {
      await config.save(value)
      syncTrayState('language', () => tray.setLanguage(value.language))
      syncTrayState('autostart', () =>
        tray.setAutostartEnabled(value.startAtLogin),
      )
    },
  }

  function syncTrayState(kind: TraySyncKind, operation: () => void): void {
    try {
      operation()
    } catch (error: unknown) {
      try {
        onTraySyncError(kind, error)
      } catch {
        // A committed config save cannot be undone by tray error reporting.
      }
    }
  }
}

export function createCoordinatedTrayAutostart(
  config: ConfigAccess,
  osAutostart: OsAutostart,
  onRollbackError: (error: unknown) => void,
): OsAutostart {
  return {
    isEnabled: () => osAutostart.isEnabled(),
    setEnabled: async (enabled) => {
      const previous = await config.load()
      await osAutostart.setEnabled(enabled)
      try {
        await config.save({ ...previous, startAtLogin: enabled })
      } catch (saveError: unknown) {
        try {
          await osAutostart.setEnabled(previous.startAtLogin)
        } catch (rollbackError: unknown) {
          try {
            onRollbackError(rollbackError)
          } catch {
            // Reporting a partial rollback cannot replace the save failure.
          }
        }
        throw saveError
      }
    },
  }
}

async function selectAdapter(
  dependencies: BootstrapDependencies,
): Promise<PlatformAdapter> {
  if (dependencies.platform === 'win32') {
    return dependencies.createWindowsAdapter()
  }
  if (dependencies.platform === 'linux') {
    if (
      dependencies.env.XDG_SESSION_TYPE?.toLowerCase() !== 'x11' ||
      dependencies.env.DISPLAY?.trim() === '' ||
      dependencies.env.DISPLAY === undefined
    ) {
      throw new UnsupportedPlatformError('linux-x11-required')
    }
    return dependencies.createLinuxAdapter()
  }
  throw new UnsupportedPlatformError('unsupported-os')
}

async function startRuntime(
  runtime: ApplicationRuntime,
  dependencies: BootstrapDependencies,
  shouldStop: () => boolean,
): Promise<void> {
  if (shouldStop()) return
  let config = await runtime.config.load()
  if (shouldStop()) return
  const enriched = await enrichFirstRunWithDingTalk(config, {
    platform: dependencies.platform,
    env: dependencies.env,
    access: dependencies.accessCandidate,
    shouldStop,
  })
  if (shouldStop()) return
  if (enriched !== config) {
    await safeStep(
      runtime,
      dependencies,
      'dingtalk-preset-save-failed',
      config.language,
      () => runtime.config.save(enriched),
      shouldStop,
    )
    if (shouldStop()) return
    config = enriched
  }

  await safeStep(
    runtime,
    dependencies,
    'autostart-startup-failed',
    config.language,
    () => runtime.autostart.setEnabled(config.startAtLogin),
    shouldStop,
  )
  if (shouldStop()) return
  await safeStep(
    runtime,
    dependencies,
    'tray-startup-failed',
    config.language,
    () => runtime.tray.initialize(),
    shouldStop,
  )
  if (shouldStop()) return
  await safeStep(
    runtime,
    dependencies,
    'tray-state-failed',
    config.language,
    () => {
      runtime.tray.setLanguage(config.language)
      runtime.tray.setAutostartEnabled(config.startAtLogin)
    },
    shouldStop,
  )
  if (shouldStop()) return

  await registerStartupShortcut(runtime, dependencies, config, shouldStop)
  if (shouldStop()) return

  const hidden = dependencies.argv.includes('--hidden')
  if (!hidden && !config.firstRunComplete) {
    await safeStep(
      runtime,
      dependencies,
      'settings-open-failed',
      config.language,
      () => runtime.settings.show(),
      shouldStop,
    )
    if (shouldStop()) return
  }
  if (dependencies.argv.includes('--run-scene')) {
    await runLatestScene(
      runtime,
      dependencies,
      'scene-run-failed',
      config,
      shouldStop,
    )
  }
}

async function registerStartupShortcut(
  runtime: ApplicationRuntime,
  dependencies: BootstrapDependencies,
  config: TouchFishConfig,
  shouldStop: () => boolean,
): Promise<void> {
  if (shouldStop()) return
  try {
    const result = await runtime.shortcut.set(config.shortcut, async () => {
      await runLatestScene(
        runtime,
        dependencies,
        'scene-run-failed',
        undefined,
        shouldStop,
      )
    })
    if (shouldStop()) return
    if (!result.ok) {
      runtime.logger.error('shortcut-conflict')
      reportSafely(
        dependencies,
        localizedMessage(
          'shortcut-conflict',
          config.language,
          safeSystemLocale(dependencies),
        ),
      )
    }
  } catch (error: unknown) {
    if (shouldStop()) return
    logSafely(runtime.logger, 'shortcut-startup-failed', error)
    reportSafely(
      dependencies,
      localizedMessage(
        'startup-service-failed',
        config.language,
        safeSystemLocale(dependencies),
      ),
    )
  }
}

async function runLatestScene(
  runtime: ApplicationRuntime,
  dependencies: BootstrapDependencies,
  event: string,
  knownConfig?: TouchFishConfig,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  if (shouldStop()) return
  let language: AppLanguage = knownConfig?.language ?? 'system'
  try {
    const config = knownConfig ?? (await runtime.config.load())
    if (shouldStop()) return
    language = config.language
    await runtime.orchestrator.run(config)
  } catch (error: unknown) {
    if (shouldStop()) return
    logSafely(runtime.logger, event, error)
    reportSafely(
      dependencies,
      localizedMessage(
        'scene-run-failed',
        language,
        safeSystemLocale(dependencies),
      ),
    )
  }
}

async function safeStep(
  runtime: ApplicationRuntime,
  dependencies: BootstrapDependencies,
  event: string,
  language: AppLanguage,
  operation: () => MaybePromise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  if (shouldStop()) return
  try {
    await operation()
  } catch (error: unknown) {
    if (shouldStop()) return
    logSafely(runtime.logger, event, error)
    reportSafely(
      dependencies,
      localizedMessage(
        'startup-service-failed',
        language,
        safeSystemLocale(dependencies),
      ),
    )
  }
}

function logSafely(logger: SceneLogger, event: string, error: unknown): void {
  try {
    logger.error(event, {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
  } catch {
    // Diagnostics must never alter lifecycle handling.
  }
}

function reportSafely(
  dependencies: Pick<BootstrapDependencies, 'reportError'>,
  message: string,
): void {
  try {
    dependencies.reportError('TouchFish', message)
  } catch {
    // A failed dialog cannot turn a handled lifecycle error into a rejection.
  }
}

function disposeSafely(operation: () => void): void {
  try {
    operation()
  } catch {
    // Cleanup continues so every owned service receives one disposal attempt.
  }
}

function quitSafely(app: Pick<LifecycleApp, 'quit'>): void {
  try {
    app.quit()
  } catch {
    // A thrown quit hook must not create an unhandled lifecycle rejection.
  }
}

function safeSystemLocale(
  dependencies: Pick<BootstrapDependencies, 'systemLocale'>,
): string {
  try {
    const locale = dependencies.systemLocale.trim()
    return locale === '' ? 'en' : locale
  } catch {
    return 'en'
  }
}

function localizedMessage(
  key:
    | 'shortcut-conflict'
    | 'startup-failed'
    | 'startup-service-failed'
    | 'scene-run-failed'
    | 'tray-autostart-toggle-failed'
    | 'tray-autostart-rollback-failed'
    | 'tray-config-sync-failed',
  language: AppLanguage,
  systemLocale: string,
): string {
  const chinese = effectiveLocale(language, systemLocale).startsWith('zh')
  const messages = {
    'shortcut-conflict': chinese
      ? '配置的快捷键已被其他程序占用，请在设置中更换。'
      : 'The configured shortcut is already in use. Choose another in Settings.',
    'startup-failed': chinese
      ? 'TouchFish 启动失败。请查看诊断日志。'
      : 'TouchFish could not start. Check the diagnostics log.',
    'startup-service-failed': chinese
      ? '部分启动设置无法应用。TouchFish 将继续运行。'
      : 'A startup setting could not be applied. TouchFish will continue.',
    'scene-run-failed': chinese
      ? '场景运行失败。请查看诊断日志。'
      : 'The scene could not run. Check the diagnostics log.',
    'tray-autostart-toggle-failed': chinese
      ? '无法更改开机启动设置。'
      : 'Could not change the start-at-login setting.',
    'tray-autostart-rollback-failed': chinese
      ? '无法恢复原有开机启动设置，系统状态可能与配置不一致。'
      : 'Could not restore the previous start-at-login setting. System state may differ from the configuration.',
    'tray-config-sync-failed': chinese
      ? '配置已保存，但无法刷新托盘状态。'
      : 'Settings were saved, but the tray could not be refreshed.',
  }
  return messages[key]
}

function messageForUnsupported(
  reason: UnsupportedPlatformError['reason'],
  systemLocale: string,
): string {
  const chinese = systemLocale.toLowerCase().startsWith('zh')
  if (reason === 'linux-x11-required') {
    return chinese
      ? 'TouchFish 当前仅支持 Ubuntu 的 X11 会话；Wayland 暂不支持。'
      : 'TouchFish currently requires an X11 session on Ubuntu; Wayland is not supported.'
  }
  return chinese
    ? 'TouchFish 当前仅支持 Windows 与 Ubuntu X11。'
    : 'TouchFish currently supports Windows and Ubuntu X11 only.'
}

function effectiveLocale(language: AppLanguage, systemLocale: string): string {
  return (language === 'system' ? systemLocale : language).toLowerCase()
}

function dingTalkCandidates(
  dependencies: Pick<DingTalkProbeDependencies, 'platform' | 'env'>,
): string[] {
  if (dependencies.platform === 'linux') {
    return [
      '/opt/apps/com.alibabainc.dingtalk/files/Elevator.sh',
      '/usr/bin/dingtalk',
    ]
  }
  if (dependencies.platform !== 'win32') return []

  const roots = [
    dependencies.env.LOCALAPPDATA,
    dependencies.env.ProgramFiles,
    dependencies.env['ProgramFiles(x86)'],
  ].filter((root): root is string => root !== undefined && root.trim() !== '')
  return roots.flatMap((root) => [
    win32.join(root, 'DingTalk', 'main', 'current', 'DingTalk.exe'),
    win32.join(root, 'DingTalk', 'DingTalk.exe'),
  ])
}

function createProductionDependencies(): BootstrapDependencies {
  return {
    app: app as unknown as LifecycleApp,
    platform: process.platform,
    env: process.env,
    argv: process.argv,
    get systemLocale() {
      return app.getLocale()
    },
    accessCandidate: async (path) => {
      await fs.access(
        path,
        process.platform === 'linux' ? constants.X_OK : constants.F_OK,
      )
    },
    createWindowsAdapter: async () => {
      const { WindowsAdapter } = await import('./platform/windows/adapter')
      return new WindowsAdapter()
    },
    createLinuxAdapter: async () => {
      const { LinuxX11Adapter } = await import('./platform/linux-x11/adapter')
      return new LinuxX11Adapter()
    },
    createRuntime: createProductionRuntime,
    reportError: (title, message) => dialog.showErrorBox(title, message),
  }
}

async function createProductionRuntime(
  adapter: PlatformAdapter,
  controls: RuntimeControls,
): Promise<ApplicationRuntime> {
  const userData = app.getPath('userData')
  const configStore = new ConfigStore(userData)
  const log = new LogStore(join(userData, 'logs'))
  const logger = createSceneLogger(log)
  const settings = new SettingsWindowController()
  const web = new WebWindowController()
  const orchestrator = new SceneOrchestrator(
    adapter,
    web,
    logger,
    sleep,
    (key, config) => resolveSceneNotification(key, config, app.getLocale()),
  )
  const shortcut = new ShortcutService(globalShortcut)
  const configHome =
    process.env.XDG_CONFIG_HOME?.trim() !== '' &&
    process.env.XDG_CONFIG_HOME !== undefined
      ? process.env.XDG_CONFIG_HOME
      : join(app.getPath('home'), '.config')
  const osAutostart =
    process.platform === 'win32'
      ? new AutostartService({
          platform: 'win32',
          configHome,
          fs,
          app: {
            executablePath: process.execPath,
            setLoginItemSettings: (settings) =>
              app.setLoginItemSettings(settings),
            getLoginItemSettings: (settings) =>
              app.getLoginItemSettings(settings),
          },
        })
      : new AutostartService({
          platform: 'linux',
          configHome,
          fs,
          app: { executablePath: process.execPath },
        })
  let trayLanguage: AppLanguage = 'system'
  const trayReporting = {
    get systemLocale() {
      return app.getLocale()
    },
    reportError: (title: string, message: string) =>
      dialog.showErrorBox(title, message),
  }
  const trayAutostart = createCoordinatedTrayAutostart(
    configStore,
    osAutostart,
    (error) => {
      logSafely(logger, 'tray-autostart-rollback-failed', error)
      reportSafely(
        trayReporting,
        localizedMessage(
          'tray-autostart-rollback-failed',
          trayLanguage,
          safeSystemLocale(trayReporting),
        ),
      )
    },
  )
  const trayService = new TrayService({
    Tray: Tray as unknown as TrayServiceDependencies['Tray'],
    Menu,
    icon: loadTrayIcon({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      nativeImage,
    }),
    locale: app.getLocale(),
    onOpenSettings: controls.openSettings,
    onRunScene: controls.runScene,
    onQuit: controls.quit,
    onError: createTrayErrorHandler(logger, trayReporting, () => trayLanguage),
    autostart: trayAutostart,
  })
  const tray: ApplicationRuntime['tray'] = {
    initialize: () => trayService.initialize(),
    setLanguage: (language) => {
      trayLanguage = language
      trayService.setLanguage(language)
    },
    setAutostartEnabled: (enabled) => trayService.setAutostartEnabled(enabled),
    dispose: () => trayService.dispose(),
  }
  const config = createCoordinatedConfigStore(
    configStore,
    tray,
    (kind, error) => {
      logSafely(logger, `tray-config-${kind}-sync-failed`, error)
      reportSafely(
        trayReporting,
        localizedMessage(
          'tray-config-sync-failed',
          trayLanguage,
          safeSystemLocale(trayReporting),
        ),
      )
    },
  )
  const legacy =
    process.platform === 'linux'
      ? new LegacyLinuxMigration({
          runCommand: async (arguments_) => {
            const [file, ...args] = arguments_
            if (file === undefined) return undefined
            return (await runCommand(file, args)).stdout
          },
          readFile: fs.readFile,
          config,
        })
      : noLegacyMigration()
  const disposeIpc = registerTouchFishIpc(ipcMain, {
    config,
    platform: adapter,
    orchestrator,
    dialog: {
      showOpenFile: async () => {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
        })
        return result.filePaths
      },
    },
    shortcut,
    autostart: osAutostart,
    log,
    web,
    settings,
    legacy,
    isTouchFishWindow: (window: NativeWindow) => window.pid === process.pid,
    sleep,
  })

  return {
    config,
    logger,
    autostart: osAutostart,
    tray,
    shortcut,
    settings,
    web,
    orchestrator,
    disposeIpc,
  }
}

function createSceneLogger(log: LogStore): SceneLogger {
  const write = (level: 'info' | 'error', event: string, data?: object) => {
    void log
      .write({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...(data === undefined ? {} : { data }),
      })
      .catch(() => undefined)
  }
  return {
    info: (event, data) => write('info', event, data),
    error: (event, data) => write('error', event, data),
  }
}

function noLegacyMigration(): {
  inspect(): Promise<null>
  apply(proposal: LegacyMigrationProposal): Promise<LegacyMigrationResult>
} {
  return {
    inspect: async () => null,
    apply: async (_proposal) => ({ ok: false, reason: 'no-proposal' }),
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

if (process.env.NODE_ENV !== 'test') {
  bootstrapTouchFish(createProductionDependencies())
}
