param(
  [int]$Port = 9229
)

# 查询"谁在监听这个端口"：返回监听进程与其祖先链的可执行路径（最多 8 级）。
# Electron 宿主：监听者就是应用 exe；WebView2 宿主（Tauri 等）：监听者是
# msedgewebview2 子进程，真正的应用在祖先链上。内核按链挑出应用本体。

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Resolve-ProcessPath([int]$ProcessId) {
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    if ($process.Path) { return [System.IO.Path]::GetFullPath($process.Path) }
  } catch { }
  return $null
}

try {
  $listeners = @()
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
  } catch {
    $listeners = @()
  }
  if ($listeners.Count -eq 0) {
    @{ ok = $false; error = "no listener on $Port" } | ConvertTo-Json -Compress
    exit 0
  }

  $listenerPid = [int]($listeners | Select-Object -First 1).OwningProcess
  $paths = @()
  $current = $listenerPid
  for ($depth = 0; $depth -lt 8 -and $current -gt 0; $depth++) {
    $path = Resolve-ProcessPath $current
    if ($path) { $paths += $path }
    try { $process = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction Stop } catch { break }
    if (-not $process) { break }
    $current = [int]$process.ParentProcessId
    if ($paths.Count -ge 5) { break }
  }

  @{
    ok    = $true
    port  = $Port
    pid   = $listenerPid
    paths = $paths
  } | ConvertTo-Json -Compress
  exit 0
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 0
}
