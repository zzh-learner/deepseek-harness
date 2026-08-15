/**
 * Function plugin registering the `orbActivity` projection unit: live
 * per-session activity (in-flight tool names, streaming bit, turn outcomes)
 * served through the session-projection seam, so the browser thinking-orb
 * background renders work state without any host-side polling contract. The
 * plugin owns only the fold; delivery is the seam's.
 *
 * @module @deepseek-ai/dsh-orb-state
 */

import type { Context } from '@deepseek-ai/cordis'
import { orbActivityProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'orb-state'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `orbActivity` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(orbActivityProjectionDefinition)
}
