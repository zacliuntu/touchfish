import { z } from 'zod'

import type {
  DisplayInfo,
  NativeWindow,
  TouchFishConfig,
} from '../shared/models'
import { IPC_CHANNELS, IPC_CONTRACTS, type IpcChannel } from '../shared/ipc'
import type { SceneRunResult } from './core/scene-orchestrator'
import type {
  LegacyMigrationProposal,
  LegacyMigrationResult,
} from './services/legacy-linux-migration'
import type { ShortcutSetResult } from './services/shortcut-service'

export interface IpcMainLike {
  handle(channel: string, listener: IpcHandler): void
  removeHandler(channel: string): void
}

type IpcHandler = (event: unknown, request: unknown) => Promise<unknown>

export interface TouchFishIpcDependencies {
  config: {
    load(): Promise<TouchFishConfig>
    save(config: TouchFishConfig): Promise<void>
  }
  platform: {
    listDisplays(): Promise<DisplayInfo[]>
    listWindows(): Promise<NativeWindow[]>
    captureForegroundWindow(): Promise<NativeWindow | null>
  }
  orchestrator: { run(config: TouchFishConfig): Promise<SceneRunResult> }
  dialog: { showOpenFile(): Promise<string[]> }
  shortcut: {
    set(
      accelerator: string,
      callback: () => void,
    ): ShortcutSetResult | Promise<ShortcutSetResult>
  }
  autostart: { setEnabled(enabled: boolean): Promise<void> }
  log: { recent(limit: number): Promise<Record<string, unknown>[]> }
  web: { clearData(): Promise<void> }
  settings: { hide(): void | Promise<void>; show(): void | Promise<void> }
  legacy: {
    inspect(): Promise<LegacyMigrationProposal | null>
    apply(proposal: LegacyMigrationProposal): Promise<LegacyMigrationResult>
  }
  isTrustedSender(event: unknown): boolean
  isTouchFishWindow(window: NativeWindow): boolean
  sleep(milliseconds: number): Promise<void>
}

export class IpcValidationError extends Error {
  constructor(channel: IpcChannel) {
    super(`Invalid IPC request for ${channel}`)
    this.name = 'IpcValidationError'
  }
}

export class IpcResponseValidationError extends Error {
  constructor(channel: IpcChannel) {
    super(`Invalid IPC response for ${channel}`)
    this.name = 'IpcResponseValidationError'
  }
}

export class IpcSenderValidationError extends Error {
  constructor() {
    super('Unauthorized TouchFish IPC sender')
    this.name = 'IpcSenderValidationError'
  }
}

export class TouchFishWindowCaptureError extends Error {
  constructor() {
    super('TouchFish windows cannot be captured')
    this.name = 'TouchFishWindowCaptureError'
  }
}

