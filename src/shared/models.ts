export type TargetKind = 'web' | 'external'

export type AppLanguage = 'system' | 'zh-CN' | 'en'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: string
  label: string
  primary: boolean
  bounds: Rect
  workArea: Rect
}

export interface WindowMatcher {
  executablePath: string
  processName: string
  nativeClass?: string
  titleHint?: string
}

export interface NativeWindow {
  id: string
  pid: number
  title: string
  nativeClass?: string
  executablePath?: string
  bounds: Rect
  visible: boolean
}

export interface ExternalTarget {
  executablePath: string
  args: string[]
  matcher: WindowMatcher | null
}

export interface TouchFishConfig {
  schemaVersion: 1
  web: { url: string }
  external: ExternalTarget
  shortcut: string
  startAtLogin: boolean
  timeoutSeconds: number
  language: AppLanguage
  singleDisplayTarget: TargetKind
  swapOnTwoDisplays: boolean
  multiDisplayTargets: {
    webDisplayId: string | null
    externalDisplayId: string | null
  }
  firstRunComplete: boolean
}

export interface PlatformAdapter {
  readonly kind: 'linux-x11' | 'windows'
  listDisplays(): Promise<DisplayInfo[]>
  listWindows(): Promise<NativeWindow[]>
  captureForegroundWindow(): Promise<NativeWindow | null>
  launchExternal(target: ExternalTarget): Promise<void>
  moveAndMaximize(windowId: string, display: DisplayInfo): Promise<void>
  notify(title: string, body: string): void
}
