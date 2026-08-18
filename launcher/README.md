# DSH Launcher

English | [中文](README.zh.md)

A Windows desktop launcher (tray exe) for the DeepSeek Harness web UI. It replaces double-clicking start-dsh-web.cmd with a resident tray app that starts, stops, and restarts `pnpm dsh web` together with the Hindsight memory daemon, shows live status, and tails the service logs.

Not part of the pnpm workspace: plain C# WinForms (`net9.0-windows`), built with the .NET 9 SDK.

## What it manages

| Component | Address | Started as |
|---|---|---|
| dsh web | `http://127.0.0.1:3080` | `pwsh -NoLogo -Command "Set-Location -LiteralPath <repo>; pnpm dsh web"` (profile loads, so fnm/pnpm resolve) |
| Hindsight daemon | `127.0.0.1:9077` | `node ~/.hindsight/coding-agents/dist/daemon-start.js --harness dsh` (idempotent bootstrap) |

State is tracked by listening ports (IPv4 `GetExtendedTcpTable`), so the launcher also manages servers it did not spawn — including the window left behind by start-dsh-web.cmd.

**Stop semantics:** Stop kills both components. The kill root is the topmost ancestor in the component's pipeline (node/cmd for web, uv/uvx/python for the daemon), removed with `taskkill /T /F`; hosting shells (pwsh, Windows Terminal, interactive cmd) are never in the chain and survive.

**Exit semantics:** quitting the launcher (Exit menu) leaves both services running; Stop is the only path that stops them.

## Tray UI

- Tray icon: green when both up, amber when partial, red when down; double-click opens the status panel.
- Right-click menu: Open UI, Start, Stop, Restart, View logs, Start with Windows (HKCU Run key), Exit.
- Status panel: per-component state, PIDs, web uptime, repo path, action buttons, open-browser toggle.
- Log viewer tails `~/.dsh/launcher/dsh-web.log`, `daemon.log`, and `launcher.log` (rotation at 8 MB to `.old`).
- Single instance: a second launch shows the first instance's status panel and exits.

## CLI verbs

Headless verbs exist for scripts and Task Scheduler; exit code 0 only on success:

```
DshLauncher.exe                # tray app
DshLauncher.exe --status       # print states; exit 0 only when both up
DshLauncher.exe --start [--no-browser]
DshLauncher.exe --stop
DshLauncher.exe --restart [--no-browser]
DshLauncher.exe --open         # just open the browser
DshLauncher.exe --probe 3080   # diagnostic: TCP rows + process chain for a port
```

## Build

Requires the .NET 9 SDK (a user-level install at `%LOCALAPPDATA%\Microsoft\dotnet` is enough; the machine's desktop runtime 9.x runs the output):

```
pwsh -File launcher/build.ps1
```

The single-file, framework-dependent exe lands in `launcher/dist/DshLauncher.exe` (~230 KB). Copy it anywhere (Desktop, Start Menu); the repo location is resolved by walking up from the exe, then the working directory, then the last remembered repo (`~/.dsh/launcher/repo-path.txt`, refreshed by every in-repo run and by the build's smoke step). With several checkouts the last one wins, so pin `dsh-launcher.json` next to the exe:

```json
{
  "repoPath": "C:\\path\\to\\deepseek-harness",
  "webPort": 3080,
  "daemonPort": 9077,
  "autoOpenBrowser": true
}
```

(`~/.dsh/launcher.json` works too; the exe-adjacent file wins. All keys are optional.)

## Test

```
pwsh -File launcher/tests/stop-cycle.test.ps1
```

Builds a mimic `node -> cmd shim -> node` chain on a throwaway port and asserts the stop cycle: port freed, chain gone, hosting shell alive, idempotent second stop, correct `--status` exit codes. The live services on 3080/9077 are never touched.

## Regenerate the icon

```
pwsh -File launcher/assets/make-icon.ps1
```

Draws `launcher/assets/app.ico` (dark rounded square, white D, green state dot) with System.Drawing at 256/48/32/16 px.
