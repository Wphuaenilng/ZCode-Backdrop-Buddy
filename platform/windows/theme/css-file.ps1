param(
  [Parameter(Mandatory = $true)][string]$ContentFile,
  [Parameter(Mandatory = $true)][string]$Dest
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $contentPath = [System.IO.Path]::GetFullPath($ContentFile)
  if (-not (Test-Path -LiteralPath $contentPath)) { throw "content file not found: $contentPath" }
  $bytes = [System.IO.File]::ReadAllBytes($contentPath)
  if ($bytes.Length -eq 0) { throw 'content is empty' }
  # 全量皮肤契约（WorkBuddy 648+ 变量明暗两套）约 400KB；护栏放到 1MB
  if ($bytes.Length -gt 1048576) { throw "content exceeds 1048576 bytes: $($bytes.Length)" }

  $target = [System.IO.Path]::GetFullPath($Dest)
  $directory = [System.IO.Path]::GetDirectoryName($target)
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }

  $temp = Join-Path $directory ('.css-' + [guid]::NewGuid().ToString('n') + '.tmp')
  try {
    [System.IO.File]::WriteAllBytes($temp, $bytes)
    Move-Item -LiteralPath $temp -Destination $target -Force
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
  }

  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  @{ ok = $true; path = $target; bytes = $bytes.Length; sha256 = $hash } | ConvertTo-Json -Compress -Depth 6
} catch {
  @{ ok = $false; error = @{ code = 'CSS_WRITE_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
