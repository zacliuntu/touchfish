export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export type ShortcutSetResult = { ok: true } | { ok: false; reason: 'conflict' }

export class ShortcutService {
  private accelerator: string | undefined
  private callback: (() => void) | undefined

  constructor(private readonly globalShortcut: GlobalShortcutLike) {}

  set(accelerator: string, callback: () => void): ShortcutSetResult {
    if (this.accelerator === accelerator) {
      this.callback = callback
      return { ok: true }
    }

    if (
      !this.globalShortcut.register(accelerator, () => {
        if (this.accelerator === accelerator) {
          this.callback?.()
        }
      })
    ) {
      return { ok: false, reason: 'conflict' }
    }

    const previousAccelerator = this.accelerator
    this.accelerator = accelerator
    this.callback = callback
    if (previousAccelerator !== undefined) {
      this.globalShortcut.unregister(previousAccelerator)
    }
    return { ok: true }
  }

  dispose(): void {
    if (this.accelerator !== undefined) {
      this.globalShortcut.unregister(this.accelerator)
      this.accelerator = undefined
      this.callback = undefined
    }
  }
}
