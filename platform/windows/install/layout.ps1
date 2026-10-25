param(
  [string]$AppRoot = '',
  [string]$ExePath = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  if ($AppRoot) {
    $root = [System.IO.Path]::GetFullPath($AppRoot)
  } else {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
  }

  $required = @(
    'ui\dist\index.html',
    'kernel\main.mjs',
    'kernel\package.json',
    'runtime\node\node.exe',
    'platform\windows\host\detect.ps1',
    'shared\protocol\constants.mjs'
  )

  $files = @()
  $ok = $true
  foreach ($relative in $required) {
    $path = Join-Path $root $relative
    $exists = Test-Path -LiteralPath $path
    if (-not $exists) { $ok = $false }
    $bytes = 0
    if ($exists) { $bytes = (Get-Item -LiteralPath $path).Length }
    $files += @{ path = $relative; exists = $exists; bytes = $bytes; required = $true }
  }

  $exe = $null
  if ($ExePath) {
    $candidate = [System.IO.Path]::GetFullPath($ExePath)
    if (Test-Path -LiteralPath $candidate) {
      $exe = @{ path = $candidate; exists = $true; bytes = (Get-Item -LiteralPath $candidate).Length }
    } else {
      $exe = @{ path = $candidate; exists = $false; bytes = 0 }
    }
  } else {
    $found = @(Get-ChildItem -LiteralPath (Join-Path $root 'src\BackdropBuddy.Shell') -Recurse -Filter 'BackdropBuddy.exe' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($found.Count -gt 0) { $exe = @{ path = $found[0].FullName; exists = $true; bytes = $found[0].Length } }
  }

  @{
    ok = $ok
    appRoot = $root
    files = $files
    exe = $exe
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'LAYOUT_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
