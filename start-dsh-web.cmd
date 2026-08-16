@echo off
setlocal

rem Quick launcher for the DeepSeek Harness Web UI (default: http://127.0.0.1:3080).
rem Boots "pnpm dsh web" in its own window, waits until the port answers,
rem then opens the default browser. Double-click this file to run.
rem The service window uses pwsh (not powershell): pnpm comes from fnm, which is
rem initialized by the pwsh profile, so -NoProfile would leave pnpm unresolved.

set "HOST=127.0.0.1"
set "PORT=3080"
set "URL=http://%HOST%:%PORT%"

cd /d "%~dp0" || (echo Cannot enter "%~dp0" & exit /b 1)

rem Already running? Just open the browser.
powershell -NoProfile -Command "exit [int](!(New-Object Net.Sockets.TcpClient).ConnectAsync('%HOST%',%PORT%).Wait(300))" >nul 2>&1
if not errorlevel 1 (
    echo dsh web is already running at %URL%.
    start "" "%URL%"
    exit /b 0
)

echo Starting dsh web in a new window...
start "dsh web" pwsh -NoLogo -Command "Set-Location -LiteralPath '%~dp0'; pnpm dsh web"

echo Waiting for %URL% to come up ^(up to 120s^)...
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(120); while((Get-Date) -lt $deadline){ $c=New-Object Net.Sockets.TcpClient; if($c.ConnectAsync('%HOST%',%PORT%).Wait(1000)){ $c.Close(); exit 0 }; $c.Close(); Start-Sleep -Milliseconds 250 }; exit 1"
if errorlevel 1 (
    echo dsh web did not come up within 120s. Check the "dsh web" window for errors
    echo ^(for example, the frontend dist may need "pnpm run build" first^).
    exit /b 1
)

start "" "%URL%"
endlocal
