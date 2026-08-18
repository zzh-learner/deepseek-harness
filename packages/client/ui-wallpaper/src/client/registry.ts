/**
 * The wallpaper registry core: registration list, current selection, and
 * localStorage persistence. Framework-free so the Settings section and the
 * service share one implementation.
 *
 * @module @deepseek-ai/dsh-client-ui-wallpaper/src/client/registry
 */

/** One background layer's registration descriptor. */
export interface WallpaperDescriptor {
  /** Stable id; the selection persists by it. */
  readonly id: string
  /** Display label in the Settings section. */
  readonly label: string
  /** Optional note line under the label. */
  readonly note?: string
  /** Show the layer (called when it becomes the selection). */
  readonly show: () => void
  /** Hide the layer and pause its render loop. */
  readonly hide: () => void
}

/** One row the Settings section renders. */
export interface WallpaperRow {
  readonly id: string
  readonly label: string
  readonly note?: string
}

/** The registry service face (also the section's data source). */
export interface WallpaperRegistry {
  /** Register one layer; returns its disposer. */
  register(desc: WallpaperDescriptor): () => void
  /** Rows for the section: registered wallpapers, then the terminal rows. */
  list(): readonly WallpaperRow[]
  /** The current selection id. */
  current(): string
  /** Select an id; unknown ids are ignored. */
  select(id: string): void
  /** Change notification for reactive readers. */
  subscribe(fn: () => void): () => void
}

/** localStorage key for the persisted selection. */
export const WALLPAPER_STORAGE_KEY = 'dsh.wallpaper.selected.v1'

/** The terminal rows every composition offers. */
const BUILTIN: readonly WallpaperRow[] = [
  { id: 'none', label: '无壁纸', note: '纯净背景' },
]

interface StoredLayer {
  readonly desc: WallpaperDescriptor
}

function readStoredSelection(): string | null {
  try {
    const raw = localStorage.getItem(WALLPAPER_STORAGE_KEY)
    return typeof raw === 'string' && raw !== '' ? raw : null
  } catch {
    return null
  }
}

function writeStoredSelection(id: string): void {
  try {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, id)
  } catch {
    /* Private-mode storage: selection stays session-local. */
  }
}

/**
 * Build the registry with its selection applied to registrants.
 * @returns the registry face.
 */
export function createWallpaperRegistry(): WallpaperRegistry {
  const layers = new Map<string, StoredLayer>()
  const listeners = new Set<() => void>()
  // Default to the blackhole wallpaper when nothing is persisted yet; an
  // unknown persisted id (a removed plugin) falls back at first list().
  let selected = readStoredSelection() ?? 'gargantua'

  const notify = (): void => {
    for (const fn of listeners) fn()
  }
  const applyTo = (layer: StoredLayer, visible: boolean): void => {
    try {
      if (visible) layer.desc.show()
      else layer.desc.hide()
    } catch {
      /* A misbehaving layer must not break selection changes. */
    }
  }

  return {
    register(desc) {
      const layer: StoredLayer = { desc }
      layers.set(desc.id, layer)
      applyTo(layer, desc.id === selected)
      notify()
      return () => {
        if (layers.get(desc.id) !== layer) return
        layers.delete(desc.id)
        if (selected === desc.id) {
          selected = 'none'
          writeStoredSelection(selected)
        }
        notify()
      }
    },
    list() {
      const rows: WallpaperRow[] = []
      for (const layer of layers.values()) {
        rows.push(layer.desc.note === undefined
          ? { id: layer.desc.id, label: layer.desc.label }
          : { id: layer.desc.id, label: layer.desc.label, note: layer.desc.note })
      }
      if (![...layers.keys(), ...BUILTIN.map(b => b.id)].includes(selected)) {
        selected = 'none'
      }
      return [...rows, ...BUILTIN]
    },
    current() {
      return selected
    },
    select(id) {
      if (id === selected) return
      if (id !== 'none' && !layers.has(id)) return
      for (const layer of layers.values()) applyTo(layer, layer.desc.id === id)
      selected = id
      writeStoredSelection(id)
      notify()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}
