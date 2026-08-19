import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export async function createChecksums(output, inputs) {
  if (inputs.length === 0) {
    throw new Error('checksums requires at least one artifact')
  }

  const artifacts = inputs
    .map((path) => ({ path: resolve(path), name: basename(path) }))
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
  for (let index = 1; index < artifacts.length; index += 1) {
    if (artifacts[index - 1].name === artifacts[index].name) {
      throw new Error(`Duplicate artifact basename: ${artifacts[index].name}`)
    }
  }

  const lines = []
  for (const artifact of artifacts) {
    lines.push(`${await sha256File(artifact.path)}  ${artifact.name}`)
  }
  await fs.writeFile(resolve(output), `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    flag: 'w',
    mode: 0o600,
  })
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [output, ...inputs] = process.argv.slice(2)
  if (output === undefined) {
    process.stderr.write(
      'Usage: node scripts/checksums.mjs <output-file> <artifact>...\n',
    )
    process.exitCode = 1
  } else {
    try {
      await createChecksums(output, inputs)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`Failed to create checksums: ${message}\n`)
      process.exitCode = 1
    }
  }
}
