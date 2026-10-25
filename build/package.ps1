[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$OutputRoot = '',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$versionInfo = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = [string]$versionInfo.version }
if (-not $OutputRoot) { $OutputRoot = Join-Path $PSScriptRoot 'out' }
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$staging = Join-Path $OutputRoot ("BackdropBuddy-" + $Version)

if (-not $SkipBuild) {
  & (Join-Path $PSScriptRoot 'build.ps1') -Version $Version -OutputRoot $OutputRoot
  if (-not $?) { throw 'build.ps1 failed' }
}

if (-not (Test-Path -LiteralPath (Join-Path $staging 'BackdropBuddy.exe'))) {
  throw ('staging directory is incomplete: ' + $staging)
}

$iscc = $null
$command = Get-Command iscc.exe -ErrorAction SilentlyContinue
if ($command) { $iscc = $command.Source }
if (-not $iscc) {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { $iscc = $candidate; break }
  }
}
if (-not $iscc) {
  $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1'
  if (Test-Path $uninstallKey) {
    $installLocation = (Get-ItemProperty -Path $uninstallKey -ErrorAction SilentlyContinue).InstallLocation
    if ($installLocation) {
      $candidate = Join-Path $installLocation 'ISCC.exe'
      if (Test-Path -LiteralPath $candidate) { $iscc = $candidate }
    }
  }
}
if (-not $iscc) {
  throw 'ISCC.exe was not found. Install Inno Setup 6 and retry (or add it to PATH).'
}
Write-Host ('iscc: ' + $iscc)

$iss = Join-Path $PSScriptRoot 'setup.iss'
$source = [System.IO.File]::ReadAllText($iss, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($iss, $source, (New-Object System.Text.UTF8Encoding($true)))

$outputDir = $OutputRoot.TrimEnd('\')
& $iscc ("/DMyAppVersion=" + $Version) ("/DSourceDir=" + $staging) ("/O" + $outputDir) ("/FBackdropBuddy-Setup-" + $Version) $iss
if ($LASTEXITCODE -ne 0) { throw ('ISCC failed with exit code ' + $LASTEXITCODE) }

$setup = Join-Path $OutputRoot ("BackdropBuddy-Setup-" + $Version + ".exe")
if (-not (Test-Path -LiteralPath $setup)) { throw ('installer not produced: ' + $setup) }

$zip = Join-Path $OutputRoot ("BackdropBuddy-" + $Version + ".zip")
$manifest = Join-Path $OutputRoot 'manifest.json'
$artifacts = @()
foreach ($path in @($setup, $zip, $manifest)) {
  if (Test-Path -LiteralPath $path) {
    $file = Get-Item -LiteralPath $path
    $artifacts += @{
      name = $file.Name
      path = $file.FullName
      bytes = $file.Length
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
}

$sumLines = @()
foreach ($artifact in $artifacts) {
  $sumLines += ($artifact.sha256 + '  ' + $artifact.name)
}
$sumText = ($sumLines -join "`n") + "`n"
[System.IO.File]::WriteAllText((Join-Path $OutputRoot 'SHA256SUMS.txt'), $sumText, (New-Object System.Text.ASCIIEncoding))

$buildJsonPath = Join-Path $OutputRoot 'build.json'
$buildInfo = $null
if (Test-Path -LiteralPath $buildJsonPath) {
  $buildInfo = Get-Content -LiteralPath $buildJsonPath -Raw | ConvertFrom-Json
}

$delivery = @{
  ok = $true
  product = [string]$versionInfo.product
  version = $Version
  publisher = [string]$versionInfo.publisher
  builtAt = [DateTime]::UtcNow.ToString('o')
  installer = $artifacts[0]
  artifacts = $artifacts
  payload = @{
    files = $(if ($buildInfo) { $buildInfo.payloadFiles } else { $null })
    bytes = $(if ($buildInfo) { $buildInfo.payloadBytes } else { $null })
    shellExeBytes = $(if ($buildInfo) { $buildInfo.shellExeBytes } else { $null })
    uiBytes = $(if ($buildInfo) { $buildInfo.uiBytes } else { $null })
  }
}
$deliveryJson = $delivery | ConvertTo-Json -Depth 8
Set-Content -LiteralPath (Join-Path $OutputRoot 'delivery.json') -Value $deliveryJson -Encoding UTF8
$deliveryJson
