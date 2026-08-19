import type { TouchFishConfig } from '../../shared/models'
import { configSchema } from '../config/schema'

export const CUSTOM_KEYBINDINGS_ARRAY_KEY =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings'
export const CUSTOM_KEYBINDINGS_ROOT =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/'
export const LEGACY_CUSTOM_BINDING_PATH =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/screen-scene/'
export const LEGACY_CONFIG_PATH = '/home/zac/.config/screen-scene/config'

const LEGACY_SECTION = '[screen-scene]'
const LEGACY_NAME = '双屏场景'
const LEGACY_COMMAND = '/home/zac/.local/bin/switch-dual-screen-scene'
const LEGACY_BINDING = '<Primary><Alt>z'
const SAFE_CUSTOM_BINDING_PATH =
  /^\/org\/gnome\/settings-daemon\/plugins\/media-keys\/custom-keybindings\/[A-Za-z0-9._-]+\/$/

export interface LegacyMigrationProposal {
  url: string
}

export type LegacyMigrationResult =
  | { ok: true }
  | { ok: false; reason: 'no-proposal' | 'write-failed' | 'rollback-failed' }

export interface LegacyLinuxMigrationDependencies {
  runCommand(arguments_: string[]): Promise<string | undefined>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  config: {
    load(): Promise<TouchFishConfig>
    save(config: TouchFishConfig): Promise<void>
  }
}

interface MigrationDetails {
  proposal: LegacyMigrationProposal
  bindings: string[]
}

export class LegacyLinuxMigration {
  constructor(
    private readonly dependencies: LegacyLinuxMigrationDependencies,
  ) {}

  async inspect(): Promise<LegacyMigrationProposal | null> {
    return (await this.inspectDetails())?.proposal ?? null
  }

  async apply(
    proposal: LegacyMigrationProposal,
  ): Promise<LegacyMigrationResult> {
    const details = await this.inspectDetails()
    if (details === null || details.proposal.url !== proposal.url) {
      return { ok: false, reason: 'no-proposal' }
    }

    const originalConfig = await this.dependencies.config.load()
    const importedConfig: TouchFishConfig = {
      ...originalConfig,
      web: { ...originalConfig.web, url: proposal.url },
    }
    const remainingBindings = details.bindings.filter(
      (path) => path !== LEGACY_CUSTOM_BINDING_PATH,
    )

    try {
      await this.writeBindings(remainingBindings)
    } catch {
      return this.rollback(details.bindings, originalConfig, false)
    }

    try {
      await this.dependencies.config.save(importedConfig)
      return { ok: true }
    } catch {
      return this.rollback(details.bindings, originalConfig, true)
    }
  }

  private async inspectDetails(): Promise<MigrationDetails | null> {
    const dump = await this.dependencies.runCommand([
      'dconf',
      'dump',
      CUSTOM_KEYBINDINGS_ROOT,
    ])
    const serializedBindings = await this.dependencies.runCommand([
      'dconf',
      'read',
      CUSTOM_KEYBINDINGS_ARRAY_KEY,
    ])
    const bindings = parseBindingArray(serializedBindings)
    if (!isExactLegacyBinding(dump) || bindings === null) {
      return null
    }
    if (!bindings.includes(LEGACY_CUSTOM_BINDING_PATH)) {
      return null
    }

    const legacyConfig = await this.dependencies.readFile(
      LEGACY_CONFIG_PATH,
      'utf8',
    )
    const url = parseLegacyUrl(legacyConfig)
    return url === null ? null : { proposal: { url }, bindings }
  }

  private async rollback(
    originalBindings: string[],
    originalConfig: TouchFishConfig,
    restoreConfig: boolean,
  ): Promise<LegacyMigrationResult> {
    let rollbackFailed = false
    try {
      await this.writeBindings(originalBindings)
    } catch {
      rollbackFailed = true
    }
    if (restoreConfig) {
      try {
        await this.dependencies.config.save(originalConfig)
      } catch {
        rollbackFailed = true
      }
    }
    return rollbackFailed
      ? { ok: false, reason: 'rollback-failed' }
      : { ok: false, reason: 'write-failed' }
  }

  private async writeBindings(bindings: string[]): Promise<void> {
    await this.dependencies.runCommand([
      'dconf',
      'write',
      CUSTOM_KEYBINDINGS_ARRAY_KEY,
      serializeBindingArray(bindings),
    ])
  }
}

function isExactLegacyBinding(dump: string | undefined): boolean {
  if (dump === undefined) {
    return false
  }
  const lines = dump.split(/\r?\n/)
  const sections = lines
    .map((line, index) => (line === LEGACY_SECTION ? index : -1))
    .filter((index) => index >= 0)
  const section = sections[0]
  if (section === undefined || sections.length !== 1) {
    return false
  }
  const values = new Map<string, string>()
  for (const line of lines.slice(section + 1)) {
    if (line.startsWith('[')) {
      break
    }
    const match = /^(name|command|binding)='([^']*)'$/.exec(line)
    if (match === null) {
      if (/^(name|command|binding)=/.test(line)) {
        return false
      }
      continue
    }
    const key = match[1]
    const value = match[2]
    if (key === undefined || value === undefined || values.has(key)) {
      return false
    }
    values.set(key, value)
  }
  return (
    values.get('name') === LEGACY_NAME &&
    values.get('command') === LEGACY_COMMAND &&
    values.get('binding') === LEGACY_BINDING
  )
}

function parseBindingArray(value: string | undefined): string[] | null {
  if (value === undefined) {
    return null
  }
  const text = value.trim()
  if (text === '[]') {
    return []
  }
  if (!text.startsWith('[') || !text.endsWith(']')) {
    return null
  }
  const body = text.slice(1, -1).trim()
  if (body.length === 0) {
    return []
  }
  const paths = body.split(/,\s*/).map((item) => {
    const match = /^'([^']+)'$/.exec(item)
    return match?.[1]
  })
  return paths.every(
    (path): path is string =>
      path !== undefined && SAFE_CUSTOM_BINDING_PATH.test(path),
  )
    ? paths
    : null
}

function serializeBindingArray(paths: string[]): string {
  if (paths.length === 0) {
    return '@as []'
  }
  return `[${paths.map((path) => `'${path}'`).join(', ')}]`
}

function parseLegacyUrl(contents: string): string | null {
  let targetUrl: string | undefined
  for (const line of contents.split(/\r?\n/)) {
    if (!line.startsWith('TARGET_URL')) {
      continue
    }
    const match = /^TARGET_URL='([^']*)'$/.exec(line)
    if (match?.[1] === undefined || targetUrl !== undefined) {
      return null
    }
    targetUrl = match[1]
  }
  if (targetUrl === undefined) {
    return null
  }
  return configSchema.shape.web.safeParse({ url: targetUrl }).success
    ? targetUrl
    : null
}
