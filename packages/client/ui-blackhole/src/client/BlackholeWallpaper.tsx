/**
 * The GARGANTUA wallpaper component: the full-screen WebGL2 canvas plus the
 * collapsible right-hand control panel (presets, accretion-disk / spacetime /
 * sky / render sliders, FPS stats, screenshot). Panel state is React state
 * persisted to localStorage; visibility is driven by the wallpaper registry
 * through a module-level bridge (the registry may hide the layer before the
 * component ever mounts).
 *
 * @module @deepseek-ai/dsh-client-ui-blackhole/src/client/BlackholeWallpaper
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { EngineStats } from './engine.ts'
import { createEngine } from './engine.ts'
import type { Engine } from './engine.ts'
import css from './BlackholeWallpaper.module.css'

/** All panel-tunable values; persisted as one object. */
export interface PanelParams {
  diskIn: number
  diskOut: number
  temp: number
  bright: number
  spin: number
  turb: number
  rs: number
  lens: number
  doppler: number
  starDens: number
  starBright: number
  nebula: number
  bloom: number
  exposure: number
  dim: number
  cssOpacity: number
}

const DEFAULTS: PanelParams = {
  diskIn: 3.0, diskOut: 14.0, temp: 0.85, bright: 1.0, spin: 1.0, turb: 0.55,
  rs: 1.0, lens: 1.0, doppler: 0.7,
  starDens: 0.5, starBright: 1.0, nebula: 0.35,
  bloom: 0.7, exposure: 1.15,
  dim: 0.0, cssOpacity: 0.25,
}

const PRESETS: Record<string, Partial<PanelParams>> = {
  movie: { rs: 1, lens: 1, doppler: 0.55, temp: 0.85, bright: 1.0, spin: 1.0, turb: 0.5, bloom: 0.7, exposure: 1.15 },
  real: { rs: 1, lens: 1, doppler: 1.5, temp: 1.0, bright: 1.1, spin: 1.2, turb: 0.6, bloom: 0.6, exposure: 1.1 },
  hot: { rs: 1, lens: 1, doppler: 1.1, temp: 1.25, bright: 1.2, spin: 1.5, turb: 0.65, bloom: 0.9, exposure: 1.0 },
}

interface Section { readonly title: string; readonly rows: readonly Row[] }
interface Row {
  readonly label: string
  readonly unit: string
  readonly key: keyof PanelParams
  readonly min: number
  readonly max: number
  readonly step: number
  readonly dec: number
}

const SECTIONS: readonly Section[] = [
  {
    title: '吸积盘',
    rows: [
      { label: '内径', unit: 'Rs', key: 'diskIn', min: 1.5, max: 10, step: 0.1, dec: 1 },
      { label: '外径', unit: 'Rs', key: 'diskOut', min: 5, max: 30, step: 0.5, dec: 1 },
      { label: '色温', unit: '', key: 'temp', min: 0.3, max: 1.3, step: 0.01, dec: 2 },
      { label: '亮度', unit: '', key: 'bright', min: 0.2, max: 3, step: 0.05, dec: 2 },
      { label: '旋转速度', unit: '', key: 'spin', min: 0, max: 3, step: 0.05, dec: 2 },
      { label: '湍流强度', unit: '', key: 'turb', min: 0, max: 1, step: 0.05, dec: 2 },
    ],
  },
  {
    title: '时空与引力',
    rows: [
      { label: '黑洞尺度', unit: 'Rs', key: 'rs', min: 0.5, max: 2, step: 0.05, dec: 2 },
      { label: '引力透镜强度', unit: '', key: 'lens', min: 0, max: 1.5, step: 0.05, dec: 2 },
      { label: '多普勒效应', unit: '', key: 'doppler', min: 0, max: 2, step: 0.05, dec: 2 },
    ],
  },
  {
    title: '星空背景',
    rows: [
      { label: '星星密度', unit: '', key: 'starDens', min: 0, max: 1, step: 0.05, dec: 2 },
      { label: '星星亮度', unit: '', key: 'starBright', min: 0, max: 2.5, step: 0.05, dec: 2 },
      { label: '星云强度', unit: '', key: 'nebula', min: 0, max: 1.5, step: 0.05, dec: 2 },
    ],
  },
]

const STORAGE_KEY = 'dsh.ui-blackhole.params.v1'

function loadParams(): PanelParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULTS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS
    return { ...DEFAULTS, ...(parsed as Partial<PanelParams>) }
  } catch {
    return DEFAULTS
  }
}

function saveParams(p: PanelParams): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* session-only then */ }
}

/** Registry → component visibility bridge; set on mount, read at registration time. */
export const visibility = { apply: null as ((on: boolean) => void) | null, desired: true }

/** One labeled range slider row. */
function SliderRow(props: {
  p: PanelParams
  row: Row
  onChange: (key: keyof PanelParams, value: number) => void
}) {
  const { row, p } = props
  return (
    <div className={css.row}>
      <div className={css.labline}>
        <span>{row.label}{row.unit !== '' && <em>&nbsp;{row.unit}</em>}</span>
        <span className={css.val}>{p[row.key].toFixed(row.dec)}</span>
      </div>
      <input
        type="range"
        min={String(row.min)}
        max={String(row.max)}
        step={String(row.step)}
        value={String(p[row.key])}
        onChange={(e) => { props.onChange(row.key, Number(e.target.value)) }}
      />
    </div>
  )
}

