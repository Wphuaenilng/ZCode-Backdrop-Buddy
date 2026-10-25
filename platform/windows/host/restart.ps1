param(
  [string]$ExePath = 'F:\shop\ZCode\ZCode.exe',
  [int]$Port = 9229,
  [int]$CloseWaitMs = 5000,
  [int]$LaunchWaitMs = 20000
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Send-Json($value) {
  $value | ConvertTo-Json -Compress -Depth 8
}

function Test-LoopbackPort([int]$Port, [int]$TimeoutMs = 300) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne($TimeoutMs)) {
      [void]$client.EndConnect($async)
      return $true
    }
  } catch { }
  finally { $client.Close() }
  return $false
}

function Get-MatchingProcesses([string]$ExePath) {
  $name = [System.IO.Path]::GetFileName($ExePath)
  $matched = @()
  try {
    foreach ($item in @(Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction Stop)) {
      $path = $item.ExecutablePath
      if (-not $path) {
        try { $path = (Get-Process -Id ([int]$item.ProcessId) -ErrorAction Stop).Path } catch { $path = $null }
      }
      if ($path -and ([System.IO.Path]::GetFullPath($path) -ieq $ExePath)) {
        $process = Get-Process -Id ([int]$item.ProcessId) -ErrorAction SilentlyContinue
        if ($process) { $matched += $process }
      }
    }
  } catch { }
  return @($matched)
}

function Get-PortOwner([int]$Port) {
  try {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($listener) { return [int]$listener.OwningProcess }
  } catch { }
  return $null
}

try {
  $exe = [System.IO.Path]::GetFullPath($ExePath)
  if (-not (Test-Path -LiteralPath $exe)) {
    Send-Json @{ ok = $false; error = @{ code = 'HOST_NOT_FOUND'; message = "ZCode.exe not found: $exe" } }
    return
  }

  $existing = @(Get-MatchingProcesses $exe)

  if (Test-LoopbackPort $Port) {
    $ownerPid = Get-PortOwner $Port
    $ownerPath = $null
    if ($ownerPid) {
      try { $ownerPath = (Get-Process -Id $ownerPid -ErrorAction Stop).Path } catch { $ownerPath = $null }
    }
    if ($ownerPath -and ([System.IO.Path]::GetFullPath($ownerPath) -ieq $exe)) {
      Send-Json @{
        ok = $true
        alreadyOpen = $true
        port = $Port
        portOpen = $true
        pid = $ownerPid
        stopped = @()
        forced = @()
      }
      return
    }

    Send-Json @{
      ok = $false
      error = @{ code = 'PORT_IN_USE'; message = "127.0.0.1:$Port is already in use by another process" }
      owner = @{ pid = $ownerPid; path = $ownerPath }
    }
    return
  }

  $stopped = @($existing | ForEach-Object { $_.Id })
  foreach ($process in $existing) {
    try { [void]$process.CloseMainWindow() } catch { }
  }

  $closeDeadline = (Get-Date).AddMilliseconds($CloseWaitMs)
  while ((Get-Date) -lt $closeDeadline) {
    if (@(Get-MatchingProcesses $exe).Count -eq 0) { break }
    Start-Sleep -Milliseconds 200
  }

  $forced = @()
  foreach ($process in @(Get-MatchingProcesses $exe)) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      $forced += $process.Id
    } catch { }
  }

  if ($forced.Count -gt 0) {
    $forceDeadline = (Get-Date).AddMilliseconds(3000)
    while ((Get-Date) -lt $forceDeadline -and @(Get-MatchingProcesses $exe).Count -gt 0) {
      Start-Sleep -Milliseconds 150
    }
  }

  if (@(Get-MatchingProcesses $exe).Count -gt 0) {
    Send-Json @{
      ok = $false
      error = @{ code = 'STOP_TIMEOUT'; message = 'ZCode processes did not exit; close ZCode manually and retry' }
      stopped = $stopped
      forced = $forced
    }
    return
  }

  # IDE/agent terminals can export ELECTRON_RUN_AS_NODE=1; Electron would then run as Node and exit.
  $electronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  try {
    $started = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port" -WorkingDirectory (Split-Path -Parent $exe) -PassThru
  } finally {
    if ($null -ne $electronRunAsNode) { $env:ELECTRON_RUN_AS_NODE = $electronRunAsNode }
  }
  $launchDeadline = (Get-Date).AddMilliseconds($LaunchWaitMs)
  $open = $false
  while ((Get-Date) -lt $launchDeadline) {
    if (Test-LoopbackPort $Port) { $open = $true; break }
    Start-Sleep -Milliseconds 250
  }

  Send-Json @{
    ok = $open
    alreadyOpen = $false
    port = $Port
    portOpen = $open
    pid = $started.Id
    stopped = $stopped
    forced = $forced
    error = $(if (-not $open) {
      @{ code = 'DEBUG_PORT_TIMEOUT'; message = "ZCode started (PID $($started.Id)) but port $Port did not open within ${LaunchWaitMs}ms" }
    } else { $null })
  }
} catch {
  Send-Json @{ ok = $false; error = @{ code = 'RESTART_FAILED'; message = $_.Exception.Message } }
}
