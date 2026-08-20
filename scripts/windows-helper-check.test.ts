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

  test('reports only fixed request stages when the helper rejects a request', async () => {
    const helper = await readFile('resources/windows/window-helper.ps1', 'utf8')
    const failureHandler = helper.slice(helper.lastIndexOf('} catch {'))

    for (const stage of [
      'dpi-awareness',
      'argument-validation',
      'payload-decode',
      'payload-parse',
      'command-dispatch',
      'window-enumeration',
      'response-serialization',
    ]) {
      expect(helper).toContain(`$requestStage = '${stage}'`)
    }
    expect(helper).toMatch(
      /\$requestStage = 'window-enumeration'\s+\$windows = @\(Get-AllWindows\)\s+\$requestStage = 'response-serialization'\s+Write-Envelope \$true \$windows/,
    )
    expect(failureHandler).toContain(
      `Write-Failure 'INVALID_REQUEST' "Request could not be processed at stage: $requestStage"`,
    )
    expect(failureHandler).not.toMatch(/\$_|Exception|StackTrace/)
  })

  test('does not collide with the case-insensitive PowerShell PID variable', async () => {
    const helper = await readFile('resources/windows/window-helper.ps1', 'utf8')

    expect(helper).not.toMatch(/\$processId\b/i)
    expect(helper).toContain('[uint32]$ownerProcessId = 0')
    expect(helper).toContain(
      'GetWindowThreadProcessId($handle, [ref]$ownerProcessId)',
    )
    expect(helper).toContain('pid = [int64]$ownerProcessId')
  })

  test('checker reports protocol error codes and messages but tolerates only DPI failure', async () => {
    const checker = await readFile('scripts/check-windows-helper.ps1', 'utf8')
    const toleratedCodes = Array.from(
      checker.matchAll(/\$response\.error\.code -eq '([^']+)'/g),
      (match) => match[1],
    )

    expect(toleratedCodes).toEqual(['DPI_AWARENESS_FAILED'])
    expect(checker).toContain(
      'throw "Windows helper rejected list-windows: $($response.error.code): $($response.error.message)"',
    )
    expect(checker).not.toContain("$response.error.code -eq 'INVALID_REQUEST'")
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

  test('CI annotates source Windows helper failures without losing their exit status', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
    const start = workflow.indexOf('- name: Check source Windows helper')
    const end = workflow.indexOf('- name: Build native Linux installer')
    const step = workflow.slice(start, end)

    expect(step).toContain('$checkerStatus = $LASTEXITCODE')
    expect(step).toContain('$logStatus = 1')
    expect(step).toContain('Get-Content -LiteralPath $logPath -Tail 200')
    expect(step).toMatch(/\.Replace\('%', '%25'\)/)
    expect(step).toMatch(/\.Replace\("`r", '%0D'\)/)
    expect(step).toMatch(/\.Replace\("`n", '%0A'\)/)
    expect(step.match(/::error::/g)).toHaveLength(1)
    expect(step).toContain('exit $failureStatus')
  })
})
