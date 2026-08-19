import type {
  DisplayInfo,
  NativeWindow,
  PlatformAdapter,
  TouchFishConfig,
  WindowMatcher,
} from '../../shared/models'
import type { SceneNotificationKey } from '../../shared/i18n/scene-notifications'
import { planScene } from './scene-plan'

export interface WebTargetController {
  ensureWindow(url: string): Promise<void>
  moveAndMaximize(display: DisplayInfo): Promise<void>
}

export interface SceneLogger {
  info(event: string, data?: object): void
  error(event: string, data?: object): void
}

export type SceneRunResult = {
  status: 'success' | 'partial' | 'failed' | 'busy'
  errors: string[]
}

export type { SceneNotificationKey } from '../../shared/i18n/scene-notifications'

export type SceneNotificationResolver = (
  key: SceneNotificationKey,
  config: TouchFishConfig,
) => string

type Sleep = (milliseconds: number) => Promise<void>

export class SceneOrchestrator {
  private running = false

  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly web: WebTargetController,
    private readonly logger: SceneLogger,
    private readonly sleep: Sleep = delay,
    private readonly resolveNotification: SceneNotificationResolver = defaultNotification,
  ) {}

  async run(config: TouchFishConfig): Promise<SceneRunResult> {
    if (this.running) {
      this.notify('TouchFish', this.resolveNotification('busy', config))
      const result: SceneRunResult = { status: 'busy', errors: [] }
      this.logInfo('scene-run-finished', result)
      return result
    }

    this.running = true
    try {
      return await this.runScene(config)
    } finally {
      this.running = false
    }
  }

  private async runScene(config: TouchFishConfig): Promise<SceneRunResult> {
    let displays: DisplayInfo[]
    let plan: ReturnType<typeof planScene>

    try {
      displays = await this.adapter.listDisplays()
      plan = planScene(displays, config)
    } catch {
      return this.finish(['scene-plan-failed'], 0, config)
    }

    if (plan.usedFallback) {
      this.notify('TouchFish', this.resolveNotification('fallback', config))
      this.logInfo('scene-plan-fallback')
    }

    const errors: string[] = []
    let successes = 0

    for (const placement of plan.placements) {
      const display = displays.find(({ id }) => id === placement.displayId)
      if (display === undefined) {
        errors.push('scene-plan-failed')
        continue
      }

      if (placement.target === 'web') {
        if (await this.placeWeb(config, display, errors)) {
          successes += 1
        }
      } else if (await this.placeExternal(config, display, errors)) {
        successes += 1
      }
    }

    return this.finish(errors, successes, config)
  }

  private async placeWeb(
    config: TouchFishConfig,
    display: DisplayInfo,
    errors: string[],
  ): Promise<boolean> {
    try {
      await this.web.ensureWindow(config.web.url)
      await this.web.moveAndMaximize(display)
      return true
    } catch {
      errors.push('web-placement-failed')
      this.logError('web-placement-failed', {
        target: 'web',
        displayId: display.id,
      })
      return false
    }
  }

  private async placeExternal(
    config: TouchFishConfig,
    display: DisplayInfo,
    errors: string[],
  ): Promise<boolean> {
    const matcher = config.external.matcher
    if (matcher === null) {
      errors.push('external-config-missing')
      this.logError('external-config-missing', {
        target: 'external',
        displayId: display.id,
      })
      return false
    }

    let errorCount = errors.length
    let matched = await this.findExternal(matcher, errors, display.id)
    if (matched === undefined && errors.length > errorCount) {
      return false
    }

    if (matched === undefined) {
      try {
        await this.adapter.launchExternal(config.external)
      } catch {
        errors.push('external-launch-failed')
        this.logError('external-launch-failed', {
          target: 'external',
          displayId: display.id,
        })
        return false
      }

      for (let elapsed = 0; elapsed < config.timeoutSeconds; elapsed += 1) {
        await this.sleep(1000)
        errorCount = errors.length
        matched = await this.findExternal(matcher, errors, display.id)
        if (matched !== undefined || errors.length > errorCount) {
          break
        }
      }
    }

    if (matched === undefined) {
      if (errors.length === errorCount) {
        errors.push('external-window-timeout')
        this.logError('external-window-timeout', {
          target: 'external',
          displayId: display.id,
        })
      }
      return false
    }

    try {
      await this.adapter.moveAndMaximize(matched.id, display)
      return true
    } catch {
      errors.push('external-placement-failed')
      this.logError('external-placement-failed', {
        target: 'external',
        displayId: display.id,
      })
      return false
    }
  }

  private async findExternal(
    matcher: WindowMatcher,
    errors: string[],
    displayId: string,
  ): Promise<NativeWindow | undefined> {
    try {
      return selectWindow(
        await this.adapter.listWindows(),
        matcher,
        this.adapter.kind === 'windows',
      )
    } catch {
      errors.push('external-window-list-failed')
      this.logError('external-window-list-failed', {
        target: 'external',
        displayId,
      })
      return undefined
    }
  }

  private finish(
    errors: string[],
    successes: number,
    config: TouchFishConfig,
  ): SceneRunResult {
    const status =
      errors.length === 0 ? 'success' : successes > 0 ? 'partial' : 'failed'

    const result: SceneRunResult = { status, errors }
    this.notify('TouchFish', this.resolveNotification(status, config))
    this.logInfo('scene-run-finished', result)
    return result
  }

  private notify(title: string, body: string): void {
    try {
      this.adapter.notify(title, body)
    } catch {
      // Notifications must not alter scene execution.
    }
  }

  private logInfo(event: string, data?: object): void {
    try {
      if (data === undefined) {
        this.logger.info(event)
      } else {
        this.logger.info(event, data)
      }
    } catch {
      // Logging must not alter scene execution.
    }
  }

  private logError(event: string, data: object): void {
    try {
      this.logger.error(event, data)
    } catch {
      // Logging must not alter scene execution.
    }
  }
}

