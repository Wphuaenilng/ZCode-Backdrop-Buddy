param(
  [string]$DataDir = '',
  [switch]$Purge,
  [switch]$PurgeUserThemes,
  [switch]$Confirm
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Test-DataDirShape([string]$Directory) {
  if (-not $Directory) { return $false }
  $full = [System.IO.Path]::GetFullPath($Directory)
  $trimmed = $full.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  if ($trimmed.Length -le 2) { return $false }
  if (-not (Test-Path -LiteralPath $full -PathType Container)) { return $false }
  if (-not (Test-Path -LiteralPath (Join-Path $full 'themes') -PathType Container)) { return $false }
  return (Test-Path -LiteralPath (Join-Path $full 'config.json') -PathType Leaf) -or
    (Test-Path -LiteralPath (Join-Path $full 'themes\pointer.json') -PathType Leaf) -or
    (Test-Path -LiteralPath (Join-Path $full 'themes\runtime.json') -PathType Leaf) -or
    (Test-Path -LiteralPath (Join-Path $full 'themes\user') -PathType Container)
}

try {
  if ($DataDir) {
    $root = [System.IO.Path]::GetFullPath($DataDir)
  } else {
    $root = Join-Path $env:LOCALAPPDATA 'BackdropBuddy'
  }

  $report = @{}
  foreach ($name in @('themes', 'themes\user', 'cache', 'logs', 'backup')) {
    $path = Join-Path $root $name
    $exists = Test-Path -LiteralPath $path
    $bytes = 0
    $count = 0
    if ($exists) {
      $sum = Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
      $bytes = [int64]($sum.Sum)
      $count = @(Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue).Count
    }
    $report[$name] = @{ path = $path; exists = $exists; bytes = $bytes; files = $count }
  }

  $actions = @()
  if (($Purge -or $PurgeUserThemes) -and -not (Test-DataDirShape $root)) {
    throw "DATA_DIR_UNRECOGNIZED: $root does not look like a BackdropBuddy data directory"
  }

  if ($Purge) {
    foreach ($name in @('cache', 'logs', 'backup')) {
      $path = [System.IO.Path]::GetFullPath((Join-Path $root $name))
      if (-not $path.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
      if ($Confirm) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop; $actions += "removed $name" }
        else { $actions += "$name already absent" }
      } else {
        $actions += "would remove $name"
      }
    }
  }

  if ($PurgeUserThemes) {
    $userThemes = [System.IO.Path]::GetFullPath((Join-Path $root 'themes\user'))
    if (-not $userThemes.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'user theme path escapes data directory' }
    if ($Confirm) {
      if (Test-Path -LiteralPath $userThemes) { Remove-Item -LiteralPath $userThemes -Recurse -Force -ErrorAction Stop; $actions += 'removed themes/user' }
      else { $actions += 'themes/user already absent' }
    } else {
      $actions += 'would remove themes/user'
    }
  }

  @{
    ok = $true
    root = $root
    purge = [bool]$Purge
    purgeUserThemes = [bool]$PurgeUserThemes
    confirmed = [bool]$Confirm
    dryRun = (-not $Confirm)
    report = $report
    actions = $actions
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  $message = $_.Exception.Message
  $code = if ($message.StartsWith('DATA_DIR_UNRECOGNIZED')) { 'DATA_DIR_UNRECOGNIZED' } else { 'DATA_POLICY_FAILED' }
  @{ ok = $false; error = @{ code = $code; message = $message } } | ConvertTo-Json -Compress -Depth 6
}
