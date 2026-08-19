import { z } from 'zod'

import { configSchema } from '../main/config/schema'
import type { DisplayInfo, NativeWindow, Rect } from './models'

export const IPC_CHANNELS = {
  loadConfig: 'touchfish:load-config',
  saveConfig: 'touchfish:save-config',
  listDisplays: 'touchfish:list-displays',
  listWindows: 'touchfish:list-windows',
  beginWindowCapture: 'touchfish:begin-window-capture',
  runScene: 'touchfish:run-scene',
  chooseExecutable: 'touchfish:choose-executable',
  setShortcut: 'touchfish:set-shortcut',
  setStartAtLogin: 'touchfish:set-start-at-login',
  getDiagnostics: 'touchfish:get-diagnostics',
  clearWebData: 'touchfish:clear-web-data',
  getLegacyMigration: 'touchfish:get-legacy-migration',
  applyLegacyMigration: 'touchfish:apply-legacy-migration',
} as const

const rectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict() satisfies z.ZodType<Rect>

const displaySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    primary: z.boolean(),
    bounds: rectSchema,
    workArea: rectSchema,
  })
  .strict() satisfies z.ZodType<DisplayInfo>

const nativeWindowSchema = z
  .object({
    id: z.string(),
    pid: z.number().int(),
    title: z.string(),
    nativeClass: z.string().optional(),
    executablePath: z.string().optional(),
    bounds: rectSchema,
    visible: z.boolean(),
  })
  .strict()
  .transform((value): NativeWindow => {
    const window: NativeWindow = {
      id: value.id,
      pid: value.pid,
      title: value.title,
      bounds: value.bounds,
      visible: value.visible,
    }
    if (value.nativeClass !== undefined) {
      window.nativeClass = value.nativeClass
    }
    if (value.executablePath !== undefined) {
      window.executablePath = value.executablePath
    }
    return window
  }) satisfies z.ZodType<NativeWindow>

const sceneRunResultSchema = z
  .object({
    status: z.enum(['success', 'partial', 'failed', 'busy']),
    errors: z.array(z.string()),
  })
  .strict()

const shortcutResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), reason: z.literal('conflict') }).strict(),
])

const legacyProposalSchema = z
  .object({ url: configSchema.shape.web.shape.url })
  .strict()

const legacyMigrationResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z
    .object({
      ok: z.literal(false),
      reason: z.enum(['no-proposal', 'write-failed', 'rollback-failed']),
    })
    .strict(),
])

export const IPC_CONTRACTS = {
  [IPC_CHANNELS.loadConfig]: {
    request: z.undefined(),
    response: configSchema,
  },
  [IPC_CHANNELS.saveConfig]: {
    request: configSchema,
    response: z.undefined(),
  },
  [IPC_CHANNELS.listDisplays]: {
    request: z.undefined(),
    response: z.array(displaySchema),
  },
  [IPC_CHANNELS.listWindows]: {
    request: z.undefined(),
    response: z.array(nativeWindowSchema),
  },
  [IPC_CHANNELS.beginWindowCapture]: {
    request: z.undefined(),
    response: nativeWindowSchema.nullable(),
  },
  [IPC_CHANNELS.runScene]: {
    request: z.undefined(),
    response: sceneRunResultSchema,
  },
  [IPC_CHANNELS.chooseExecutable]: {
    request: z.undefined(),
    response: z.string().nullable(),
  },
  [IPC_CHANNELS.setShortcut]: {
    request: z.object({ accelerator: z.string().min(1).max(256) }).strict(),
    response: shortcutResultSchema,
  },
  [IPC_CHANNELS.setStartAtLogin]: {
    request: z.union([
      z.boolean(),
      z.object({ enabled: z.boolean() }).strict(),
    ]),
    response: z.undefined(),
  },
  [IPC_CHANNELS.getDiagnostics]: {
    request: z.union([
      z.undefined(),
      z.object({ limit: z.number().int().min(1).max(200).optional() }).strict(),
    ]),
    response: z.array(z.record(z.string(), z.unknown())),
  },
  [IPC_CHANNELS.clearWebData]: {
    request: z.undefined(),
    response: z.undefined(),
  },
  [IPC_CHANNELS.getLegacyMigration]: {
    request: z.undefined(),
    response: legacyProposalSchema.nullable(),
  },
  [IPC_CHANNELS.applyLegacyMigration]: {
    request: z
      .object({ confirmed: z.literal(true), proposal: legacyProposalSchema })
      .strict(),
    response: legacyMigrationResultSchema,
  },
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export type IpcRequest<Channel extends IpcChannel> = z.input<
  (typeof IPC_CONTRACTS)[Channel]['request']
>

export type IpcResponse<Channel extends IpcChannel> = z.output<
  (typeof IPC_CONTRACTS)[Channel]['response']
>

export interface TouchFishRendererApi {
  loadConfig(): Promise<IpcResponse<typeof IPC_CHANNELS.loadConfig>>
  saveConfig(
    config: IpcRequest<typeof IPC_CHANNELS.saveConfig>,
  ): Promise<IpcResponse<typeof IPC_CHANNELS.saveConfig>>
  listDisplays(): Promise<IpcResponse<typeof IPC_CHANNELS.listDisplays>>
  listWindows(): Promise<IpcResponse<typeof IPC_CHANNELS.listWindows>>
  beginWindowCapture(): Promise<
    IpcResponse<typeof IPC_CHANNELS.beginWindowCapture>
  >
  runScene(): Promise<IpcResponse<typeof IPC_CHANNELS.runScene>>
  chooseExecutable(): Promise<IpcResponse<typeof IPC_CHANNELS.chooseExecutable>>
  setShortcut(
    request: IpcRequest<typeof IPC_CHANNELS.setShortcut>,
  ): Promise<IpcResponse<typeof IPC_CHANNELS.setShortcut>>
  setStartAtLogin(
    request: IpcRequest<typeof IPC_CHANNELS.setStartAtLogin>,
  ): Promise<IpcResponse<typeof IPC_CHANNELS.setStartAtLogin>>
  getDiagnostics(
    request?: Exclude<
      IpcRequest<typeof IPC_CHANNELS.getDiagnostics>,
      undefined
    >,
  ): Promise<IpcResponse<typeof IPC_CHANNELS.getDiagnostics>>
  clearWebData(): Promise<IpcResponse<typeof IPC_CHANNELS.clearWebData>>
  getLegacyMigration(): Promise<
    IpcResponse<typeof IPC_CHANNELS.getLegacyMigration>
  >
  applyLegacyMigration(
    request: IpcRequest<typeof IPC_CHANNELS.applyLegacyMigration>,
  ): Promise<IpcResponse<typeof IPC_CHANNELS.applyLegacyMigration>>
}
