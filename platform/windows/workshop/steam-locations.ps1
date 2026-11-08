param()

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Send-Json($value) {
  $value | ConvertTo-Json -Compress -Depth 5
}

try {
  $steamPath = $null

  # 1. Registry is the canonical source: Steam itself writes SteamPath on install.
  try {
    $key = Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -Name SteamPath -ErrorAction Stop
    if ($key.SteamPath) { $steamPath = [System.IO.Path]::GetFullPath(([string]$key.SteamPath).Trim()) }
  } catch { }

  $libraries = New-Object System.Collections.Generic.List[string]
  if ($steamPath) {
    $libraries.Add($steamPath)

    # 2. libraryfolders.vdf lists every additional Steam library. Modern builds
    #    keep it under steamapps\; older ones under config\. Parse both, dedupe.
    $vdfCandidates = @(
      (Join-Path $steamPath 'steamapps\libraryfolders.vdf'),
      (Join-Path $steamPath 'config\libraryfolders.vdf')
    )
    foreach ($vdf in $vdfCandidates) {
      if (-not (Test-Path -LiteralPath $vdf)) { continue }
      # vdf 是无 BOM 的 UTF-8：PS 5.1 的 Get-Content 默认按系统 ANSI 读，中文库路径会乱码
      foreach ($line in @(Get-Content -LiteralPath $vdf -Encoding UTF8 -ErrorAction SilentlyContinue)) {
        if ($line -match '"path"\s+"(.+?)"\s*$') {
          $library = $Matches[1].Replace('\\', '\').Trim()
          if (-not $library) { continue }
          try { $library = [System.IO.Path]::GetFullPath($library) } catch { continue }
          # List.Contains 是序数大小写比较，C:\Steam 与 c:\steam 会重复入库
          $dupe = $false
          foreach ($existing in $libraries) { if ($existing -ieq $library) { $dupe = $true; break } }
          if (-not $dupe) { $libraries.Add($library) }
        }
      }
      break
    }
  }

  Send-Json @{
    ok = $true
    found = [bool]$steamPath
    steamPath = $steamPath
    libraries = $libraries
  }
} catch {
  Send-Json @{
    ok = $false
    found = $false
    steamPath = $null
    libraries = @()
    error = @{ code = 'STEAM_LOCATE_FAILED'; message = $_.Exception.Message }
  }
}
