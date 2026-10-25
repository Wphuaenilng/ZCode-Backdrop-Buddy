param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$ExpectedPath = 'F:\shop\ZCode\ZCode.exe',
  [switch]$Force,
  [int]$WaitMs = 5000
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $actual = $process.Path
  $expected = [System.IO.Path]::GetFullPath($ExpectedPath)
  if (-not $actual -or ([System.IO.Path]::GetFullPath($actual) -ine $expected)) {
    @{ ok = $false; error = @{ code = 'PID_MISMATCH'; message = "refusing to stop PID $ProcessId ($actual); expected $expected" }; pid = $ProcessId } | ConvertTo-Json -Compress -Depth 6
  } else {
    $method = 'closeMainWindow'
    [void]$process.CloseMainWindow()
    $exited = $process.WaitForExit($WaitMs)
    if (-not $exited -and $Force) {
      Stop-Process -Id $ProcessId -Force -ErrorAction Stop
      $exited = $process.WaitForExit($WaitMs)
      $method = 'stopProcess'
    }
    @{
      ok = $exited
      pid = $ProcessId
      method = $method
      exited = $exited
      error = $(if (-not $exited) { @{ code = 'STOP_TIMEOUT'; message = "ZCode PID $ProcessId did not exit within ${WaitMs}ms (use -Force to terminate)" } } else { $null })
    } | ConvertTo-Json -Compress -Depth 6
  }
} catch {
  @{ ok = $false; error = @{ code = 'STOP_FAILED'; message = $_.Exception.Message }; pid = $ProcessId } | ConvertTo-Json -Compress -Depth 6
}
