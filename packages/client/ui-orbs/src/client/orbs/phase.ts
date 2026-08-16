/**
 * Phase mapping: combines current-session activity (the `orbActivity`
 * projection) with session-list facts (running bits, pending approval,
 * running lineage) into the single animation phase the orb renders. Pure —
 * all timing arrives as booleans the caller already windowed against its
 * own clock.
 *
 * @module @deepseek-ai/dsh-client-ui-orbs/src/client/orbs/phase
 */

import type { OrbMode } from './engine.ts'

/** Tool names that read as searching. */
const SEARCH_TOOLS = new Set(['web_search'])

/** Tool names that read as writing content into files. */
const WRITE_TOOLS = new Set(['write', 'edit'])

/** The animation phases; each maps to one playground mode. */
export type OrbPhase =
  | 'approval' | 'error' | 'settle' | 'delegating'
  | 'searching' | 'weaving' | 'tooling' | 'wave'
  | 'pulse' | 'drift'

/** Phase → mode (the 1:1 mapping; drift rotates through all modes). */
export const PHASE_MODE: Readonly<Record<OrbPhase, OrbMode>> = {
  approval: 'rubik',
  error: 'rubik',
  settle: 'ring',
  delegating: 'ribbon',
  searching: 'globe',
  weaving: 'braid',
  tooling: 'web',
  wave: 'wave',
  pulse: 'orbits',
  drift: 'morph',
}

/** Live facts the phase derives from (all boolean/count, no clocks). */
export interface OrbFacts {
  /** The current session's agent loop is between turn start and turn end. */
  readonly running: boolean
  /** Any session waits on a user approval answer. */
  readonly approval: boolean
  /** Count of running child sessions (subagents, workflow agents). */
  readonly delegating: number
  /** The current session's in-flight tool names. */
  readonly openTools: readonly string[]
  /** The current session's open step is streaming tokens. */
  readonly streaming: boolean
}

/** Caller-windowed outcome flags (the component edges outcomeSeq against its clock). */
export interface OrbWindows {
  /** Inside the error hold after a failed turn. */
  readonly error: boolean
  /** Inside the settle hold after a clean turn and the loop went idle. */
  readonly settle: boolean
}

/**
 * Derive the animation phase. Precedence mirrors attention: an answer the
 * user owes outranks failures, failures outrank celebration, celebration
 * only shows once the loop went idle, and work-state classes outrank plain
 * streaming, which outranks thinking.
 * @param facts - live per-session and cross-session facts.
 * @param windows - caller-windowed outcome flags.
 * @returns the phase to render.
 */
export function orbPhase(facts: OrbFacts, windows: OrbWindows): OrbPhase {
  if (facts.approval) return 'approval'
  if (windows.error) return 'error'
  if (windows.settle && !facts.running) return 'settle'
  const busy = facts.running || facts.streaming || facts.openTools.length > 0
  if (!busy && facts.delegating === 0) return 'drift'
  if (facts.delegating > 0) return 'delegating'
  if (facts.openTools.some(name => SEARCH_TOOLS.has(name))) return 'searching'
  if (facts.openTools.some(name => WRITE_TOOLS.has(name))) return 'weaving'
  if (facts.openTools.length > 0) return 'tooling'
  if (facts.streaming) return 'wave'
  return 'pulse'
}

/**
 * Animation speed multiplier from how much of the harness is concurrently
 * alive: one tick per running session, one more while tools dispatch. The
 * curve is tuned to a meditative pace — roughly half the playground's
 * reference tempo — so busyness still reads without agitation.
 * @param runningSessions - count of sessions whose running bit is set.
 * @param toolsOpen - whether the current session has tools in flight.
 * @returns the multiplier (0.6 idle baseline … 0.9 capped).
 */
export function orbSpeed(runningSessions: number, toolsOpen: boolean): number {
  const intensity = Math.min(4, Math.max(1, runningSessions) + (toolsOpen ? 1 : 0))
  return 0.5 + 0.1 * intensity
}
