import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import sharp from 'sharp'
import { afterEach, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const pngSizes = [16, 24, 32, 48, 64, 72, 96, 128, 256, 512]
const expectedFiles = [
  ...pngSizes.map((size) => `${size}x${size}.png`),
  'icon.ico',
]
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

test('generates the complete deterministic PNG and ICO icon set', async () => {
  const first = await generateIntoTemporaryDirectory()
  const second = await generateIntoTemporaryDirectory()

  expect((await readdir(first)).sort()).toEqual([...expectedFiles].sort())
  expect((await readdir(second)).sort()).toEqual([...expectedFiles].sort())

  for (const size of pngSizes) {
    const fileName = `${size}x${size}.png`
    const metadata = await sharp(join(first, fileName)).metadata()
    expect(metadata.width).toBe(size)
    expect(metadata.height).toBe(size)
    expect(metadata.format).toBe('png')
  }

  const ico = await readFile(join(first, 'icon.ico'))
  expect(ico.readUInt16LE(0)).toBe(0)
  expect(ico.readUInt16LE(2)).toBe(1)
  const imageCount = ico.readUInt16LE(4)
  expect(imageCount).toBeGreaterThan(1)
  expect(readIcoSizes(ico)).toEqual([16, 24, 32, 48, 64, 72, 96, 128, 256])

  expect(await hashesFor(first)).toEqual(await hashesFor(second))
})

async function generateIntoTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'touchfish-icons-'))
  temporaryDirectories.push(directory)
  await execFileAsync(process.execPath, [
    'scripts/generate-icons.mjs',
    '--out',
    directory,
  ])
  return directory
}

function readIcoSizes(ico: Buffer): number[] {
  const count = ico.readUInt16LE(4)
  return Array.from({ length: count }, (_, index) => {
    const value = ico.readUInt8(6 + index * 16)
    return value === 0 ? 256 : value
  })
}

async function hashesFor(directory: string): Promise<Record<string, string>> {
  const entries = await Promise.all(
    expectedFiles.map(async (fileName) => {
      const bytes = await readFile(join(directory, fileName))
      return [fileName, createHash('sha256').update(bytes).digest('hex')]
    }),
  )
  return Object.fromEntries(entries)
}
