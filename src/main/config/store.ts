import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { TouchFishConfig } from '../../shared/models'
import { configSchema, defaultConfig } from './schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function migrateUnknownConfig(value: unknown): unknown {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 0 ||
    Object.hasOwn(value, 'firstRunComplete')
  ) {
    return value
  }

  const migrated = {
    ...value,
    schemaVersion: 1,
    firstRunComplete: false,
  }

  return configSchema.safeParse(migrated).success ? migrated : value
}

export class ConfigStore {
  readonly configPath: string

  constructor(
    private readonly configDirectory: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.configPath = join(configDirectory, 'config.json')
  }

  async load(): Promise<TouchFishConfig> {
    await mkdir(this.configDirectory, { recursive: true, mode: 0o700 })

    let contents: string
    try {
      contents = await readFile(this.configPath, 'utf8')
    } catch (error: unknown) {
      if (isErrno(error, 'ENOENT')) {
        return defaults()
      }
      throw error
    }

    let value: unknown
    try {
      value = JSON.parse(contents)
    } catch {
      return this.backUpInvalidConfiguration()
    }

    const result = configSchema.safeParse(migrateUnknownConfig(value))
    if (result.success) {
      return result.data
    }

    return this.backUpInvalidConfiguration()
  }

  async save(value: TouchFishConfig): Promise<void> {
    const validConfiguration = configSchema.parse(value)
    await mkdir(this.configDirectory, { recursive: true, mode: 0o700 })

    const temporaryPath = `${this.configPath}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporaryPath, 'w', 0o600)
      await handle.writeFile(`${JSON.stringify(validConfiguration)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle?.close()
    }
    await rename(temporaryPath, this.configPath)
  }

  private async backUpInvalidConfiguration(): Promise<TouchFishConfig> {
    const stamp = this.clock().toISOString().replace(/[:.]/g, '')
    await rename(this.configPath, `${this.configPath}.${stamp}.invalid`)
    return defaults()
  }
}

function defaults(): TouchFishConfig {
  return configSchema.parse(defaultConfig)
}

function isErrno(error: unknown, code: string): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
