[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $keys = @(
    @{ path = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'; scope = 'machine-x86' },
    @{ path = 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'; scope = 'machine' },
    @{ path = 'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'; scope = 'user' }
  )

  $found = $null
  foreach ($key in $keys) {
    if (Test-Path $key.path) {
      $value = (Get-ItemProperty -Path $key.path -Name pv -ErrorAction SilentlyContinue).pv
      if ($value) {
        $found = @{ version = $value; scope = $key.scope; registry = $key.path }
        break
      }
    }
  }

  if ($found) {
    @{ ok = $true; version = $found.version; scope = $found.scope; registry = $found.registry } | ConvertTo-Json -Compress -Depth 6
  } else {
    @{ ok = $false; error = @{ code = 'WEBVIEW2_NOT_FOUND'; message = 'WebView2 Runtime is not installed for this user or machine' }; version = $null } | ConvertTo-Json -Compress -Depth 6
  }
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
