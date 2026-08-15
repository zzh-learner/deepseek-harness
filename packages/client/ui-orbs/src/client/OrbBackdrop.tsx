/**
 * The thinking-orb background component: one hero canvas centered on the
 * conversation column, rendering the playground mode that matches the live
 * phase. Facts arrive through the standard sessions hook (running bits,
 * pending approval, running lineage) plus the current session's `orbActivity`
 * projection value; all timing — outcome holds, idle rotation, crossfades —
 * is component-internal behavioral state on the animation clock, so nothing
 * here subscribes outside the framework seats.
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges ui-layout's 'shell.overlay' declaration into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: merges the orbActivity key into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-orb-state/client'
import type { OrbActivityProjection } from '@deepseek-ai/dsh-orb-state/client'
import { ORB_ROTATION, ORB_SPEEDS, orbScene, pick, type OrbMode } from './orbs/engine.ts'
import { paintScene } from './orbs/paint.ts'
import { orbPhase, orbSpeed, PHASE_MODE, type OrbFacts, type OrbPhase } from './orbs/phase.ts'
import { conversationBox, pageIsDark } from './orbs/measure.ts'
import css from './OrbBackdrop.module.css'

/** Crossfade length between modes, seconds. */
const FADE_SECONDS = 0.9

/** Idle rotation period, seconds. */
const ROTATE_SECONDS = 9

/** Settle hold after a cleanly completed turn, ms. */
const SETTLE_HOLD_MS = 1700

/** Error hold after a failed turn, ms. */
const ERROR_HOLD_MS = 3200

/** Theme re-check cadence (frames); getComputedStyle is not free. */
const THEME_CHECK_FRAMES = 60

/** Layout re-check cadence (frames); the ResizeObserver handles the rest. */
const LAYOUT_CHECK_FRAMES = 30

/** Canvas props of the orb host. */
export type OrbBackdropProps = PropsRuntime<'shell.overlay'>

/**
 * The thinking-orb background: renders one centered canvas driven by the
 * live session phase.
 * @param props - the shell.overlay standard props (useSessions).
 */
