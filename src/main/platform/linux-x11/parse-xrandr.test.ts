import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

import { describe, expect, test } from 'vitest'

import { parseXrandr, XrandrParseError } from './parse-xrandr'

const fixturesDirectory = fileURLToPath(
  new URL('../../../../tests/fixtures/', import.meta.url),
)

async function fixture(name: string): Promise<string> {
  return readFile(new URL(name, `file://${fixturesDirectory}`), 'utf8')
}

describe('parseXrandr', () => {
  test('parses active connected displays and ignores inactive connectors', async () => {
    await expect(parseXrandr(await fixture('xrandr-two.txt'))).toEqual([
      {
        id: 'HDMI-A-0',
        label: 'HDMI-A-0',
        primary: true,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      },
      {
        id: 'DVI-D-0',
        label: 'DVI-D-0',
        primary: false,
        bounds: { x: -1280, y: 0, width: 1280, height: 1024 },
        workArea: { x: -1280, y: 0, width: 1280, height: 1024 },
      },
    ])
  })

  test('uses geometry and rotation tokens from a three-display layout', async () => {
    await expect(
      parseXrandr(await fixture('xrandr-three-negative.txt')),
    ).toEqual([
      expect.objectContaining({ id: 'HDMI-A-0', primary: true }),
      expect.objectContaining({
        id: 'DP-1',
        bounds: { x: -1024, y: 120, width: 1024, height: 768 },
      }),
      expect.objectContaining({
        id: 'DP-2',
        bounds: { x: 1920, y: -100, width: 1280, height: 1024 },
      }),
    ])
  })

  test('sorts non-primary displays by x, y, and original connector id', () => {
    expect(
      parseXrandr(
        [
          'DP-3 connected 100x100+10+5 normal',
          'DP-2 connected 100x100+10+5 normal',
          'DP-1 connected 100x100+10+2 normal',
          'HDMI-1 connected primary 100x100+900+0 normal',
        ].join('\n'),
      ),
    ).toMatchObject([
      { id: 'HDMI-1' },
      { id: 'DP-1' },
      { id: 'DP-2' },
      { id: 'DP-3' },
    ])
  })

  test.each([
    'HDMI-A-0 connected 0x1080+0+0 normal',
    'HDMI-A-0 connected 1920x0+0+0 normal',
    'HDMI-A-0 connected 9007199254740992x1080+0+0 normal',
  ])('rejects malformed active geometry %s', (line) => {
    expect(() => parseXrandr(line)).toThrow(XrandrParseError)
  })
})
