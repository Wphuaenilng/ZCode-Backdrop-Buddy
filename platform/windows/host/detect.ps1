param(
  [string]$ExePath = 'F:\shop\ZCode\ZCode.exe',
  [int]$Port = 9229
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Resolve-ProcessPath([int]$ProcessId) {
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    if ($process.Path) { return [System.IO.Path]::GetFullPath($process.Path) }
  } catch { }
  return $null
}

# The debug port is not always owned by the app process itself: WebView2 hosts
# (Tauri / WinUI / .NET WebView2) listen on a msedgewebview2.exe child, so the
# ownership check walks the ancestor chain instead of comparing PIDs only.
function Test-OwnedBy([int]$OwnerPid, [int]$AppPid) {
  if (-not $OwnerPid -or -not $AppPid) { return $false }
  $current = $OwnerPid
  for ($depth = 0; $depth -lt 8 -and $current -gt 0; $depth++) {
    if ($current -eq $AppPid) { return $true }
    try { $process = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction Stop } catch { return $false }
    if (-not $process) { return $false }
    $current = [int]$process.ParentProcessId
  }
  return $false
}

try {
  $exe = [System.IO.Path]::GetFullPath($ExePath)
  $name = [System.IO.Path]::GetFileName($exe)
  $installed = Test-Path -LiteralPath $exe

  $items = @()
  try {
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction Stop)) {
      $path = $process.ExecutablePath
      if (-not $path) { $path = Resolve-ProcessPath ([int]$process.ProcessId) }
      if ($path) { $path = [System.IO.Path]::GetFullPath($path) }
      $version = $null
      if ($path -and (Test-Path -LiteralPath $path)) {
        try { $version = (Get-Item -LiteralPath $path).VersionInfo.FileVersion } catch { $version = $null }
      }
      $items += @{
        pid = [int]$process.ProcessId
        name = $process.Name
        path = $path
        version = $version
        commandLine = $process.CommandLine
        parentPid = [int]$process.ParentProcessId
        createdAt = $(try { $process.CreationDate.ToString('o') } catch { $null })
      }
    }
  } catch { }

  $selected = $null
  foreach ($item in $items) {
    if ($item.path -and ($item.path -ieq $exe)) { $selected = $item; break }
  }

  $listeners = @()
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
  } catch {
    $listeners = @()
  }

  $portInfo = @{
    listening = $false
    localAddress = $null
    localPort = $Port
    pid = $null
    path = $null
    matchesExe = $false
    loopbackOnly = $false
    source = 'none'
  }

  if ($listeners.Count -gt 0) {
    $first = $listeners[0]
    $owner = [int]$first.OwningProcess
    $ownerPath = Resolve-ProcessPath $owner
    $loopbackOnly = $true
    foreach ($listener in $listeners) {
      $address = [string]$listener.LocalAddress
      if (-not ($address -eq '127.0.0.1' -or $address -eq '::1' -or $address -eq '[::1]')) { $loopbackOnly = $false }
    }
    $owned = ($ownerPath -and ($ownerPath -ieq $exe)) -or (Test-OwnedBy -OwnerPid $owner -AppPid $(if ($selected) { $selected.pid } else { 0 }))
    $portInfo = @{
      listening = $true
      localAddress = [string]$first.LocalAddress
      localPort = [int]$first.LocalPort
      pid = $owner
      path = $ownerPath
      matchesExe = $owned
      loopbackOnly = $loopbackOnly
      source = 'Get-NetTCPConnection'
    }
  } else {
    $netstat = @(netstat -ano -p tcp 2>$null)
    foreach ($line in $netstat) {
      $text = [string]$line
      if ($text -notmatch 'LISTENING') { continue }
      $parts = ($text -split '\s+') | Where-Object { $_ -ne '' }
      if ($parts.Count -lt 5) { continue }
      $local = $parts[1]
      if ($local -notmatch (':' + $Port + '$')) { continue }
      $owner = [int]$parts[$parts.Count - 1]
      $ownerPath = Resolve-ProcessPath $owner
      $address = $local.Substring(0, $local.LastIndexOf(':'))
      $owned = ($ownerPath -and ($ownerPath -ieq $exe)) -or (Test-OwnedBy -OwnerPid $owner -AppPid $(if ($selected) { $selected.pid } else { 0 }))
      $portInfo = @{
        listening = $true
        localAddress = $address
        localPort = $Port
        pid = $owner
        path = $ownerPath
        matchesExe = $owned
        loopbackOnly = ($address -eq '127.0.0.1' -or $address -eq '[::1]')
        source = 'netstat'
      }
      break
    }
  }

  $debugPortFromCommandLine = $false
  if ($selected -and $selected.commandLine -match '--remote-debugging-port=(\d+)') {
    $debugPortFromCommandLine = ([int]$Matches[1] -eq $Port)
  }

  $ownership = @{
    exe = [bool]($selected -and ($selected.path -ieq $exe))
    port = [bool]$portInfo.listening
    loopback = [bool]$portInfo.loopbackOnly
    pid = [bool]($selected -and $portInfo.pid -and (Test-OwnedBy -OwnerPid $portInfo.pid -AppPid $selected.pid))
    verified = $false
  }
  $ownership.verified = [bool]($ownership.exe -and $ownership.port -and $ownership.loopback -and $ownership.pid)

  $reason = $null
  $errorCode = $null
  if (-not $installed) {
    $reason = "ZCode.exe not found: $exe"
    $errorCode = 'HOST_NOT_FOUND'
  } elseif (-not $selected) {
    $reason = 'no running ZCode process found'
    $errorCode = 'HOST_NOT_FOUND'
  } elseif (-not $portInfo.listening) {
    $reason = "ZCode is running but debug port $Port is closed; fully quit ZCode and restart with --remote-debugging-port=$Port"
    $errorCode = 'HOST_NOT_READY'
  } elseif (-not $portInfo.loopbackOnly) {
    $reason = "debug port $Port is listening on a non-loopback address ($($portInfo.localAddress))"
    $errorCode = 'HOST_UNREACHABLE'
  } elseif (-not $portInfo.matchesExe) {
    $ownerLabel = $(if ($portInfo.path) { $portInfo.path } else { 'unknown process' })
    $reason = "port $Port is owned by $ownerLabel (PID $($portInfo.pid))"
    $errorCode = 'HOST_UNREACHABLE'
  } else {
    $reason = 'debug port ownership verified'
  }

  @{
    ok = $true
    host = 'zcode'
    installed = $installed
    running = [bool]$selected
    selected = $selected
    processes = $items
    port = $portInfo
    ownership = $ownership
    debugPortFromCommandLine = $debugPortFromCommandLine
    reason = $reason
    errorCode = $errorCode
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
