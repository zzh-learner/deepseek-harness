/**
 * The thinking-orb background component: one hero canvas centered on the
 * conversation column, rendering the playground mode that matches the live
 * phase. Facts arrive through the standard sessions hook (running bits,
 * pending approval, running lineage) plus the current session's `orbActivity`
 * projection value; all timing — outcome holds, idle rotation, crossfades —
 * is component-internal behavioral state on the animation clock, so nothing
 * here subscribes outside the framework seats. User configuration (phase →
 * mode mapping, idle mode, density / speed / size) rides a config ref the
 * frame loop samples; the collapsible panel edits it and persists to
 * localStorage. The wallpaper registry drives visibility through the
 * exported bridge — hiding pauses the render loop entirely.
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
import {
  ALL_MODES, DEFAULT_CONFIG, MODE_LABELS, PHASE_LABELS,
  densityOverrides, loadConfig, saveConfig, type OrbsConfig,
} from './orbs/config.ts'
import css from './OrbBackdrop.module.css'
import panelCss from './OrbsPanel.module.css'

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

/** Registry → component visibility bridge; read at registration time. */
export const visibility = { apply: null as ((on: boolean) => void) | null, desired: true }

/** Canvas props of the orb host. */
export type OrbBackdropProps = PropsRuntime<'shell.overlay'>

/** The phases the panel exposes, in attention order. */
const PANEL_PHASES: readonly OrbPhase[] = [
  'drift', 'pulse', 'wave', 'tooling', 'weaving', 'searching', 'delegating', 'settle', 'error', 'approval',
]

/**
 * The thinking-orb background: renders one centered canvas driven by the
 * live session phase.
 * @param props - the shell.overlay standard props (useSessions).
 */
