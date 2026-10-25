[CmdletBinding()]
param(
  [string]$Configuration = 'Release',
  [string]$Version = '',
  [string]$OutputRoot = '',
  [switch]$SkipUi,
  [switch]$SkipTests,
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$versionInfo = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = [string]$versionInfo.version }
if (-not $OutputRoot) { $OutputRoot = Join-Path $PSScriptRoot 'out' }

$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$staging = Join-Path $OutputRoot ("BackdropBuddy-" + $Version)
$node = Join-Path $root 'runtime\node\node.exe'
$msbuild = $null
$testSummary = ''
$steps = New-Object System.Collections.ArrayList

function Invoke-Step([string]$Name, [scriptblock]$Action) {
  Write-Host ("[step] " + $Name)
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  & $Action
  $watch.Stop()
  [void]$steps.Add(@{ name = $Name; ms = $watch.ElapsedMilliseconds })
  Write-Host ("[done] " + $Name + " " + $watch.ElapsedMilliseconds + " ms")
}

function Assert-Exit([int]$Code, [string]$What) {
  if ($Code -ne 0) { throw ($What + " failed with exit code " + $Code) }
}

if (-not (Test-Path -LiteralPath $node)) { throw ("Node runtime not found: " + $node) }
if (-not $OutputRoot.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw ("OutputRoot must stay inside the project: " + $OutputRoot)
}
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
if (Test-Path -LiteralPath $staging) {
  if (-not $staging.StartsWith($OutputRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw ("Refusing to clean staging outside OutputRoot: " + $staging)
  }
  Remove-Item -LiteralPath $staging -Recurse -Force
}

$env:PATH = (Join-Path $root 'runtime\node') + ';' + $env:PATH

Invoke-Step 'icon' {
  $iconPath = Join-Path $PSScriptRoot 'BackdropBuddy.ico'
  if (-not (Test-Path -LiteralPath $iconPath)) { throw 'app icon missing: BackdropBuddy.ico' }
}

if (-not $SkipUi) {
  Invoke-Step 'ui' {
    $ui = Join-Path $root 'ui'
    if (-not (Test-Path -LiteralPath (Join-Path $ui 'node_modules\vite\bin\vite.js'))) {
      $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
      if (-not $npm) { throw 'ui/node_modules is missing and npm.cmd was not found on PATH' }
      Push-Location $ui
      try {
        & $npm.Source ci
        Assert-Exit $LASTEXITCODE 'npm ci'
      } finally { Pop-Location }
    }

    Push-Location $ui
    try {
      & $node '.\node_modules\vite\bin\vite.js' build
      Assert-Exit $LASTEXITCODE 'vite build'
      & $node '.\scripts\inject-csp.mjs'
      Assert-Exit $LASTEXITCODE 'csp injection'
    } finally { Pop-Location }

    $html = Get-Item -LiteralPath (Join-Path $ui 'dist\index.html')
    if ($html.Length -gt 262144) { throw ("ui/dist/index.html is " + $html.Length + " bytes; limit is 262144") }
  }
}

if (-not $SkipTests) {
  Invoke-Step 'kernel-tests' {
    $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $root 'tests\kernel') -Filter '*.test.mjs' -File |
      Sort-Object Name | ForEach-Object { $_.FullName })
    if ($testFiles.Count -eq 0) { throw 'no kernel test files found' }
    $output = & $node --test @testFiles 2>&1
    $code = $LASTEXITCODE
    $output | Set-Content -LiteralPath (Join-Path $OutputRoot 'kernel-tests.log') -Encoding UTF8
    if ($code -ne 0) {
      $output | Select-Object -Last 40 | Out-Host
      throw ("kernel tests failed with exit code " + $code)
    }
    $summary = $output | Where-Object { $_ -match '^# (tests|pass|fail|duration_ms) ' }
    $script:testSummary = ($summary -join '; ')
    Write-Host $script:testSummary
  }
}

