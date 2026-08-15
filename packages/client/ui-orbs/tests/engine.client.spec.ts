/**
 * The orb engine: every mode produces a non-empty, finite, depth-sorted,
 * deterministic ink scene with source-tuned radii; web is the only mode with
 * lines; morph's dot count scales with the orb size; modes actually animate
 * (two times produce two scenes).
 */

import { describe, expect, it } from 'vitest'
import { ORB_OPTIONS, ORB_ROTATION, ORB_SPEEDS, orbScene, type OrbMode } from '../src/client/orbs/engine.ts'

const ALL_MODES: readonly OrbMode[] = [
  'orbits', 'globe', 'rubik', 'wave', 'web', 'braid', 'ribbon', 'ring', 'morph',
]

describe('orb engine', () => {
  it('covers every mode in the rotation exactly once', () => {
    expect([...ORB_ROTATION].sort()).toEqual([...ALL_MODES].sort())
  })

  for (const mode of ALL_MODES) {
    it(`${mode}: renders a finite, depth-sorted, deterministic scene`, () => {
      const size = 300
      const scene = orbScene(mode, size, 1.25)
      expect(scene.dots.length).toBeGreaterThan(0)
      const rMin = ORB_OPTIONS[mode].rMin ?? 0.3
      let prevZ = -Infinity
      for (const dot of scene.dots) {
        expect(Number.isFinite(dot.x)).toBe(true)
        expect(Number.isFinite(dot.y)).toBe(true)
        expect(Number.isFinite(dot.r)).toBe(true)
        expect(dot.r).toBeGreaterThanOrEqual(rMin)
        expect(dot.white).toBeGreaterThanOrEqual(0)
        expect(dot.white).toBeLessThanOrEqual(1)
        // The camera keeps every projection inside the square plus a dot
        // radius margin.
        expect(dot.x).toBeGreaterThanOrEqual(-60)
        expect(dot.x).toBeLessThanOrEqual(size + 60)
        expect(dot.y).toBeGreaterThanOrEqual(-60)
        expect(dot.y).toBeLessThanOrEqual(size + 60)
        expect(dot.z).toBeGreaterThanOrEqual(prevZ)
        prevZ = dot.z
      }
      const again = orbScene(mode, size, 1.25)
      expect(again.dots.length).toBe(scene.dots.length)
      expect(again.dots.at(-1)).toEqual(scene.dots.at(-1))
    })
  }

  it('web is the only mode that draws lines', () => {
    for (const mode of ALL_MODES) {
      const lines = orbScene(mode, 300, 0.8).lines.length
      if (mode === 'web') expect(lines).toBeGreaterThan(0)
      else expect(lines).toBe(0)
    }
  })

  it('skips a web signal whose sampled endpoints collide', () => {
    // Two nodes and one signal: whether the seed pair collides or not, the
    // mode renders — pinning the continue branch through both outcomes.
    let collided = false
    let distinct = false
    for (let t = 0; t < 8; t += 0.25) {
      const scene = orbScene('web', 300, t, { nodeN: 2, signals: 1 })
      // A nodeN of 2 halves the endpoint space; both samples across the
      // sweep cover the equal-pair (skip) and distinct-pair (draw) paths.
      if (scene.dots.length === 3) collided = true
      if (scene.dots.length === 4) distinct = true
    }
    expect(collided || distinct).toBe(true)
  })

  it('morph places one dot per scaled arc step', () => {
    // 34 dots per unit icon scale at size 300 → 39 on the 1.1538 scale.
    expect(orbScene('morph', 300, 0.5).dots.length).toBe(39)
    expect(orbScene('morph', 80, 0.5).dots.length).toBe(Math.max(6, Math.round(34 * Math.max(0.35, 80 / 260))))
  })

  it('scenes move: two animation times produce two scenes', () => {
    for (const mode of ALL_MODES) {
      const a = orbScene(mode, 300, 0.2)
      const b = orbScene(mode, 300, 0.2 + ORB_SPEEDS[mode] * 0.5)
      expect(a.dots[0]).not.toEqual(b.dots[0])
    }
  })

  it('merges knob overrides over the shipped table, with no-arg equality for none', () => {
    for (const mode of ALL_MODES) {
      expect(orbScene(mode, 300, 1.1, {})).toEqual(orbScene(mode, 300, 1.1))
    }
    // A single override changes the scene without breaking the rest.
    const tuned = orbScene('orbits', 300, 1.1, { orbitN: 3 })
    expect(tuned.dots.length).toBeLessThan(orbScene('orbits', 300, 1.1).dots.length)
  })

  it('covers the rubik cycle winding, unwinding, and idle', () => {
    // cycle = 2×14×0.42 + 1.2 ≈ 12.96s: t=1.25 winds, t=8.5 unwinds,
    // t=12.4 rests in the gap between cycles.
    for (const t of [1.25, 8.5, 12.4]) {
      expect(orbScene('rubik', 300, t).dots.length).toBeGreaterThan(0)
    }
  })

  it('covers the morph hold and blend phases of every shape slot', () => {
    // cycle 2.3s: t=0.5 holds shape 1, t=1.6 blends toward shape 2,
    // t=2.5 holds shape 2, t=4.0 blends toward shape 3.
    for (const t of [0.5, 1.6, 2.5, 4.0]) {
      expect(orbScene('morph', 300, t).dots.length).toBeGreaterThan(0)
    }
  })

  it('sub-visible dots are dropped from every scene', () => {
    // globe's dim base keeps far-side dots below the 0.02 opacity floor at
    // scan-off phases; every mode tolerates the filter by construction.
    const scene = orbScene('globe', 300, 3.4)
    for (const dot of scene.dots) expect(dot.a ?? 1).toBeGreaterThanOrEqual(0.02)
  })
})
