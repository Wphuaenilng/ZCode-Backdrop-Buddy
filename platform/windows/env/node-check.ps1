param(
  [string]$NodePath = '',
  [string]$Expected = 'v22.22.2'
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  if ($NodePath) {
    $path = [System.IO.Path]::GetFullPath($NodePath)
  } else {
    $path = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path 'runtime\node\node.exe'
  }

  if (-not (Test-Path -LiteralPath $path)) {
    @{ ok = $false; error = @{ code = 'NODE_NOT_FOUND'; message = "node.exe not found: $path" }; path = $path } | ConvertTo-Json -Compress -Depth 6
  } else {
    $version = (& $path --version 2>$null | Out-String).Trim()
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    @{
      ok = ($version -eq $Expected)
      expected = $Expected
      version = $version
      path = $path
      bytes = (Get-Item -LiteralPath $path).Length
      sha256 = $hash
      error = $(if ($version -ne $Expected) { @{ code = 'NODE_VERSION'; message = "expected $Expected, got $version" } } else { $null })
    } | ConvertTo-Json -Compress -Depth 6
  }
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
