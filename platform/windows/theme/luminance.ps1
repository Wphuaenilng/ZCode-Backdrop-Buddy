param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Size = 32
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Write-Failure([string]$Code, [string]$Message) {
  @{ ok = $false; error = @{ code = $Code; message = $Message } } | ConvertTo-Json -Compress -Depth 6
}

function Round4([double]$Value) {
  return [Math]::Round($Value, 4)
}

try {
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $full)) {
    Write-Failure 'LUMINANCE_MISSING' "image not found: $full"
    exit 0
  }
  if ($Size -lt 8 -or $Size -gt 128) { $Size = 32 }

  Add-Type -AssemblyName System.Drawing

  $source = $null
  $small = $null
  $graphics = $null
  try {
    $source = [System.Drawing.Bitmap]::FromFile($full)
    $small = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($small)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($source, 0, 0, $Size, $Size)
    $graphics.Dispose()
    $graphics = $null

    $values = New-Object 'double[]' ($Size * $Size)
    $sum = 0.0
    $centerSum = 0.0
    $centerCount = 0
    $highlight = 0
    $dark = 0
    $lo = [int][Math]::Floor($Size * 0.25)
    $hi = [int][Math]::Ceiling($Size * 0.75)

    for ($y = 0; $y -lt $Size; $y++) {
      for ($x = 0; $x -lt $Size; $x++) {
        $color = $small.GetPixel($x, $y)
        $luminance = (0.2126 * $color.R + 0.7152 * $color.G + 0.0722 * $color.B) / 255.0
        $index = $y * $Size + $x
        $values[$index] = $luminance
        $sum += $luminance
        if ($luminance -gt 0.8) { $highlight++ }
        if ($luminance -lt 0.2) { $dark++ }
        if ($x -ge $lo -and $x -lt $hi -and $y -ge $lo -and $y -lt $hi) {
          $centerSum += $luminance
          $centerCount++
        }
      }
    }
  } finally {
    if ($graphics) { $graphics.Dispose() }
    if ($small) { $small.Dispose() }
    if ($source) { $source.Dispose() }
  }

  $sorted = @($values | Sort-Object)
  $count = $sorted.Count
  function Percentile([double]$Ratio) {
    $index = [int][Math]::Floor($Ratio * ($count - 1))
    if ($index -lt 0) { return 0.0 }
    if ($index -ge $count) { return [double]$sorted[$count - 1] }
    return [double]$sorted[$index]
  }

  $columns = 4
  $rows = 3
  $grid = @()
  for ($row = 0; $row -lt $rows; $row++) {
    $y0 = [int][Math]::Floor($row * $Size / $rows)
    $y1 = [int][Math]::Floor(($row + 1) * $Size / $rows)
    for ($column = 0; $column -lt $columns; $column++) {
      $x0 = [int][Math]::Floor($column * $Size / $columns)
      $x1 = [int][Math]::Floor(($column + 1) * $Size / $columns)
      $total = 0.0
      $n = 0
      for ($y = $y0; $y -lt $y1; $y++) {
        for ($x = $x0; $x -lt $x1; $x++) {
          $total += $values[$y * $Size + $x]
          $n++
        }
      }
      $grid += $(if ($n -gt 0) { Round4 ($total / $n) } else { 0.0 })
    }
  }

  @{
    ok = $true
    size = $Size
    mean = (Round4 ($sum / $values.Length))
    center = (Round4 ($(if ($centerCount -gt 0) { $centerSum / $centerCount } else { 0.0 })))
    p50 = (Round4 (Percentile 0.50))
    p15 = (Round4 (Percentile 0.15))
    p75 = (Round4 (Percentile 0.75))
    p85 = (Round4 (Percentile 0.85))
    p90 = (Round4 (Percentile 0.90))
    p99 = (Round4 (Percentile 0.99))
    highlight = (Round4 ($highlight / $values.Length))
    dark = (Round4 ($dark / $values.Length))
    grid = $grid
  } | ConvertTo-Json -Compress -Depth 6
} catch {
  Write-Failure 'LUMINANCE_FAILED' $_.Exception.Message
}
