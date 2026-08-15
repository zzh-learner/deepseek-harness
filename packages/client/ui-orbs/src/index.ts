/**
 * Node-half stub for the thinking-orb background: the whole feature is the
 * browser half registered into `shell.overlay`, fed by the `orbActivity`
 * projection (dsh-orb-state) and session-list facts. Nothing to mount on the
 * host side.
 *
 * @module @deepseek-ai/dsh-client-ui-orbs
 */

/** Cordis plugin name. */
export const name = 'client-ui-orbs'

/** No host-side services or effects. */
export function apply(): void {}
