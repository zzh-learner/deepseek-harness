/**
 * Pure types of the orb-state domain: the ONE home of the `orbActivity`
 * projection-key declaration, free of this package's host-side value imports.
 * Two namespace projections serve it — `./types` for host consumers,
 * `./client` for the browser orb surface — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-orb-state/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Live per-session activity for the thinking-orb surface: what the current
 * conversation is doing right now, folded from the durable log. Every field
 * is event-derived (no wall-clock decay in the fold), so a replayed value is
 * exactly what the live session showed at the same seq.
 */
export interface OrbActivityProjection {
  /** Tool names dispatched without their matching `tool/result`, in call order. */
  openTools: readonly string[]
  /** The open step has emitted stream chunks but not yet assembled its message. */
  streaming: boolean
  /** Outcome of the most recent closed turn that settled distinctly: a clean completion, a failure, or nothing notable. */
  outcome: 'settle' | 'error' | null
  /** Monotonic count of non-null outcomes; clients edge-trigger animations on this counter. */
  outcomeSeq: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Live activity for the orb surface; see {@link OrbActivityProjection}. */
    orbActivity: OrbActivityProjection
  }
}
