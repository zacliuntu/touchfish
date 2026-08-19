import { describe, expect, test } from 'vitest'

import { en } from './en'
import { zhCN } from './zh-CN'

function recursiveKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return []

  return Object.entries(value)
    .flatMap(([key, nested]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return [path, ...recursiveKeys(nested, path)]
    })
    .sort()
}

describe('TouchFish translations', () => {
  test('English and Simplified Chinese contain identical recursive keys', () => {
    expect(recursiveKeys(zhCN)).toEqual(recursiveKeys(en))
  })

  test('all leaf translations are non-empty strings', () => {
    for (const locale of [en, zhCN]) {
      const visit = (value: unknown): void => {
        if (typeof value === 'string') {
          expect(value.trim()).not.toBe('')
          return
        }
        expect(value).toBeTypeOf('object')
        for (const nested of Object.values(value as Record<string, unknown>)) {
          visit(nested)
        }
      }
      visit(locale)
    }
  })
})
