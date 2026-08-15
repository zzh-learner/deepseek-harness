/**
 * The ink painter: dots and lines render as grayscale fills/strokes whose
 * channel flips with the theme, opacity rides the dot's optional alpha with
 * 1 as the default, and radius/width pass through to the canvas verbatim.
 */

import { describe, expect, it, vi } from 'vitest'
import { orbScene } from '../src/client/orbs/engine.ts'
import { paintScene } from '../src/client/orbs/paint.ts'

/** Recording 2D context spy: asserts the issued draw commands. */
function spy() {
  const fills: string[] = []
  const strokes: string[] = []
  const widths: number[] = []
  let arcs = 0
  let moves: readonly [number, number][] = []
  const context = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    beginPath: vi.fn(),
    moveTo: (x: number, y: number) => { moves = [...moves, [x, y]] },
    lineTo: vi.fn(),
    stroke: () => { strokes.push(context.strokeStyle); widths.push(context.lineWidth) },
    fill: () => { fills.push(context.fillStyle) },
    arc: () => { arcs += 1 },
  }
  return { context: context as unknown as CanvasRenderingContext2D, fills, strokes, widths, arcCount: () => arcs, moves: () => moves }
}

describe('paintScene', () => {
  it('paints every dot with theme-flipped grayscale and default alpha', () => {
    const light = spy()
    paintScene(light.context, { dots: [{ x: 1, y: 2, z: 0, r: 3, white: 0.5 }], lines: [] }, false)
    expect(light.fills).toEqual(['rgba(128,128,128,1)'])
    expect(light.arcCount()).toBe(1)

    const dark = spy()
    paintScene(dark.context, { dots: [{ x: 1, y: 2, z: 0, r: 3, white: 0.5 }], lines: [] }, true)
    expect(dark.fills).toEqual(['rgba(128,128,128,1)'])

    const opaque = spy()
    paintScene(opaque.context, { dots: [{ x: 0, y: 0, z: 0, r: 1, white: 1, a: 0.25 }], lines: [] }, false)
    expect(opaque.fills).toEqual(['rgba(255,255,255,0.25)'])
  })

  it('strokes every line with its width, dark-side flipped', () => {
    const light = spy()
    paintScene(light.context, {
      dots: [],
      lines: [{ x1: 0, y1: 0, x2: 5, y2: 5, white: 0.2, a: 0.4, w: 1.5 }],
    }, false)
    expect(light.strokes).toEqual(['rgba(51,51,51,0.4)'])
    expect(light.widths).toEqual([1.5])
    expect(light.moves()).toEqual([[0, 0]])

    const dark = spy()
    paintScene(dark.context, {
      dots: [],
      lines: [{ x1: 0, y1: 0, x2: 5, y2: 5, white: 0.2, a: 0.4, w: 1.5 }],
    }, true)
    expect(dark.strokes).toEqual(['rgba(204,204,204,0.4)'])
  })

  it('renders a full web scene through both loops', () => {
    // web is the one mode carrying lines; driving it through paintScene covers
    // the mixed dots+lines path with real engine output.
    const s = spy()
    const scene = orbScene('web', 300, 1.2)
    expect(scene.lines.length).toBeGreaterThan(0)
    paintScene(s.context, scene, true)
    expect(s.strokes.length).toBe(scene.lines.length)
    expect(s.arcCount()).toBe(scene.dots.length)
  })
})
