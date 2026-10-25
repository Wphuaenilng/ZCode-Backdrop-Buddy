param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [ValidateSet('snapshot', 'restore', 'other')][string]$Kind = 'snapshot',
  [Parameter(Mandatory = $true)][string]$DataFile,
  [string]$Name = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $directory = [System.IO.Path]::GetFullPath($Dir)
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $dataPath = [System.IO.Path]::GetFullPath($DataFile)
  if (-not (Test-Path -LiteralPath $dataPath)) { throw "data file not found: $dataPath" }

  $content = [System.IO.File]::ReadAllText($dataPath, [System.Text.Encoding]::UTF8)
  if ($content.Length -gt 1048576) { throw "data exceeds 1 MiB: $($content.Length) chars" }
  $null = $content | ConvertFrom-Json

  if ($Name) {
    $leaf = [System.IO.Path]::GetFileName($Name)
    if ($leaf -ne $Name) { throw "name must not contain a path: $Name" }
  } else {
    $leaf = "$Kind-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json'
  }
  if (-not $leaf.ToLowerInvariant().EndsWith('.json')) { $leaf = $leaf + '.json' }

  $target = [System.IO.Path]::GetFullPath((Join-Path $directory $leaf))
  if (-not $target.StartsWith($directory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "target escapes backup directory: $target"
  }

  $temp = Join-Path $directory ('.write-' + [guid]::NewGuid().ToString('n') + '.tmp')
  try {
    [System.IO.File]::WriteAllText($temp, $content, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $target -Force
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
  }

  $bytes = (Get-Item -LiteralPath $target).Length
  $sha = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  @{ ok = $true; kind = $Kind; path = $target; bytes = $bytes; sha256 = $sha } | ConvertTo-Json -Compress -Depth 6
} catch {
  @{ ok = $false; error = @{ code = 'BACKUP_WRITE_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
