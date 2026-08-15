/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-orbs`.
 * @module @deepseek-ai/dsh-client-ui-orbs/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-orbs'

/** Cordis companion plugin name. */
export const name = 'client-ui-orbs-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package is pure presentation over already-owned
 * reactive channels (the sessions list snapshot and the orbActivity
 * projection), asserts no new event/data relation, and its phase mapping is
 * pinned by this package's phase and component specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
