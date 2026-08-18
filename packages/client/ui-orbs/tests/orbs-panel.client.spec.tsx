// @vitest-environment jsdom
/**
 * The configuration panel and the wallpaper visibility bridge: the
 * phase-mode selects and the three knobs write the persisted config, a size
 * change re-lays-out the canvas at once, and the registry-driven apply()
 * hides/shows the host while pausing and resuming the render loop —
 * including the pre-mount desired state, reduced motion, and stale
 * closures captured before unmount.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrbBackdrop, visibility } from '../src/client/OrbBackdrop.tsx'

interface SessionsFixture {
  current?: string
  byId: Record<string, { running?: boolean }>
}

type FrameCallback = (stamp: number) => void

/** Recording 2D context: only the arc count matters here. */
function fakeContext() {
  const calls = { arcs: 0 }
  return {
    calls,
    context: {
      setTransform: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => { calls.arcs += 1 },
      get globalAlpha() { return 1 },
      set globalAlpha(_v: number) {},
      set strokeStyle(_v: string) {},
      get strokeStyle() { return '' },
      set fillStyle(_v: string) {},
      get fillStyle() { return '' },
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D,
  }
}

let frames: FrameCallback[] = []
let rafId = 0

function pump(stampMs: number): void {
  const pending = frames
  frames = []
  for (const cb of pending) cb(stampMs)
}

const KEY = 'dsh.ui-orbs.config.v1'

function storedConfig(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
}

function backdropProps(fixture: SessionsFixture) {
  const useSessions = <T,>(select: (s: SessionsFixture) => T): T => select(fixture)
  return { useSessions } as unknown as Parameters<typeof OrbBackdrop>[0]
}

function sizedCanvas(width: { value: number }, height = 800): void {
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => width.value })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: height })
}

function stubCanvas(context: CanvasRenderingContext2D): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext
}

beforeEach(() => {
  frames = []
  rafId = 0
  localStorage.clear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameCallback) => {
    frames.push(cb)
    return ++rafId
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // Reset the module bridge so later cases start visible and detached.
  visibility.desired = true
  visibility.apply = null
})

describe('OrbBackdrop panel', () => {
  it('collapses the panel and expands it again', () => {
    sizedCanvas({ value: 1200 })
    stubCanvas(fakeContext().context)
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const panel = () => host.container.querySelector('aside')!
    const openButton = () => host.getByTitle('展开面板') as HTMLButtonElement
    expect(panel().hasAttribute('data-collapsed')).toBe(false)
    expect(openButton().hasAttribute('data-show')).toBe(false)

    fireEvent.click(host.getByTitle('收起面板'))
    expect(panel().hasAttribute('data-collapsed')).toBe(true)
    expect(openButton().hasAttribute('data-show')).toBe(true)

    fireEvent.click(openButton())
    expect(panel().hasAttribute('data-collapsed')).toBe(false)
    expect(openButton().hasAttribute('data-show')).toBe(false)
  })

  it('pins the idle mode from the drift select and returns to the tour', async () => {
    sizedCanvas({ value: 1200 })
    const { calls, context } = fakeContext()
    stubCanvas(context)
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const drift = () => host.container.querySelectorAll('select')[0]!
    expect(drift().value).toBe('auto')

    fireEvent.change(drift(), { target: { value: 'globe' } })
    expect(drift().value).toBe('globe')
    expect(storedConfig().idleMode).toBe('globe')
    // The pinned mode drives the loop on the next frames and stays pinned.
    await act(async () => { pump(16); pump(32); pump(48) })
    expect(calls.arcs).toBeGreaterThan(0)

    fireEvent.change(drift(), { target: { value: 'auto' } })
    expect(storedConfig().idleMode).toBe('auto')
    expect(drift().value).toBe('auto')
    await act(async () => { pump(64) })
  })

  it('overrides a phase mode and clears the override back to default', async () => {
    sizedCanvas({ value: 1200 })
    stubCanvas(fakeContext().context)
    const fixture: SessionsFixture = { current: 's1', byId: { s1: { running: true } } }
    const host = render(<OrbBackdrop {...backdropProps(fixture)} />)
    // A running session renders the pulse phase: panel row #2.
    const pulse = () => host.container.querySelectorAll('select')[1]!
    expect(pulse().value).toBe('default')

    fireEvent.change(pulse(), { target: { value: 'globe' } })
    expect(pulse().value).toBe('globe')
    expect(storedConfig().phaseModes).toEqual({ pulse: 'globe' })
    await act(async () => { pump(16); pump(32) })

    fireEvent.change(pulse(), { target: { value: 'default' } })
    expect(pulse().value).toBe('default')
    expect(storedConfig().phaseModes).toEqual({})
    await act(async () => { pump(48) })
  })

  it('moves the density, speed, and size knobs, persists each, and resets', () => {
    sizedCanvas({ value: 1200 })
    stubCanvas(fakeContext().context)
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const knobs = () => Array.from(host.container.querySelectorAll('input[type="range"]'))

    fireEvent.change(knobs()[0]!, { target: { value: '1.5' } })
    expect(storedConfig().density).toBe(1.5)
    expect(host.container.textContent).toContain('1.50')

    fireEvent.change(knobs()[1]!, { target: { value: '2.25' } })
    expect(storedConfig().speed).toBe(2.25)

    fireEvent.change(knobs()[2]!, { target: { value: '0.75' } })
    expect(storedConfig().size).toBe(0.75)

    fireEvent.click(host.getByText('恢复默认'))
    expect(storedConfig()).toEqual({ phaseModes: {}, idleMode: 'auto', density: 1, speed: 1, size: 1 })
    expect(host.container.textContent).toContain('1.00')
  })

  it('re-lays-out at once when the size knob changes', async () => {
    const width = { value: 1200 }
    sizedCanvas(width)
    stubCanvas(fakeContext().context)
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const canvas = host.container.querySelector('canvas')!
    await act(async () => { pump(16) })
    expect(canvas.width).toBe(1200)

    // The viewport moved but no frame ran; the size-knob effect must
    // relayout immediately, not on the 30-frame cadence.
    width.value = 700
    const size = host.container.querySelectorAll('input[type="range"]')[2]!
    fireEvent.change(size, { target: { value: '1.5' } })
    expect(canvas.width).toBe(700)
  })

  it('skips the size relayout when the loop never mounted', () => {
    sizedCanvas({ value: 1200 })
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const size = host.container.querySelectorAll('input[type="range"]')[2]!
    expect(() => fireEvent.change(size, { target: { value: '1.5' } })).not.toThrow()
    expect(storedConfig().size).toBe(1.5)
  })
})

