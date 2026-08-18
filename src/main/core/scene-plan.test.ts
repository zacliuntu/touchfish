import { describe, expect, test } from 'vitest'

import { defaultConfig } from '../config/schema'
import type { DisplayInfo, TouchFishConfig } from '../../shared/models'
import { NoActiveDisplayError, planScene } from './scene-plan'

const display = (
  id: string,
  x: number,
  y: number,
  primary = false,
): DisplayInfo => ({
  id,
  label: id,
  primary,
  bounds: { x, y, width: 1920, height: 1080 },
  workArea: { x, y, width: 1920, height: 1040 },
})

const primary = display('primary', 0, 0, true)
const secondary = display('secondary', 1920, 0)
const left = display('left', -1600, 0)

const config = (overrides: Partial<TouchFishConfig> = {}): TouchFishConfig => ({
  ...defaultConfig,
  web: { ...defaultConfig.web },
  external: {
    ...defaultConfig.external,
    args: [...defaultConfig.external.args],
  },
  ...overrides,
  multiDisplayTargets: {
    ...defaultConfig.multiDisplayTargets,
    ...overrides.multiDisplayTargets,
  },
})

describe('planScene', () => {
  test('throws a recognizable error when no display is active', () => {
    expect(() => planScene([], config())).toThrow(NoActiveDisplayError)
    expect(() => planScene([], config())).toThrow(/NoActiveDisplayError/)
  })

  test.each(['web', 'external'] as const)(
    'places only %s on the sole display',
    (singleDisplayTarget) => {
      expect(planScene([primary], config({ singleDisplayTarget }))).toEqual({
        placements: [{ target: singleDisplayTarget, displayId: 'primary' }],
        usedFallback: false,
      })
    },
  )

  test('assigns web to primary and external to secondary for two displays', () => {
    expect(planScene([secondary, primary], config())).toEqual({
      placements: [
        { target: 'web', displayId: 'primary' },
        { target: 'external', displayId: 'secondary' },
      ],
      usedFallback: false,
    })
  })

  test('swaps two-display assignments when configured', () => {
    expect(
      planScene([secondary, primary], config({ swapOnTwoDisplays: true })),
    ).toEqual({
      placements: [
        { target: 'web', displayId: 'secondary' },
        { target: 'external', displayId: 'primary' },
      ],
      usedFallback: false,
    })
  })

  test('honors distinct saved assignments on three displays', () => {
    expect(
      planScene(
        [secondary, primary, left],
        config({
          multiDisplayTargets: {
            webDisplayId: 'secondary',
            externalDisplayId: 'left',
          },
        }),
      ),
    ).toEqual({
      placements: [
        { target: 'web', displayId: 'secondary' },
        { target: 'external', displayId: 'left' },
      ],
      usedFallback: false,
    })
  })

  test.each([
    [
      'a disconnected saved ID',
      { webDisplayId: 'gone', externalDisplayId: 'secondary' },
    ],
    ['a null saved ID', { webDisplayId: null, externalDisplayId: 'secondary' }],
    [
      'duplicate saved IDs',
      { webDisplayId: 'secondary', externalDisplayId: 'secondary' },
    ],
  ])(
    'uses the complete safe fallback for %s',
    (_caseName, multiDisplayTargets) => {
      expect(
        planScene([secondary, primary, left], config({ multiDisplayTargets })),
      ).toEqual({
        placements: [
          { target: 'web', displayId: 'primary' },
          { target: 'external', displayId: 'left' },
        ],
        usedFallback: true,
      })
    },
  )

  test('sorts a copied display list deterministically before deciding placements', () => {
    const laterPrimary = display('z-primary', 100, 0, true)
    const earlierPrimary = display('a-primary', -100, 0, true)
    const displays = [secondary, laterPrimary, left, earlierPrimary]

    expect(planScene(displays, config())).toEqual({
      placements: [
        { target: 'web', displayId: 'a-primary' },
        { target: 'external', displayId: 'z-primary' },
      ],
      usedFallback: true,
    })
    expect(displays.map(({ id }) => id)).toEqual([
      'secondary',
      'z-primary',
      'left',
      'a-primary',
    ])
  })

  test('breaks equal-x primary display ties by y coordinate', () => {
    const higher = display('higher', 100, 10, true)
    const lower = display('lower', 100, -10, true)

    expect(planScene([higher, lower], config()).placements).toEqual([
      { target: 'web', displayId: 'lower' },
      { target: 'external', displayId: 'higher' },
    ])
  })

  test('uses raw ID order when collation-equivalent display IDs share coordinates', () => {
    const composed = display('é', 100, 0, true)
    const decomposed = display('e\u0301', 100, 0, true)
    const expected = {
      placements: [
        { target: 'web' as const, displayId: 'e\u0301' },
        { target: 'external' as const, displayId: 'é' },
      ],
      usedFallback: false,
    }

    expect(planScene([composed, decomposed], config())).toEqual(expected)
    expect(planScene([decomposed, composed], config())).toEqual(expected)
  })

  test('never assigns both multi-display targets to the same display', () => {
    const result = planScene(
      [secondary, primary, left],
      config({
        multiDisplayTargets: {
          webDisplayId: 'secondary',
          externalDisplayId: 'secondary',
        },
      }),
    )

    expect(
      new Set(result.placements.map(({ displayId }) => displayId)).size,
    ).toBe(2)
  })
})
