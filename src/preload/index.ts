import { contextBridge, ipcRenderer } from 'electron'

import {
  IPC_CHANNELS,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type TouchFishRendererApi,
} from '../shared/ipc'

type Invoke = (channel: IpcChannel, request: unknown) => Promise<unknown>

export function createTouchFishApi(
  invoke: Invoke,
): Readonly<TouchFishRendererApi> {
  const call = <Channel extends IpcChannel>(
    channel: Channel,
    request: IpcRequest<Channel>,
  ): Promise<IpcResponse<Channel>> =>
    invoke(channel, request) as Promise<IpcResponse<Channel>>

  const api: TouchFishRendererApi = {
    loadConfig: () => call(IPC_CHANNELS.loadConfig, undefined),
    saveConfig: (config) => call(IPC_CHANNELS.saveConfig, config),
    listDisplays: () => call(IPC_CHANNELS.listDisplays, undefined),
    listWindows: () => call(IPC_CHANNELS.listWindows, undefined),
    beginWindowCapture: () => call(IPC_CHANNELS.beginWindowCapture, undefined),
    runScene: () => call(IPC_CHANNELS.runScene, undefined),
    chooseExecutable: () => call(IPC_CHANNELS.chooseExecutable, undefined),
    setShortcut: (request) => call(IPC_CHANNELS.setShortcut, request),
    setStartAtLogin: (request) => call(IPC_CHANNELS.setStartAtLogin, request),
    getDiagnostics: (request) => call(IPC_CHANNELS.getDiagnostics, request),
    clearWebData: () => call(IPC_CHANNELS.clearWebData, undefined),
    getLegacyMigration: () => call(IPC_CHANNELS.getLegacyMigration, undefined),
    applyLegacyMigration: (request) =>
      call(IPC_CHANNELS.applyLegacyMigration, request),
  }
  return Object.freeze(api)
}

if (typeof window !== 'undefined') {
  contextBridge.exposeInMainWorld(
    'touchfish',
    createTouchFishApi((channel, request) =>
      ipcRenderer.invoke(channel, request),
    ),
  )
}
