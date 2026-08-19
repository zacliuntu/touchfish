import type { TouchFishRendererApi } from '../../shared/ipc'

declare global {
  interface Window {
    touchfish: Readonly<TouchFishRendererApi>
  }
}

export {}
