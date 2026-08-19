# Agent Note: launcher daemon startup hardening

Status: implemented

English | [中文](2026-08-19-launcher-daemon-startup-hardening.zh.md)

## Problem

A morning launcher restart left the daemon down with three stacked failures. `hindsight-api-slim` depends on `claude-agent-sdk>=0.2.82` with no upper bound; after upstream published 0.2.140, the next `uvx hindsight-api@0.9.1` resolution had to download ~100 MB of wheels. Three independent timeouts fired during that download: the launcher gave up on the daemon port after 60 s, the embed CLI's own startup budget (`HINDSIGHT_EMBED_DAEMON_STARTUP_TIMEOUT`, default 180 s) expired mid-download without killing anything, and a second bootstrap then lost 300 s waiting on the uv wheel-cache lock held by the first attempt's still-running uv process. Stop made this worse, not better: it finds processes only through the listening port, so a still-booting chain (downloading dependencies, no listener) survived every stop, and each retry stacked another bootstrap on top of the previous one.

## Decision

One number governs the whole daemon boot: `daemonStartTimeoutSeconds` (now 300 by default) is both the launcher's port wait and, forwarded to the bootstrap as `HINDSIGHT_EMBED_DAEMON_STARTUP_TIMEOUT` and `UV_LOCK_TIMEOUT`, the embed CLI's budget and uv's lock wait. No layer gives up while another is still making progress inside the budget, and a concurrent second bootstrap waits for the lock instead of failing on it.

Stop and Start now also track spawn roots, not just listeners. Every spawn writes `web.pid`/`daemon.pid` (`pid|start-time|process-name`) into the log dir; Stop kills the remembered roots after the port-based pass, and Start kills a remembered root before spawning, so at most one chain per component exists at any time. The record is validated against process name and start time before any kill, so a reused pid is never touched. Pid files are cross-process state on purpose: headless verbs run in their own exe instance and share nothing with the tray process. `dsh-launcher.json` gained a `logDir` override so the stop-cycle test redirects `web.pid`/`daemon.pid` and the logs into its temp copy instead of the real `~/.dsh/launcher`.

The daemon bootstrap `Process` object is now held like the web one instead of being disposed when `StartDaemonAsync` returns: a disposed Process stops raising output events, which is why `daemon.log` never contained the `=== pid ... exited ===` trailer.

## Alternatives considered

**Kill orphaned uv processes by command-line scan.** Would reach detached daemons whose bootstrap already exited, but requires WMI-speed process enumeration and risks killing a user's own hindsight processes; `UV_LOCK_TIMEOUT` inside the budget lets a retry converge on the previous download instead.

**Forward headless verbs to the tray process over IPC.** Would keep pid state in memory only, but adds a pipe protocol for what a two-line pid file already solves, including after the tray exits.

## Consequences

A daemon whose bootstrap died between launcher runs (orphaned, mid-download, no listener, no remembered pid) is still invisible to Stop; the next Start's lock wait is what absorbs it, and after the download completes once the wheel cache makes it moot. The extra pid files under `~/.dsh/launcher/` are one line each, consumed (deleted) by every stop. The stop-cycle test grew a no-listener chain case and now redirects `logDir`, so the real launcher directory is untouched by tests.
