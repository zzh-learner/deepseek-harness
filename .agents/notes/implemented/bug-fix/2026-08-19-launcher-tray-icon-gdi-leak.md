# Agent Note: DshLauncher tray icon redraws only on state change and owns its HICONs

Status: implemented

English | [中文](2026-08-19-launcher-tray-icon-gdi-leak.zh.md)

## Problem

The tray icon disappeared after roughly 2 h 46 m of uptime. Five Windows Error Report crash records shared one lifetime — 165–166 minutes from process start to the `.NET Runtime` event 1026 — and one stack: `Image.FromHbitmap` inside `System.Windows.Forms.ThreadExceptionDialog..ctor`, reached from a timer-window callback. Two code facts produced it. `TrayApp.Poll` redrew the status icon on every 3 s tick regardless of state change, and `DrawIcon` returned `Icon.FromHandle(bitmap.GetHicon())`: the wrapper does not own the HICON, so its `Dispose` never released the handle, and the `NativeMethods.SafeDestroyIcon` wrapper had no callers. Each tick leaked 1 USER and 3 GDI objects; the 10,000 per-process GDI quota emptied at 166 min, the next draw threw `ExternalException` in GDI+, and the WinForms default error dialog allocates its own GDI icon, so the exception handler threw again and the process died. `Program.RunTray` registered no `Application.ThreadException` or `AppDomain.CurrentDomain.UnhandledException` handler, so the dialog was the only failure path.

## Decision

The icon redraws only when the polled status differs from the previous poll; the first poll always draws (`_lastStatus` starts null). Menu enablement, the status panel, and the web-down balloon still run on every tick — only the GDI-drawing step is gated. `DrawIcon` now clones before releasing: `var handle = bitmap.GetHicon(); try { return (Icon)Icon.FromHandle(handle).Clone(); } finally { NativeMethods.SafeDestroyIcon(handle); }` — the clone owns a private HICON, so `TrayApp.Dispose` releasing `_currentIcon` frees real handles. `RunTray` routes UI-thread exceptions through `Application.ThreadException` and all others through `AppDomain.CurrentDomain.UnhandledException` into `launcher.log` via `ProcessService.Log`, replacing the dialog as the failure path.

## Evidence

A 1000-iteration harness measured `GetGuiResources` around the draw: the old pattern grows USER +1 and GDI +3 per iteration (a 200-iteration slice: USER 4→204, GDI 16→613); the clone-and-destroy pattern holds USER flat and leaves GDI within GDI+'s bounded internal cache (1000 iterations: USER 4→4, GDI 5→16). The deployed binary showed the same signature live — USER 284/GDI 825 at 805 s uptime, +5 USER/+15 GDI per 15 s — matching the 165–166 min crash lifetimes at 3 GDI per 3 s against the 10,000 quota. After the fix, a restarted instance holds USER 16/GDI 21 flat across 15 consecutive polls with both services up.

## Alternatives considered

**Free the handle correctly but keep drawing every tick.** Sufficient to stop the leak, but redrawing an unchanged icon allocates GDI objects 20 times a minute for no visible effect, and any future leak-shaped regression returns at full cadence. Gating on state change leaves at most a handful of draws per day and makes the always-draw-on-first-poll guarantee explicit.

**Cache one `Icon` per status combination.** Four cached icons would also bound allocation, but add invalidation surface for no gain once draws are state-gated; clone-per-draw stays simpler.

**Try/catch around `Poll`.** Swallowing GDI exhaustion hides the cause and leaves a blind process with a blank icon; the global handlers log the failure instead, and the ownership fix removes the cause.

**A watchdog that restarts the launcher.** Masks a deterministic defect and adds a moving part; nothing about the crash was nondeterministic.

## Consequences

The 166-minute crash cadence is gone; `launcher.log` now carries any future unhandled exception instead of the event log alone, and the WinForms error dialog — itself a GDI consumer — no longer sits on the failure path of a GDI-exhausted process. The trade-offs: a stale icon (for example after a DPI change) now refreshes only on the next status change or restart, and a UI-thread exception keeps the process alive without user-visible notice, so `launcher.log` is the place to look when the tray misbehaves. Known coverage gap: no automated test observes GDI growth — that requires an interactive window station; the harness numbers above are the recorded evidence, and `stop-cycle.test.ps1` covers the unaffected process-lifecycle paths.
