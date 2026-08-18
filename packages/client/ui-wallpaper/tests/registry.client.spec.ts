// @vitest-environment jsdom
/**
 * The wallpaper registry core: default and persisted selection, registration
 * with show/hide application, the Settings row projection, selection
 * persistence in localStorage, and containment of misbehaving layers plus
 * unwritable storage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWallpaperRegistry, WALLPAPER_STORAGE_KEY } from '../src/client/registry.ts'
import type { WallpaperDescriptor } from '../src/client/registry.ts'

/** A recording layer whose show/hide calls the assertions read. */
function layer(id: string, label = `label-${id}`): WallpaperDescriptor & {
  show: ReturnType<typeof vi.fn<() => void>>
  hide: ReturnType<typeof vi.fn<() => void>>
} {
  return { id, label, show: vi.fn(), hide: vi.fn() }
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

describe('createWallpaperRegistry', () => {
  it('defaults to the gargantua wallpaper when nothing is persisted', () => {
    const registry = createWallpaperRegistry()
    expect(registry.current()).toBe('gargantua')
    expect(registry.list().map(row => row.id)).toEqual(['none'])
  })

  it('rehydrates a persisted selection and applies it on registration', () => {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, 'nebula')
    const registry = createWallpaperRegistry()
    expect(registry.current()).toBe('nebula')
    const nebula = layer('nebula')
    const other = layer('other')
    registry.register(other)
    registry.register(nebula)
    expect(nebula.show).toHaveBeenCalledTimes(1)
    expect(other.hide).toHaveBeenCalledTimes(1)
  })

  it('treats an empty persisted string as no selection', () => {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, '')
    expect(createWallpaperRegistry().current()).toBe('gargantua')
  })

  it('treats an unreadable storage as no selection', () => {
    // jsdom keeps the Storage methods on the prototype, where vi.spyOn never
    // attaches, so the throwing storage replaces the whole global instead.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage denied') },
      setItem: () => {},
      clear: () => {},
    })
    expect(createWallpaperRegistry().current()).toBe('gargantua')
  })

  it('keeps the selection session-local when storage writes fail', () => {
    const writes: [string, string][] = []
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: (key: string, value: string) => {
        writes.push([key, value])
        throw new Error('private mode')
      },
      clear: () => {},
    })
    const registry = createWallpaperRegistry()
    registry.register(layer('nebula'))
    expect(() => { registry.select('nebula') }).not.toThrow()
    expect(registry.current()).toBe('nebula')
    expect(writes).toEqual([[WALLPAPER_STORAGE_KEY, 'nebula']])
    // Nothing persisted: a fresh registry still starts from the default.
    expect(createWallpaperRegistry().current()).toBe('gargantua')
  })

  it('falls back to the none row at list() when the persisted id is unknown', () => {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, 'removed-plugin')
    const registry = createWallpaperRegistry()
    expect(registry.current()).toBe('removed-plugin')
    expect(registry.list().map(row => row.id)).toEqual(['none'])
    expect(registry.current()).toBe('none')
  })

  it('lists registered layers with their optional notes before the builtin rows', () => {
    const registry = createWallpaperRegistry()
    registry.register({ id: 'orbs', label: '思考球体', note: '会话活动球体', show: vi.fn(), hide: vi.fn() })
    registry.register({ id: 'plain', label: '纯色', show: vi.fn(), hide: vi.fn() })
    const rows = registry.list()
    expect(rows.map(row => row.id)).toEqual(['orbs', 'plain', 'none'])
    expect(rows[0]).toEqual({ id: 'orbs', label: '思考球体', note: '会话活动球体' })
    expect(rows[1]).toEqual({ id: 'plain', label: '纯色' })
    expect(rows[1]).not.toHaveProperty('note')
    expect(rows[2]).toEqual({ id: 'none', label: '无壁纸', note: '纯净背景' })
  })

  it('selects a layer, notifying subscribers and hiding the previous one', () => {
    const registry = createWallpaperRegistry()
    const gargantua = layer('gargantua')
    const nebula = layer('nebula')
    registry.register(gargantua)
    registry.register(nebula)
    const heard = vi.fn()
    const off = registry.subscribe(heard)
    registry.select('nebula')
    expect(gargantua.hide).toHaveBeenCalledTimes(1)
    expect(nebula.show).toHaveBeenCalledTimes(1)
    expect(registry.current()).toBe('nebula')
    expect(localStorage.getItem(WALLPAPER_STORAGE_KEY)).toBe('nebula')
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    registry.select('gargantua')
    expect(heard).toHaveBeenCalledTimes(1)
    // gargantua showed at registration and again at re-selection; nebula
    // hid while unselected at registration and once more when switched away.
    expect(gargantua.show).toHaveBeenCalledTimes(2)
    expect(nebula.hide).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(WALLPAPER_STORAGE_KEY)).toBe('gargantua')
  })

  it('ignores selecting the current id or an unknown id', () => {
    const registry = createWallpaperRegistry()
    const heard = vi.fn()
    registry.subscribe(heard)
    registry.select('gargantua')
    registry.select('ghost')
    expect(registry.current()).toBe('gargantua')
    expect(heard).toHaveBeenCalledTimes(0)
    expect(localStorage.getItem(WALLPAPER_STORAGE_KEY)).toBe(null)
  })

  it('selects the builtin none row without layers and persists it', () => {
    const registry = createWallpaperRegistry()
    const heard = vi.fn()
    registry.subscribe(heard)
    registry.select('none')
    expect(registry.current()).toBe('none')
    expect(localStorage.getItem(WALLPAPER_STORAGE_KEY)).toBe('none')
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('contains a misbehaving layer at registration and selection', () => {
    const registry = createWallpaperRegistry()
    registry.register({
      id: 'gargantua',
      label: 'broken',
      show: () => { throw new Error('show boom') },
      hide: () => { throw new Error('hide boom') },
    })
    const heard = vi.fn()
    registry.subscribe(heard)
    expect(() => { registry.select('none') }).not.toThrow()
    expect(registry.current()).toBe('none')
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('disposes a registration, falling back to none when it was selected', () => {
    const registry = createWallpaperRegistry()
    const stop = registry.register(layer('nebula'))
    registry.select('nebula')
    const heard = vi.fn()
    registry.subscribe(heard)
    stop()
    expect(registry.list().map(row => row.id)).toEqual(['none'])
    expect(registry.current()).toBe('none')
    expect(localStorage.getItem(WALLPAPER_STORAGE_KEY)).toBe('none')
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('disposes an unselected registration without touching the selection', () => {
    const registry = createWallpaperRegistry()
    const stop = registry.register(layer('nebula'))
    const heard = vi.fn()
    registry.subscribe(heard)
    stop()
    expect(registry.current()).toBe('gargantua')
    expect(localStorage.getItem(WALLPAPER_STORAGE_KEY)).toBe(null)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale disposer after the same id re-registered', () => {
    const registry = createWallpaperRegistry()
    const stopFirst = registry.register(layer('nebula'))
    const stopSecond = registry.register(layer('nebula', '星云二号'))
    const heard = vi.fn()
    registry.subscribe(heard)
    stopFirst()
    const rows = registry.list()
    expect(rows.map(row => row.id)).toEqual(['nebula', 'none'])
    expect(rows[0]!.label).toBe('星云二号')
    expect(heard).toHaveBeenCalledTimes(0)
    stopSecond()
    expect(registry.list().map(row => row.id)).toEqual(['none'])
  })
})
