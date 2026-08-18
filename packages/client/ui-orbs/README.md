# @deepseek-ai/dsh-client-ui-orbs

English | [中文](README.zh.md)

Web thinking-orb background: the orbs.jakubantalik.com (thinking-orbs) playground — nine hand-tuned dot-lattice animations (orbit rings, scan globe, band-twisting rubik, breathing wave, signal web, braid, ribbon, ring, shape morph) — rendered as one hero canvas centered on the conversation column, behind every interactive occupant of the shell overlay. The live phase combines the current session's `orbActivity` projection (dsh-orb-state: in-flight tool names, streaming bit, turn outcomes) with session-list facts (running bits, pending approval, running lineage): waiting approval → rubik, failed turn → rubik plus the error wash, clean turn → ring plus the settle wash, delegation → ribbon, search tools → globe, file writes → braid, other tools → web, streaming → wave, thinking → orbits, idle → rotation through all nine. Concurrent liveness scales the animation speed; modes crossfade over 0.9s; `prefers-reduced-motion` draws one static frame; ink flips with the theme's resolved base background. A collapsible panel (top-right while the wallpaper is shown) remaps every phase to any mode, pins or frees the idle tour, and scales density / speed / size; edits persist to localStorage and take effect on the next frame.

## Composition

```yaml
- id: ui-orbs
  name: '@deepseek-ai/dsh-client-ui-orbs'
```

Browser half only: registers one `shell.overlay` list entry (`order: -1000`, so it paints beneath other overlay occupants) plus the `orbs` registration in `wallpaper.registry` (ui-wallpaper); being hidden through the registry pauses the render loop entirely. The node half is an inert loader seat; all data arrives through the standard sessions hook and the projection seam.

## Model Experience

None, as the plugin only renders already-derived client state and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Overlay-plane rendering** — the shell has no content-below slot, so the orb paints inside the frame-wide overlay layer under its siblings at reduced canvas opacity rather than behind the column surfaces themselves; a future background slot in ui-layout would be the structural fix.
- **Geometry is measured, not declared** — centering reads the layout frame's inline grid tracks from the marked overlay ancestor and re-checks on a cadence plus ResizeObserver; a ui-layout owner param would make the column box authoritative.
- **Tool-name classes are fixed sets** — `web_search` reads as searching and `write`/`edit` as weaving; tools added later join `tooling` until their classes are extended here.
- **The layer is aria-hidden** — the orb canvas and its config panel are ambient decoration and sit outside the accessibility tree; the panel is pointer-operated only.
