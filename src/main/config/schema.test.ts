import { describe, expect, test } from 'vitest'

import { configSchema, defaultConfig } from './schema'

describe('TouchFish configuration schema', () => {
  test('provides the approved immutable defaults', () => {
    expect(defaultConfig).toEqual({
      schemaVersion: 1,
      web: {
        url: 'https://e.gitee.com/fairlandgroup/repos/fairlandgroup/localization_module/tree/master',
      },
      external: {
        executablePath: '',
        args: [],
        matcher: null,
      },
      shortcut: 'CommandOrControl+Alt+Z',
      startAtLogin: true,
      timeoutSeconds: 15,
      language: 'system',
      singleDisplayTarget: 'web',
      swapOnTwoDisplays: false,
      multiDisplayTargets: {
        webDisplayId: null,
        externalDisplayId: null,
      },
      firstRunComplete: false,
    })
    expect(configSchema.parse(defaultConfig)).toEqual(defaultConfig)
  })

  test.each(['file:///tmp/a', 'javascript:alert(1)', ''])(
    'rejects unsafe URL %j',
    (url) => {
      expect(
        configSchema.safeParse({ ...defaultConfig, web: { url } }).success,
      ).toBe(false)
    },
  )

  test.each(['HTTP://example.com', 'HTTPS://example.com', 'not a URL'])(
    'accepts HTTP URL protocol casing and rejects malformed URL %j according to URL parsing',
    (url) => {
      const result = configSchema.safeParse({ ...defaultConfig, web: { url } })

      expect(result.success).toBe(url !== 'not a URL')
    },
  )

  test('rejects a string external argument instead of an argument array', () => {
    expect(
      configSchema.safeParse({
        ...defaultConfig,
        external: { ...defaultConfig.external, args: '--unsafe' },
      }).success,
    ).toBe(false)
  })

  test.each([0, 121, 1.5])(
    'rejects timeoutSeconds value %d outside the allowed integer range',
    (timeoutSeconds) => {
      expect(
        configSchema.safeParse({ ...defaultConfig, timeoutSeconds }).success,
      ).toBe(false)
    },
  )

  test.each([1, 120])(
    'accepts timeoutSeconds boundary %d',
    (timeoutSeconds) => {
      expect(
        configSchema.safeParse({ ...defaultConfig, timeoutSeconds }).success,
      ).toBe(true)
    },
  )

  test('rejects unknown configuration fields', () => {
    expect(
      configSchema.safeParse({ ...defaultConfig, typoedSetting: true }).success,
    ).toBe(false)
    expect(
      configSchema.safeParse({
        ...defaultConfig,
        external: {
          ...defaultConfig.external,
          matcher: { executablePath: 'a', processName: 'b', typo: true },
        },
      }).success,
    ).toBe(false)
  })

  test('deeply freezes default configuration objects and arrays', () => {
    expect(Object.isFrozen(defaultConfig)).toBe(true)
    expect(Object.isFrozen(defaultConfig.web)).toBe(true)
    expect(Object.isFrozen(defaultConfig.external)).toBe(true)
    expect(Object.isFrozen(defaultConfig.external.args)).toBe(true)
    expect(Object.isFrozen(defaultConfig.multiDisplayTargets)).toBe(true)
  })
})
