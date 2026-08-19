import { readFile } from 'node:fs/promises'

import { expect, test } from 'vitest'

test('keeps the Linux desktop identity aligned with the executable', async () => {
  const packageJson = JSON.parse(
    await readFile('package.json', 'utf8'),
  ) as Record<string, unknown>
  const builderConfig = await readFile('electron-builder.yml', 'utf8')
  const linuxSection = builderConfig
    .split(/\n(?=\S)/)
    .find((section) => section.startsWith('linux:\n'))

  expect(packageJson.desktopName).toBe('touchfish')
  expect(linuxSection).toMatch(/^[ ]{2}syncDesktopName: true$/m)
})
