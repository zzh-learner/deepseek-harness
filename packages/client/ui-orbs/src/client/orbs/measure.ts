/**
 * Conversation-column measurement: the hero orb centers on the middle grid
 * track of the three-column shell, so it must survive the sidebar collapsing
 * and the details pane opening. The sanctioned source is the layout frame's
 * own inline `grid-template-columns` (written by ui-layout's AppFrame), read
 * from the marked overlay layer's parent; DOM walking is read-only and
 * feature-detected, with the viewport center as the fallback.
 *
 * @module @deepseek-ai/dsh-client-ui-orbs/src/client/orbs/measure
 */

/** A measured center-column box in viewport coordinates. */
export interface ColumnBox {
  readonly left: number
  readonly width: number
}

/** The inline track format AppFrame writes: `<side>px minmax(0, 1fr) <details>px`. */
const TRACKS = /^([\d.]+)px minmax\(0, ?1fr\) ([\d.]+)px$/

/**
 * Measure the conversation column from an element inside the shell overlay.
 * @param el - any descendant of the overlay layer (the orb canvas).
 * @returns the column box, or null when the shell shape is not recognized.
 */
export function conversationBox(el: HTMLElement | null): ColumnBox | null {
  let overlay: HTMLElement | null = null
  let node: HTMLElement | null = el
  while (node !== null) {
    if (node.getAttribute('data-shell-overlay') !== null) {
      overlay = node
      break
    }
    node = node.parentElement
  }
  if (overlay === null) return null
  const frame = overlay.parentElement
  if (frame === null || frame.style.gridTemplateColumns === '') return null
  const match = TRACKS.exec(frame.style.gridTemplateColumns)
  if (match === null) return null
  // The TRACKS capture groups accept only digit/dot forms and the CSSOM
  // rejects NaN/Infinity spellings at parse, so both widths are finite here.
  const side = Number.parseFloat(pick(match, 1))
  const details = Number.parseFloat(pick(match, 2))
  const rect = frame.getBoundingClientRect()
  if (!(rect.width > 0)) return null
  return { left: rect.left + side, width: Math.max(0, rect.width - side - details) }
}

/**
 * Theme darkness from the resolved base-background token: ink flips toward
 * light when the page paints dark. Checked on a cadence, not per frame.
 * @param el - any element inheriting the shell's theme variables.
 * @returns true when the effective base background is dark.
 */
export function pageIsDark(el: HTMLElement | null): boolean {
  if (el === null) return false
  const raw = getComputedStyle(el).getPropertyValue('--dsw-alias-bg-base').trim()
  if (raw === '') return false
  const channels = parseChannels(raw)
  if (channels === null) return false
  // Rec. 601 luma; ink stays readable across themes either way.
  return (0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]) / 255 < 0.5
}

/** Checked-free capture-group read: the caller has just matched the regex. */
function pick(match: RegExpExecArray, group: number): string {
  return match[group] as string
}

/** Parse `#rgb`, `#rrggbb`, or `rgb(a, b, c)` into channel triple. */
function parseChannels(raw: string): readonly [number, number, number] | null {
  if (raw.startsWith('#')) {
    const hex = raw.slice(1)
    if (hex.length === 3) {
      return [
        Number.parseInt(hex.charAt(0) + hex.charAt(0), 16),
        Number.parseInt(hex.charAt(1) + hex.charAt(1), 16),
        Number.parseInt(hex.charAt(2) + hex.charAt(2), 16),
      ]
    }
    if (hex.length === 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ]
    }
    return null
  }
  const match = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(raw)
  if (match === null) return null
  return [Number(pick(match, 1)), Number(pick(match, 2)), Number(pick(match, 3))]
}
