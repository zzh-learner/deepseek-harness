# @deepseek-ai/dsh-client-ui-wallpaper

English | [中文](README.zh.md)

Web wallpaper registry: the Settings 「壁纸」 section plus the page-local `wallpaper.registry` service background layers register into. The registry holds the registered wallpapers (each with `show`/`hide` callbacks expected to pause their render loop while hidden) and the current selection, persisted to localStorage; consumers declare the service in `inject` (ui-orbs, ui-blackhole). The Settings section lists every registration plus the terminal 「无壁纸」 row and applies a selection immediately, so the page behind the open panel previews it. A registered layer that goes away while selected falls back to 「无壁纸」; a persisted id that no longer resolves falls back at the next `list()`.

## Composition

```yaml
- id: ui-wallpaper
  name: '@deepseek-ai/dsh-client-ui-wallpaper'
```

Browser half only: provides the `wallpaper.registry` service and registers one `settings.section` entry (`order: 20`, label 「壁纸」). The node half is an inert loader seat. The service is page-local — it lives in the client Context via `ctx.provide` and never crosses the wire; selection state is per-browser (localStorage), not per session or workspace.

## Model Experience

None, as the registry and its selection page are browser-side viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Selection is per-browser, not per session** — one localStorage key holds the selection for every workspace and session in the browser; a per-workspace wallpaper would need a host-side setting.
- **A layer registered while hidden is told, not polled** — the registry calls `hide` at registration when another wallpaper is selected; a layer that ignores the contract (keeps rendering) is only detectable by its GPU cost, not by the registry.
- **No layer ordering inside the overlay** — wallpapers rely on their own `shell.overlay` `order` values; the registry selects visibility, not z-order, so two visible layers compose by slot order rather than by any registry rule.
