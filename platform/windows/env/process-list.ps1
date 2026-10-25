param(
  [string]$Name = 'ZCode.exe'
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $items = @()
  $processes = @()
  try {
    $processes = Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction Stop
  } catch {
    $processes = @()
  }

  foreach ($process in $processes) {
    $path = $process.ExecutablePath
    if (-not $path) {
      try { $path = (Get-Process -Id $process.ProcessId -ErrorAction Stop).Path } catch { $path = $null }
    }
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

  @{
    ok = $true
    name = $Name
    count = $items.Count
    processes = $items
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