function defaultNotification(key: SceneNotificationKey): string {
  const messages: Record<SceneNotificationKey, string> = {
    busy: 'A scene is already running.',
    fallback: 'Using fallback display assignments.',
    success: 'Scene setup completed successfully.',
    partial: 'Scene setup partially completed.',
    failed: 'Scene setup failed.',
  }
  return messages[key]
}

function selectWindow(
  windows: NativeWindow[],
  matcher: WindowMatcher,
  caseInsensitive: boolean,
): NativeWindow | undefined {
  const visible = windows.filter((window) => window.visible)
  const tiers = [
    matcher.executablePath === ''
      ? []
      : visible.filter((window) =>
          matchesIdentity(
            window.executablePath,
            matcher.executablePath,
            caseInsensitive,
          ),
        ),
    matcher.nativeClass === undefined || matcher.nativeClass === ''
      ? []
      : visible.filter((window) =>
          matchesIdentity(
            window.nativeClass,
            matcher.nativeClass ?? '',
            caseInsensitive,
          ),
        ),
    matcher.processName === ''
      ? []
      : visible.filter((window) =>
          matchesIdentity(
            basename(window.executablePath),
            matcher.processName,
            caseInsensitive,
          ),
        ),
    matcher.titleHint === undefined || matcher.titleHint === ''
      ? []
      : visible.filter((window) =>
          window.title.includes(matcher.titleHint ?? ''),
        ),
  ]

  return tiers.find((tier) => tier.length > 0)?.sort(compareWindows)[0]
}

function matchesIdentity(
  actual: string | undefined,
  expected: string,
  caseInsensitive: boolean,
): boolean {
  if (actual === undefined) return false
  return caseInsensitive
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected
}

function basename(path: string | undefined): string {
  const separator = Math.max(
    path?.lastIndexOf('/') ?? -1,
    path?.lastIndexOf('\\') ?? -1,
  )
  return path?.slice(separator + 1) ?? ''
}

function compareWindows(left: NativeWindow, right: NativeWindow): number {
  const leftArea = left.bounds.width * left.bounds.height
  const rightArea = right.bounds.width * right.bounds.height
  return (
    rightArea - leftArea ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}
