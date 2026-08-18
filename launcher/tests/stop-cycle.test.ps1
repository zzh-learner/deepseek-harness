# End-to-end stop test for DshLauncher against throwaway ports, so the live
# dsh web / hindsight daemon are never touched. Builds a mimic of the real
# "pwsh -> node(pnpm) -> cmd(shim) -> node(server)" chain listening on a dummy
# port, runs "DshLauncher.exe --stop" with an exe-adjacent temp config, and
# asserts: port freed, chain processes gone, the hosting shell alive.
# Usage: pwsh -File launcher/tests/stop-cycle.test.ps1 [-Exe <path>] [-Port <n>]
param(
    [string]$Exe = (Join-Path $PSScriptRoot '..\dist\DshLauncher.exe'),
    [int]$Port = 39999
)

$ErrorActionPreference = 'Stop'
$failures = @()

function Assert([bool]$Condition, [string]$Message) {
    if ($Condition) {
        Write-Host "  PASS: $Message"
    } else {
        Write-Host "  FAIL: $Message" -ForegroundColor Red
        $script:failures += $Message
    }
}

# Victim JS goes through temp files: Start-Process ArgumentList quoting mangles
# inline scripts containing spaces.
$work = Join-Path $env:TEMP ("dsh-launcher-victim-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$listenerJs = Join-Path $work 'listener.js'
$topJs = Join-Path $work 'top.js'

$topCode = @"
const listener = process.argv[2];
const { spawn } = require('child_process');
// spawn with an argument array performs no shell parsing, so the Windows path
// passes through unchanged.
spawn('cmd', ['/c', 'node', listener], { stdio: 'inherit' });
setInterval(() => {}, 1e6);
"@
Set-Content -Path $topJs -Value $topCode

$listenerCode = @"
require('http').createServer((q, s) => s.end('x')).listen($Port, '127.0.0.1', () => console.log('victim-listening'));
setInterval(() => {}, 1e6);
"@
Set-Content -Path $listenerJs -Value $listenerCode

Write-Host "1. starting victim chain on port $Port"
$top = Start-Process node -ArgumentList $topJs, $listenerJs -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
$listenerRow = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Assert ($null -ne $listenerRow) "victim listens on $Port (pid $($listenerRow.OwningProcess))"

Write-Host '2. running DshLauncher --stop with exe-adjacent temp config'
# The isolated copy's dsh-launcher.json redirects both component ports away
# from the live services.
$iso = Join-Path $env:TEMP ("dsh-launcher-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $iso | Out-Null
Copy-Item $Exe (Join-Path $iso 'DshLauncher.exe')
@{
    repoPath   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    webPort    = $Port
    daemonPort = $Port + 1
    autoOpenBrowser = $false
} | ConvertTo-Json | Set-Content -Path (Join-Path $iso 'dsh-launcher.json')
$isoExe = Join-Path $iso 'DshLauncher.exe'
$shellPid = $PID

# Pipeline form: PowerShell sets $LASTEXITCODE reliably here, while the
# assignment form leaves it null for GUI-subsystem executables.
& $isoExe --stop | Tee-Object -Variable stopOutput | ForEach-Object { Write-Host "  $_" }
$stopCode = $LASTEXITCODE
Assert ($stopCode -eq 0) "--stop exit code is 0 (got $stopCode)"

Write-Host '3. verifying teardown'
Start-Sleep -Seconds 1
$still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
Assert ($null -eq $still) "port $Port is free after stop"
Assert ($null -eq (Get-Process -Id $top.Id -ErrorAction SilentlyContinue)) "victim top node (pid $($top.Id)) is gone"
Assert ($null -ne (Get-Process -Id $shellPid -ErrorAction SilentlyContinue)) "hosting shell (this script, pid $shellPid) survived"

Write-Host '4. idempotent second stop'
& $isoExe --stop | ForEach-Object { Write-Host "  $_" }
Assert ($LASTEXITCODE -eq 0) "second --stop also exits 0"

Write-Host '5. --status against the temp config'
& $isoExe --status | ForEach-Object { Write-Host "  $_" }
Assert ($LASTEXITCODE -eq 1) "--status exits 1 while both components are down"

Remove-Item -Recurse -Force $iso, $work -ErrorAction SilentlyContinue

if ($failures.Count -gt 0) {
    Write-Host "$($failures.Count) failure(s)" -ForegroundColor Red
    exit 1
}

Write-Host 'stop-cycle test: all assertions passed'
exit 0
