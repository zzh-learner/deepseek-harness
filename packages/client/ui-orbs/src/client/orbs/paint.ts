/**
 * Ink painter for one {@link OrbScene}: grayscale dots and lines whose
 * `white` mix flips with the theme so the orb reads on light and dark alike.
 *
 * @module @deepseek-ai/dsh-client-ui-orbs/src/client/orbs/paint
 */

import type { OrbScene } from './engine.ts'

/**
 * Paint a scene with 2D canvas ink.
 * @param g - the canvas 2D context (transform already positioned at the orb).
 * @param scene - the scene to paint.
 * @param dark - true flips the ink toward light-on-dark.
 */
export function paintScene(g: CanvasRenderingContext2D, scene: OrbScene, dark: boolean): void {
  for (const line of scene.lines) {
    const gray = Math.round((dark ? 1 - line.white : line.white) * 255)
    g.strokeStyle = `rgba(${gray},${gray},${gray},${line.a})`
    g.lineWidth = line.w
    g.beginPath()
    g.moveTo(line.x1, line.y1)
    g.lineTo(line.x2, line.y2)
    g.stroke()
  }
  for (const dot of scene.dots) {
    const gray = Math.round((dark ? 1 - dot.white : dot.white) * 255)
    g.fillStyle = `rgba(${gray},${gray},${gray},${dot.a ?? 1})`
    g.beginPath()
    g.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2)
    g.fill()
  }
}