export function OrbBackdrop({ useSessions }: OrbBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [outcome, setOutcome] = useState<'error' | 'settle' | null>(null)
  const [config, setConfig] = useState<OrbsConfig>(loadConfig)
  const [collapsed, setCollapsed] = useState(false)
  const configRef = useRef(config)
  configRef.current = config

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

  const relayoutRef = useRef<(() => void) | null>(null)

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
    let runningLoop = true

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
      const base = Math.min(560, Math.max(180, Math.min(height * 0.66, columnWidth * 0.52)))
      const cfg = configRef.current
      cellSize = Math.max(100, Math.min(base * cfg.size, Math.min(width, height) * 0.95))
      const dpr = dprOf()
      const pw = Math.round(width * dpr)
      const ph = Math.round(height * dpr)
      if (canvas.width !== pw) canvas.width = pw
      if (canvas.height !== ph) canvas.height = ph
    }
    relayoutRef.current = relayout

    /** The configured mode for a phase; null keeps the shipped behavior. */
    function modeForPhase(phase: OrbPhase): OrbMode | null {
      const cfg = configRef.current
      if (phase === 'drift') {
        return cfg.idleMode === 'auto' ? null : cfg.idleMode
      }
      return cfg.phaseModes[phase] ?? null
    }

    /** Resolve the mode for a phase, rotating while idle and crossfading changes. */
    function modeFor(now: number, phase: OrbPhase): OrbMode {
      if (phase === 'drift') {
        const pinned = modeForPhase('drift')
        if (pinned !== null) {
          if (mode !== pinned) {
            prevMode = mode
            mode = pinned
            since = now
          }
          return mode
        }
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
      const want = modeForPhase(phase) ?? PHASE_MODE[phase]
      if (mode !== want) {
        prevMode = mode
        mode = want
        since = now
      }
      return mode
    }

    function draw(now: number, phase: OrbPhase): void {
      if (width <= 0 || cellSize <= 0) return
      const cfg = configRef.current
      const dpr = dprOf()
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, width, height)
      const speed = orbSpeed(countersRef.current.runningCount, countersRef.current.toolsOpen) * cfg.speed
      const currentMode = modeFor(now, phase)
      const k = prevMode === null ? 1 : Math.min(1, (now - since) / FADE_SECONDS)
      if (k >= 1) prevMode = null
      g.save()
      g.translate(cellX - cellSize / 2, cellY - cellSize / 2)
      if (prevMode !== null) {
        g.globalAlpha = 1 - k
        paintScene(g, orbScene(prevMode, cellSize, now * ORB_SPEEDS[prevMode] * speed, densityOverrides(prevMode, cfg.density)), dark)
      }
      g.globalAlpha = k
      const dense = densityOverrides(currentMode, cfg.density)
      paintScene(g, orbScene(currentMode, cellSize, now * ORB_SPEEDS[currentMode] * speed, dense), dark)
      g.restore()
      g.globalAlpha = 1
    }

    function frame(stamp: number): void {
      if (disposed || !runningLoop) return
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

    function pauseLoop(): void {
      runningLoop = false
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = 0
    }
    function resumeLoop(): void {
      if (disposed || runningLoop || reduced) return
      runningLoop = true
      lastStamp = 0
      raf = requestAnimationFrame(frame)
    }

    // Registry visibility bridge: hide pauses the loop and the DOM; show
    // restores both. The desired state is synced once here because the
    // registry may have hidden the layer before this component mounted.
    visibility.apply = (on: boolean): void => {
      if (hostRef.current !== null) hostRef.current.style.display = on ? '' : 'none'
      if (on) resumeLoop()
      else pauseLoop()
    }
    visibility.apply(visibility.desired)

    if (reduced) {
      draw(0.6, 'drift')
    } else {
      raf = requestAnimationFrame(frame)
    }

    return () => {
      disposed = true
      visibility.apply = null
      observer?.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [])

  // Size changes need an immediate relayout (the frame loop polls slowly);
  // before the loop mounts (no 2D context) there is nothing to relayout.
  useEffect(() => { relayoutRef.current?.() }, [config.size])
  useEffect(() => { saveConfig(config) }, [config])

  const setPhaseMode = (phase: OrbPhase, value: string): void => {
    setConfig((prev) => {
      if (phase === 'drift') {
        const idleMode = value === 'auto' ? 'auto' as const : value as OrbMode
        return { ...prev, idleMode }
      }
      if (value === 'default') {
        const kept = Object.fromEntries(
          Object.entries(prev.phaseModes).filter(([key]) => key !== phase),
        ) as typeof prev.phaseModes
        return { ...prev, phaseModes: kept }
      }
      return { ...prev, phaseModes: { ...prev.phaseModes, [phase]: value as OrbMode } }
    })
  }
  const setKnob = (key: 'density' | 'speed' | 'size', value: number): void => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }
  const phaseValue = (phase: OrbPhase): string => {
    if (phase === 'drift') return config.idleMode
    return config.phaseModes[phase] ?? 'default'
  }

  return (
    <div ref={hostRef} className={css.host} aria-hidden="true">
      <canvas ref={canvasRef} className={css.canvas} />
      <div className={`${css.wash} ${css.washError}`} data-on={outcome === 'error' || undefined} />
      <div className={`${css.wash} ${css.washSettle}`} data-on={outcome === 'settle' || undefined} />
      <button className={panelCss.open} title="展开面板" data-show={collapsed ? '' : undefined} onClick={() => { setCollapsed(false) }}>⟨</button>
      <aside className={panelCss.panel} data-collapsed={collapsed ? '' : undefined}>
        <button className={panelCss.toggle} title="收起面板" onClick={() => { setCollapsed(true) }}>⟩</button>
        <header className={panelCss.head}>
          <h1>思考球体</h1>
          <p className={panelCss.sub}>ORBS · 会话活动背景</p>
        </header>
        <section className={panelCss.sec}>
          <h2>状态 → 球体</h2>
          {PANEL_PHASES.map(phase => (
            <div className={panelCss.row} key={phase}>
              <div className={panelCss.labline}><span>{PHASE_LABELS[phase]}</span></div>
              <select
                className={panelCss.select}
                value={phaseValue(phase)}
                onChange={(e) => { setPhaseMode(phase, e.target.value) }}
              >
                {phase === 'drift'
                  ? <option value="auto">自动轮换</option>
                  : <option value="default">默认（{MODE_LABELS[PHASE_MODE[phase]]}）</option>}
                {ALL_MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
              </select>
            </div>
          ))}
        </section>
        <section className={panelCss.sec}>
          <h2>参数</h2>
          <div className={panelCss.row}>
            <div className={panelCss.labline}>
              <span>粒子密度</span>
              <span className={panelCss.val}>{config.density.toFixed(2)}</span>
            </div>
            <input type="range" min="0.3" max="2.2" step="0.05" value={String(config.density)}
              onChange={(e) => { setKnob('density', Number(e.target.value)) }} />
          </div>
          <div className={panelCss.row}>
            <div className={panelCss.labline}>
              <span>速度</span>
              <span className={panelCss.val}>{config.speed.toFixed(2)}</span>
            </div>
            <input type="range" min="0.2" max="3" step="0.05" value={String(config.speed)}
              onChange={(e) => { setKnob('speed', Number(e.target.value)) }} />
          </div>
          <div className={panelCss.row}>
            <div className={panelCss.labline}>
              <span>球体大小</span>
              <span className={panelCss.val}>{config.size.toFixed(2)}</span>
            </div>
            <input type="range" min="0.5" max="1.5" step="0.05" value={String(config.size)}
              onChange={(e) => { setKnob('size', Number(e.target.value)) }} />
          </div>
          <div className={`${panelCss.row} ${panelCss.checkline}`}>
            <span />
            <button className={panelCss.mini} onClick={() => { setConfig(DEFAULT_CONFIG) }}>恢复默认</button>
          </div>
        </section>
        <footer className={panelCss.foot}>
          状态映射即时生效并保存在本地；形变模式无粒子密度参数
        </footer>
      </aside>
    </div>
  )
}
