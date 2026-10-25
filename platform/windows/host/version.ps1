param(
  [string]$ExePath = 'F:\shop\ZCode\ZCode.exe'
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $exe = [System.IO.Path]::GetFullPath($ExePath)
  if (-not (Test-Path -LiteralPath $exe)) {
    @{ ok = $false; error = @{ code = 'HOST_NOT_FOUND'; message = "ZCode.exe not found: $exe" }; path = $exe } | ConvertTo-Json -Compress -Depth 6
  } else {
    $item = Get-Item -LiteralPath $exe
    $info = $item.VersionInfo
    @{
      ok = $true
      path = $exe
      fileVersion = $info.FileVersion
      productVersion = $info.ProductVersion
      company = $info.CompanyName
      product = $info.ProductName
      bytes = $item.Length
      sha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
      supported = ([version]($info.FileVersion -replace '[^0-9.].*$', '') -ge [version]'3.0.0')
    } | ConvertTo-Json -Compress -Depth 6
  }
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
