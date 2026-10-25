param(
  [string]$Name = 'ZCode.exe'
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Send-Json($value) {
  $value | ConvertTo-Json -Compress -Depth 5
}

try {
  $foundPath = $null
  $source = $null

  # 1. A running process is the most reliable source: it is the exact binary
  #    the user is looking at, even for portable installs.
  try {
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction Stop)) {
      $candidate = $process.ExecutablePath
      if (-not $candidate) {
        try { $candidate = (Get-Process -Id ([int]$process.ProcessId) -ErrorAction Stop).Path } catch { $candidate = $null }
      }
      if ($candidate -and (Test-Path -LiteralPath $candidate)) {
        $foundPath = [System.IO.Path]::GetFullPath($candidate)
        $source = 'process'
        break
      }
    }
  } catch { }

  # 2. Uninstall entries cover the normal per-user and machine installers.
  if (-not $foundPath) {
    $roots = @(
      'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($root in $roots) {
      foreach ($entry in @(Get-ItemProperty -Path $root -ErrorAction SilentlyContinue)) {
        if ($entry.DisplayName -notmatch 'ZCode') { continue }
        $candidates = @()
        if ($entry.InstallLocation) { $candidates += (Join-Path ([string]$entry.InstallLocation) $Name) }
        if ($entry.DisplayIcon) {
          $icon = ([string]$entry.DisplayIcon).Trim().Trim('"')
          $icon = ($icon -split ',')[0].Trim().Trim('"')
          if ($icon) {
            $candidates += $icon
            $iconDir = Split-Path -Parent $icon
            if ($iconDir) { $candidates += (Join-Path $iconDir $Name) }
          }
        }
        if ($entry.UninstallString) {
          $uninstall = ([string]$entry.UninstallString).Trim()
          if ($uninstall -match '^"([^"]+)"') { $uninstall = $Matches[1] }
          else { $uninstall = ($uninstall -split ' ')[0] }
          $uninstallDir = Split-Path -Parent $uninstall
          if ($uninstallDir) { $candidates += (Join-Path $uninstallDir $Name) }
        }
        foreach ($candidate in $candidates) {
          if (-not $candidate) { continue }
          if ((Split-Path -Leaf $candidate) -ine $Name) { continue }
          if (Test-Path -LiteralPath $candidate) {
            $foundPath = [System.IO.Path]::GetFullPath($candidate)
            $source = 'registry'
            break
          }
        }
        if ($foundPath) { break }
      }
      if ($foundPath) { break }
    }
  }

  # 3. Start Menu shortcuts are a last resort for installs without registry data.
  if (-not $foundPath) {
    $shell = $null
    try { $shell = New-Object -ComObject WScript.Shell } catch { $shell = $null }
    if ($shell) {
      $startRoots = @(
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
        (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
      )
      foreach ($root in $startRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($shortcut in @(Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
          try {
            $target = $shell.CreateShortcut($shortcut.FullName).TargetPath
            if ($target -and ((Split-Path -Leaf $target) -ieq $Name) -and (Test-Path -LiteralPath $target)) {
              $foundPath = [System.IO.Path]::GetFullPath($target)
              $source = 'shortcut'
              break
            }
          } catch { }
        }
        if ($foundPath) { break }
      }
    }
  }

  Send-Json @{
    ok = $true
    found = [bool]$foundPath
    path = $foundPath
    source = $source
  }
} catch {
  Send-Json @{
    ok = $false
    found = $false
    path = $null
    source = $null
    error = @{ code = 'FIND_FAILED'; message = $_.Exception.Message }
  }
}
