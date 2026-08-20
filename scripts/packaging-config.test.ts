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

test('installs every Linux command used by the runtime in packages and CI', async () => {
  const builderConfig = await readFile('electron-builder.yml', 'utf8')
  const ci = await readFile('.github/workflows/ci.yml', 'utf8')
  const release = await readFile('.github/workflows/release.yml', 'utf8')

  for (const dependency of ['wmctrl', 'x11-xserver-utils', 'x11-utils']) {
    expect(builderConfig).toContain(`    - ${dependency}\n`)
    expect(ci).toContain(`            ${dependency} \\\n`)
    expect(release).toContain(`            ${dependency} \\\n`)
  }
})

test('disables implicit publishing for native installer builds', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }

  for (const script of ['package:linux', 'package:win']) {
    expect(packageJson.scripts[script]).toMatch(/(?:^| )--publish never(?: |$)/)
  }
})
