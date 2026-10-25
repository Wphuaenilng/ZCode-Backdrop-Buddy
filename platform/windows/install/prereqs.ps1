param(
  [string]$AppRoot = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Invoke-ScriptJson([string]$Script, [hashtable]$Parameters = @{}) {
  $output = (& $Script @Parameters | Out-String)
  try { return ($output | ConvertFrom-Json) }
  catch { return [pscustomobject]@{ ok = $false; error = @{ code = 'PS_JSON'; message = $output.Trim() } } }
}

try {
  if ($AppRoot) {
    $root = [System.IO.Path]::GetFullPath($AppRoot)
  } else {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
  }

  $webview = Invoke-ScriptJson (Join-Path $PSScriptRoot '..\env\webview2-check.ps1') @{}
  $dotnet = Invoke-ScriptJson (Join-Path $PSScriptRoot '..\env\dotnet-check.ps1') @{}
  $node = Invoke-ScriptJson (Join-Path $PSScriptRoot '..\env\node-check.ps1') @{ NodePath = (Join-Path $root 'runtime\node\node.exe') }
  $powershell = $PSVersionTable.PSVersion

  $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  $ffprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue

  $required = @(
    @{ name = 'webview2'; ok = [bool]$webview.ok; version = $webview.version; detail = $webview },
    @{ name = 'dotnet48'; ok = [bool]$dotnet.ok; version = $dotnet.version; detail = $dotnet },
    @{ name = 'node'; ok = [bool]$node.ok; version = $node.version; detail = $node },
    @{ name = 'powershell'; ok = ($powershell -ge [version]'5.1'); version = $powershell.ToString(); detail = $null }
  )
  $optional = @(
    @{ name = 'ffmpeg'; ok = [bool]$ffmpeg; path = $(if ($ffmpeg) { $ffmpeg.Source } else { $null }) },
    @{ name = 'ffprobe'; ok = [bool]$ffprobe; path = $(if ($ffprobe) { $ffprobe.Source } else { $null }) }
  )

  $ok = $true
  foreach ($item in $required) { if (-not $item.ok) { $ok = $false } }

  @{
    ok = $ok
    required = $required
    optional = $optional
    missing = @($required | Where-Object { -not $_.ok } | ForEach-Object { $_.name })
  } | ConvertTo-Json -Compress -Depth 10
} catch {
  @{ ok = $false; error = @{ code = 'PREREQ_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
