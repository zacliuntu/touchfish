import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

describe('Windows helper release checks', () => {
  test('parses the helper AST and exercises the versioned list-windows protocol', async () => {
    const checker = await readFile('scripts/check-windows-helper.ps1', 'utf8')

    expect(checker).toContain(
      '[System.Management.Automation.Language.Parser]::ParseFile',
    )
    expect(checker).toMatch(/\$parseErrors\.Count\s+-ne\s+0/)
    expect(checker).toContain("$startInfo.FileName = 'powershell.exe'")
    expect(checker).toContain('$startInfo.ArgumentList.Add($argument)')
    expect(checker).toContain('$startInfo.RedirectStandardOutput = $true')
    expect(checker).toContain('$startInfo.RedirectStandardError = $true')
    expect(checker).toContain('$process.StandardOutput.ReadToEndAsync()')
    expect(checker).toContain('$process.StandardError.ReadToEndAsync()')
    expect(checker).not.toContain('@(& $helperPath')
    expect(checker).toContain('ConvertFrom-Json')
    expect(checker).toMatch(/protocolVersion\s+-ne\s+1/)
    expect(checker).toMatch(/DPI_AWARENESS_FAILED/)
    expect(checker).toMatch(/result.*System\.Array/s)
  })

  test.each([
    ['.github/workflows/ci.yml', 'Verify source'],
    ['.github/workflows/release.yml', 'Verify tagged source'],
  ])(
    '%s checks source and packaged helpers before the Windows smoke',
    async (workflowPath, verifyStep) => {
      const workflow = await readFile(workflowPath, 'utf8')
      const verifyIndex = workflow.indexOf(`- name: ${verifyStep}`)
      const sourceIndex = workflow.indexOf(
        '- name: Check source Windows helper',
      )
      const packageIndex = workflow.indexOf('- name: Build native installer')
      const packagedIndex = workflow.indexOf(
        '- name: Check packaged Windows helper',
      )
      const smokeIndex = workflow.indexOf('- name: Smoke packaged Windows app')

      expect(verifyIndex).toBeGreaterThan(-1)
      expect(sourceIndex).toBeGreaterThan(verifyIndex)
      expect(packageIndex).toBeGreaterThan(sourceIndex)
      expect(packagedIndex).toBeGreaterThan(packageIndex)
      expect(smokeIndex).toBeGreaterThan(packagedIndex)
      expect(workflow).toContain(
        'pwsh -NoLogo -NoProfile -File scripts/check-windows-helper.ps1',
      )
      expect(workflow).toContain(
        'dist/win-unpacked/resources/windows/window-helper.ps1',
      )
    },
  )
})
