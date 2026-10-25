param(
  [string]$Json = '',
  [string]$Path = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Clamp-Number([object]$Value, [double]$Min, [double]$Max, [double]$Fallback) {
  if ($null -eq $Value) { return $Fallback }
  try { $number = [double]$Value } catch { return $Fallback }
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $Fallback }
  return [Math]::Min($Max, [Math]::Max($Min, $number))
}

try {
  if ($Path) {
    $text = [System.IO.File]::ReadAllText([System.IO.Path]::GetFullPath($Path), [System.Text.Encoding]::UTF8)
  } else {
    $text = $Json
  }
  $data = $text | ConvertFrom-Json
  $errors = @()

  $mode = $(if ($data.mode -in @('auto', 'cover', 'contain', 'stretch')) { $data.mode } else { 'auto' })
  $safe = $(if ($data.safe -in @('auto', 'left', 'right', 'center')) { $data.safe } else { 'auto' })
  $task = $(if ($data.task -in @('auto', 'ambient', 'focus')) { $data.task } else { 'auto' })
  $accent = [string]$data.accent
  if ($accent -notmatch '^#[0-9a-fA-F]{6}$') { $errors += "accent must be #rrggbb: $accent"; $accent = '#6F9275' }

  $normalized = @{
    mode = $mode
    x = (Clamp-Number $data.x 0 100 50)
    y = (Clamp-Number $data.y 0 100 50)
    zoom = (Clamp-Number $data.zoom 100 220 100)
    hpos = (Clamp-Number $data.hpos 0 100 0)
    safe = $safe
    task = $task
    bubble = (Clamp-Number $data.bubble 0 100 0)
    panel = (Clamp-Number $data.panel 0 100 30)
    accent = $accent.ToLowerInvariant()
    lock = [bool]$data.lock
    custom = [bool]$data.custom
  }

  @{ ok = $true; valid = ($errors.Count -eq 0); params = $normalized; errors = $errors } | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'PARAMS_INVALID'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
