param(
  [Parameter(Mandatory = $true)][string]$HostRoot,
  [int]$MaxFiles = 5000
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $root = [System.IO.Path]::GetFullPath($HostRoot)
  if (-not (Test-Path -LiteralPath $root)) { throw "host root not found: $root" }

  $targets = @()
  foreach ($name in @('ZCode.exe', 'resources\app.asar', 'resources\app-update.yml', 'resources\elevate.exe')) {
    $candidate = Join-Path $root $name
    if (Test-Path -LiteralPath $candidate) { $targets += Get-Item -LiteralPath $candidate }
  }
  $unpacked = Join-Path $root 'resources\app.asar.unpacked'
  if (Test-Path -LiteralPath $unpacked) {
    $targets += @(Get-ChildItem -LiteralPath $unpacked -Recurse -File -ErrorAction SilentlyContinue)
  }

  $targets = @($targets | Sort-Object FullName)
  if ($targets.Count -eq 0) { throw "no host files found under $root" }

  $truncated = $false
  if ($targets.Count -gt $MaxFiles) {
    $targets = @($targets[0..($MaxFiles - 1)])
    $truncated = $true
  }

  $entries = @()
  $bytes = 0
  foreach ($file in $targets) {
    $relative = $file.FullName.Substring($root.Length).TrimStart('\', '/') -replace '\\', '/'
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $bytes += $file.Length
    $entries += @{ path = $relative; bytes = $file.Length; sha256 = $hash }
  }

  $material = (($entries | Sort-Object path | ForEach-Object { "$($_.path):$($_.sha256)" }) -join "`n")
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $aggregate = ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($material))) -replace '-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }

  @{
    ok = $true
    root = $root
    count = $entries.Count
    bytes = $bytes
    truncated = $truncated
    complete = (-not $truncated)
    aggregate = $aggregate
    files = $entries
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'HOST_HASH_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
