/**
 * Browser half of the GARGANTUA black-hole wallpaper: registers the canvas
 * hero into `shell.overlay` (beneath every other occupant) and the layer
 * into the `wallpaper.registry` service, whose show/hide callbacks pause
 * the render loop while the layer is not selected.
 *
 * @module @deepseek-ai/dsh-client-ui-blackhole/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: merges ui-layout's 'shell.overlay' declaration into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: merges the 'wallpaper.registry' service key into Context.
import type {} from '@deepseek-ai/dsh-client-ui-wallpaper/client'
import { BlackholeWallpaper, visibility } from './BlackholeWallpaper.tsx'

/** Required services: the slot registry and the wallpaper registry. */
export const inject = ['slots', 'wallpaper.registry']

/**
 * Client plugin body: overlay entry plus wallpaper registration.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'gargantua-wallpaper', order: -2000, label: 'GARGANTUA 黑洞壁纸' },
    BlackholeWallpaper,
  ))
  const registry = ctx.get('wallpaper.registry')
  if (registry === undefined) return
  const stop = registry.register({
    id: 'gargantua',
    label: 'GARGANTUA 黑洞',
    note: '引力透镜光线追踪 · WebGL2',
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