describe('OrbBackdrop visibility bridge', () => {
  it('hides the host and pauses painting, then restores both', async () => {
    sizedCanvas({ value: 1200 })
    const { calls, context } = fakeContext()
    stubCanvas(context)
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const hostEl = () => host.container.firstElementChild as HTMLElement
    await act(async () => { pump(16) })
    const painted = calls.arcs
    expect(painted).toBeGreaterThan(0)

    act(() => { visibility.apply!(false) })
    expect(hostEl().style.display).toBe('none')
    await act(async () => { pump(32) })
    expect(calls.arcs).toBe(painted)

    act(() => { visibility.apply!(true) })
    expect(hostEl().style.display).toBe('')
    await act(async () => { pump(48) })
    expect(calls.arcs).toBeGreaterThan(painted)

    // Repeated bridge calls stay idempotent: show-while-shown and
    // hide-while-hidden are no-ops, and a later show still resumes.
    act(() => { visibility.apply!(true) })
    act(() => { visibility.apply!(false) })
    act(() => { visibility.apply!(false) })
    act(() => { visibility.apply!(true) })
    await act(async () => { pump(64) })
    expect(calls.arcs).toBeGreaterThan(painted)
  })

  it('honors a pre-mount hide request and paints once shown', async () => {
    sizedCanvas({ value: 1200 })
    const { calls, context } = fakeContext()
    stubCanvas(context)
    visibility.desired = false
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const hostEl = () => host.container.firstElementChild as HTMLElement
    expect(hostEl().style.display).toBe('none')
    await act(async () => { pump(16) })
    expect(calls.arcs).toBe(0)

    act(() => { visibility.apply!(true) })
    expect(hostEl().style.display).toBe('')
    await act(async () => { pump(32) })
    expect(calls.arcs).toBeGreaterThan(0)
  })

  it('clears the bridge on unmount and ignores stale closures', async () => {
    sizedCanvas({ value: 1200 })
    const { calls, context } = fakeContext()
    stubCanvas(context)
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    await act(async () => { pump(16) })
    const painted = calls.arcs
    const stale = visibility.apply
    expect(stale).not.toBeNull()

    host.unmount()
    expect(visibility.apply).toBeNull()
    // A closure captured before unmount cannot touch the detached host or
    // restart the disposed loop.
    act(() => { stale!(false); stale!(true) })
    await act(async () => { pump(64) })
    expect(calls.arcs).toBe(painted)
  })

  it('keeps a reduced-motion mount hidden and static through the bridge', async () => {
    sizedCanvas({ value: 1200 })
    const { calls, context } = fakeContext()
    stubCanvas(context)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const hostEl = () => host.container.firstElementChild as HTMLElement
    const staticDots = calls.arcs
    expect(staticDots).toBeGreaterThan(0)

    act(() => { visibility.apply!(false) })
    expect(hostEl().style.display).toBe('none')
    // Showing again restores the DOM but never starts a loop under reduced
    // motion: the single static frame stays.
    act(() => { visibility.apply!(true) })
    expect(hostEl().style.display).toBe('')
    await act(async () => { pump(16) })
    expect(calls.arcs).toBe(staticDots)
  })
})
