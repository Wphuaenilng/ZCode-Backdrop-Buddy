param(
  [string]$DataDir = '',
  [switch]$Create
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  if ($DataDir) {
    $root = [System.IO.Path]::GetFullPath($DataDir)
  } else {
    $root = Join-Path $env:LOCALAPPDATA 'BackdropBuddy'
  }

  $relative = @('themes', 'themes\builtin', 'themes\user', 'themes\staging', 'cache', 'backup', 'logs')
  $dirs = @{}
  foreach ($item in $relative) {
    $path = Join-Path $root $item
    if ($Create) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
    $dirs[$item] = @{ path = $path; exists = (Test-Path -LiteralPath $path) }
  }

  $writable = $false
  if (Test-Path -LiteralPath $root) {
    $probe = Join-Path $root ('.write-probe-' + [guid]::NewGuid().ToString('n'))
    try {
      [System.IO.File]::WriteAllText($probe, 'ok')
      $writable = $true
      Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    } catch {
      $writable = $false
    }
  }

  $userThemes = 0
  $userDir = Join-Path $root 'themes\user'
  if (Test-Path -LiteralPath $userDir) { $userThemes = @(Get-ChildItem -LiteralPath $userDir -Directory).Count }

  @{
    ok = (Test-Path -LiteralPath $root)
    root = $root
    exists = (Test-Path -LiteralPath $root)
    writable = $writable
    userThemes = $userThemes
    dirs = $dirs
    error = $(if (-not (Test-Path -LiteralPath $root)) { @{ code = 'DATA_DIR_MISSING'; message = "data directory not found: $root" } } else { $null })
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
