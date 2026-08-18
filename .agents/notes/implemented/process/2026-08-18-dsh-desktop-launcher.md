# Agent Note: DSH desktop launcher exe

Status: implemented

English | [中文](2026-08-18-dsh-desktop-launcher.zh.md)

## Problem

Starting the web UI required double-clicking start-dsh-web.cmd, which opens a dedicated pwsh window, starts the Hindsight daemon, waits for the port, and exits. The window holds the server: closing it kills the server mid-session, and there is no stop, restart, or status surface — every operation means finding the window or killing PIDs by hand. The daemon has the same problem in reverse: nothing but the cmd bootstrap ever starts it, and nothing stops it.

## Decision

A native Windows tray exe in [launcher/](../../../../launcher/), outside the pnpm workspace: C# WinForms on `net9.0-windows`, published as a single-file framework-dependent exe (`launcher/build.ps1` → `launcher/dist/DshLauncher.exe`, ~230 KB). The tray app starts, stops, and restarts both components, reflects their state in the icon and a status panel, tails the three launcher-owned logs under `~/.dsh/launcher/`, registers HKCU Run auto-start, and refuses a second instance.

Component discovery is port-based, not spawn-based: listeners are found through `GetExtendedTcpTable`, so the launcher manages servers it did not spawn, including a window left by the old cmd. Stop kills the topmost pipeline ancestor with `taskkill /T /F` — node/cmd for web (the pnpm shim chain), uv/uvx/python for the daemon — so hosting shells never die; a cmd ancestor counts only when its own parent is node, which is the pnpm.CMD shim pattern and excludes interactive shells. Quitting the launcher leaves services running; Stop is the explicit teardown path. Headless verbs (`--status/--start/--stop/--restart/--open/--probe`) expose the same operations to scripts, with exit codes scripts can branch on.

The stop cycle is verified by [launcher/tests/stop-cycle.test.ps1](../../../../launcher/tests/stop-cycle.test.ps1): a mimic node → cmd-shim → node chain on a throwaway port with an exe-adjacent config redirecting the component ports, asserting port freed, chain gone, hosting shell alive, idempotent re-stop, and `--status` exit codes.

## Alternatives considered

**Keep extending start-dsh-web.cmd.** A batch file cannot sit in the tray, show state, or own logs, and reliable process-tree kill from batch means shipping PowerShell one-liners that are already hard to read in the cmd.

**Electron or a web-based tray.** Matches the repository's TypeScript stack, but costs ~200 MB and a bundled Chromium for four menu actions; the .NET desktop runtime was already installed and the whole tool is one small exe.

**Spawn-based process ownership (tracking child handles).** Cleaner kill semantics for self-started servers, but cannot stop a server started by the cmd, a terminal, or a previous launcher instance; port-based discovery handles all of those uniformly.

## Consequences

Windows-only by design; the cmd remains for other platforms. The exe requires the .NET 9 desktop runtime (present on this machine; a user-level SDK at `%LOCALAPPDATA%\Microsoft\dotnet` is enough to rebuild). Repo discovery walks up from the exe or the working directory, then falls back to the last remembered repo (`~/.dsh/launcher/repo-path.txt`, refreshed by every in-repo run and seeded by the build's `--status` smoke step), so an exe copied outside the checkout still finds it; `dsh-launcher.json` overrides repo path and ports for non-standard or multi-checkout layouts (last checkout wins in the cache). Build outputs stay untracked (`launcher/{bin,obj,dist}/` in .gitignore); the source, icon generator, build script, test, and README are tracked. GUI-subsystem exit codes reach PowerShell only through pipeline invocation, which the test script notes explicitly — the build's smoke step therefore pipes through `Tee-Object`, never assignment.
