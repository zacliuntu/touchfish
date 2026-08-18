import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, test } from 'vitest'

import { LogStore } from './log-store'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'touchfish-log-store-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('LogStore', () => {
  test('redacts matching keys deeply without mutating the entry', async () => {
    const directory = await temporaryDirectory()
    const entry = {
      user: {
        password: 'secret',
        nested: [{ Authorization: 'Bearer token' }, { okay: true }],
      },
      sessionToken: 'also secret',
    }
    const before = JSON.parse(JSON.stringify(entry)) as typeof entry

    await new LogStore(directory).write(entry)

    await expect(
      readFile(join(directory, 'touchfish.log'), 'utf8'),
    ).resolves.toBe(
      `${JSON.stringify({
        user: {
          password: '[REDACTED]',
          nested: [{ Authorization: '[REDACTED]' }, { okay: true }],
        },
        sessionToken: '[REDACTED]',
      })}\n`,
    )
    expect(entry).toEqual(before)
  })

  test('rotates logs and retains at most the configured number of files', async () => {
    const directory = await temporaryDirectory()
    const lineBytes = Buffer.byteLength(
      `${JSON.stringify({ index: 1 })}\n`,
      'utf8',
    )
    const store = new LogStore(directory, { maxBytes: lineBytes, maxFiles: 3 })

    await store.write({ index: 1 })
    await store.write({ index: 2 })
    await store.write({ index: 3 })
    await store.write({ index: 4 })

    await expect(store.recent(10)).resolves.toEqual([
      { index: 2 },
      { index: 3 },
      { index: 4 },
    ])
    await expect(
      stat(join(directory, 'touchfish.log.3')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('returns recent records in order, skips corrupt lines, and honors the limit', async () => {
    const directory = await temporaryDirectory()
    await writeFile(
      join(directory, 'touchfish.log.2'),
      '{"index":1}\nnot-json\n',
    )
    await writeFile(join(directory, 'touchfish.log.1'), '{"index":2}\n')
    await writeFile(join(directory, 'touchfish.log'), '{"index":3}\n')
    const store = new LogStore(directory, { maxFiles: 3 })

    await expect(store.recent(10)).resolves.toEqual([
      { index: 1 },
      { index: 2 },
      { index: 3 },
    ])
    await expect(store.recent(2)).resolves.toEqual([{ index: 2 }, { index: 3 }])
    await expect(store.recent(0)).resolves.toEqual([])
  })

  test('uses UTF-8 byte length when deciding whether to rotate', async () => {
    const directory = await temporaryDirectory()
    const entry = { message: '你' }
    const maxBytes = Buffer.byteLength(`${JSON.stringify(entry)}\n`, 'utf8')
    const store = new LogStore(directory, { maxBytes, maxFiles: 2 })

    await store.write(entry)
    await store.write(entry)

    await expect(
      readFile(join(directory, 'touchfish.log.1'), 'utf8'),
    ).resolves.toBe(`${JSON.stringify(entry)}\n`)
  })

  test('keeps only the current log when maxFiles is one', async () => {
    const directory = await temporaryDirectory()
    const lineBytes = Buffer.byteLength(
      `${JSON.stringify({ index: 1 })}\n`,
      'utf8',
    )
    const store = new LogStore(directory, { maxBytes: lineBytes, maxFiles: 1 })

    await store.write({ index: 1 })
    await store.write({ index: 2 })

    await expect(store.recent(10)).resolves.toEqual([{ index: 2 }])
    await expect(
      stat(join(directory, 'touchfish.log.1')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test.each([
    { maxFiles: 0 },
    { maxFiles: -1 },
    { maxFiles: 1.5 },
    { maxBytes: 0 },
    { maxBytes: -1 },
    { maxBytes: 1.5 },
  ])('rejects invalid limits %o', (options) => {
    expect(() => new LogStore('/tmp/touchfish-log-store', options)).toThrow()
  })
})
