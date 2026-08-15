/**
 * The phase mapping: the full truth table of facts → phase, the precedence
 * chain (approval over error over idle-gated settle over work classes over
 * streaming over thinking), drift requiring complete quiescence, and the
 * speed ladder from concurrent-liveness counts.
 */

import { describe, expect, it } from 'vitest'
import { PHASE_MODE, orbPhase, orbSpeed, type OrbFacts } from '../src/client/orbs/phase.ts'

const IDLE: OrbFacts = { running: false, approval: false, delegating: 0, openTools: [], streaming: false }
const NO_OUTCOME = { error: false, settle: false }

function facts(overrides: Partial<OrbFacts>): OrbFacts {
  return { ...IDLE, ...overrides }
}

describe('orbPhase', () => {
  it('maps every phase onto a playground mode, with approval and error sharing the waiting rubik', () => {
    const modes = Object.values(PHASE_MODE)
    // Ten phases, nine modes: approval and error both hold the rubik (the
    // error wash distinguishes them); every other phase owns its mode.
    expect(new Set(modes).size).toBe(modes.length - 1)
    expect(PHASE_MODE.approval).toBe('rubik')
    expect(PHASE_MODE.error).toBe('rubik')
  })

  it('quiescent facts drift', () => {
    expect(orbPhase(IDLE, NO_OUTCOME)).toBe('drift')
  })

  it('classifies in-flight tools by name', () => {
    expect(orbPhase(facts({ openTools: ['web_search'] }), NO_OUTCOME)).toBe('searching')
    expect(orbPhase(facts({ openTools: ['edit'] }), NO_OUTCOME)).toBe('weaving')
    expect(orbPhase(facts({ openTools: ['bash'] }), NO_OUTCOME)).toBe('tooling')
    expect(orbPhase(facts({ openTools: ['write', 'web_search'] }), NO_OUTCOME)).toBe('searching')
  })

  it('streams wave and thinks pulse while a turn runs', () => {
    expect(orbPhase(facts({ streaming: true }), NO_OUTCOME)).toBe('wave')
    expect(orbPhase(facts({ running: true }), NO_OUTCOME)).toBe('pulse')
  })

  it('running lineage shows delegating even between current-session steps', () => {
    expect(orbPhase(facts({ delegating: 2 }), NO_OUTCOME)).toBe('delegating')
    expect(orbPhase(facts({ running: true, delegating: 1, openTools: ['subagent'] }), NO_OUTCOME)).toBe('delegating')
  })

  it('approval outranks everything', () => {
    expect(orbPhase(facts({ approval: true, running: true, openTools: ['bash'], streaming: true }), {
      error: true,
      settle: true,
    })).toBe('approval')
  })

  it('error outranks work classes but not approval; settle shows only once idle', () => {
    expect(orbPhase(facts({ running: true, openTools: ['bash'] }), { error: true, settle: false })).toBe('error')
    expect(orbPhase(facts({ running: true }), { error: false, settle: true })).not.toBe('settle')
    expect(orbPhase(IDLE, { error: false, settle: true })).toBe('settle')
  })

  it('drift requires complete quiescence', () => {
    expect(orbPhase(facts({ streaming: true }), NO_OUTCOME)).not.toBe('drift')
    expect(orbPhase(facts({ openTools: ['read'] }), NO_OUTCOME)).not.toBe('drift')
    expect(orbPhase(facts({ running: true }), NO_OUTCOME)).not.toBe('drift')
    expect(orbPhase(facts({ delegating: 1 }), NO_OUTCOME)).not.toBe('drift')
  })
})

describe('orbSpeed', () => {
  it('climbs with concurrent liveness and caps at four ticks', () => {
    expect(orbSpeed(1, false)).toBeCloseTo(1.12)
    expect(orbSpeed(2, false)).toBeCloseTo(1.34)
    expect(orbSpeed(1, true)).toBeCloseTo(1.34)
    expect(orbSpeed(3, true)).toBeCloseTo(1.78)
    expect(orbSpeed(9, true)).toBeCloseTo(1.78)
  })
})
