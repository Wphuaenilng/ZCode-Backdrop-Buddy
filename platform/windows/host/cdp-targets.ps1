param(
  [int]$Port = 9229
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $base = "http://127.0.0.1:$Port"
  $version = Invoke-RestMethod -Uri "$base/json/version" -TimeoutSec 3 -UseBasicParsing
  $targets = Invoke-RestMethod -Uri "$base/json/list" -TimeoutSec 3 -UseBasicParsing

  $pages = @()
  foreach ($target in $targets) {
    if ($target.type -ne 'page') { continue }
    $pages += @{
      id = $target.id
      type = $target.type
      title = $target.title
      url = $target.url
      wsUrl = $target.webSocketDebuggerUrl
    }
  }

  $selected = $null
  foreach ($page in $pages) {
    if ($page.url -match 'out[\\/]renderer[\\/]index\.html') { $selected = $page; break }
  }

  @{
    ok = $true
    browser = $version.Browser
    userAgent = $version.'User-Agent'
    targetCount = $pages.Count
    target = $selected
    targets = $pages
    error = $(if (-not $selected) { @{ code = 'HOST_TARGET_MISSING'; message = 'debug port is open but no ZCode renderer page was found' } } else { $null })
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'CDP_UNREACHABLE'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
