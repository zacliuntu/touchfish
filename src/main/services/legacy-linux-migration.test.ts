import { describe, expect, test, vi } from 'vitest'

import { configSchema, defaultConfig } from '../config/schema'
import {
  CUSTOM_KEYBINDINGS_ARRAY_KEY,
  CUSTOM_KEYBINDINGS_ROOT,
  LEGACY_CONFIG_PATH,
  LEGACY_CUSTOM_BINDING_PATH,
  LegacyLinuxMigration,
} from './legacy-linux-migration'

const exactDump = `[screen-scene]\nname='双屏场景'\ncommand='/home/zac/.local/bin/switch-dual-screen-scene'\nbinding='<Primary><Alt>z'\n`
const realLegacyConfig = `# screen-scene configuration

TARGET_URL='https://example.test/path'
APP_COMMAND='/usr/bin/example'
WINDOW_TITLE='Example'
`

describe('LegacyLinuxMigration', () => {
  test('proposes importing only the exact legacy binding and an approved URL', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(`['${LEGACY_CUSTOM_BINDING_PATH}']`)
    const readFile = vi
      .fn()
      .mockResolvedValue("TARGET_URL='https://example.test/path'\n")
    const migration = createMigration({ runCommand, readFile })

    await expect(migration.inspect()).resolves.toEqual({
      url: 'https://example.test/path',
    })
    expect(runCommand).toHaveBeenNthCalledWith(1, [
      'dconf',
      'dump',
      CUSTOM_KEYBINDINGS_ROOT,
    ])
    expect(runCommand).toHaveBeenNthCalledWith(2, [
      'dconf',
      'read',
      CUSTOM_KEYBINDINGS_ARRAY_KEY,
    ])
    expect(readFile).toHaveBeenCalledWith(LEGACY_CONFIG_PATH, 'utf8')
  })

  test('reads a unique strict target URL line from the real multiline legacy structure', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(`['${LEGACY_CUSTOM_BINDING_PATH}']`)
    const migration = createMigration({
      runCommand,
      readFile: vi.fn().mockResolvedValue(realLegacyConfig),
    })

    await expect(migration.inspect()).resolves.toEqual({
      url: 'https://example.test/path',
    })
  })

  test.each([
    "TARGET_URL='https://example.test/one'\nTARGET_URL='https://example.test/two'\n",
    "TARGET_URL = 'https://example.test/path'\n",
    "TARGET_URL='https://example.test/path'; touch /tmp/pwned\n",
    "TARGET_URL='https://example.test/path\n",
    'TARGET_URL=https://example.test/path\n',
  ])(
    'rejects an ambiguous or malformed target line without executing it',
    async (contents) => {
      const runCommand = vi
        .fn()
        .mockResolvedValueOnce(exactDump)
        .mockResolvedValueOnce(`['${LEGACY_CUSTOM_BINDING_PATH}']`)
      const migration = createMigration({
        runCommand,
        readFile: vi.fn().mockResolvedValue(contents),
      })

      await expect(migration.inspect()).resolves.toBeNull()
    },
  )

  test.each([
    exactDump.replace("name='双屏场景'", "name='别的场景'"),
    exactDump.replace("name='双屏场景'", "name='别的场景'\nname='双屏场景'"),
    exactDump.replace(
      "command='/home/zac/.local/bin/switch-dual-screen-scene'",
      "command='/tmp/not-it'",
    ),
    exactDump.replace("binding='<Primary><Alt>z'", "binding='<Primary><Alt>x'"),
    `noise[screen-scene]\n${exactDump.slice(exactDump.indexOf('\n') + 1)}`,
  ])('does not propose or write when a legacy field differs', async (dump) => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(dump)
      .mockResolvedValueOnce(`['${LEGACY_CUSTOM_BINDING_PATH}']`)
    const migration = createMigration({ runCommand })

    await expect(migration.inspect()).resolves.toBeNull()
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(
      createMigration({ runCommand }).apply({ url: 'https://example.test' }),
    ).resolves.toEqual({ ok: false, reason: 'no-proposal' })
  })

  test('removes only the exact path, preserves ordered paths, and updates the URL after explicit apply', async () => {
    const other =
      '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/other/'
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(`['${other}', '${LEGACY_CUSTOM_BINDING_PATH}']`)
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(`['${other}', '${LEGACY_CUSTOM_BINDING_PATH}']`)
    const config = structuredConfig()
    const migration = createMigration({ runCommand, config })
    const proposal = await migration.inspect()

    await expect(migration.apply(proposal!)).resolves.toEqual({ ok: true })

    expect(runCommand).toHaveBeenLastCalledWith([
      'dconf',
      'write',
      CUSTOM_KEYBINDINGS_ARRAY_KEY,
      `['${other}']`,
    ])
    expect(config.save).toHaveBeenCalledWith({
      ...defaultConfig,
      web: { url: 'https://example.test/path' },
    })
  })

  test('writes a typed empty GVariant array when the legacy path is the only binding', async () => {
    const originalArray = `['${LEGACY_CUSTOM_BINDING_PATH}']`
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(originalArray)
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(originalArray)
    const migration = createMigration({ runCommand })
    const proposal = await migration.inspect()

    await expect(migration.apply(proposal!)).resolves.toEqual({ ok: true })
    expect(runCommand).toHaveBeenNthCalledWith(5, [
      'dconf',
      'write',
      CUSTOM_KEYBINDINGS_ARRAY_KEY,
      '@as []',
    ])
  })

  test('rejects malformed old configuration without evaluating it', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(`['${LEGACY_CUSTOM_BINDING_PATH}']`)
    const migration = createMigration({
      runCommand,
      readFile: vi
        .fn()
        .mockResolvedValue("TARGET_URL='file:///tmp/a'; rm -rf /\n"),
    })

    await expect(migration.inspect()).resolves.toBeNull()
  })

  test('restores the original array and TouchFish config when saving fails', async () => {
    const originalArray = `['${LEGACY_CUSTOM_BINDING_PATH}']`
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(originalArray)
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(originalArray)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    const save = vi
      .fn<MigrationConfig['save']>()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined)
    const config = structuredConfig({ save })
    const migration = createMigration({ runCommand, config })
    const proposal = await migration.inspect()

    await expect(migration.apply(proposal!)).resolves.toEqual({
      ok: false,
      reason: 'write-failed',
    })
    expect(runCommand).toHaveBeenNthCalledWith(5, [
      'dconf',
      'write',
      CUSTOM_KEYBINDINGS_ARRAY_KEY,
      '@as []',
    ])
    expect(runCommand).toHaveBeenNthCalledWith(6, [
      'dconf',
      'write',
      CUSTOM_KEYBINDINGS_ARRAY_KEY,
      originalArray,
    ])
    expect(config.save).toHaveBeenNthCalledWith(1, {
      ...defaultConfig,
      web: { url: 'https://example.test/path' },
    })
    expect(config.save).toHaveBeenNthCalledWith(2, defaultConfig)
  })

  test('reports rollback failure after attempting both restorations', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(`['${LEGACY_CUSTOM_BINDING_PATH}']`)
      .mockResolvedValueOnce(exactDump)
      .mockResolvedValueOnce(`['${LEGACY_CUSTOM_BINDING_PATH}']`)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('dconf restore failed'))
    const config = structuredConfig({
      save: vi
        .fn<MigrationConfig['save']>()
        .mockRejectedValue(new Error('config write failed')),
    })
    const migration = createMigration({ runCommand, config })
    const proposal = await migration.inspect()

    await expect(migration.apply(proposal!)).resolves.toEqual({
      ok: false,
      reason: 'rollback-failed',
    })
    expect(config.save).toHaveBeenCalledTimes(2)
  })
})

type MigrationConfig = ConstructorParameters<
  typeof LegacyLinuxMigration
>[0]['config']

function structuredConfig(
  overrides: Partial<MigrationConfig> = {},
): MigrationConfig {
  return {
    load: vi
      .fn<MigrationConfig['load']>()
      .mockResolvedValue(configSchema.parse(defaultConfig)),
    save: vi.fn<MigrationConfig['save']>().mockResolvedValue(undefined),
    ...overrides,
  }
}

function createMigration(
  overrides: Partial<
    ConstructorParameters<typeof LegacyLinuxMigration>[0]
  > = {},
) {
  return new LegacyLinuxMigration({
    runCommand: vi.fn().mockResolvedValue(''),
    readFile: vi
      .fn()
      .mockResolvedValue("TARGET_URL='https://example.test/path'\n"),
    config: structuredConfig(),
    ...overrides,
  })
}
