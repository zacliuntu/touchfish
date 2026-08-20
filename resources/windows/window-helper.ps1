[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'

$nativeSource = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class TouchFishNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
}
'@
$null = Add-Type -TypeDefinition $nativeSource -ErrorAction Stop

function Write-Envelope([bool]$ok, $value) {
  if ($ok) {
    $envelope = [ordered]@{ protocolVersion = 1; ok = $true; result = $value }
  } else {
    $envelope = [ordered]@{ protocolVersion = 1; ok = $false; error = $value }
  }
  [Console]::Out.WriteLine(($envelope | ConvertTo-Json -Compress -Depth 6))
}

function Write-Failure([string]$code, [string]$message) {
  Write-Envelope $false ([ordered]@{ code = $code; message = $message })
}

function Get-Property($object, [string]$name) {
  $property = $object.PSObject.Properties[$name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-WindowId([IntPtr]$handle) {
  return ('0x{0:x}' -f ([UInt64]$handle.ToInt64()))
}

function Get-WindowRecord([IntPtr]$handle) {
  if (-not [TouchFishNative]::IsWindowVisible($handle)) { return $null }
  if ([TouchFishNative]::GetWindow($handle, 4) -ne [IntPtr]::Zero) { return $null }
  $style = [TouchFishNative]::GetWindowLong($handle, -20).ToInt64()
  if (($style -band 0x80) -ne 0) { return $null }
  $rect = New-Object TouchFishNative+RECT
  if (-not [TouchFishNative]::GetWindowRect($handle, [ref]$rect)) { return $null }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) { return $null }

  [uint32]$ownerProcessId = 0
  $null = [TouchFishNative]::GetWindowThreadProcessId($handle, [ref]$ownerProcessId)
  if ($ownerProcessId -eq 0) { return $null }
  $title = New-Object System.Text.StringBuilder 32768
  $className = New-Object System.Text.StringBuilder 256
  $null = [TouchFishNative]::GetWindowText($handle, $title, $title.Capacity)
  $null = [TouchFishNative]::GetClassName($handle, $className, $className.Capacity)
  $executablePath = $null
  try { $executablePath = (Get-Process -Id $ownerProcessId -ErrorAction Stop).MainModule.FileName } catch { }

  $record = [ordered]@{
    id = Get-WindowId $handle
    pid = [int64]$ownerProcessId
    title = $title.ToString()
    bounds = [ordered]@{ x = $rect.Left; y = $rect.Top; width = $width; height = $height }
    visible = $true
  }
  if ($className.Length -gt 0) { $record.nativeClass = $className.ToString() }
  if (-not [string]::IsNullOrWhiteSpace($executablePath)) { $record.executablePath = $executablePath }
  return [pscustomobject]$record
}

function Get-AllWindows {
  $windows = New-Object System.Collections.Generic.List[object]
  $callback = [TouchFishNative+EnumWindowsProc]{
    param([IntPtr]$handle, [IntPtr]$unused)
    $record = Get-WindowRecord $handle
    if ($null -ne $record) { $windows.Add($record) }
    return $true
  }
  $null = [TouchFishNative]::EnumWindows($callback, [IntPtr]::Zero)
  return @($windows)
}

function Get-ForegroundWindowRecord {
  $handle = [TouchFishNative]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { return $null }
  return Get-WindowRecord $handle
}

function Find-Window([string]$windowId) {
  foreach ($window in (Get-AllWindows)) {
    if ($window.id -ceq $windowId) { return $window }
  }
  return $null
}

$requestStage = 'dpi-awareness'
try {
  $previousDpiContext = [TouchFishNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
  if ($previousDpiContext -eq [IntPtr]::Zero) {
    Write-Failure 'DPI_AWARENESS_FAILED' 'DPI awareness could not be enabled'
    exit 0
  }
  $requestStage = 'argument-validation'
  if ($args.Count -ne 3 -or $args[1] -cne '--payload-base64') {
    throw 'INVALID_REQUEST'
  }
  $command = $args[0]
  if ($command -cnotin @('list-windows', 'foreground-window', 'move-maximize')) {
    throw 'INVALID_COMMAND'
  }
  $requestStage = 'payload-decode'
  $payloadText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[2]))
  $requestStage = 'payload-parse'
  $payload = ConvertFrom-Json -InputObject $payloadText -ErrorAction Stop
  if ($null -eq $payload -or $payload -isnot [psobject]) { throw 'INVALID_PAYLOAD' }

  $requestStage = 'command-dispatch'
  switch ($command) {
    'list-windows' { Write-Envelope $true @(Get-AllWindows); break }
    'foreground-window' { Write-Envelope $true (Get-ForegroundWindowRecord); break }
    'move-maximize' {
      $windowId = Get-Property $payload 'windowId'
      $workArea = Get-Property $payload 'workArea'
      if ($windowId -isnot [string] -or $null -eq $workArea) { throw 'INVALID_PAYLOAD' }
      $x = Get-Property $workArea 'x'; $y = Get-Property $workArea 'y'
      $width = Get-Property $workArea 'width'; $height = Get-Property $workArea 'height'
      if ($x -isnot [ValueType] -or $y -isnot [ValueType] -or $width -isnot [ValueType] -or $height -isnot [ValueType] -or $width -le 0 -or $height -le 0) { throw 'INVALID_PAYLOAD' }
      $window = Find-Window $windowId
      if ($null -eq $window) { Write-Failure 'WINDOW_NOT_FOUND' 'Window was not found'; break }
      [IntPtr]$handle = [Int64]::Parse($window.id.Substring(2), [Globalization.NumberStyles]::HexNumber)
      $moved = [TouchFishNative]::SetWindowPos($handle, [IntPtr]::Zero, [int]$x, [int]$y, [int]$width, [int]$height, 0x0040)
      if (-not $moved) { Write-Failure 'WINDOW_MOVE_FAILED' 'Window could not be moved'; break }
      $maximized = [TouchFishNative]::ShowWindowAsync($handle, 3)
      if (-not $maximized) { Write-Failure 'WINDOW_MAXIMIZE_FAILED' 'Window could not be maximized'; break }
      Write-Envelope $true ([ordered]@{})
      break
    }
  }
} catch {
  Write-Failure 'INVALID_REQUEST' "Request could not be processed at stage: $requestStage"
}
exit 0
