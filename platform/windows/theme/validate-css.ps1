param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$MaxBytes = 262144,
  [string]$ExtraSelectors = ''
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

$extraSelectorList = @()
if ($ExtraSelectors) { $extraSelectorList = @($ExtraSelectors.Split('|') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }

function Test-AllowedSelector([string]$Selector) {
  $value = $Selector.Trim()
  if ($extraSelectorList -contains $value) { return $true }
  if ($value -eq ':root' -or $value -eq 'html' -or $value -eq 'body' -or $value -eq '#root') { return $true }
  if ($value -match '^html\.(dark|light|theme-[a-z0-9-]+)$') { return $true }
  if ($value -match '^#backdropbuddy-[a-z0-9-]+(::[a-z-]+)?$') { return $true }
  if ($value -match '^\[class~="[A-Za-z0-9:_\-\/\[\]]+"\](::[a-z-]+)?$') { return $true }
  return $false
}

try {
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $full)) { throw "css not found: $full" }
  $bytes = [System.IO.File]::ReadAllBytes($full)
  if ($bytes.Length -eq 0) { throw 'css is empty' }
  if ($bytes.Length -gt $MaxBytes) { throw "css exceeds $MaxBytes bytes" }

  $css = [System.Text.Encoding]::UTF8.GetString($bytes)
  $lower = $css.ToLowerInvariant()
  $errors = @()

  foreach ($token in @('</style', '<script', '@import', 'expression(', 'javascript:', 'behavior:', '-moz-binding', 'http://', 'https://')) {
    if ($lower.Contains($token)) { $errors += "forbidden token: $token" }
  }

  $urlPattern = [regex]'url\s*\(\s*([^)]*?)\s*\)'
  foreach ($match in $urlPattern.Matches($css)) {
    $value = $match.Groups[1].Value.Trim()
    if ($value -notmatch '^"file:///[^"]+\.(jpg|jpeg|png|webp|mp4|webm)"$') {
      $errors += "url must be a quoted local media file: $value"
    }
  }

  $allowedProperties = @(
    'background', 'background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat', 'transform', 'transform-origin', 'position', 'inset', 'top', 'right',
    'bottom', 'left', 'width', 'height', 'z-index', 'pointer-events', 'opacity', 'content',
    'backdrop-filter', '-webkit-backdrop-filter', 'object-fit', 'object-position', 'display', 'overflow',
    'border-radius', 'box-shadow', 'color', 'filter'
  )

  $selectors = @()
  $ruleCount = 0
  $rules = [regex]::Matches($css, '(?s)([^{}]+)\{([^{}]*)\}')
  foreach ($rule in $rules) {
    $ruleCount += 1
    $selectorGroup = $rule.Groups[1].Value.Trim()
    if ($selectorGroup.StartsWith('@')) { $errors += "at-rule is not allowed: $selectorGroup"; continue }

    foreach ($selector in ($selectorGroup -split ',')) {
      $trimmed = $selector.Trim()
      if (-not (Test-AllowedSelector $trimmed)) { $errors += "selector is not allowed: $trimmed" }
      elseif ($selectors -notcontains $trimmed) { $selectors += $trimmed }
    }

    foreach ($declaration in ($rule.Groups[2].Value -split ';')) {
      $entry = $declaration.Trim()
      if (-not $entry) { continue }
      $colon = $entry.IndexOf(':')
      if ($colon -le 0) { $errors += "invalid declaration: $entry"; continue }
      $property = $entry.Substring(0, $colon).Trim().ToLowerInvariant()
      $value = $entry.Substring($colon + 1).Trim()
      if (-not $value) { $errors += "empty value for $property"; continue }
      if (-not ($property.StartsWith('--') -or ($allowedProperties -contains $property))) {
        $errors += "property is not allowed: $property"
      }
    }
  }

  if ($ruleCount -eq 0) { $errors += 'no css rules found' }
  if ($css -match '[{}]' -and ($rules.Count -eq 0)) { $errors += 'malformed css braces' }

  $sha = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($errors.Count -gt 0) {
    @{
      ok = $false
      error = @{ code = 'CSS_REJECTED'; message = $errors[0]; details = $errors }
      bytes = $bytes.Length
      rules = $ruleCount
      sha256 = $sha
      selectors = $selectors
    } | ConvertTo-Json -Compress -Depth 8
  } else {
    @{
      ok = $true
      bytes = $bytes.Length
      rules = $ruleCount
      sha256 = $sha
      selectors = $selectors
    } | ConvertTo-Json -Compress -Depth 8
  }
} catch {
  @{ ok = $false; error = @{ code = 'CSS_INVALID'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
