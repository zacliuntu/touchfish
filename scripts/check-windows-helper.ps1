param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
$helperPath = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile(
  $helperPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -ne 0) {
  $details = ($parseErrors | ForEach-Object { $_.Message }) -join '; '
  throw "Windows helper has PowerShell parse errors: $details"
}

$payloadBase64 = [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes('{}')
)

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = 'powershell.exe'
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
foreach ($argument in @(
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  $helperPath,
  'list-windows',
  '--payload-base64',
  $payloadBase64
)) {
  $null = $startInfo.ArgumentList.Add($argument)
}

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
try {
  if (-not $process.Start()) {
    throw 'Windows helper process could not be started'
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $exitCode = $process.ExitCode
} finally {
  $process.Dispose()
}

if ($exitCode -ne 0) {
  $detail = $stderr.Trim()
  throw "Windows helper exited with code $exitCode$(if ($detail) { ": $detail" })"
}
$output = @($stdout -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 })
if ($output.Count -ne 1) {
  throw 'Windows helper must emit exactly one JSON envelope'
}

$response = $output[0] | ConvertFrom-Json -ErrorAction Stop
if ($response.protocolVersion -ne 1 -or $response.ok -isnot [bool]) {
  throw 'Windows helper returned an invalid protocol envelope'
}
if (-not $response.ok) {
  if ($response.error.code -eq 'DPI_AWARENESS_FAILED') {
    Write-Warning 'Windows helper protocol is valid, but this runner could not enable DPI awareness'
    exit 0
  }
  throw "Windows helper rejected list-windows: $($response.error.code)"
}
if ($response.result -isnot [System.Array]) {
  throw 'Windows helper list-windows result must be an array'
}

Write-Host "Windows helper check passed: $helperPath"
