import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const pngSizes = [16, 24, 32, 48, 64, 72, 96, 128, 256, 512]
const icoSizes = pngSizes.filter((size) => size <= 256)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..')
const sourcePath = join(projectDirectory, 'resources', 'icon.svg')
const outputDirectory = readOutputDirectory(process.argv.slice(2))

await mkdir(outputDirectory, { recursive: true })
const source = await readFile(sourcePath)

for (const size of pngSizes) {
  await sharp(source, { density: 384 })
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      force: true,
      palette: false,
    })
    .toFile(join(outputDirectory, `${size}x${size}.png`))
}

const ico = await pngToIco(
  icoSizes.map((size) => join(outputDirectory, `${size}x${size}.png`)),
)
await writeFile(join(outputDirectory, 'icon.ico'), ico)

function readOutputDirectory(arguments_) {
  const outputIndex = arguments_.indexOf('--out')
  if (outputIndex === -1) return join(projectDirectory, 'build', 'icons')
  const value = arguments_[outputIndex + 1]
  if (value === undefined || value.trim() === '') {
    throw new Error('--out requires a directory')
  }
  return resolve(value)
}
