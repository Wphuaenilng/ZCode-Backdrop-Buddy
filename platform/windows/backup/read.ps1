param(
  [Parameter(Mandatory = $true)][string]$Path
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $file = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $file)) { throw "backup not found: $file" }
  $bytes = [System.IO.File]::ReadAllBytes($file)
  if ($bytes.Length -gt 1048576) { throw "backup exceeds 1 MiB: $($bytes.Length)" }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $data = $text | ConvertFrom-Json
  @{
    ok = $true
    path = $file
    bytes = $bytes.Length
    sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    data = $data
  } | ConvertTo-Json -Compress -Depth 12
} catch {
  @{ ok = $false; error = @{ code = 'BACKUP_READ_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
