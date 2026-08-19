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
$output = @(& $helperPath 'list-windows' '--payload-base64' $payloadBase64)
if ($LASTEXITCODE -ne 0) {
  throw "Windows helper exited with code $LASTEXITCODE"
}
if ($output.Count -ne 1 -or $output[0] -isnot [string]) {
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
