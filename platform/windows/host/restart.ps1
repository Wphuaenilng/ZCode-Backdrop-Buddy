param(
  [string]$ExePath = 'F:\shop\ZCode\ZCode.exe',
  [int]$Port = 9229,
  [int]$CloseWaitMs = 5000,
  [int]$LaunchWaitMs = 20000,
  [string]$AppxPackage = '',
  [string]$ExeName = 'ChatGPT.exe',
  [string]$StartupConfig = '',
  [string]$StartupResult = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Send-Json($value) {
  $value | ConvertTo-Json -Compress -Depth 8
}

# MSIX 应用的安装路径带版本号会随更新漂移：按包名从 Appx 解析出当前真实 exe。
function Resolve-AppxExe([string]$Package, [string]$Name) {
  if (-not $Package) { return $null }
  try {
    $pkg = Get-AppxPackage -Name $Package -ErrorAction Stop | Sort-Object -Property Version -Descending | Select-Object -First 1
    if (-not $pkg) { return $null }
    foreach ($relative in @(('app\' + $Name), $Name)) {
      $candidate = Join-Path -Path $pkg.InstallLocation -ChildPath $relative
      if (Test-Path -LiteralPath $candidate) { return [System.IO.Path]::GetFullPath($candidate) }
    }
  } catch { }
  return $null
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

$script:StartupInjector = $null
$script:StartupInjection = $null

function Start-StartupInjector {
  if (-not $StartupConfig) { return }
  try {
    $appRoot = $env:BACKDROPBUDDY_APP_ROOT
    $node = if ($appRoot) { Join-Path $appRoot 'runtime\node\node.exe' } else { '' }
    $script = if ($appRoot) { Join-Path $appRoot 'kernel\host\startup-injector.mjs' } else { '' }
    if (-not $appRoot -or -not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $script) -or
        -not (Test-Path -LiteralPath $StartupConfig) -or -not $StartupResult) {
      throw 'startup injector configuration or runtime is unavailable'
    }
    $arguments = @('"' + $script + '"', '--config="' + $StartupConfig + '"')
    $script:StartupInjector = Start-Process -FilePath $node -ArgumentList $arguments `
      -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput ($StartupResult + '.stdout.log') `
      -RedirectStandardError ($StartupResult + '.stderr.log')
  } catch {
    $script:StartupInjection = @{ attached = $false; injected = $false; elapsedMs = 0; reason = ('injector-start-failed: ' + $_.Exception.Message) }
  }
}

function Wait-StartupInjector([bool]$AllowWait) {
  if (-not $script:StartupInjector) { return }
  $process = $script:StartupInjector
  $exited = $false
  try { $exited = $process.WaitForExit($(if ($AllowWait) { 6000 } else { 0 })) } catch { $exited = $process.HasExited }
  if (-not $exited) {
    # Only the exact child process created above is ever stopped here.
    try { Stop-Process -Id $process.Id -Force -ErrorAction Stop } catch { }
    if (-not $script:StartupInjection) {
      $script:StartupInjection = @{ attached = $false; injected = $false; elapsedMs = 0; reason = 'injector-result-timeout' }
    }
  }
  if (Test-Path -LiteralPath $StartupResult) {
    try {
      $value = Get-Content -LiteralPath $StartupResult -Raw | ConvertFrom-Json
      $script:StartupInjection = @{
        attached = [bool]$value.attached
        injected = [bool]$value.injected
        elapsedMs = [int]$value.elapsedMs
        reason = [string]$value.reason
        attachAfterPortMs = $(if ($null -ne $value.attachAfterPortMs) { [int]$value.attachAfterPortMs } else { $null })
      }
    } catch { }
  }
}

function Stop-OwnedStartupInjector {
  if (-not $script:StartupInjector) { return }
  try {
    if (-not $script:StartupInjector.HasExited) { Stop-Process -Id $script:StartupInjector.Id -Force -ErrorAction Stop }
  } catch { }
  try { $script:StartupInjector.Dispose() } catch { }
  $script:StartupInjector = $null
}

try {
  # ExePath 为空或不存在时（内置 MSIX 宿主），按 -AppxPackage 解析真实安装路径
  $exe = $null
  if ($ExePath) {
    try { $exe = [System.IO.Path]::GetFullPath($ExePath) } catch { $exe = $null }
  }
  if (($null -eq $exe -or -not (Test-Path -LiteralPath $exe)) -and $AppxPackage) {
    $exe = Resolve-AppxExe $AppxPackage $ExeName
  }
  if (-not $exe -or -not (Test-Path -LiteralPath $exe)) {
    Send-Json @{ ok = $false; error = @{ code = 'HOST_NOT_FOUND'; message = "$ExeName not found$(if ($exe) { ": $exe" } else { '' })" } }
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

  # 端口已开放时上面已经返回；只有确实要停/启本次宿主才允许启动注入器。
  Start-StartupInjector

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
      error = @{ code = 'STOP_TIMEOUT'; message = "$([System.IO.Path]::GetFileName($exe)) processes did not exit; close it manually and retry" }
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

  Wait-StartupInjector $open

  Send-Json @{
    ok = $open
    alreadyOpen = $false
    port = $Port
    portOpen = $open
    pid = $started.Id
    stopped = $stopped
    forced = $forced
    startupInject = $script:StartupInjection
    error = $(if (-not $open) {
      @{ code = 'DEBUG_PORT_TIMEOUT'; message = "$([System.IO.Path]::GetFileName($exe)) started (PID $($started.Id)) but port $Port did not open within ${LaunchWaitMs}ms" }
    } else { $null })
  }
} catch {
  Send-Json @{ ok = $false; error = @{ code = 'RESTART_FAILED'; message = $_.Exception.Message }; startupInject = $script:StartupInjection }
} finally {
  Stop-OwnedStartupInjector
}