export function OrbBackdrop({ useSessions }: OrbBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [outcome, setOutcome] = useState<'error' | 'settle' | null>(null)

  const current = useSessions(s => s.current)
  const running = useSessions(s => (current !== undefined ? s.byId[current]?.running ?? false : false))
  const approval = useSessions(s =>
    Object.values(s.byId).some(row => row.pendingInteraction === 'approval'))
  const delegating = useSessions(s =>
    Object.values(s.byId).filter(row => row.parentId !== undefined && row.running).length)
  const runningCount = useSessions(s =>
    Object.values(s.byId).filter(row => row.running).length)
  const activity: OrbActivityProjection | undefined = useSessions(s =>
    (current !== undefined ? s.byId[current]?.projectionValues?.orbActivity : undefined))

  // Latest render-time facts for the animation loop (a ref, not state: the
  // loop samples at frame cadence and never triggers renders).
  const factsRef = useRef<OrbFacts>({ running: false, approval: false, delegating: 0, openTools: [], streaming: false })
  factsRef.current = {
    running,
    approval,
    delegating,
    openTools: activity?.openTools ?? [],
    streaming: activity?.streaming ?? false,
  }
  const countersRef = useRef({ runningCount: 1, toolsOpen: false })
  countersRef.current = { runningCount: Math.max(1, runningCount), toolsOpen: (activity?.openTools.length ?? 0) > 0 }
  const activityRef = useRef<OrbActivityProjection | undefined>(undefined)
  activityRef.current = activity

  useEffect(() => {
    const canvasEl = canvasRef.current
    /* v8 ignore next -- React attaches the ref before effects run; only a
       host bug nulls it between render and effect. */
    if (canvasEl === null) return
    const ctx2d = canvasEl.getContext('2d')
    if (ctx2d === null) return
    const canvas: HTMLCanvasElement = canvasEl
    const g: CanvasRenderingContext2D = ctx2d
    // Capped device pixel ratio, read per call so moving the window between
    // displays retimes it; the same global the layout frame uses for rAF.
    const dprOf = (): number => Math.min(2, window.devicePixelRatio)

    let width = 0
    let height = 0
    let cellX = 0
    let cellY = 0
    let cellSize = 0
    let dark = false
    let frameNo = 0
    let clock = 0
    let lastStamp = 0
    let raf = 0
    let disposed = false

    // One orb's mode bookkeeping.
    let mode: OrbMode = 'morph'
    let prevMode: OrbMode | null = null
    let since = 0
    let rotation = 0
    let nextRotation = ROTATE_SECONDS
    // Outcome holds: edge-triggered off the projection's monotonic counter.
    let seenSeq: number | null = null
    let settleUntil = 0
    let errorUntil = 0
    let shownOutcome: 'error' | 'settle' | null = null

    const reduced = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

    function relayout(): void {
      width = canvas.clientWidth
      height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      const box = conversationBox(canvas)
      const columnWidth = box?.width ?? width
      cellX = (box?.left ?? 0) + columnWidth / 2
      cellY = height * 0.48
      cellSize = Math.min(560, Math.max(180, Math.min(height * 0.66, columnWidth * 0.52)))
      const dpr = dprOf()
      const pw = Math.round(width * dpr)
      const ph = Math.round(height * dpr)
      if (canvas.width !== pw) canvas.width = pw
      if (canvas.height !== ph) canvas.height = ph
    }

    /** Resolve the mode for a phase, rotating while idle and crossfading changes. */
    function modeFor(now: number, phase: OrbPhase): OrbMode {
      if (phase === 'drift') {
        if (now >= nextRotation) {
          rotation += 1
          nextRotation = now + ROTATE_SECONDS
          prevMode = mode
          // A non-empty rotation table indexed by modular arithmetic cannot
          // yield undefined; pick asserts the in-range read for the same
          // reason the engine's generators do.
          mode = pick(ORB_ROTATION, rotation % ORB_ROTATION.length)
          since = now
        }
        return mode
      }
      const want = PHASE_MODE[phase]
      if (mode !== want) {
        prevMode = mode
        mode = want
        since = now
      }
      return mode
    }

    function draw(now: number, phase: OrbPhase): void {
      if (width <= 0 || cellSize <= 0) return
      const dpr = dprOf()
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, width, height)
      const speed = orbSpeed(countersRef.current.runningCount, countersRef.current.toolsOpen)
      const currentMode = modeFor(now, phase)
      const k = prevMode === null ? 1 : Math.min(1, (now - since) / FADE_SECONDS)
      if (k >= 1) prevMode = null
      g.save()
      g.translate(cellX - cellSize / 2, cellY - cellSize / 2)
      if (prevMode !== null) {
        g.globalAlpha = 1 - k
        paintScene(g, orbScene(prevMode, cellSize, now * ORB_SPEEDS[prevMode]), dark)
      }
      g.globalAlpha = k
      paintScene(g, orbScene(currentMode, cellSize, now * ORB_SPEEDS[currentMode] * speed), dark)
      g.restore()
      g.globalAlpha = 1
    }

    function frame(stamp: number): void {
      if (disposed) return
      raf = requestAnimationFrame(frame)
      const dt = lastStamp === 0 ? 1 / 60 : Math.min(0.1, (stamp - lastStamp) / 1000)
      lastStamp = stamp
      clock += dt
      frameNo += 1

      if (frameNo % LAYOUT_CHECK_FRAMES === 1) {
        const w = canvas.clientWidth
        const h = canvas.clientHeight
        if (Math.abs(w - width) > 2 || Math.abs(h - height) > 2) relayout()
      }
      if (frameNo % THEME_CHECK_FRAMES === 1) dark = pageIsDark(canvas)

      // Outcome windows from the projection counter.
      const live = activityRef.current
      const wall = performance.now()
      if (live !== undefined && live.outcomeSeq !== seenSeq) {
        seenSeq = live.outcomeSeq
        if (live.outcome === 'error') errorUntil = wall + ERROR_HOLD_MS
        else if (live.outcome === 'settle') settleUntil = wall + SETTLE_HOLD_MS
      }
      const nextOutcome = wall < errorUntil ? 'error' : wall < settleUntil ? 'settle' : null
      if (nextOutcome !== shownOutcome) {
        shownOutcome = nextOutcome
        setOutcome(nextOutcome)
      }

      draw(clock, orbPhase(factsRef.current, { error: wall < errorUntil, settle: wall < settleUntil }))
    }

    relayout()
    dark = pageIsDark(canvas)
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { relayout() })
      : null
    observer?.observe(canvas)
    if (reduced) {
      draw(0.6, 'drift')
    } else {
      raf = requestAnimationFrame(frame)
    }

    return () => {
      disposed = true
      observer?.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className={css.host} aria-hidden="true">
      <canvas ref={canvasRef} className={css.canvas} />
      <div className={`${css.wash} ${css.washError}`} data-on={outcome === 'error' || undefined} />
      <div className={`${css.wash} ${css.washSettle}`} data-on={outcome === 'settle' || undefined} />
    </div>
  )
}