Invoke-Step 'msbuild' {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) {
    $found = & $vswhere '-latest' '-products' '*' '-requires' 'Microsoft.Component.MSBuild' '-find' 'MSBuild\**\Bin\MSBuild.exe' 2>$null
    if ($found) { $script:msbuild = @($found)[0] }
  }
  if (-not $script:msbuild) {
    $candidate = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe'
    if (Test-Path -LiteralPath $candidate) { $script:msbuild = $candidate }
  }
  if (-not $script:msbuild) {
    $command = Get-Command msbuild.exe -ErrorAction SilentlyContinue
    if ($command) { $script:msbuild = $command.Source }
  }
  if (-not $script:msbuild) { throw 'MSBuild.exe was not found (vswhere, BuildTools 2022 and PATH all failed)' }

  Write-Host ("msbuild: " + $script:msbuild)
  $csproj = Join-Path $root 'src\BackdropBuddy.Shell\BackdropBuddy.Shell.csproj'
  & $script:msbuild $csproj ("/p:Configuration=" + $Configuration) '/p:Platform=AnyCPU' '/v:minimal' '/nologo'
  Assert-Exit $LASTEXITCODE 'msbuild'
}

Invoke-Step 'stage' {
  New-Item -ItemType Directory -Force -Path $staging | Out-Null

  $binDir = Join-Path $root ("src\BackdropBuddy.Shell\bin\" + $Configuration)
  $required = @(
    'BackdropBuddy.exe',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.Wpf.dll',
    'WebView2Loader.dll'
  )
  foreach ($name in $required) {
    $source = Join-Path $binDir $name
    if (-not (Test-Path -LiteralPath $source)) { throw ("build output missing: " + $source) }
    Copy-Item -LiteralPath $source -Destination $staging -Force
  }

  $copyDirs = @{
    'ui\dist' = 'ui\dist'
    'kernel' = 'kernel'
    'shared' = 'shared'
    'platform' = 'platform'
    'runtime\node' = 'runtime\node'
  }
  foreach ($relative in $copyDirs.Keys) {
    $source = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $source)) { throw ("payload source missing: " + $source) }
    $target = Join-Path $staging $copyDirs[$relative]
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
  }

  $assetDir = Join-Path $staging 'assets'
  New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
  $assetFiles = @(Get-ChildItem -LiteralPath (Join-Path $root 'assets') -File)
  if ($assetFiles.Count -eq 0) { throw 'assets directory is empty' }
  foreach ($file in $assetFiles) {
    Copy-Item -LiteralPath $file.FullName -Destination $assetDir -Force
  }

  $deliveryDocs = @(
    @{ relative = 'docs\README.md'; name = 'README.md' },
    @{ relative = 'docs\THIRD_PARTY_NOTICES.md'; name = 'THIRD_PARTY_NOTICES.md' },
    @{ relative = 'docs\LICENSE'; name = 'LICENSE' },
    @{ relative = 'docs\issue-dark-mode-contrast.md'; name = 'issue-dark-mode-contrast.md' }
  )
  foreach ($doc in $deliveryDocs) {
    $source = Join-Path $root $doc.relative
    if (-not (Test-Path -LiteralPath $source)) { throw ("delivery document missing: " + $source) }
    Copy-Item -LiteralPath $source -Destination (Join-Path $staging $doc.name) -Force
  }

  $licenseDir = Join-Path $staging 'licenses'
  New-Item -ItemType Directory -Force -Path $licenseDir | Out-Null
  $licenseFiles = @(
    @{ name = 'Node-LICENSE.txt'; path = 'runtime\node\LICENSE' },
    @{ name = 'WebView2-LICENSE.txt'; path = 'packages\Microsoft.Web.WebView2.1.0.2903.40\LICENSE.txt' },
    @{ name = 'WebView2-NOTICE.txt'; path = 'packages\Microsoft.Web.WebView2.1.0.2903.40\NOTICE.txt' },
    @{ name = 'React-LICENSE.txt'; path = 'ui\node_modules\react\LICENSE' },
    @{ name = 'Vite-LICENSE.md'; path = 'ui\node_modules\vite\LICENSE.md' },
    @{ name = 'vite-plugin-singlefile-LICENSE.txt'; path = 'ui\node_modules\vite-plugin-singlefile\LICENSE' },
    @{ name = '@vitejs-plugin-react-LICENSE.txt'; path = 'ui\node_modules\@vitejs\plugin-react\LICENSE' },
    @{ name = 'ChineseSimplified.isl-LICENSE.txt'; path = 'build\ChineseSimplified.LICENSE.txt' }
  )
  foreach ($entry in $licenseFiles) {
    $source = Join-Path $root $entry.path
    if (-not (Test-Path -LiteralPath $source)) { throw ("license file missing: " + $source) }
    Copy-Item -LiteralPath $source -Destination (Join-Path $licenseDir $entry.name) -Force
  }

  Set-Content -LiteralPath (Join-Path $staging 'VERSION') -Value $Version -Encoding ASCII
}

