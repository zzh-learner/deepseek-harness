// @vitest-environment jsdom
/**
 * The OrbBackdrop component: mounts a canvas sized to its client box and
 * paints grayscale ink through a stubbed 2D context on every pumped frame;
 * phase changes flow from the sessions stub into distinct scenes; outcome
 * edges toggle the tinted washes; unmount stops the loop; reduced motion
 * draws once without a loop.
 */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrbBackdrop } from '../src/client/OrbBackdrop.tsx'
import type { OrbActivityProjection } from '@deepseek-ai/dsh-orb-state/client'
import { apply } from '../src/client/index.ts'

interface SessionsFixture {
  current?: string
  byId: Record<string, {
    running?: boolean
    parentId?: string
    pendingInteraction?: string
    projectionValues?: { orbActivity?: OrbActivityProjection }
  }>
}

type FrameCallback = (stamp: number) => void

/** Recording 2D context: the assertions read fill/stroke colors and arcs. */
function fakeContext() {
  const calls: { fill?: string; stroke?: string; arcs: number } = { arcs: 0 }
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
      set strokeStyle(v: string) { calls.stroke = v },
      get strokeStyle() { return calls.stroke ?? '' },
      set fillStyle(v: string) { calls.fill = v },
      get fillStyle() { return calls.fill ?? '' },
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

function backdropProps(fixture: SessionsFixture) {
  const useSessions = <T,>(select: (s: SessionsFixture) => T): T => select(fixture)
  return { useSessions } as unknown as Parameters<typeof OrbBackdrop>[0]
}

beforeEach(() => {
  frames = []
  rafId = 0
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
})

function stubCanvas(context: CanvasRenderingContext2D): void {
  // The stub answers only the "2d" overload; the remaining overloads are
  // unreachable through the component.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext
}

describe('OrbBackdrop', () => {
  it('paints grayscale ink each frame with a current session pointing nowhere', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { calls, context } = fakeContext()
    stubCanvas(context)

    // `current` names a row the list does not carry: the running and
    // activity selectors take their absent-row paths and render quiescent.
    const host = render(<OrbBackdrop {...backdropProps({ current: 'gone', byId: {} })} />)
    pump(16)
    expect(calls.arcs).toBeGreaterThan(0)
    host.unmount()
  })

  it('keeps quiescent selectors on a no-current list while others run', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { calls, context } = fakeContext()
    stubCanvas(context)

    // No `current` at all (the blank-session hero): cross-session selectors
    // still read approval/delegation from the list.
    const host = render(<OrbBackdrop {...backdropProps({
      byId: {
        parent: { running: true },
        child: { running: true, parentId: 'parent', pendingInteraction: 'approval' },
      },
    })} />)
    pump(16)
    expect(calls.arcs).toBeGreaterThan(0)
    host.unmount()
  })

  it('sizes the canvas and paints grayscale ink each frame', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { calls, context } = fakeContext()
    stubCanvas(context)

    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const canvas = host.container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas!.getAttribute('class')).toContain('canvas')

    pump(16)
    expect(calls.arcs).toBeGreaterThan(0)
    expect(calls.fill).toMatch(/^rgba\(\d+,\d+,\d+,/)
    const afterFirst = calls.arcs
    pump(32)
    expect(calls.arcs).toBeGreaterThan(afterFirst)

    host.unmount()
    const painted = calls.arcs
    pump(48)
    expect(calls.arcs).toBe(painted)
  })

  it('toggles the error wash on an error outcome edge and clears it after the hold', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { context } = fakeContext()
    stubCanvas(context)

    const fixture: SessionsFixture = {
      current: 's1',
      byId: {
        s1: {
          running: true,
          projectionValues: { orbActivity: { openTools: [], streaming: false, outcome: 'error', outcomeSeq: 1 } },
        },
      },
    }
    const host = render(<OrbBackdrop {...backdropProps(fixture)} />)
    const washes = () => Array.from(host.container.querySelectorAll('[data-on]'))
    // jsdom's clock is uptime-based; pin it so the hold math is deterministic.
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    await act(async () => { pump(16) })
    expect(washes().length).toBe(1)

    // 4s later (past the 3.2s hold): the wash retired.
    vi.mocked(performance.now).mockReturnValue(4200)
    await act(async () => { pump(4016) })
    expect(washes().length).toBe(0)
    vi.mocked(performance.now).mockRestore()
    host.unmount()
  })

  it('paints one static frame without a loop under reduced motion', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { calls, context } = fakeContext()
    stubCanvas(context)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    expect(calls.arcs).toBeGreaterThan(0)
    pump(16)
    const painted = calls.arcs
    pump(32)
    expect(calls.arcs).toBe(painted)
    host.unmount()
  })

  it('mounts nothing when the canvas has no 2D context', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null)

    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    // The component still renders its host; the loop never starts.
    expect(host.container.querySelector('canvas')).not.toBeNull()
    pump(16)
    pump(32)
    host.unmount()
  })

  it('paints nothing while the canvas has no measured box, then starts once sized', async () => {
    const box = { w: 0, h: 0 }
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => box.w })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => box.h })
    const { calls, context } = fakeContext()
    stubCanvas(context)

    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    await act(async () => { pump(16) })
    expect(calls.arcs).toBe(0)

    box.w = 1200
    box.h = 800
    await act(async () => { for (let i = 1; i <= 32; i++) pump(16 + i * 16) })
    expect(calls.arcs).toBeGreaterThan(0)
    host.unmount()
  })

  it('rotates the idle mode on the 9s cadence and crossfades to a phase change', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { calls, context } = fakeContext()
    stubCanvas(context)

    const fixture: SessionsFixture = { byId: {} }
    const props = { current: backdropProps(fixture) }
    const host = render(<OrbBackdrop {...props.current} />)
    // Advance the animation clock past the rotation boundary (9s at 60fps).
    await act(async () => { for (let i = 0; i < 580; i++) pump(16 + i * 16) })
    const afterRotation = calls.arcs
    expect(afterRotation).toBeGreaterThan(0)

    // A busy session mid-drift forces the mode change branch.
    props.current = backdropProps({
      current: 's1',
      byId: { s1: { running: true } },
    })
    host.rerender(<OrbBackdrop {...props.current} />)
    await act(async () => { pump(16 + 600 * 16) })
    expect(calls.arcs).toBeGreaterThan(afterRotation)
    host.unmount()
  })

  it('ignores a null-outcome counter bump without opening a window', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { context } = fakeContext()
    stubCanvas(context)

    // outcomeSeq moves with a null outcome (an aborted turn folded): the
    // seen-seq edge fires but neither hold window opens.
    const fixture: SessionsFixture = {
      current: 's1',
      byId: {
        s1: {
          running: false,
          projectionValues: { orbActivity: { openTools: [], streaming: false, outcome: null, outcomeSeq: 1 } },
        },
      },
    }
    const host = render(<OrbBackdrop {...backdropProps(fixture)} />)
    const washes = () => Array.from(host.container.querySelectorAll('[data-on]'))
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    await act(async () => { pump(16) })
    expect(washes().length).toBe(0)
    vi.mocked(performance.now).mockRestore()
    host.unmount()
  })

  it('toggles the settle wash after a clean turn and retires it with the loop idle', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { context } = fakeContext()
    stubCanvas(context)

    const fixture: SessionsFixture = {
      current: 's1',
      byId: {
        s1: {
          running: false,
          projectionValues: { orbActivity: { openTools: [], streaming: false, outcome: 'settle', outcomeSeq: 1 } },
        },
      },
    }
    const host = render(<OrbBackdrop {...backdropProps(fixture)} />)
    const washes = () => Array.from(host.container.querySelectorAll('[data-on]'))
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    await act(async () => { pump(16) })
    expect(washes().length).toBe(1)

    // Past the 1.7s settle hold the wash retires and the idle drift resumes.
    vi.mocked(performance.now).mockReturnValue(3000)
    await act(async () => { pump(4016) })
    expect(washes().length).toBe(0)
    vi.mocked(performance.now).mockRestore()
    host.unmount()
  })

  it('re-lays-out on a viewport change observed through the frame cadence', async () => {
    const width = { value: 1200 }
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => width.value })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { context } = fakeContext()
    stubCanvas(context)

    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    const canvas = host.container.querySelector('canvas')!
    await act(async () => { pump(16) })
    expect(canvas.width).toBe(1200) // jsdom's devicePixelRatio is 1

    width.value = 700
    // The layout re-check runs on the 30-frame cadence; advance past it.
    for (let i = 1; i <= 32; i++) await act(async () => { pump(16 + i * 16) })
    expect(canvas.width).toBe(700)
    host.unmount()
  })

  it('keeps painting across the theme-cadence re-check and a clamped dt jump', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { calls, context } = fakeContext()
    stubCanvas(context)

    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    // 70 frames crosses the 60-frame theme cadence; a 5s stamp jump takes the
    // dt clamp (0.1s) rather than a wall-following clock.
    for (let i = 0; i <= 70; i++) await act(async () => { pump(16 + i * 16) })
    await act(async () => { pump(400_000) })
    expect(calls.arcs).toBeGreaterThan(0)
    host.unmount()
  })

  it('observes the canvas through a defined ResizeObserver and re-lays-out on its callback', async () => {
    const width = { value: 1200 }
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => width.value })
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
    const { context } = fakeContext()
    stubCanvas(context)
    const observed: { observe(el: unknown): void; disconnect(): void }[] = []
    const resizeCallbacks: (() => void)[] = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { resizeCallbacks.push(cb) }
      observe(el: unknown): void { observed.push(this) ; void el }
      disconnect(): void {}
    })

    const host = render(<OrbBackdrop {...backdropProps({ byId: {} })} />)
    await act(async () => { pump(16) })
    expect(observed).toHaveLength(1)
    const canvas = host.container.querySelector('canvas')!
    expect(canvas.width).toBe(1200) // jsdom's devicePixelRatio is 1

    // A resize delivery re-runs relayout through the observer callback.
    width.value = 700
    await act(async () => { resizeCallbacks[0]!() })
    expect(canvas.width).toBe(700)
    host.unmount()
    expect(observed[0]).toBeDefined()
  })

  it('registers the shell.overlay entry through the plugin apply', () => {
    const registrations: { options: unknown; component: unknown }[] = []
    const ctx = {
      slots: {
        inject: (_name: string, install: () => unknown) => {
          install()
          return () => {}
        },
        register: (options: unknown, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
    }
    apply(ctx as never)
    expect(registrations).toHaveLength(1)
    expect((registrations[0]!.options as { id?: string }).id).toBe('orbs-backdrop')
    expect(registrations[0]!.component).toBe(OrbBackdrop)
  })
})
