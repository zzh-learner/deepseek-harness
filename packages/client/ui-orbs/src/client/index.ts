/**
 * Web thinking-orb plugin, browser half: OrbBackdrop registered as a
 * list entry of the shell overlay — the frame-wide floating layer — where it
 * paints one centered canvas behind every other occupant. Export discipline:
 * packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { OrbBackdrop } from './OrbBackdrop.tsx'

/** Required services: the slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the thinking-orb background into the shell
 * overlay layer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'orbs-backdrop', order: -1000, label: '思考球体' },
    OrbBackdrop,
  ))
}
