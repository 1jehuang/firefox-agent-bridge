param(
    [string]$Target = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RustCli = Join-Path $RepoRoot "rust-cli"
$BrowserExe = Join-Path $RustCli "target\$Target\release\browser.exe"
$HostExe = Join-Path $RustCli "target\$Target\release\firefox-agent-bridge-host.exe"

if (-not (Test-Path $BrowserExe)) {
    throw "browser.exe not found at $BrowserExe"
}
if (-not (Test-Path $HostExe)) {
    throw "firefox-agent-bridge-host.exe not found at $HostExe"
}

function Read-Exact([System.IO.Stream]$Stream, [int]$Count) {
    $buffer = New-Object byte[] $Count
    $offset = 0
    while ($offset -lt $Count) {
        $read = $Stream.Read($buffer, $offset, $Count - $offset)
        if ($read -le 0) {
            throw "Unexpected EOF while reading $Count bytes; got $offset"
        }
        $offset += $read
    }
    return $buffer
}

function Read-NativeMessage([System.IO.Stream]$Stream) {
    $lenBytes = Read-Exact $Stream 4
    $len = [BitConverter]::ToUInt32($lenBytes, 0)
    if ($len -le 0 -or $len -gt 10485760) {
        throw "Invalid native message length: $len"
    }
    $payloadBytes = Read-Exact $Stream ([int]$len)
    $payload = [System.Text.Encoding]::UTF8.GetString($payloadBytes)
    return $payload | ConvertFrom-Json
}

function Write-NativeMessage([System.IO.Stream]$Stream, [object]$Message) {
    $json = $Message | ConvertTo-Json -Depth 32 -Compress
    $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $lenBytes = [BitConverter]::GetBytes([UInt32]$payloadBytes.Length)
    $Stream.Write($lenBytes, 0, $lenBytes.Length)
    $Stream.Write($payloadBytes, 0, $payloadBytes.Length)
    $Stream.Flush()
}

& $BrowserExe --version
if ($LASTEXITCODE -ne 0) {
    throw "browser.exe --version failed"
}

& $BrowserExe docs *> $null
if ($LASTEXITCODE -ne 0) {
    throw "browser.exe docs failed"
}

$session = & $BrowserExe session start windows-smoke 2>&1
if ($LASTEXITCODE -eq 0) {
    throw "browser.exe session start unexpectedly succeeded on Windows: $session"
}
if (($session -join "`n") -notmatch "not supported") {
    throw "Windows session unsupported message was unclear: $session"
}

$hostStart = New-Object System.Diagnostics.ProcessStartInfo
$hostStart.FileName = $HostExe
$hostStart.UseShellExecute = $false
$hostStart.RedirectStandardInput = $true
$hostStart.RedirectStandardOutput = $true
$hostStart.RedirectStandardError = $true
$hostStart.CreateNoWindow = $true
$hostStart.Environment["FAB_REQUEST_TIMEOUT_MS"] = "5000"
$hostProc = [System.Diagnostics.Process]::Start($hostStart)

try {
    Start-Sleep -Milliseconds 500
    if ($hostProc.HasExited) {
        $err = $hostProc.StandardError.ReadToEnd()
        throw "Host exited early with code $($hostProc.ExitCode): $err"
    }

    $clientStart = New-Object System.Diagnostics.ProcessStartInfo
    $clientStart.FileName = $BrowserExe
    $clientStart.Arguments = 'ping'
    $clientStart.UseShellExecute = $false
    $clientStart.RedirectStandardOutput = $true
    $clientStart.RedirectStandardError = $true
    $clientStart.CreateNoWindow = $true
    $client = [System.Diagnostics.Process]::Start($clientStart)

    $nativeMessage = Read-NativeMessage $hostProc.StandardOutput.BaseStream
    if ($nativeMessage.action -ne "ping") {
        throw "Expected native ping action, got: $($nativeMessage | ConvertTo-Json -Depth 32 -Compress)"
    }
    if (-not $nativeMessage.id) {
        throw "Native ping message did not include an id"
    }

    Write-NativeMessage $hostProc.StandardInput.BaseStream @{
        id = $nativeMessage.id
        ok = $true
        result = @{ pong = $true }
    }

    if (-not $client.WaitForExit(10000)) {
        $client.Kill()
        throw "browser.exe ping did not exit after fake native response"
    }
    $clientOut = $client.StandardOutput.ReadToEnd()
    $clientErr = $client.StandardError.ReadToEnd()
    if ($client.ExitCode -ne 0) {
        throw "browser.exe ping failed with code $($client.ExitCode). stdout=$clientOut stderr=$clientErr"
    }
    if ($clientOut -notmatch '"pong"\s*:\s*true') {
        throw "browser.exe ping did not print pong result. stdout=$clientOut stderr=$clientErr"
    }

    Write-Host "Windows native host smoke test passed"
} finally {
    if ($hostProc -and -not $hostProc.HasExited) {
        $hostProc.Kill()
        $hostProc.WaitForExit(5000) | Out-Null
    }
}
