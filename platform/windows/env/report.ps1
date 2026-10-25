param(
  [string]$AppRoot = '',
  [string]$DataDir = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  if ($AppRoot) {
    $root = [System.IO.Path]::GetFullPath($AppRoot)
  } else {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
  }
  if ($DataDir) {
    $data = [System.IO.Path]::GetFullPath($DataDir)
  } else {
    $data = Join-Path $env:LOCALAPPDATA 'BackdropBuddy'
  }

  $os = Get-CimInstance Win32_OperatingSystem
  $nodePath = Join-Path $root 'runtime\node\node.exe'
  $nodeVersion = $null
  $nodeSha256 = $null
  if (Test-Path -LiteralPath $nodePath) {
    $nodeVersion = (& $nodePath --version 2>$null | Out-String).Trim()
    $nodeSha256 = (Get-FileHash -LiteralPath $nodePath -Algorithm SHA256).Hash.ToLowerInvariant()
  }

  $wvKeys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  )
  $webview2 = $null
  foreach ($key in $wvKeys) {
    if (Test-Path $key) {
      $value = (Get-ItemProperty -Path $key -Name pv -ErrorAction SilentlyContinue).pv
      if ($value) { $webview2 = $value; break }
    }
  }

  $release = $null
  $dotnetKey = 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full'
  if (Test-Path $dotnetKey) {
    $release = (Get-ItemProperty -Path $dotnetKey -Name Release -ErrorAction SilentlyContinue).Release
  }

  $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  $ffprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue

  $themeCount = 0
  $dataBytes = 0
  if (Test-Path -LiteralPath $data) {
    foreach ($sub in @('builtin', 'user')) {
      $dir = Join-Path $data ('themes\' + $sub)
      if (Test-Path -LiteralPath $dir) {
        $themeCount += @(Get-ChildItem -LiteralPath $dir -Directory).Count
      }
    }
    $sum = Get-ChildItem -LiteralPath $data -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
    $dataBytes = [int64]($sum.Sum)
  }

  @{
    ok = $true
    os = $os.Caption
    osVersion = $os.Version
    architecture = $env:PROCESSOR_ARCHITECTURE
    powershell = $PSVersionTable.PSVersion.ToString()
    user = $env:USERNAME
    appRoot = $root
    dataDir = $data
    dataDirExists = (Test-Path -LiteralPath $data)
    themeCount = $themeCount
    dataBytes = $dataBytes
    node = @{ path = $nodePath; exists = (Test-Path -LiteralPath $nodePath); version = $nodeVersion; sha256 = $nodeSha256 }
    webview2 = $webview2
    dotnetRelease = $release
    ffmpeg = $(if ($ffmpeg) { $ffmpeg.Source } else { $null })
    ffprobe = $(if ($ffprobe) { $ffprobe.Source } else { $null })
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
