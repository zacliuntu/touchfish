import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

import { describe, expect, test } from 'vitest'

import { parseWmctrl, WmctrlParseError } from './parse-wmctrl'

const fixturesDirectory = fileURLToPath(
  new URL('../../../../tests/fixtures/', import.meta.url),
)

async function fixture(name: string): Promise<string> {
  return readFile(new URL(name, `file://${fixturesDirectory}`), 'utf8')
}

describe('parseWmctrl', () => {
  test('parses titles with spaces and duplicate WM_CLASS entries', async () => {
    await expect(parseWmctrl(await fixture('wmctrl-windows.txt'))).toEqual([
      {
        id: '0x03e00007',
        pid: 1234,
        title: 'DingTalk - Project Alpha',
        nativeClass: 'dingtalk.DingTalk',
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
        visible: true,
      },
      {
        id: '0x03e00008',
        pid: 1234,
        title: 'DingTalk - Project Beta',
        nativeClass: 'dingtalk.DingTalk',
        bounds: { x: -1280, y: 0, width: 1280, height: 720 },
        visible: true,
      },
      {
        id: '0x03e00009',
        pid: 77,
        title: 'Hidden overlay',
        nativeClass: 'app.Class',
        bounds: { x: 0, y: 0, width: 0, height: 720 },
        visible: false,
      },
      {
        id: '0x03e0000a',
        pid: 42,
        title: 'Browser window title',
        nativeClass: 'browser.Browser',
        bounds: { x: 10, y: 20, width: 400, height: 300 },
        visible: true,
      },
      {
        id: '0x03e0000b',
        pid: 99,
        title: 'Spaced  \t title',
        nativeClass: 'notes.App',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        visible: true,
      },
    ])
  })

  test('allows an empty title after the nine wmctrl fields', () => {
    expect(parseWmctrl('0x0000000F 0 1 0 0 1 1 example.App host')).toEqual([
      expect.objectContaining({ id: '0x0000000f', pid: 1, title: '' }),
    ])
  })

  test.each([
    'not-a-window',
    'window-id 0 1 0 0 1 1 class host Highly sensitive window title',
    '0x1 bad-desktop 1 0 0 1 1 class host Highly sensitive window title',
    '0x1 0 no-pid 0 0 1 1 class host Highly sensitive window title',
    '0x1 0 9007199254740992 0 0 1 1 class host Highly sensitive window title',
    '0x1 0 1 no-x 0 1 1 class host Highly sensitive window title',
    '0x1 0 1 0 no-y 1 1 class host Highly sensitive window title',
    '0x1 0 1 0 0 -1 1 class host Highly sensitive window title',
    '0x1 0 1 0 0 1 -1 class host Highly sensitive window title',
  ])('rejects malformed line without exposing its title', (line) => {
    try {
      parseWmctrl(line)
      throw new Error('Expected parseWmctrl to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(WmctrlParseError)
      expect(error).toMatchObject({ lineNumber: 1 })
      expect((error as Error).message).not.toContain('Highly sensitive')
    }
  })
})
