import * as fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createChecksums } from './checksums.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  )
})

describe('createChecksums', () => {
  test('streams inputs and writes stable basename-sorted SHA-256 lines', async () => {
    const directory = await temporaryDirectory()
    const linux = join(directory, 'TouchFish-0.1.0-amd64.deb')
    const windows = join(directory, 'TouchFish-Setup-0.1.0.exe')
    const output = join(directory, 'SHA256SUMS.txt')
    await fs.writeFile(linux, 'linux artifact')
    await fs.writeFile(windows, 'windows artifact')

    await createChecksums(output, [windows, linux])

    await expect(fs.readFile(output, 'utf8')).resolves.toBe(
      `${digest('linux artifact')}  TouchFish-0.1.0-amd64.deb\n` +
        `${digest('windows artifact')}  TouchFish-Setup-0.1.0.exe\n`,
    )
  })

  test('fails clearly when no artifacts are provided', async () => {
    const directory = await temporaryDirectory()

    await expect(
      createChecksums(join(directory, 'SHA256SUMS.txt'), []),
    ).rejects.toThrow('at least one artifact')
  })

  test('rejects duplicate artifact basenames', async () => {
    const directory = await temporaryDirectory()
    const firstDirectory = join(directory, 'one')
    const secondDirectory = join(directory, 'two')
    await Promise.all([fs.mkdir(firstDirectory), fs.mkdir(secondDirectory)])
    const first = join(firstDirectory, 'TouchFish.deb')
    const second = join(secondDirectory, 'TouchFish.deb')
    await Promise.all([fs.writeFile(first, 'one'), fs.writeFile(second, 'two')])

    await expect(
      createChecksums(join(directory, 'SHA256SUMS.txt'), [first, second]),
    ).rejects.toThrow('Duplicate artifact basename')
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'touchfish-checksums-'))
  temporaryDirectories.push(directory)
  return directory
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