export function registerTouchFishIpc(
  ipcMain: IpcMainLike,
  dependencies: TouchFishIpcDependencies,
): () => void {
  const register = <Request, Response>(
    channel: IpcChannel,
    requestSchema: z.ZodType<Request, unknown>,
    responseSchema: z.ZodType<Response, unknown>,
    operation: (request: Request) => Promise<Response>,
  ): void => {
    ipcMain.handle(channel, async (event, request) => {
      if (!dependencies.isTrustedSender(event)) {
        throw new IpcSenderValidationError()
      }
      const parsedRequest = requestSchema.safeParse(request)
      if (!parsedRequest.success) {
        throw new IpcValidationError(channel)
      }

      const response = await operation(parsedRequest.data)
      const parsedResponse = responseSchema.safeParse(response)
      if (!parsedResponse.success) {
        throw new IpcResponseValidationError(channel)
      }
      return parsedResponse.data
    })
  }

  register(
    IPC_CHANNELS.loadConfig,
    IPC_CONTRACTS[IPC_CHANNELS.loadConfig].request,
    IPC_CONTRACTS[IPC_CHANNELS.loadConfig].response,
    () => dependencies.config.load(),
  )
  register(
    IPC_CHANNELS.saveConfig,
    IPC_CONTRACTS[IPC_CHANNELS.saveConfig].request,
    IPC_CONTRACTS[IPC_CHANNELS.saveConfig].response,
    async (config) => dependencies.config.save(config),
  )
  register(
    IPC_CHANNELS.listDisplays,
    IPC_CONTRACTS[IPC_CHANNELS.listDisplays].request,
    IPC_CONTRACTS[IPC_CHANNELS.listDisplays].response,
    () => dependencies.platform.listDisplays(),
  )
  register(
    IPC_CHANNELS.listWindows,
    IPC_CONTRACTS[IPC_CHANNELS.listWindows].request,
    IPC_CONTRACTS[IPC_CHANNELS.listWindows].response,
    () => dependencies.platform.listWindows(),
  )
  register(
    IPC_CHANNELS.beginWindowCapture,
    IPC_CONTRACTS[IPC_CHANNELS.beginWindowCapture].request,
    IPC_CONTRACTS[IPC_CHANNELS.beginWindowCapture].response,
    async () => captureWindow(dependencies),
  )
  register(
    IPC_CHANNELS.runScene,
    IPC_CONTRACTS[IPC_CHANNELS.runScene].request,
    IPC_CONTRACTS[IPC_CHANNELS.runScene].response,
    () => runScene(dependencies),
  )
  register(
    IPC_CHANNELS.chooseExecutable,
    IPC_CONTRACTS[IPC_CHANNELS.chooseExecutable].request,
    IPC_CONTRACTS[IPC_CHANNELS.chooseExecutable].response,
    async () => (await dependencies.dialog.showOpenFile())[0] ?? null,
  )
  register(
    IPC_CHANNELS.setShortcut,
    IPC_CONTRACTS[IPC_CHANNELS.setShortcut].request,
    IPC_CONTRACTS[IPC_CHANNELS.setShortcut].response,
    async ({ accelerator }) =>
      dependencies.shortcut.set(accelerator, () => {
        void runScene(dependencies).catch(() => {})
      }),
  )
  register(
    IPC_CHANNELS.setStartAtLogin,
    IPC_CONTRACTS[IPC_CHANNELS.setStartAtLogin].request,
    IPC_CONTRACTS[IPC_CHANNELS.setStartAtLogin].response,
    async (request) =>
      dependencies.autostart.setEnabled(
        typeof request === 'boolean' ? request : request.enabled,
      ),
  )
  register(
    IPC_CHANNELS.getDiagnostics,
    IPC_CONTRACTS[IPC_CHANNELS.getDiagnostics].request,
    IPC_CONTRACTS[IPC_CHANNELS.getDiagnostics].response,
    async (request) => dependencies.log.recent(request?.limit ?? 50),
  )
  register(
    IPC_CHANNELS.clearWebData,
    IPC_CONTRACTS[IPC_CHANNELS.clearWebData].request,
    IPC_CONTRACTS[IPC_CHANNELS.clearWebData].response,
    async () => dependencies.web.clearData(),
  )
  register(
    IPC_CHANNELS.getLegacyMigration,
    IPC_CONTRACTS[IPC_CHANNELS.getLegacyMigration].request,
    IPC_CONTRACTS[IPC_CHANNELS.getLegacyMigration].response,
    () => dependencies.legacy.inspect(),
  )
  register(
    IPC_CHANNELS.applyLegacyMigration,
    IPC_CONTRACTS[IPC_CHANNELS.applyLegacyMigration].request,
    IPC_CONTRACTS[IPC_CHANNELS.applyLegacyMigration].response,
    ({ proposal }) => dependencies.legacy.apply(proposal),
  )

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel)
    }
  }
}

async function runScene(
  dependencies: TouchFishIpcDependencies,
): Promise<SceneRunResult> {
  return dependencies.orchestrator.run(await dependencies.config.load())
}

async function captureWindow(
  dependencies: TouchFishIpcDependencies,
): Promise<NativeWindow | null> {
  try {
    await dependencies.settings.hide()
    await dependencies.sleep(500)
    const window = await dependencies.platform.captureForegroundWindow()
    if (window !== null && dependencies.isTouchFishWindow(window)) {
      throw new TouchFishWindowCaptureError()
    }
    return window
  } finally {
    await dependencies.settings.show()
  }
}
