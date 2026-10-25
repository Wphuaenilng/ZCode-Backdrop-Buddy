param(
  [int]$Port = 9229,
  [string]$ExePath = 'F:\shop\ZCode\ZCode.exe'
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

# WebView2 hosts (Tauri / WinUI / .NET WebView2) listen on a msedgewebview2.exe child.
# Walk the ancestor chain to tell whether this port was spawned by the target exe.
function Find-AncestorPath([int]$ProcessId, [string]$Exe) {
  $current = $ProcessId
  for ($depth = 0; $depth -lt 8 -and $current -gt 0; $depth++) {
    $path = Resolve-ProcessPath $current
    if ($path -and ($path -ieq $Exe)) { return $path }
    try { $process = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction Stop } catch { return $null }
    if (-not $process) { return $null }
    $current = [int]$process.ParentProcessId
  }
  return $null
}

try {
  $exe = [System.IO.Path]::GetFullPath($ExePath)
  $listeners = @()
  $source = 'Get-NetTCPConnection'
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
  } catch {
    $listeners = @()
    $source = 'netstat'
  }

  if ($listeners.Count -eq 0 -and $source -eq 'netstat') {
    $rows = @()
    foreach ($line in @(netstat -ano -p tcp 2>$null)) {
      $text = [string]$line
      if ($text -notmatch 'LISTENING') { continue }
      $parts = ($text -split '\s+') | Where-Object { $_ -ne '' }
      if ($parts.Count -lt 5) { continue }
      $local = $parts[1]
      if ($local -notmatch (':' + $Port + '$')) { continue }
      $rows += @{ address = $local.Substring(0, $local.LastIndexOf(':')); pid = [int]$parts[$parts.Count - 1] }
    }
    $listeners = $rows
  }

  $items = @()
  foreach ($listener in $listeners) {
    if ($listener.PSObject.Properties.Name -contains 'OwningProcess') {
      $owner = [int]$listener.OwningProcess
      $address = [string]$listener.LocalAddress
    } else {
      $owner = [int]$listener.pid
      $address = [string]$listener.address
    }
    $path = Resolve-ProcessPath $owner
    $ancestor = $null
    if (-not ($path -and ($path -ieq $exe))) { $ancestor = Find-AncestorPath -ProcessId $owner -Exe $exe }
    $items += @{
      pid = $owner
      address = $address
      loopback = ($address -eq '127.0.0.1' -or $address -eq '::1' -or $address -eq '[::1]')
      path = $path
      matchesExe = [bool](($path -and ($path -ieq $exe)) -or $ancestor)
      ancestor = $ancestor
    }
  }

  $loopbackOnly = $true
  foreach ($item in $items) { if (-not $item.loopback) { $loopbackOnly = $false } }
  $ownerItem = $(if ($items.Count -gt 0) { $items[0] } else { $null })

  @{
    ok = $true
    port = $Port
    listening = ($items.Count -gt 0)
    source = $source
    loopbackOnly = $loopbackOnly
    owner = $ownerItem
    listeners = $items
    matchesExe = [bool]($ownerItem -and $ownerItem.matchesExe)
    error = $(if ($items.Count -eq 0) { @{ code = 'PORT_CLOSED'; message = "no listener on 127.0.0.1:$Port" } } elseif (-not $ownerItem.matchesExe) { @{ code = 'PORT_OWNED_BY_OTHER'; message = "port $Port is owned by $($ownerItem.path)" } } else { $null })
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
