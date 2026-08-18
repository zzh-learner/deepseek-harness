/**
 * User configuration for the thinking-orb wallpaper: per-phase mode mapping
 * (which playground mode plays for each DSH activity phase), the idle mode
 * ('auto' keeps the curated rotation tour), plus density / speed / size
 * multipliers. Persisted to localStorage as one object.
 *
 * @module @deepseek-ai/dsh-client-ui-orbs/src/client/orbs/config
 */

import type { OrbMode, OrbOptions } from './engine.ts'
import { ORB_OPTIONS } from './engine.ts'
import type { OrbPhase } from './phase.ts'

/** The complete user-tunable set. */
export interface OrbsConfig {
  /** Phase → mode overrides; phases absent here keep the shipped mapping. */
  readonly phaseModes: Partial<Record<OrbPhase, OrbMode>>
  /** The idle (drift) mode: 'auto' rotates the curated tour, else pinned. */
  readonly idleMode: 'auto' | OrbMode
  /** Particle-count multiplier (scales every mode's count knobs). */
  readonly density: number
  /** Animation-speed multiplier on top of the busyness factor. */
  readonly speed: number
  /** Orb size multiplier against the measured conversation column. */
  readonly size: number
}

/** Shipped defaults: no overrides, tour idle, unit multipliers. */
export const DEFAULT_CONFIG: OrbsConfig = {
  phaseModes: {},
  idleMode: 'auto',
  density: 1,
  speed: 1,
  size: 1,
}

/** Chinese labels for the panel's phase rows. */
export const PHASE_LABELS: Readonly<Record<OrbPhase, string>> = {
  approval: '等待批准',
  error: '回合出错',
  settle: '回合完成',
  delegating: '子代理运行',
  searching: '搜索中',
  weaving: '写入文件',
  tooling: '工具调用',
  wave: '流式输出',
  pulse: '思考中',
  drift: '空闲',
}

/** Chinese labels for the panel's mode options. */
export const MODE_LABELS: Readonly<Record<OrbMode, string>> = {
  orbits: '轨道',
  globe: '扫描球仪',
  rubik: '魔方',
  wave: '呼吸波',
  web: '信号网络',
  braid: '编织',
  ribbon: '缎带',
  ring: '光环',
  morph: '形变',
}

/** Every selectable mode, in tour order. */
export const ALL_MODES: readonly OrbMode[] = [
  'morph', 'orbits', 'globe', 'rubik', 'ribbon', 'wave', 'web', 'braid', 'ring',
]

const STORAGE_KEY = 'dsh.ui-orbs.config.v1'

/**
 * Load the persisted config, falling back to defaults on any damage.
 * @returns the persisted config, or the shipped defaults.
 */
export function loadConfig(): OrbsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_CONFIG
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CONFIG
    const p = parsed as Partial<OrbsConfig>
    // localStorage JSON may hold values the static cast does not admit (JSON
    // null); reading through `unknown` keeps the runtime null rejection
    // visible to the compiler instead of lying on the Partial type.
    const rawModes: unknown = p.phaseModes
    const rawIdle: unknown = p.idleMode
    return {
      phaseModes: typeof rawModes === 'object' && rawModes !== null ? rawModes as OrbsConfig['phaseModes'] : {},
      idleMode: rawIdle === undefined || rawIdle === null ? 'auto' : rawIdle as OrbsConfig['idleMode'],
      density: typeof p.density === 'number' && Number.isFinite(p.density) ? p.density : 1,
      speed: typeof p.speed === 'number' && Number.isFinite(p.speed) ? p.speed : 1,
      size: typeof p.size === 'number' && Number.isFinite(p.size) ? p.size : 1,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

/**
 * Persist the config; failures keep it session-local.
 * @param config - the config to persist.
 */
export function saveConfig(config: OrbsConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch { /* session-only */ }
}

/** Count knobs each mode scales under the density multiplier. */
const COUNT_FIELDS: Readonly<Record<OrbMode, readonly (keyof OrbOptions)[]>> = {
  orbits: ['orbitN', 'ghostN', 'particles'],
  globe: ['latRings', 'lonDensity'],
  wave: ['rings', 'lonDensity'],
  web: ['nodeN', 'signals'],
  braid: ['strandN', 'ghostN'],
  ribbon: ['segs', 'ghostN'],
  ring: ['segs'],
  rubik: ['latRings', 'lonDensity'],
  // morph's dot count is derived internally from the canvas size; density
  // has no knob to scale there.
  morph: [],
}

/**
 * Engine overrides realizing the density multiplier for one mode.
 * @param mode - the mode being rendered.
 * @param density - the user multiplier.
 * @returns partial options scaled off the hand-tuned table.
 */
export function densityOverrides(mode: OrbMode, density: number): OrbOptions {
  if (density === 1) return {}
  const scaled: Record<string, number> = {}
  const table = ORB_OPTIONS[mode]
  for (const field of COUNT_FIELDS[mode]) {
    const base = table[field as keyof typeof table]
    if (typeof base === 'number') scaled[field] = Math.max(1, Math.round(base * density))
  }
  return scaled
}