/** The GARGANTUA wallpaper entry. */
export function BlackholeWallpaper() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const [p, setP] = useState<PanelParams>(loadParams)
  const [stats, setStats] = useState<EngineStats>({ fps: '--', res: '--', steps: '--' })
  const [quality, setQualityState] = useState(1)
  const [autoRotate, setAutoRotate] = useState(true)
  const [interactive, setInteractive] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const api = createEngine(canvasRef.current, {
      onStats: setStats,
      onQuality: (i) => { setQualityState(i) },
      onFatal: (m) => { setError(m) },
    })
    engineRef.current = api

    visibility.apply = (on: boolean): void => {
      if (hostRef.current !== null) hostRef.current.style.display = on ? '' : 'none'
      if (engineRef.current !== null) {
        if (on) engineRef.current.resume()
        else engineRef.current.pause()
      }
    }
    visibility.apply(visibility.desired)

    return () => {
      visibility.apply = null
      api.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setParams(p)
    saveParams(p)
  }, [p])

  useEffect(() => { engineRef.current?.setAutoRotate(autoRotate) }, [autoRotate])

  const upd = (key: keyof PanelParams, value: number): void => {
    setP(prev => ({ ...prev, [key]: value }))
  }
  const applyPreset = (id: string): void => {
    const preset = PRESETS[id]
    /* v8 ignore next -- the three preset buttons pass fixed ids that all exist in PRESETS */
    if (preset !== undefined) setP(prev => ({ ...prev, ...preset }))
  }

  const slider = (row: Row): ReactElement => <SliderRow key={row.key} row={row} p={p} onChange={upd} />

  return (
    <div
      ref={hostRef}
      className={css.host}
      aria-hidden="true"
      data-collapsed={collapsed ? '' : undefined}
      data-interactive={interactive ? '' : undefined}
    >
      <canvas ref={canvasRef} className={css.canvas} style={{ opacity: p.cssOpacity }} />
      <button className={css.open} title="展开面板" onClick={() => { setCollapsed(false) }}>⟨</button>
      <aside className={css.panel}>
        <button className={css.toggle} title="收起面板" onClick={() => { setCollapsed(true) }}>⟩</button>
        <header className={css.head}>
          <h1>GARGANTUA</h1>
          <p className={css.sub}>卡冈图雅 · 黑洞壁纸</p>
        </header>
        {error !== ''
          ? <div className={css.fatal}>{error}</div>
          : (
            <div className={css.stats}>
              <div className={css.stat}><b>{stats.fps}</b>FPS</div>
              <div className={css.stat}><b>{stats.res}</b>分辨率</div>
              <div className={css.stat}><b>{stats.steps}</b>积分步</div>
            </div>
          )}
        <div className={css.presets}>
          <button onClick={() => { applyPreset('movie') }}>电影模式</button>
          <button onClick={() => { applyPreset('real') }}>物理真实</button>
          <button onClick={() => { applyPreset('hot') }}>炽热蓝盘</button>
        </div>
        <section className={css.sec}>
          <h2>壁纸</h2>
          <SliderRow p={p} row={{ label: '壁纸浓度', unit: '', key: 'cssOpacity', min: 0, max: 1, step: 0.05, dec: 2 }} onChange={upd} />
          <SliderRow p={p} row={{ label: '背景暗化', unit: '', key: 'dim', min: 0, max: 0.8, step: 0.05, dec: 2 }} onChange={upd} />
          <div className={`${css.row} ${css.checkline}`}>
            <label>
              <input type="checkbox" checked={interactive} onChange={(e) => { setInteractive(e.target.checked) }} />
              交互模式（拖拽旋转 · 滚轮缩放）
            </label>
          </div>
        </section>
        {SECTIONS.map(s => (
          <section className={css.sec} key={s.title}>
            <h2>{s.title}</h2>
            {s.rows.map(slider)}
          </section>
        ))}
        <section className={css.sec}>
          <h2>渲染</h2>
          <div className={css.row}>
            <div className={css.labline}><span>画质</span></div>
            <select
              value={String(quality)}
              onChange={(e) => {
                const i = Number(e.target.value)
                setQualityState(i)
                engineRef.current?.setQuality(i, true)
              }}
            >
              <option value="0">低（性能优先）</option>
              <option value="1">中（推荐）</option>
              <option value="2">高（效果优先）</option>
            </select>
          </div>
          <SliderRow p={p} row={{ label: '泛光强度', unit: '', key: 'bloom', min: 0, max: 2, step: 0.05, dec: 2 }} onChange={upd} />
          <SliderRow p={p} row={{ label: '曝光', unit: '', key: 'exposure', min: 0.3, max: 2.5, step: 0.05, dec: 2 }} onChange={upd} />
          <div className={`${css.row} ${css.checkline}`}>
            <label>
              <input type="checkbox" checked={autoRotate} onChange={(e) => { setAutoRotate(e.target.checked) }} />
              自动旋转
            </label>
            <button className={css.mini} onClick={() => { engineRef.current?.capture() }}>保存截图</button>
          </div>
        </section>
        <footer className={css.foot}>
          开启交互模式后：拖拽旋转 · 滚轮/双指缩放<br />
          关闭交互模式即恢复界面正常操作；透镜强度拉到 0 可对比平直时空
        </footer>
      </aside>
    </div>
  )
}
