// @vitest-environment jsdom
/**
 * Conversation-column measurement and theme darkness: the column box parses
 * the layout frame's inline grid tracks from the marked overlay ancestor and
 * falls back to null on every unrecognized shell shape; darkness reads the
 * resolved base-background token with hex, short hex, and rgb() forms.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { conversationBox, pageIsDark } from '../src/client/orbs/measure.ts'

let cleanupFns: (() => void)[] = []

afterEach(() => {
  for (const fn of cleanupFns) fn()
  cleanupFns = []
  document.body.innerHTML = ''
})

/** Mount canvas → overlay → frame with the given inline tracks and rect. */
function mount(tracks: string | undefined, rect: { left: number; width: number } | null): HTMLCanvasElement {
  const frame = document.createElement('div')
  if (tracks !== undefined) frame.style.gridTemplateColumns = tracks
  if (rect !== null) {
    const box = rect
    const asRect = {
      left: box.left,
      top: 0,
      width: box.width,
      height: 800,
      right: box.left + box.width,
      bottom: 800,
      x: box.left,
      y: 0,
      toJSON: () => ({}),
    }
    frame.getBoundingClientRect = () => asRect
    cleanupFns.push(() => { delete (frame as { getBoundingClientRect?: unknown }).getBoundingClientRect })
  }
  const overlay = document.createElement('div')
  overlay.setAttribute('data-shell-overlay', '')
  const canvas = document.createElement('canvas')
  overlay.appendChild(canvas)
  frame.appendChild(overlay)
  document.body.appendChild(frame)
  return canvas
}

describe('conversationBox', () => {
  it('derives the center column from the frame grid tracks', () => {
    const canvas = mount('250px minmax(0, 1fr) 320px', { left: 10, width: 1200 })
    expect(conversationBox(canvas)).toEqual({ left: 260, width: 630 })
  })

  it('collapses to the full frame without a details pane', () => {
    const canvas = mount('250px minmax(0, 1fr) 0px', { left: 0, width: 1000 })
    expect(conversationBox(canvas)).toEqual({ left: 250, width: 750 })
  })

  it('returns null without the overlay mark, the frame, tracks, or a visible frame', () => {
    const bare = document.createElement('canvas')
    document.body.appendChild(bare)
    expect(conversationBox(bare)).toBeNull()
    expect(conversationBox(null)).toBeNull()

    expect(conversationBox(mount(undefined, { left: 0, width: 800 }))).toBeNull()
    expect(conversationBox(mount('1fr 1fr 1fr', { left: 0, width: 800 }))).toBeNull()
    expect(conversationBox(mount('250px minmax(0, 1fr) 320px', null))).toBeNull()
  })

  it('rejects a non-matching track shape and a zero-width frame', () => {
    expect(conversationBox(mount('1fr 1fr 1fr', { left: 0, width: 800 }))).toBeNull()
  })
})

describe('pageIsDark', () => {
  it('reads darkness from the resolved base-background token', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)

    el.style.setProperty('--dsw-alias-bg-base', '#070707')
    expect(pageIsDark(el)).toBe(true)

    el.style.setProperty('--dsw-alias-bg-base', '#ffffff')
    expect(pageIsDark(el)).toBe(false)

    el.style.setProperty('--dsw-alias-bg-base', 'rgb(10, 10, 10)')
    expect(pageIsDark(el)).toBe(true)

    el.style.setProperty('--dsw-alias-bg-base', '#abc')
    expect(pageIsDark(el)).toBe(false)

    // Malformed values read as light: an odd hex length, a truncated rgb(),
    // and an unknown prefix never crash the cadence check.
    el.style.setProperty('--dsw-alias-bg-base', '#12345')
    expect(pageIsDark(el)).toBe(false)

    el.style.setProperty('--dsw-alias-bg-base', 'rgb(1, 2)')
    expect(pageIsDark(el)).toBe(false)

    el.style.setProperty('--dsw-alias-bg-base', 'hsl(0, 0%, 4%)')
    expect(pageIsDark(el)).toBe(false)

    el.style.removeProperty('--dsw-alias-bg-base')
    expect(pageIsDark(el)).toBe(false)
    expect(pageIsDark(null)).toBe(false)
  })
})
