param(
  [Parameter(Mandatory = $true)][string]$Path
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $file = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $file)) { throw "snapshot not found: $file" }
  $bytes = [System.IO.File]::ReadAllBytes($file)
  if ($bytes.Length -gt 1048576) { throw 'snapshot exceeds 1 MiB' }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $data = $text | ConvertFrom-Json

  $errors = @()
  if ($data.schema -ne 'backdropbuddy.snapshot/1') { $errors += 'schema must be backdropbuddy.snapshot/1' }
  if (-not $data.host -or $data.host -ne 'zcode') { $errors += 'host must be zcode' }
  if (-not $data.capturedAt) { $errors += 'capturedAt is required' }
  if (-not $data.baseline) { $errors += 'baseline is required' }
  if ($data.baseline -and -not ($data.baseline.htmlClass -ne $null)) { $errors += 'baseline.htmlClass is required' }

  @{
    ok = $true
    valid = ($errors.Count -eq 0)
    path = $file
    bytes = $bytes.Length
    sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    capturedAt = $data.capturedAt
    host = $data.host
    themeId = $data.themeId
    injectedBefore = [bool]($data.baseline -and $data.baseline.injected -and $data.baseline.injected.style)
    errors = $errors
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'SNAPSHOT_INVALID'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
