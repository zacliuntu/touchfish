import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import type { TouchFishConfig } from '../../shared/models'
import { configSchema, defaultConfig } from './schema'
import { ConfigStore, migrateUnknownConfig } from './store'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'touchfish-config-store-'))
  temporaryDirectories.push(directory)
  return directory
}

function validConfiguration(): TouchFishConfig {
  return {
    ...defaultConfig,
    web: { ...defaultConfig.web },
    external: {
      ...defaultConfig.external,
      args: [...defaultConfig.external.args],
    },
    multiDisplayTargets: { ...defaultConfig.multiDisplayTargets },
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('ConfigStore', () => {
  test('returns the defaults when configuration is missing', async () => {
    const store = new ConfigStore(await temporaryDirectory())

    await expect(store.load()).resolves.toEqual(defaultConfig)
  })

  test.each(['missing', 'invalid'])(
    'returns independent mutable defaults when configuration is %s',
    async (state) => {
      const directory = await temporaryDirectory()
      if (state === 'invalid') {
        await writeFile(join(directory, 'config.json'), 'not json')
      }
      const store = new ConfigStore(directory)

      const first = await store.load()
      first.web.url = 'https://example.com/changed'
      first.external.args.push('--changed')
      const second = await store.load()

      expect(second).not.toBe(first)
      expect(second.web).not.toBe(first.web)
      expect(second.external.args).not.toBe(first.external.args)
      expect(second).toEqual(defaultConfig)
    },
  )

  test('saves schema-valid JSON atomically without leaving a temporary file', async () => {
    const directory = await temporaryDirectory()
    const store = new ConfigStore(directory)
    const configuration = {
      ...validConfiguration(),
      firstRunComplete: true,
    }

    await store.save(configuration)

    await expect(
      readFile(join(directory, 'config.json'), 'utf8'),
    ).resolves.toBe(`${JSON.stringify(configuration)}\n`)
    await expect(
      stat(join(directory, 'config.json.tmp')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
    if (process.platform !== 'win32') {
      await expect(stat(join(directory, 'config.json'))).resolves.toMatchObject(
        {
          mode: expect.any(Number),
        },
      )
      const mode = (await stat(join(directory, 'config.json'))).mode
      expect(mode & 0o777).toBe(0o600)
    }
  })

  test('backs up byte-for-byte invalid JSON with an injected timestamp', async () => {
    const directory = await temporaryDirectory()
    const contents = '{not valid json\n'
    await writeFile(join(directory, 'config.json'), contents)
    const store = new ConfigStore(
      directory,
      () => new Date('2026-08-18T11:45:00.000Z'),
    )

    await expect(store.load()).resolves.toEqual(defaultConfig)

    await expect(
      readFile(
        join(directory, 'config.json.2026-08-18T114500000Z.invalid'),
        'utf8',
      ),
    ).resolves.toBe(contents)
    await expect(stat(join(directory, 'config.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('backs up semantically invalid configuration before returning defaults', async () => {
    const directory = await temporaryDirectory()
    const contents = JSON.stringify({ ...defaultConfig, timeoutSeconds: 0 })
    await writeFile(join(directory, 'config.json'), contents)
    const store = new ConfigStore(
      directory,
      () => new Date('2026-08-18T11:45:00.000Z'),
    )

    await expect(store.load()).resolves.toEqual(defaultConfig)
    await expect(
      readFile(
        join(directory, 'config.json.2026-08-18T114500000Z.invalid'),
        'utf8',
      ),
    ).resolves.toBe(contents)
  })

  test('migrates the exact v0 shape without mutating it and loads the result', async () => {
    const directory = await temporaryDirectory()
    const { firstRunComplete: _firstRunComplete, ...currentFields } =
      validConfiguration()
    const v0 = { ...currentFields, schemaVersion: 0 as const }

    const migrated = migrateUnknownConfig(v0)

    expect(migrated).toEqual({
      ...defaultConfig,
      schemaVersion: 1,
      firstRunComplete: false,
    })
    expect(v0).toEqual({
      schemaVersion: 0,
      web: currentFields.web,
      external: currentFields.external,
      shortcut: currentFields.shortcut,
      startAtLogin: currentFields.startAtLogin,
      timeoutSeconds: currentFields.timeoutSeconds,
      language: currentFields.language,
      singleDisplayTarget: currentFields.singleDisplayTarget,
      swapOnTwoDisplays: currentFields.swapOnTwoDisplays,
      multiDisplayTargets: currentFields.multiDisplayTargets,
    })
    await writeFile(join(directory, 'config.json'), JSON.stringify(v0))

    await expect(new ConfigStore(directory).load()).resolves.toEqual(
      defaultConfig,
    )
  })

  test('does not migrate other values, leaving strict schema validation to reject them', () => {
    const unsupported = {
      ...validConfiguration(),
      schemaVersion: 0,
      firstRunComplete: true,
    }

    const result = migrateUnknownConfig(unsupported)

    expect(result).toBe(unsupported)
    expect(configSchema.safeParse(result).success).toBe(false)
  })

  test('rejects invalid saves without replacing an existing configuration', async () => {
    const directory = await temporaryDirectory()
    const store = new ConfigStore(directory)
    await store.save(validConfiguration())
    const original = await readFile(join(directory, 'config.json'), 'utf8')

    await expect(
      store.save({
        ...defaultConfig,
        schemaVersion: 0,
      } as unknown as TouchFishConfig),
    ).rejects.toThrow()

    await expect(
      readFile(join(directory, 'config.json'), 'utf8'),
    ).resolves.toBe(original)
  })
})
