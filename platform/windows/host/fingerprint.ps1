param(
  [int]$Port = 9229
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

$temp = $null
try {
  $targets = (& (Join-Path $PSScriptRoot 'cdp-targets.ps1') -Port $Port | Out-String | ConvertFrom-Json)
  if (-not $targets.ok -or -not $targets.target) {
    @{ ok = $false; error = @{ code = 'HOST_TARGET_MISSING'; message = $(if ($targets.error) { $targets.error.message } else { 'renderer target missing' }) } } | ConvertTo-Json -Compress -Depth 6
  } else {
    $expression = @'
(() => {
  const root = document.querySelector('#root');
  const html = document.documentElement;
  const body = document.body;
  const cs = getComputedStyle(html);
  return {
    url: location.href,
    title: document.title,
    ready: !!root && body.classList.contains('zcode-startup-ready'),
    loading: !!document.querySelector('[data-testid="root-startup-loading"]'),
    rootChildren: root ? root.children.length : 0,
    testidCount: document.querySelectorAll('[data-testid]').length,
    htmlClass: html.className,
    bodyClass: body.className,
    backgroundToken: cs.getPropertyValue('--color-background').trim(),
    foregroundToken: cs.getPropertyValue('--color-foreground').trim(),
    injected: !!document.getElementById('backdropbuddy-theme')
  };
})()
'@
    $temp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($temp, $expression, [System.Text.UTF8Encoding]::new($false))
    $evaluated = (& (Join-Path $PSScriptRoot 'cdp-eval.ps1') -Port $Port -ExpressionFile $temp -TimeoutMs 8000 | Out-String | ConvertFrom-Json)

    if (-not $evaluated.ok) {
      @{ ok = $false; error = $evaluated.error } | ConvertTo-Json -Compress -Depth 8
    } else {
      $page = $evaluated.result.result.value
      $material = "$($targets.target.id)|$($page.url)|$($page.title)|$($page.testidCount)|$($page.htmlClass)|$($page.rootChildren)"
      $sha = [System.Security.Cryptography.SHA256]::Create()
      try {
        $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($material))
        $fingerprint = ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
      } finally {
        $sha.Dispose()
      }
      @{
        ok = [bool]$page.ready
        target = $targets.target
        page = $page
        fingerprint = $fingerprint
        error = $(if (-not $page.ready) { @{ code = 'HOST_NOT_READY'; message = 'ZCode renderer is not ready (#root / zcode-startup-ready)' } } else { $null })
      } | ConvertTo-Json -Compress -Depth 8
    }
  }
} catch {
  @{ ok = $false; error = @{ code = 'FINGERPRINT_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
} finally {
  if ($temp -and (Test-Path -LiteralPath $temp)) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}
