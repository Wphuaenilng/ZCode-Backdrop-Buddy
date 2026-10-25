param(
  [string]$Accent = '#6F9275',
  [ValidateSet('light', 'dark')][string]$Mode = 'light',
  [double]$Panel = 30,
  [double]$Bubble = 0,
  [double]$Mean = 0.5,
  [double]$Center = 0.5,
  [double]$P15 = 0.2,
  [double]$P75 = 0.6,
  [double]$P85 = 0.75,
  [double]$P90 = 0.75,
  [double]$P99 = 0.85,
  [double]$Highlight = 0.1
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

function Format-Alpha([double]$Value) {
  return ([Math]::Round($Value, 2)).ToString('0.00', [System.Globalization.CultureInfo]::InvariantCulture)
}

function New-Rgba([int]$R, [int]$G, [int]$B, [double]$Alpha) {
  return ('rgba({0},{1},{2},{3})' -f $R, $G, $B, (Format-Alpha $Alpha))
}

function Clamp([double]$Value, [double]$Min, [double]$Max) {
  return [Math]::Min($Max, [Math]::Max($Min, $Value))
}

function Inverse-Srgb([double]$Y) {
  if ($Y -le 0.0031308) { return $Y * 12.92 }
  return 1.055 * [Math]::Pow($Y, 1.0 / 2.4) - 0.055
}

function New-Tokens([string]$TokenMode, [double]$DimAlpha, [double]$PanelAlpha, [double]$BubbleValue, [double]$AccentR, [double]$AccentG, [double]$AccentB, [string]$Contrast, [int]$AccentR8, [int]$AccentG8, [int]$AccentB8) {
  $isDark = $TokenMode -eq 'dark'
  $r = $(if ($isDark) { 18 } else { 255 })
  $g = $(if ($isDark) { 18 } else { 255 })
  $b = $(if ($isDark) { 20 } else { 255 })

  $sidebarAlpha = Clamp ($PanelAlpha + $(if ($isDark) { 0.16 } else { 0.02 })) $(if ($isDark) { 0.30 } else { 0.10 }) $(if ($isDark) { 0.62 } else { 0.55 })
  $headerAlpha = Clamp ($PanelAlpha + $(if ($isDark) { 0.13 } else { 0.01 })) $(if ($isDark) { 0.28 } else { 0.08 }) $(if ($isDark) { 0.58 } else { 0.50 })
  $cardFloor = $(if ($isDark) { 0.62 } else { 0.66 })
  $inputFloor = $(if ($isDark) { 0.66 } else { 0.70 })
  $cardCap = $(if ($isDark) { 0.80 } else { 0.86 })
  $inputCap = $(if ($isDark) { 0.84 } else { 0.90 })
  $cardAlpha = Clamp ($PanelAlpha + 0.14 + $BubbleValue * 0.10) $cardFloor $cardCap
  $inputAlpha = Clamp ($PanelAlpha + 0.18 + $BubbleValue * 0.10) $inputFloor $inputCap
  $popoverAlpha = $(if ($isDark) { 0.97 } else { 0.98 })
  $surfaceAlpha = Clamp (0.10 + $PanelAlpha * 0.30) 0.10 0.55
  $surfaceHoverAlpha = Clamp (0.16 + $PanelAlpha * 0.34) 0.16 0.65

  $foreground = $(if ($isDark) { '#e8e8ea' } else { '#1c1c1e' })
  $foregroundSubtle = $(if ($isDark) { 'rgba(232,232,234,0.78)' } else { 'rgba(28,28,30,0.72)' })
  $foregroundSubtlest = $(if ($isDark) { 'rgba(232,232,234,0.62)' } else { 'rgba(28,28,30,0.58)' })
  $border = $(if ($isDark) { 'rgba(255,255,255,0.18)' } else { 'rgba(0,0,0,0.12)' })
  $cardBorder = $(if ($isDark) { 'rgba(255,255,255,0.20)' } else { 'rgba(0,0,0,0.14)' })
  $inputBorder = $(if ($isDark) { 'rgba(255,255,255,0.22)' } else { 'rgba(0,0,0,0.16)' })
  $popoverBorder = $(if ($isDark) { 'rgba(255,255,255,0.18)' } else { 'rgba(0,0,0,0.12)' })
  $popoverForeground = $(if ($isDark) { '#f0f0f2' } else { '#1c1c1e' })

  return @{
    panel = (New-Rgba $r $g $b $PanelAlpha)
    sidebar = (New-Rgba $r $g $b $sidebarAlpha)
    header = (New-Rgba $r $g $b $headerAlpha)
    card = (New-Rgba $r $g $b $cardAlpha)
    popover = (New-Rgba $r $g $b $popoverAlpha)
    input = (New-Rgba $r $g $b $inputAlpha)
    surface = (New-Rgba $r $g $b $surfaceAlpha)
    surfaceHover = (New-Rgba $r $g $b $surfaceHoverAlpha)
    selected = (New-Rgba $AccentR8 $AccentG8 $AccentB8 0.22)
    accentSoft = (New-Rgba $AccentR8 $AccentG8 $AccentB8 0.16)
    terminal = (New-Rgba $r $g $b 1.0)
    scrim = (New-Rgba $r $g $b (Clamp ($DimAlpha * 0.75) 0.06 0.55))
    dim = (New-Rgba $r $g $b $DimAlpha)
    foreground = $foreground
    foregroundSubtle = $foregroundSubtle
    foregroundSubtlest = $foregroundSubtlest
    border = $border
    cardBorder = $cardBorder
    inputBorder = $inputBorder
    popoverBorder = $popoverBorder
    popoverForeground = $popoverForeground
    tooltipForeground = $popoverForeground
    contrast = $Contrast
  }
}

try {
  if ($Accent -notmatch '^#[0-9a-fA-F]{6}$') { throw "invalid accent: $Accent" }

  $panelValue = Clamp ($Panel / 100) 0 1
  $bubbleValue = Clamp ($Bubble / 100) 0 1
  $risk = Clamp (0.25 * $Center + 0.35 * $P75 + 0.40 * $P90) 0 1

  $accentR = [Convert]::ToInt32($Accent.Substring(1, 2), 16)
  $accentG = [Convert]::ToInt32($Accent.Substring(3, 2), 16)
  $accentB = [Convert]::ToInt32($Accent.Substring(5, 2), 16)
  $luminance = (0.2126 * $accentR + 0.7152 * $accentG + 0.0722 * $accentB) / 255
  $contrast = $(if ($luminance -gt 0.45) { '#000000' } else { '#ffffff' })

  $targetDark = (Inverse-Srgb ([Math]::Max(0.02, ((0.807 + 0.05) / 4.5) - 0.05))) * 255
  $targetLight = (Inverse-Srgb (((0.0117 + 0.05) * 4.5) - 0.05)) * 255

  $peak = $P90 * 255
  $darkA = $(if ($peak -le $targetDark) { 0.10 } else { ($peak - $targetDark) / ($peak - 18) })
  $darkA = Clamp $darkA 0.10 0.74
  $darkDim = Clamp ($darkA * 0.35) 0.08 0.30
  $darkPanel = Clamp ([Math]::Max((($darkA - $darkDim) / (1 - $darkDim)), $panelValue)) 0.16 0.92

  $shadow = $P15 * 255
  $lightA = $(if ($shadow -ge $targetLight) { 0.06 } else { ($targetLight - $shadow) / (255 - $shadow) })
  $lightA = Clamp $lightA 0.06 0.55
  $lightLift = Clamp ($lightA * 0.45) 0.03 0.24
  $lightPanel = Clamp ([Math]::Max((($lightA - $lightLift) / (1 - $lightLift)), $panelValue)) 0.03 0.92

  $dark = New-Tokens 'dark' $darkDim $darkPanel $bubbleValue 0 0 0 $contrast $accentR $accentG $accentB
  $light = New-Tokens 'light' $lightLift $lightPanel $bubbleValue 0 0 0 $contrast $accentR $accentG $accentB

  $current = $(if ($Mode -eq 'dark') { $dark } else { $light })
  $output = @{}
  foreach ($key in $current.Keys) { $output[$key] = $current[$key] }
  $output.ok = $true
  $output.mode = $Mode
  $output.luminance = @{
    mean = [Math]::Round($Mean, 4)
    center = [Math]::Round($Center, 4)
    p15 = [Math]::Round($P15, 4)
    p75 = [Math]::Round($P75, 4)
    p85 = [Math]::Round($P85, 4)
    p90 = [Math]::Round($P90, 4)
    p99 = [Math]::Round($P99, 4)
    highlight = [Math]::Round($Highlight, 4)
    risk = [Math]::Round($risk, 4)
    darkA = [Math]::Round($darkA, 4)
    lightA = [Math]::Round($lightA, 4)
    darkDim = [Math]::Round($darkDim, 4)
    darkPanel = [Math]::Round($darkPanel, 4)
    lightLift = [Math]::Round($lightLift, 4)
    lightPanel = [Math]::Round($lightPanel, 4)
  }
  $output.light = $light
  $output.dark = $dark
  $output | ConvertTo-Json -Compress -Depth 8
} catch {
  @{ ok = $false; error = @{ code = 'COLOR_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
