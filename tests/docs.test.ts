import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '..')
const readmes = ['README.md', 'README.zh-CN.md'] as const

describe('project documentation', () => {
  test.each(readmes)(
    '%s has no broken relative Markdown links',
    async (readme) => {
      const contents = await readFile(resolve(repositoryRoot, readme), 'utf8')

      for (const target of relativeMarkdownLinks(contents)) {
        const path = decodeURIComponent(target.split('#', 1)[0] ?? '')
        if (path === '') continue
        await expect(
          access(resolve(dirname(resolve(repositoryRoot, readme)), path)),
          `missing link target ${target} in ${readme}`,
        ).resolves.toBeUndefined()
      }
    },
  )

  test('English and Chinese READMEs link to each other', async () => {
    const english = await readFile(resolve(repositoryRoot, 'README.md'), 'utf8')
    const chinese = await readFile(
      resolve(repositoryRoot, 'README.zh-CN.md'),
      'utf8',
    )

    expect(relativeMarkdownLinks(english)).toContain('README.zh-CN.md')
    expect(relativeMarkdownLinks(chinese)).toContain('README.md')
  })

  test('states the exact support and release warnings', async () => {
    const english = await readFile(resolve(repositoryRoot, 'README.md'), 'utf8')

    expect(english).toContain('Ubuntu X11 only')
    expect(english).toContain('Windows 10/11')
    expect(english).toContain('unsigned installer')
    expect(english).toContain('SmartScreen')
    expect(english).toContain('Windows dual-display post-release smoke test')
  })

  test('keeps operational guidance aligned with the current implementation', async () => {
    const install = await readDocument('docs/INSTALL.md')
    const installChinese = await readDocument('docs/INSTALL.zh-CN.md')
    const configuration = await readDocument('docs/CONFIGURATION.md')
    const configurationChinese = await readDocument(
      'docs/CONFIGURATION.zh-CN.md',
    )
    const troubleshooting = await readDocument('docs/TROUBLESHOOTING.md')
    const troubleshootingChinese = await readDocument(
      'docs/TROUBLESHOOTING.zh-CN.md',
    )

    expect(install).toContain('x64 Ubuntu in an X11 session')
    expect(install).toContain('release notes')
    expect(install).not.toContain('uninstaller from the Start menu')
    expect(install).not.toMatch(/Ubuntu (?:20\.04|22\.04|24\.04)/)
    expect(installChinese).toContain('64 位 Ubuntu X11 会话')
    expect(installChinese).toContain('发布说明')
    expect(installChinese).not.toMatch(/Ubuntu (?:20\.04|22\.04|24\.04)/)
    expect(configuration).toContain(
      'known installed launcher or a currently visible DingTalk window',
    )
    expect(configurationChinese).toContain(
      '已知钉钉启动程序或当前可见的钉钉窗口',
    )
    expect(troubleshooting).toContain(
      'Quit TouchFish from the tray and restart it',
    )
    expect(troubleshooting).toContain(
      'reproduce the scene, quit TouchFish from the tray, restart it, and then open **Diagnostics**',
    )
    expect(troubleshootingChinese).toContain('从托盘退出 TouchFish 并重新启动')
    expect(troubleshootingChinese).toContain(
      '先重现场景，等待最终通知，再从托盘退出并重新启动 TouchFish',
    )
  })
})

function readDocument(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8')
}

function relativeMarkdownLinks(markdown: string): string[] {
  return [...markdown.matchAll(/(?<!!)\[[^\n]*?\]\(([^)]+)\)/g)]
    .map((match) => match[1]?.trim())
    .filter(
      (target): target is string =>
        target !== undefined &&
        !target.startsWith('#') &&
        !/^[a-z][a-z\d+.-]*:/i.test(target),
    )
}
