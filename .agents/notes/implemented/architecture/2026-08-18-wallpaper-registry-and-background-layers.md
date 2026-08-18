# Agent Note: A page-local wallpaper registry for selectable background layers

Status: implemented

English | [中文](2026-08-18-wallpaper-registry-and-background-layers.zh.md)

## Problem

The web GUI had two ambient background layers with no way to choose between them or turn them off: the thinking-orb canvas (ui-orbs) painted permanently, and adding the GARGANTUA black-hole wallpaper would have stacked a second always-on GPU pipeline under it. Both layers animate continuously — leaving all registered layers running was a performance decision the user could not make, and two translucent canvases composed by slot order alone. A selection mechanism needed a home that multiple mutually unaware wallpaper plugins could register into, without the shell knowing any of them.

## Decision

A page-local `wallpaper.registry` service provided by the new `packages/client/ui-wallpaper` package (`ctx.provide`, never crossing the wire), plus a Settings 「壁纸」 section (`settings.section` entry) that lists every registration with the terminal 「无壁纸」 row and applies a selection immediately. Wallpaper packages (`inject: ['slots', 'wallpaper.registry']`) register a descriptor — stable `id`, `label`, `note`, and `show`/`hide` callbacks — next to their `shell.overlay` entry; the selection persists to localStorage (`dsh.wallpaper.selected.v1`) and defaults to `gargantua`. Registering while not selected calls `hide` immediately; unregistering the selected layer falls back to `none`; a persisted id that no longer resolves falls back at `list()`.

**Visibility rides a module-level bridge, not props.** The registry may hide a layer before its component ever mounts (persisted selection) or after it unmounts (HMR), so `show`/`hide` cannot call into a component instance. Each wallpaper exports a `visibility` object (`{ apply, desired }`): the registration callbacks set `desired` and forward to `apply`; the component installs `apply` on mount (setting the host's `display`, pausing or resuming the render loop), applies `desired` once for the pre-mount state, and clears `apply` on unmount. The bridge is package-internal — the registry only ever sees callbacks.

**Hidden means paused.** Both engines stop all work when hidden: the orb loop cancels its rAF chain; the black-hole engine's `pause()` stops the frame loop (all GPU passes) while `resume()` restarts it. The contract lives in the descriptor documentation and the Settings copy; the registry calls `hide` and trusts the layer.

ui-orbs gained a user-facing configuration panel (per-phase mode mapping, idle mode, density / speed / size multipliers, persisted to localStorage) folded into the same overlay entry; the GARGANTUA wallpaper (`packages/client/ui-blackhole`) is a verbatim port of the standalone project — WebGL2 null-geodesic ray tracer with luminance-driven premultiplied alpha, its full parameter panel, quality auto-downgrade below 26fps, and `prefers-reduced-motion` single-frame rendering.

Placement rulings:

- **A ctx service, not a slot.** Wallpaper selection is data plus callbacks shared across entries (the Settings section reads it; every wallpaper writes it) — exactly the case the client architecture note reserves for ctx services over slots. The service is page-local because selection is per-browser viewing state, not per session or workspace.
- **Order stays with the slots.** The registry selects visibility only; z-order remains each layer's `shell.overlay` `order` value (`-2000` black-hole, `-1000` orbs). Two visible layers compose by slot order — visible only in the transient frame while a selection change is being applied.
- **`ctx.get` with a guard in ui-orbs.** ui-orbs' component spec mounts the overlay entry with a slots-only stub context; its apply reads the registry through `typeof ctx.get === 'function' ? ctx.get('wallpaper.registry') : undefined` and skips registration when absent (the spec drives the registry seam directly instead).
- **Wallpaper layers are aria-hidden.** Both hosts (canvas plus control panel) sit outside the accessibility tree, extending the orbs canvas precedent to the whole ambient layer: the selected wallpaper's panel would otherwise enter every full-page aria snapshot with nondeterministic stats text (live FPS/resolution), making the goldens unrestorable; decoration stays pointer-operated only.

## Alternatives considered

- **Slot shadowing (a `wallpaper` slot where the selected layer renders).** Rejected: slots authorize rendering, not pausing — an unselected layer would still mount or the shell would need a swap protocol; and the Settings section needs the registration list as data, which slot metadata does not carry.
- **Host-side setting + wire field.** Rejected for now: the selection is per-browser viewing state; a host round trip would add a wire field and a settings namespace for a fact only the browser consumes. Recorded as the deferred form if per-workspace wallpaper ever needs it.
- **An always-rendered opacity knob (no pausing).** Rejected: the black-hole tracer is a full-resolution GPU pipeline; a hidden wallpaper must cost zero, and the orbs' rAF chain is the same obligation.
- **One combined "backgrounds" package owning both wallpapers.** Rejected: the wallpapers share no code (2D canvas lattice vs WebGL2 ray tracer) and evolve independently; only the registry is shared, which is exactly the service seam.

## Consequences

- A future background layer is one package: register the `shell.overlay` entry + the registry descriptor, and it appears in Settings with no shell or registry edits.
- The registry's per-file coverage, both new packages' engines, panels, and apply surfaces are pinned by their component/engine specs; the packages carry audited `No runtime invariant` companions.
- Selection is per-browser (one localStorage key across workspaces and sessions) — documented as the packages' known limitation.
