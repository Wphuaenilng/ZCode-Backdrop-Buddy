param(
  [int]$Port = 9229,
  [string]$UrlPattern = 'out[\\/]renderer[\\/]index\.html'
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  try { $null = ('' -match $UrlPattern) } catch {
    @{ ok = $false; error = @{ code = 'BAD_URL_PATTERN'; message = "invalid -UrlPattern regex: $UrlPattern" } } | ConvertTo-Json -Compress -Depth 6
    return
  }

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
    if ($page.url -match $UrlPattern) { $selected = $page; break }
  }

  @{
    ok = $true
    browser = $version.Browser
    userAgent = $version.'User-Agent'
    targetCount = $pages.Count
    target = $selected
    targets = $pages
    error = $(if (-not $selected) { @{ code = 'HOST_TARGET_MISSING'; message = "debug port is open but no renderer page matched pattern: $UrlPattern" } } else { $null })
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'CDP_UNREACHABLE'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
