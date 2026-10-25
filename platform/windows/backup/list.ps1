param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [string]$Kind = '',
  [int]$Limit = 50
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $directory = [System.IO.Path]::GetFullPath($Dir)
  if (-not (Test-Path -LiteralPath $directory)) {
    @{ ok = $true; dir = $directory; count = 0; items = @() } | ConvertTo-Json -Compress -Depth 6
  } else {
    $limit = [Math]::Min(500, [Math]::Max(1, $Limit))
    $items = @()
    $files = @(Get-ChildItem -LiteralPath $directory -File -Filter '*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    foreach ($file in $files) {
      if ($Kind -and -not $file.Name.StartsWith($Kind + '-')) { continue }
      $items += @{
        name = $file.Name
        path = $file.FullName
        bytes = $file.Length
        modifiedAt = $file.LastWriteTime.ToString('o')
      }
      if ($items.Count -ge $limit) { break }
    }
    @{ ok = $true; dir = $directory; count = $items.Count; items = $items } | ConvertTo-Json -Compress -Depth 6
  }
} catch {
  @{ ok = $false; error = @{ code = 'BACKUP_LIST_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
