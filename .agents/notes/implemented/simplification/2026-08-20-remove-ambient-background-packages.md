# Agent Note: Remove the ambient background packages

Status: implemented

English | [中文](2026-08-20-remove-ambient-background-packages.zh.md)

Scope: `packages/session/orb-state`, `packages/client/ui-orbs`, `packages/client/ui-wallpaper`, `packages/client/ui-blackhole`, web-app bundle rows.

## Problem

The web GUI had accumulated an ambient-background feature line: the thinking-orb canvas (2026-08-12, the `orbActivity` session projection plus the `ui-orbs` nine-mode port) and the page-local wallpaper selection mechanism (2026-08-18, the `ui-wallpaper` registry plus the `ui-blackhole` GARGANTUA wallpaper). The original motivations those two notes record were, respectively, persisting the dynamic-plugin orb background into a restart-surviving bundle row, and letting the user choose between mutually unaware background layers and turn always-on animation and GPU pipelines off.

The layers are decoration: aria-hidden, pointer-operated only, outside the accessibility tree, with no product requirement depending on them. The unreleased repository has no external consumers, yet the line cost four packages — canvas and WebGL2 engines, a registry service, a Settings section, and each package's tests and generated-catalog surface. The scope-contraction call: decoration is not product core, and that maintenance footprint is not justified.

## Decision

All four packages are deleted with no compatibility package or alias. The same change removes the web-app bundle rows and workspace dependencies, the tsconfig path mappings and project references, the knip projects, the cordis/client/config generated-catalog entries, the `wallpaper.registry` service-walk exemption, the slot-catalog `shell.overlay` occupants and the `settings.section` wallpaper section, and the 「壁纸」 button from eleven settings goldens. `pnpm-lock.yaml` shrinks to match.

This note consolidates the two superseded records — the feature note "Thinking-orb background — session-projection seam and the shipped ui-orbs port" (2026-08-12) and the architecture note "A page-local wallpaper registry for selectable background layers" (2026-08-18). Both complete triplets (en/zh/sidecar) are deleted with it; git history retains the texts, but they are no longer authority for current behavior.

### Consolidated records

- **Original motivations.** The orb background persisted the orbs.jakubantalik.com playground from a dynamic plugin, sensing state through a pure `orbActivity` fold read via `SessionSummary.projectionValues` — no host polling, no wall clock inside the fold. The wallpaper registry existed because multiple always-on animated layers could not be chosen between or turned off; selection persisted to localStorage, and hidden meant paused (rAF chain cancelled, frame loop stopped).
- **Why they no longer held.** Both layers were decoration (the aria-hidden facts above) in a pre-release repository with no external consumers; carrying them cost four packages of engines, panels, a registry, and their full test and catalog surface, while the product claims no requirement for activity visualization or selectable wallpapers.
- **Capability given up.** Ambient visualization of session activity (in-flight tools, streaming bit, turn outcomes driving nine modes) and user-selectable background layers. The `shell.overlay` seat remains with its occupant list empty.
- **Reintroduction condition.** A future activity visualization or background layer starts from a real product need, a fresh package boundary, and assembled acceptance — not from inheriting these implementations; richer activity semantics still belong in a new session-projection unit rather than a parallel channel.

## Verification

Repository searches and the generated catalogs carry none of the four package names, the `wallpaper.registry` service key, or the `orbActivity` projection key. `pnpm run build`, the cordis-client-runner unit tests, the doc-sync and hygiene manifest/catalog sub-gates, and a `--frozen-lockfile` install of the shrunken lockfile all pass; the settings web e2e goldens (plugin config, settings chrome, agent presets, models, onboarding) are updated to the no-「壁纸」 form.

## Alternatives considered

**Keep the packages out of the bundle.** Rejected: the maintenance and catalog/test surface stays, and unshipped UI remains presented as product surface; the pre-release stance gives no reason to carry it.

**Move the packages to the examples group.** Rejected: moving code creates no product need, and examples require maintained assembled acceptance (the same ruling as the TUI removal note).

**Keep the registry, drop the two wallpapers.** Rejected: the registry existed to arbitrate exactly these layers; a registry with no registrants is the speculative surface the package rules forbid.

**Disable the rows by default in the composition.** Rejected: a `disabled:` row still feeds the packages, their tests, and the catalog surface; decoration earns no seat in the product inventory.

## Consequences

The web GUI has no ambient background layer; the session-projection seam itself remains, with the `orbActivity` unit gone. The localStorage key `dsh.wallpaper.selected.v1` survives in browsers as dead data no code reads; there is no migration. The `SessionSummary.projectionValues` mechanism keeps serving other projection consumers.

Reintroducing ambient visualization or backgrounds requires a named product need, an explicit package boundary, and assembled lifecycle and transcript acceptance; an implementation should start from the host and interaction requirements of its time rather than restore these ports.
