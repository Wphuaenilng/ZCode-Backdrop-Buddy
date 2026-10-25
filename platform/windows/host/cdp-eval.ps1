param(
  [int]$Port = 9229,
  [string]$ExpressionFile = '',
  [int]$TimeoutMs = 8000
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

try {
  if (-not $ExpressionFile -or -not (Test-Path -LiteralPath $ExpressionFile)) {
    throw "expression file not found: $ExpressionFile"
  }
  $expression = [System.IO.File]::ReadAllText($ExpressionFile, [System.Text.Encoding]::UTF8)
  if ($expression.Length -gt 262144) { throw 'expression exceeds 256 KiB' }

  $targetsRaw = (& (Join-Path $PSScriptRoot 'cdp-targets.ps1') -Port $Port | Out-String)
  $targets = $targetsRaw | ConvertFrom-Json
  if (-not $targets.ok -or -not $targets.target) {
    @{ ok = $false; error = @{ code = 'HOST_TARGET_MISSING'; message = $(if ($targets.error) { $targets.error.message } else { 'renderer target missing' }) } } | ConvertTo-Json -Compress -Depth 6
  } else {
    $socket = New-Object System.Net.WebSockets.ClientWebSocket
    $cts = New-Object System.Threading.CancellationTokenSource
    $cts.CancelAfter($TimeoutMs)
    try {
      [void]$socket.ConnectAsync([Uri]$targets.target.wsUrl, $cts.Token).GetAwaiter().GetResult()
      $payload = @{
        id = 1
        method = 'Runtime.evaluate'
        params = @{ expression = $expression; returnByValue = $true; awaitPromise = $true }
      } | ConvertTo-Json -Compress -Depth 6
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
      [void]$socket.SendAsync([System.ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()

      $builder = New-Object System.Text.StringBuilder
      $buffer = New-Object byte[] 65536
      do {
        $received = $socket.ReceiveAsync([System.ArraySegment[byte]]::new($buffer), $cts.Token).GetAwaiter().GetResult()
        if ($received.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
        [void]$builder.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $received.Count))
      } while (-not $received.EndOfMessage)

      $reply = $builder.ToString() | ConvertFrom-Json
      if ($reply.error) {
        @{ ok = $false; error = @{ code = 'CDP_ERROR'; message = $reply.error.message; details = $reply.error } } | ConvertTo-Json -Compress -Depth 8
      } else {
        @{ ok = $true; result = $reply.result } | ConvertTo-Json -Compress -Depth 12
      }
    } finally {
      try { $socket.Dispose() } catch { }
      try { $cts.Dispose() } catch { }
    }
  }
} catch {
  @{ ok = $false; error = @{ code = 'CDP_EVAL_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress -Depth 6
}
