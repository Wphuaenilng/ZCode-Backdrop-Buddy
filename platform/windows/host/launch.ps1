param(
  [string]$ExePath = 'F:\shop\ZCode\ZCode.exe',
  [int]$Port = 9229,
  [int]$WaitMs = 15000,
  [string]$EnvJsonB64 = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

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

# 附加启动环境变量（base64 JSON，避免引号被 PowerShell 参数解析破坏）；
# 只作用于 Start-Process 那一刻，启动完立即恢复本进程环境。
function Read-LaunchEnv([string]$B64) {
  if (-not $B64) { return $null }
  try {
    $object = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($B64)) | ConvertFrom-Json
    $map = @{}
    foreach ($property in $object.PSObject.Properties) {
      if ($property.Name -match '^[A-Za-z_][A-Za-z0-9_]{0,63}$' -and $property.Value -is [string]) {
        $map[$property.Name] = [string]$property.Value
      }
    }
    if ($map.Count -gt 0) { return $map }
  } catch { }
  return $null
}

function Set-LaunchEnv([hashtable]$Map, [hashtable]$Backup) {
  foreach ($name in $Map.Keys) {
    $Backup[$name] = [Environment]::GetEnvironmentVariable($name)
    [Environment]::SetEnvironmentVariable($name, [string]$Map[$name], 'Process')
  }
}

function Restore-LaunchEnv([hashtable]$Backup) {
  foreach ($name in $Backup.Keys) {
    [Environment]::SetEnvironmentVariable($name, $Backup[$name], 'Process')
  }
}

try {
  $exe = [System.IO.Path]::GetFullPath($ExePath)
  if (-not (Test-Path -LiteralPath $exe)) {
    @{ ok = $false; error = @{ code = 'HOST_NOT_FOUND'; message = "ZCode.exe not found: $exe" } } | ConvertTo-Json -Compress -Depth 6
  } else {
    $name = [System.IO.Path]::GetFileName($exe)
    $existing = @()
    try {
      foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction Stop)) {
        $path = $process.ExecutablePath
        if ($path -and ([System.IO.Path]::GetFullPath($path) -ieq $exe)) { $existing += [int]$process.ProcessId }
      }
    } catch { }

    if ($existing.Count -gt 0) {
      @{ ok = $false; error = @{ code = 'HOST_ALREADY_RUNNING'; message = "ZCode is already running (PID $($existing -join ', ')). Fully quit it before launching with a debug port." }; processes = $existing } | ConvertTo-Json -Compress -Depth 6
    } elseif (Test-LoopbackPort $Port) {
      @{ ok = $false; error = @{ code = 'PORT_IN_USE'; message = "127.0.0.1:$Port is already in use" } } | ConvertTo-Json -Compress -Depth 6
    } else {
      # IDE/agent terminals can export ELECTRON_RUN_AS_NODE=1; Electron would then run as Node and exit.
      $electronRunAsNode = $env:ELECTRON_RUN_AS_NODE
      Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
      $launchEnv = Read-LaunchEnv $EnvJsonB64
      $envBackup = @{}
      if ($launchEnv) { Set-LaunchEnv $launchEnv $envBackup }
      try {
        $started = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port" -PassThru
      } finally {
        if ($launchEnv) { Restore-LaunchEnv $envBackup }
        if ($null -ne $electronRunAsNode) { $env:ELECTRON_RUN_AS_NODE = $electronRunAsNode }
      }
      $deadline = (Get-Date).AddMilliseconds($WaitMs)
      $open = $false
      while ((Get-Date) -lt $deadline) {
        if (Test-LoopbackPort $Port) { $open = $true; break }
        Start-Sleep -Milliseconds 250
      }
      @{
        ok = $open
        pid = $started.Id
        port = $Port
        portOpen = $open
        waitedMs = $WaitMs - [int][Math]::Max(0, ($deadline - (Get-Date)).TotalMilliseconds)
        error = $(if (-not $open) { @{ code = 'DEBUG_PORT_TIMEOUT'; message = "ZCode started (PID $($started.Id)) but port $Port did not open within ${WaitMs}ms" } } else { $null })
      } | ConvertTo-Json -Compress -Depth 6
    }
  }
} catch {
  @{ ok = $false; error = @{ code = 'LAUNCH_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
