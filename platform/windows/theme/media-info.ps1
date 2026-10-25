param(
  [Parameter(Mandatory = $true)][string]$Path
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $file = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $file)) {
    @{ ok = $false; error = @{ code = 'FILE_NOT_FOUND'; message = "media not found: $file" }; path = $file } | ConvertTo-Json -Compress -Depth 6
  } else {
    $item = Get-Item -LiteralPath $file
    $header = New-Object byte[] 16
    $stream = [System.IO.File]::OpenRead($file)
    try {
      $read = $stream.Read($header, 0, $header.Length)
    } finally {
      $stream.Dispose()
    }

    $kind = 'unknown'
    if ($read -ge 3 -and $header[0] -eq 0xFF -and $header[1] -eq 0xD8 -and $header[2] -eq 0xFF) { $kind = 'image' }
    elseif ($read -ge 8 -and $header[0] -eq 0x89 -and $header[1] -eq 0x50 -and $header[2] -eq 0x4E -and $header[3] -eq 0x47) { $kind = 'image' }
    elseif ($read -ge 12 -and [System.Text.Encoding]::ASCII.GetString($header, 0, 4) -eq 'RIFF' -and [System.Text.Encoding]::ASCII.GetString($header, 8, 4) -eq 'WEBP') { $kind = 'image' }
    elseif ($read -ge 12 -and [System.Text.Encoding]::ASCII.GetString($header, 4, 4) -eq 'ftyp') { $kind = 'video' }
    elseif ($read -ge 4 -and $header[0] -eq 0x1A -and $header[1] -eq 0x45 -and $header[2] -eq 0xDF -and $header[3] -eq 0xA3) { $kind = 'video' }

    @{
      ok = ($kind -ne 'unknown')
      path = $file
      kind = $kind
      extension = $item.Extension.ToLowerInvariant()
      bytes = $item.Length
      sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
      error = $(if ($kind -eq 'unknown') { @{ code = 'MEDIA_INVALID'; message = 'unrecognised media signature' } } else { $null })
    } | ConvertTo-Json -Compress -Depth 6
  }
} catch {
  @{ ok = $false; error = @{ code = 'MEDIA_INVALID'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
