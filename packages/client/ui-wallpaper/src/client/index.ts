/**
 * Browser half of the wallpaper registry: provides the page-local
 * `wallpaper.registry` service background layers register into, plus the
 * Settings section that lists them and selects the active one. Selection
 * persists in localStorage; wallpapers that register while not selected are
 * hidden through their own `show`/`hide` callbacks (a hidden layer is
 * expected to pause its render loop), so no slot shadowing is involved.
 *
 * @module @deepseek-ai/dsh-client-ui-wallpaper/client
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: merges the settings slot declarations into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createWallpaperRegistry } from './registry.ts'
import type { WallpaperRegistry } from './registry.ts'
import { WallpaperSection } from './WallpaperSection.tsx'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Wallpaper registry: selection + registration of background layers. */
    'wallpaper.registry': WallpaperRegistry
  }
}

/** Required services: the slot registry. */
export const inject = ['slots']

/** The share the settings shell passes every section (only `close` is used). */
interface SectionProps {
  readonly close: () => void
}

/**
 * Client plugin body: provide the registry, then register the Settings
 * section that projects it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const registry = createWallpaperRegistry()
  const stopProvide = ctx.provide('wallpaper.registry', registry)
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'wallpaper', order: 20, label: '壁纸' },
    (props: SectionProps) => createElement(WallpaperSection, { registry, close: props.close }),
  ))
  ctx.effect(() => stopProvide)
}
