// @vitest-environment jsdom
/**
 * The orbs config module: persisted load with per-field damage fallbacks,
 * save with storage failures kept session-local, and the density scaler's
 * per-mode count-knob math — including the minimum-count clamp and the skip
 * of count fields a mode's hand-tuned table does not carry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORB_ROTATION } from '../src/client/orbs/engine.ts'
import { PHASE_MODE } from '../src/client/orbs/phase.ts'
import {
  ALL_MODES, DEFAULT_CONFIG, MODE_LABELS, PHASE_LABELS,
  densityOverrides, loadConfig, saveConfig, type OrbsConfig,
} from '../src/client/orbs/config.ts'

// Perturb one hand-tuned entry so a density-scaled count field resolves to
// undefined; the scaler must skip it instead of emitting NaN.
vi.mock('../src/client/orbs/engine.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/orbs/engine.ts')>()
  return {
    ...actual,
    ORB_OPTIONS: {
      ...actual.ORB_OPTIONS,
      ribbon: { ...actual.ORB_OPTIONS.ribbon, ghostN: undefined },
    } as unknown as typeof actual.ORB_OPTIONS,
  }
})

const KEY = 'dsh.ui-orbs.config.v1'

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('loadConfig', () => {
  it('returns the shipped defaults when nothing is persisted', () => {
    expect(loadConfig()).toBe(DEFAULT_CONFIG)
  })

  it('falls back to defaults when storage reads fail or the payload is damaged', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(loadConfig()).toBe(DEFAULT_CONFIG)
    vi.restoreAllMocks()

    // Broken JSON, a non-object payload, and a JSON null all fall back.
    for (const raw of ['{', '123', 'null']) {
      localStorage.setItem(KEY, raw)
      expect(loadConfig()).toBe(DEFAULT_CONFIG)
    }
  })

  it('rebuilds missing or damaged fields into a complete config', () => {
    localStorage.setItem(KEY, '{}')
    expect(loadConfig()).toEqual({ phaseModes: {}, idleMode: 'auto', density: 1, speed: 1, size: 1 })

    // phaseModes null, idleMode null, a string density, a null speed, and a
    // size of Infinity (JSON.parse of 1e999) each take their fallback.
    localStorage.setItem(
      KEY,
      '{"phaseModes":null,"idleMode":null,"density":"2","speed":null,"size":1e999}',
    )
    expect(loadConfig()).toEqual({ phaseModes: {}, idleMode: 'auto', density: 1, speed: 1, size: 1 })
  })

  it('keeps a fully valid persisted payload', () => {
    const stored: OrbsConfig = {
      phaseModes: { pulse: 'globe', error: 'ring' },
      idleMode: 'wave',
      density: 1.5,
      speed: 2,
      size: 0.8,
    }
    localStorage.setItem(KEY, JSON.stringify(stored))
    expect(loadConfig()).toEqual(stored)
  })
})

describe('saveConfig', () => {
  it('persists the config as one JSON object', () => {
    const stored: OrbsConfig = {
      phaseModes: { tooling: 'web' },
      idleMode: 'auto',
      density: 1.25,
      speed: 1,
      size: 1,
    }
    saveConfig(stored)
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(stored))
    expect(loadConfig()).toEqual(stored)
  })

  it('keeps the config session-local when storage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() =>{  saveConfig(DEFAULT_CONFIG) }).not.toThrow()
  })
})

describe('densityOverrides', () => {
  it('returns no overrides at unit density', () => {
    expect(densityOverrides('orbits', 1)).toEqual({})
    expect(densityOverrides('morph', 1)).toEqual({})
  })

  it('scales each mode’s hand-tuned count knobs', () => {
    expect(densityOverrides('orbits', 2)).toEqual({ orbitN: 24, ghostN: 80, particles: 6 })
    expect(densityOverrides('braid', 2)).toEqual({ strandN: 104, ghostN: 300 })
    expect(densityOverrides('wave', 2)).toEqual({ rings: 30, lonDensity: 80 })
    expect(densityOverrides('rubik', 2)).toEqual({ latRings: 30, lonDensity: 80 })
    // Half density rounds half-up: 17 rings become 9.
    expect(densityOverrides('globe', 0.5)).toEqual({ latRings: 9, lonDensity: 22 })
    expect(densityOverrides('ring', 1.5)).toEqual({ segs: 66 })
  })

  it('clamps scaled counts to at least one particle', () => {
    expect(densityOverrides('web', 0.01)).toEqual({ nodeN: 1, signals: 1 })
  })

  it('leaves morph empty: its dot count derives from the canvas', () => {
    expect(densityOverrides('morph', 2)).toEqual({})
  })

  it('skips count fields the mode’s table does not carry', () => {
    // ribbon’s ghostN is undefined in the perturbed table; segs still scales.
    expect(densityOverrides('ribbon', 2)).toEqual({ segs: 88 })
  })
})

describe('shipped tables', () => {
  it('label every phase and mode exactly once', () => {
    expect([...Object.keys(PHASE_LABELS)].sort()).toEqual([...Object.keys(PHASE_MODE)].sort())
    for (const label of Object.values(PHASE_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }

    expect(new Set(ALL_MODES).size).toBe(ALL_MODES.length)
    expect([...ALL_MODES].sort()).toEqual([...ORB_ROTATION].sort())
    expect([...Object.keys(MODE_LABELS)].sort()).toEqual([...ORB_ROTATION].sort())
    for (const label of Object.values(MODE_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('ship unit defaults with the auto tour', () => {
    expect(DEFAULT_CONFIG).toEqual({ phaseModes: {}, idleMode: 'auto', density: 1, speed: 1, size: 1 })
  })
})
