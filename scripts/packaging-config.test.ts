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

test('configures the Linux SUID sandbox for installs and unpacked workflow smoke', async () => {
  const afterInstall = await readFile('build/after-install.sh', 'utf8')

  expect(afterInstall).toContain('set -e')
  expect(afterInstall).toContain("sandbox_path='/opt/TouchFish/chrome-sandbox'")
  expect(afterInstall).toContain('if [ -f "$sandbox_path" ]; then')
  expect(afterInstall).toContain('chown root:root "$sandbox_path"')
  expect(afterInstall).toContain('chmod 4755 "$sandbox_path"')
  expect(afterInstall).not.toMatch(/(?:chown|chmod).*\|\| true/)

  for (const workflowPath of [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
  ]) {
    const workflow = await readFile(workflowPath, 'utf8')
    const permissionStart = workflow.indexOf(
      '- name: Configure Linux sandbox permissions',
    )
    const smokeStart = workflow.indexOf('- name: Smoke packaged Linux app')
    const windowsStart = workflow.indexOf(
      '- name: Check packaged Windows helper',
    )
    const permissionStep = workflow.slice(permissionStart, smokeStart)
    const smokeStep = workflow.slice(smokeStart, windowsStart)

    expect(permissionStart, workflowPath).toBeGreaterThan(-1)
    expect(permissionStep).toContain("if: runner.os == 'Linux'")
    expect(permissionStep).toContain('sudo chown root:root "$sandbox_path"')
    expect(permissionStep).toContain('sudo chmod 4755 "$sandbox_path"')
    expect(permissionStep).toContain(
      `test "$(stat -c '%u:%g' "$sandbox_path")" = '0:0'`,
    )
    expect(permissionStep).toContain(
      `test "$(stat -c '%a' "$sandbox_path")" = '4755'`,
    )
    expect(smokeStep).not.toContain('--no-sandbox')
  }
})