Invoke-Step 'layout' {
  $layoutScript = Join-Path $staging 'platform\windows\install\layout.ps1'
  $layoutOutput = & $layoutScript -AppRoot $staging -ExePath (Join-Path $staging 'BackdropBuddy.exe')
  $layout = (($layoutOutput | Out-String).Trim() | ConvertFrom-Json)
  if (-not $layout.ok) {
    throw ('layout verification failed: ' + (($layoutOutput | Out-String).Trim()))
  }
}

Invoke-Step 'manifest' {
  $files = @(Get-ChildItem -LiteralPath $staging -Recurse -File | Sort-Object FullName)
  $entries = @()
  foreach ($file in $files) {
    if ($file.Name -eq 'manifest.json' -and $file.DirectoryName -eq $staging) { continue }
    $relative = $file.FullName.Substring($staging.Length + 1).Replace('\', '/')
    $entries += @{
      path = $relative
      bytes = $file.Length
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $manifest = @{
    product = [string]$versionInfo.product
    version = $Version
    generatedAt = [DateTime]::UtcNow.ToString('o')
    files = $entries
  }
  $manifestJson = $manifest | ConvertTo-Json -Depth 6
  Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Value $manifestJson -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $OutputRoot 'manifest.json') -Value $manifestJson -Encoding UTF8
}

if (-not $NoZip) {
  Invoke-Step 'zip' {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = Join-Path $OutputRoot ("BackdropBuddy-" + $Version + ".zip")
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    $archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      $files = @(Get-ChildItem -LiteralPath $staging -Recurse -File | Sort-Object FullName)
      foreach ($file in $files) {
        $relative = $file.FullName.Substring($staging.Length + 1).Replace('\', '/')
        $entryName = 'BackdropBuddy-' + $Version + '/' + $relative
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
          $archive,
          $file.FullName,
          $entryName,
          [System.IO.Compression.CompressionLevel]::Optimal
        )
      }
    } finally {
      $archive.Dispose()
    }
  }
}

Invoke-Step 'summary' {
  $files = @(Get-ChildItem -LiteralPath $staging -Recurse -File)
  $payloadBytes = ($files | Measure-Object -Property Length -Sum).Sum
  $zip = Join-Path $OutputRoot ("BackdropBuddy-" + $Version + ".zip")
  $result = @{
    ok = $true
    product = [string]$versionInfo.product
    version = $Version
    configuration = $Configuration
    staging = $staging
    zip = $(if (Test-Path -LiteralPath $zip) { $zip } else { $null })
    zipBytes = $(if (Test-Path -LiteralPath $zip) { (Get-Item -LiteralPath $zip).Length } else { 0 })
    payloadFiles = $files.Count
    payloadBytes = [int64]$payloadBytes
    shellExeBytes = (Get-Item -LiteralPath (Join-Path $staging 'BackdropBuddy.exe')).Length
    uiBytes = (Get-Item -LiteralPath (Join-Path $staging 'ui\dist\index.html')).Length
    kernelModules = @(Get-ChildItem -LiteralPath (Join-Path $staging 'kernel') -Recurse -Filter '*.mjs' -File).Count
    psScripts = @(Get-ChildItem -LiteralPath (Join-Path $staging 'platform\windows') -Recurse -Filter '*.ps1' -File).Count
    tests = $script:testSummary
    steps = $steps
  }
  $json = $result | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath (Join-Path $OutputRoot 'build.json') -Value $json -Encoding UTF8
  $json
}
