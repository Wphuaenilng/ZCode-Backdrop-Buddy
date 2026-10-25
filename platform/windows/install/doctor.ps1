param(
  [string]$AppRoot = '',
  [string]$DataDir = '',
  [string]$HostRoot = 'F:\shop\ZCode'
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
  if (-not $DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA 'BackdropBuddy' }
  $exe = Join-Path $HostRoot 'ZCode.exe'

  $envReport = Invoke-ScriptJson (Join-Path $PSScriptRoot '..\env\report.ps1') @{ AppRoot = $root; DataDir = $DataDir }
  $layout = Invoke-ScriptJson (Join-Path $PSScriptRoot 'layout.ps1') @{ AppRoot = $root }
  $prereqs = Invoke-ScriptJson (Join-Path $PSScriptRoot 'prereqs.ps1') @{ AppRoot = $root }
  $hostReport = Invoke-ScriptJson (Join-Path $PSScriptRoot '..\host\detect.ps1') @{ ExePath = $exe; Port = 9229 }

  $checks = @(
    @{ name = 'environment'; required = $true; ok = [bool]$envReport.ok; detail = $envReport },
    @{ name = 'layout'; required = $true; ok = [bool]$layout.ok; detail = $layout },
    @{ name = 'prerequisites'; required = $true; ok = [bool]$prereqs.ok; detail = $prereqs },
    @{ name = 'host'; required = $false; ok = [bool]$hostReport.ok; detail = $hostReport }
  )

  $requiredOk = $true
  $warnings = @()
  foreach ($check in $checks) {
    if ($check.required -and -not $check.ok) { $requiredOk = $false }
    if (-not $check.required -and -not $check.ok) { $warnings += "$($check.name) check failed" }
    if ($check.name -eq 'host' -and $check.ok -and -not $hostReport.running) { $warnings += 'ZCode is not running' }
  }

  @{
    ok = $requiredOk
    appRoot = $root
    dataDir = $DataDir
    hostRoot = $HostRoot
    checks = $checks
    warnings = $warnings
  } | ConvertTo-Json -Compress -Depth 12
} catch {
  @{ ok = $false; error = @{ code = 'DOCTOR_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
