param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [string]$Root = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $manifestPath = [System.IO.Path]::GetFullPath($Manifest)
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw "manifest not found: $manifestPath" }
  if ($Root) {
    $root = [System.IO.Path]::GetFullPath($Root)
  } else {
    $root = [System.IO.Path]::GetDirectoryName($manifestPath)
  }

  $data = ([System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
  if (-not $data.files -or $data.files.Count -eq 0) { throw 'manifest.files is required' }

  $checked = @()
  $mismatches = @()
  $missing = @()
  foreach ($entry in $data.files) {
    if (-not $entry.path -or -not $entry.sha256) { $missing += 'entry missing path or sha256'; continue }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $entry.path))
    if (-not $candidate.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      $mismatches += @{ path = $entry.path; reason = 'path escapes root' }
      continue
    }
    if (-not (Test-Path -LiteralPath $candidate)) { $missing += $entry.path; continue }
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = ([string]$entry.sha256).ToLowerInvariant()
    $checked += @{ path = $entry.path; ok = ($actual -eq $expected) }
    if ($actual -ne $expected) { $mismatches += @{ path = $entry.path; expected = $expected; actual = $actual } }
  }

  @{
    ok = ($mismatches.Count -eq 0 -and $missing.Count -eq 0)
    root = $root
    checked = $checked.Count
    mismatches = $mismatches
    missing = $missing
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'HASH_VERIFY_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
