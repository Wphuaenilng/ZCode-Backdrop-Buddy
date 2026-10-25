param(
  [string]$ExePath = 'F:\shop\ZCode\ZCode.exe',
  [int]$Port = 9229,
  [int]$WaitMs = 15000
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
      try {
        $started = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port" -PassThru
      } finally {
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
