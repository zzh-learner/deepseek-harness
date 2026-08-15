# Agent Note: Thinking-orb background — session-projection seam and the shipped ui-orbs port

Status: implemented

English | [中文](2026-08-12-thinking-orb-background.zh.md)

Scope: `packages/session/orb-state`, `packages/client/ui-orbs`, web-app bundle rows.

## Problem

The thinking-orb background — the orbs.jakubantalik.com (thinking-orbs) playground as a persistent web-surface feature — existed only as a session-local dynamic plugin (`orbs-1`): its state sensing rode a host-side RPC polled by the page, and it vanished on process restart with no sharing path to other machines. Shipping it meant finding the composition seam that survives restarts (a web-app bundle row) and replacing the plugin's ad-hoc sensing with facts a shipped client can own without new wire contracts.

## Decision

Ship two packages wired into the web-app bundle:

- `dsh-orb-state` registers the `orbActivity` session-projection unit: a pure fold of the durable log serving in-flight tool names (`tool/call` minus matched `tool/result`, swept at `turn/end`), the open step's streaming bit (chunk set, assembled message or `step/end` clears), and distinct turn outcomes (`completed`→settle, `error`→error, monotonic `outcomeSeq`).
- `dsh-client-ui-orbs` renders one hero canvas centered on the conversation column through a `shell.overlay` list entry (`order: -1000`, inside the layer's stacking context), with all nine source modes ported 1:1 from the site's published bundle (seeded rng, yaw+tilt orthographic camera, depth-sorted grayscale ink dots, per-mode speed constants).

## Decisions worth keeping

- **Phase mapping is client-side over two owned channels.** The component derives its phase from the sessions-list snapshot (running bits, `pendingInteraction === 'approval'`, running-lineage counts) plus the current session's `orbActivity` projection value read through `SessionSummary.projectionValues` — the reference-stable whole-value map the object layer publishes precisely so global consumers need no per-session subscriptions. No host-side polling contract, no new Remote. Approval waits hold the rubik; delegation shows ribbon; search tools globe; writes braid; other tools web; streaming wave; thinking orbits; idle rotates all nine.
- **No wall clock in the fold.** Outcome windows (settle 1.7s, error 3.2s) are client-owned: the component edges `outcomeSeq` against `performance.now()`. This keeps the persisted-cache replay equal to the live value — the same property sessionStats pins — and moves every timing decision next to the animation that consumes it.
- **Geometry is measured, not declared.** Centering reads the layout frame's inline `grid-template-columns` from the marked `data-shell-overlay` ancestor (`ui-layout` AppFrame writes both), re-checked on a frame cadence plus a ResizeObserver. A ui-layout owner param would be the authoritative fix; measurement keeps the feature additive until then (recorded as a README limitation).
- **`pick` in the engine** asserts in-range index reads for modular/walked loops rather than re-checking bounds the constructors already guarantee; hot-loop clarity over defensive branches the caller cannot violate.
- **Provenance of the port.** The geometry constants and generators were extracted from the site's minified `ThinkingOrb-*.js` (parameter tables, camera, per-mode generators) during a dynamic-plugin session and verified visually before this port; the dynamic plugin (`orbs-1`, seven packages) remains the reference implementation for tuning comparisons.

## Consequences

- The web surface now carries an always-mounted ambient animation with a per-frame rAF loop; its cost is bounded by one orb's dot count (largest mode ~700 dots) and it self-disables to a single static frame under `prefers-reduced-motion`. Sessions with heavy history pay nothing extra: the fold is incremental over the projection seam's persisted cache.
- Any future surface wanting richer activity semantics (per-tool animation classes, a distinct max-tokens outcome) extends `orbActivity` with a `stateVersion` bump rather than growing a parallel channel.
- The dynamic-plugin lineage (`orbs-1`) is superseded by this shipped form for every future session; its role remains reference tuning.

## Alternatives considered

- **A host-side phase service polled by RPC** (the dynamic plugin's design). Rejected for the shipped form: it duplicates facts the client already owns, adds a polling contract per page, and cannot reach other assemblies without mounting host rows. The projection seam delivers the same facts through the session-list infrastructure every page already consumes.
- **Folding phase timing (hold windows) into the projection.** Rejected: wall-clock windows inside the fold break replay equality with the live value — the property the persisted cache and the sessionStats precedent pin. All timing lives client-side, edge-triggered off the monotonic counter.
- **A dedicated background slot in ui-layout.** Deferred: it is the structural fix for true under-content rendering but requires touching the shipped layout package; measuring the frame's own inline grid tracks keeps this feature additive (the README limitation records the follow-up).

## Invariants and tests

`orb-state` carries the registry-drive fold spec (pairing, prototype-named result, sweep, outcome table, replay purity) and a Loader-composition proof. `ui-orbs` pins the engine (finiteness, depth sort, determinism, per-mode shape facts), the phase truth table and precedence, the column measurement against the frame-tracks format with all unrecognized-shell nulls, and the component (canvas sizing, per-frame ink through a stubbed 2D context, outcome-wash edges with a pinned clock, reduced-motion static frame, apply registration).
