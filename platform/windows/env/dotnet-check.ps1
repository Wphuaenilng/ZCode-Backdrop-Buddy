[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $key = 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full'
  if (-not (Test-Path $key)) {
    @{ ok = $false; error = @{ code = 'DOTNET_NOT_FOUND'; message = '.NET Framework 4.x is not installed' }; release = $null } | ConvertTo-Json -Compress -Depth 6
  } else {
    $release = [int](Get-ItemProperty -Path $key -Name Release -ErrorAction SilentlyContinue).Release
    $version = 'unknown'
    if ($release -ge 533320) { $version = '4.8.1+' }
    elseif ($release -ge 528040) { $version = '4.8' }
    elseif ($release -ge 461808) { $version = '4.7.2' }
    elseif ($release -ge 460798) { $version = '4.7' }
    elseif ($release -ge 394802) { $version = '4.6.2' }
    else { $version = 'below 4.6.2' }

    $ok = ($release -ge 528040)
    @{
      ok = $ok
      release = $release
      version = $version
      requiredRelease = 528040
      error = $(if (-not $ok) { @{ code = 'DOTNET_UNSUPPORTED'; message = ".NET Framework 4.8 required, found release $release" } } else { $null })
    } | ConvertTo-Json -Compress -Depth 6
  }
} catch {
  @{ ok = $false; error = @{ code = 'PS_ERROR'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
