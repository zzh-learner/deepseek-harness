# @deepseek-ai/dsh-client-ui-blackhole

English | [中文](README.zh.md)

Web GARGANTUA wallpaper: a zero-dependency WebGL2 black-hole ray tracer rendered as a translucent background layer with its own control panel. The scene (gravitational lensing via null-geodesic integration, thin accretion disk with Doppler beaming, procedural sky) is ported verbatim from the standalone GARGANTUA project; the composite outputs luminance-driven premultiplied alpha, so empty space stays transparent while the disk and stars remain solid. The collapsible right-hand panel keeps the project's full parameter set (presets, accretion disk / spacetime / sky / render sliders, FPS stats, screenshot, interactive orbit mode) and persists to localStorage. Registers into `shell.overlay` beneath every other occupant and into `wallpaper.registry` (ui-wallpaper), pausing the render loop while not selected; a browser without WebGL2 renders nothing and reports the reason in the panel.

## Composition

```yaml
- id: ui-blackhole
  name: '@deepseek-ai/dsh-client-ui-blackhole'
```

Browser half only: one `shell.overlay` list entry (`order: -2000`, beneath every other occupant) plus the `gargantua` registration in `wallpaper.registry`. The node half is an inert loader seat. Quality starts at 「中」 with automatic downgrade below 26fps until the user locks a step; `prefers-reduced-motion` disables the auto-orbit and renders single frames.

## Model Experience

None, as the wallpaper is browser-side ambient rendering over a WebGL2 canvas; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The engine is a verbatim port, not a shared WebGL layer** — the ray tracer owns its programs and render targets; a second WebGL background would duplicate the pipeline rather than share it.
- **Capture composites the raw canvas** — the screenshot downloads the engine's frame without the panel, CSS opacity is applied at the canvas element, and the browser's default download flow is used (no in-app gallery).
- **Interactive mode opts the canvas into pointer events** — drag/orbit and wheel-zoom require toggling the checkbox because the wallpaper layer sits under every interactive occupant; always-on gestures would swallow the UI's own pointer input.
- **The layer is aria-hidden** — the wallpaper and its panel are ambient decoration (like the orbs canvas) and sit outside the accessibility tree; the panel is pointer-operated only.
