/**
 * Web thinking-orb plugin, browser half: OrbBackdrop registered as a
 * list entry of the shell overlay — the frame-wide floating layer — where it
 * paints one centered canvas behind every other occupant. The layer also
 * registers into the `wallpaper.registry` service (ui-wallpaper), whose
 * show/hide callbacks pause the render loop while another wallpaper is
 * selected. Export discipline: packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: merges ui-layout's 'shell.overlay' declaration into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: merges the 'wallpaper.registry' service key into Context.
import type {} from '@deepseek-ai/dsh-client-ui-wallpaper/client'
import { OrbBackdrop, visibility } from './OrbBackdrop.tsx'

/** Required services: the slot registry and the wallpaper registry. */
export const inject = ['slots', 'wallpaper.registry']

/**
 * Client plugin body: register the thinking-orb background into the shell
 * overlay layer and into the wallpaper registry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'orbs-backdrop', order: -1000, label: '思考球体' },
    OrbBackdrop,
  ))
  // Guarded so a slots-only context (the component spec) still mounts the
  // overlay entry without the registry.
  const registry = typeof ctx.get === 'function'
    ? ctx.get('wallpaper.registry')
    : undefined
  if (registry === undefined) return
  const stop = registry.register({
    id: 'orbs',
    label: '思考球体',
    note: '会话活动球体 · 可配置',
    show: () => {
      visibility.desired = true
      visibility.apply?.(true)
    },
    hide: () => {
      visibility.desired = false
      visibility.apply?.(false)
    },
  })
  ctx.effect(() => stop)
}
