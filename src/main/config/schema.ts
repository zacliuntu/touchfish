import { z } from 'zod'

import type { TouchFishConfig, WindowMatcher } from '../../shared/models'

const { URL } = globalThis

const httpUrlSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  },
  { message: 'URL must use the http: or https: protocol' },
)

const windowMatcherSchema = z
  .object({
    executablePath: z.string(),
    processName: z.string(),
    nativeClass: z.string().optional(),
    titleHint: z.string().optional(),
  })
  .strict()
  .transform((value): WindowMatcher => {
    const matcher: WindowMatcher = {
      executablePath: value.executablePath,
      processName: value.processName,
    }

    if (value.nativeClass !== undefined) {
      matcher.nativeClass = value.nativeClass
    }

    if (value.titleHint !== undefined) {
      matcher.titleHint = value.titleHint
    }

    return matcher
  })

export const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    web: z.object({ url: httpUrlSchema }).strict(),
    external: z
      .object({
        executablePath: z.string(),
        args: z.array(z.string()),
        matcher: windowMatcherSchema.nullable(),
      })
      .strict(),
    shortcut: z.string(),
    startAtLogin: z.boolean(),
    timeoutSeconds: z.number().int().min(1).max(120),
    language: z.enum(['system', 'zh-CN', 'en']),
    singleDisplayTarget: z.enum(['web', 'external']),
    swapOnTwoDisplays: z.boolean(),
    multiDisplayTargets: z
      .object({
        webDisplayId: z.string().nullable(),
        externalDisplayId: z.string().nullable(),
      })
      .strict(),
    firstRunComplete: z.boolean(),
  })
  .strict() satisfies z.ZodType<TouchFishConfig>

type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value

function deepFreeze<Value extends object>(value: Value): DeepReadonly<Value> {
  Object.freeze(value)

  for (const nestedValue of Object.values(value)) {
    if (
      nestedValue !== null &&
      typeof nestedValue === 'object' &&
      !Object.isFrozen(nestedValue)
    ) {
      deepFreeze(nestedValue)
    }
  }

  return value as DeepReadonly<Value>
}

export const defaultConfig = deepFreeze<TouchFishConfig>({
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
