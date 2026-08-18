# Publishes the DSH launcher as a single-file, framework-dependent exe.
# Finds dotnet in PATH or the user-level install at %LOCALAPPDATA%\Microsoft\dotnet.
param(
    [string]$Configuration = 'Release',
    [string]$OutputDir = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'

function Test-HasSdk([string]$DotnetPath) {
    if (-not $DotnetPath -or -not (Test-Path $DotnetPath)) { return $false }
    $sdks = & $DotnetPath --list-sdks 2>$null
    return ($sdks | Measure-Object).Count -gt 0
}

# Prefer the first dotnet that actually carries an SDK: a PATH dotnet may be a
# runtime-only install, while the user-level install has the SDK.
$candidates = @(
    (Get-Command dotnet -ErrorAction SilentlyContinue).Source
    (Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe')
)
$dotnet = $candidates | Where-Object { Test-HasSdk $_ } | Select-Object -First 1
if (-not $dotnet) {
    throw 'no dotnet with an SDK was found; install the .NET 9 SDK (user-level is fine): https://dotnet.microsoft.com/download/dotnet/9.0'
}

$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$project = Join-Path $PSScriptRoot 'DshLauncher.csproj'
& $dotnet publish $project -c $Configuration -r win-x64 --self-contained false -p:PublishSingleFile=true -o $OutputDir
if ($LASTEXITCODE -ne 0) {
    throw "publish failed with exit $LASTEXITCODE"
}

$exe = Join-Path $OutputDir 'DshLauncher.exe'
Write-Host "built $exe ($((Get-Item $exe).Length) bytes)"

# Smoke-run the published exe: proves it starts under the desktop runtime and
# seeds the remembered-repo cache (~/.dsh/launcher/repo-path.txt) so a copy
# placed outside the checkout still finds the repo. Pipeline form is required:
# pwsh captures a GUI-subsystem exe's output only through a downstream cmdlet,
# never via assignment (the stop-cycle test documents the same quirk). The exit
# code is ignored: --status legitimately exits 1 while the services are down.
& $exe --status 2>&1 | Tee-Object -Variable statusOutput | ForEach-Object { Write-Host "  $_" }
if (-not ($statusOutput -match 'repo:')) {
    throw "published exe failed its --status smoke test: $($statusOutput -join '; ')"
}
