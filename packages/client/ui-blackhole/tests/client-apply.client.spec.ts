// @vitest-environment jsdom
/**
 * The client plugin body: the shell.overlay entry registered beneath every
 * other occupant, the wallpaper-registry registration with its show/hide
 * bridge, the early exit when the registry service is missing, and the
 * ctx.effect-backed disposal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { BlackholeWallpaper, visibility } from '../src/client/BlackholeWallpaper.tsx'

interface WallpaperEntry { id: string; label: string; note: string; show(): void; hide(): void }

afterEach(() => {
  visibility.desired = true
  visibility.apply = null
})

const makeCtx = (registry: unknown): {
  ctx: unknown
  registered: { options: Record<string, unknown>; component: unknown }[]
  effects: (() => unknown)[]
} => {
  const registered: { options: Record<string, unknown>; component: unknown }[] = []
  const effects: (() => unknown)[] = []
  return {
    registered,
    effects,
    ctx: {
      slots: {
        inject: (_name: string, install: () => unknown): (() => void) => {
          install()
          return () => {}
        },
        register: (options: Record<string, unknown>, component: unknown): (() => void) => {
          registered.push({ options, component })
          return () => {}
        },
      },
      get: (name: string): unknown => (name === 'wallpaper.registry' ? registry : undefined),
      effect: (fn: () => unknown): (() => void) => {
        effects.push(fn)
        return () => {}
      },
    },
  }
}

describe('client apply', () => {
  it('registers the overlay entry beneath every other occupant', () => {
    const registry = { register: vi.fn(() => () => {}) }
    const { ctx, registered } = makeCtx(registry)
    apply(ctx as never)
    expect(registered).toHaveLength(1)
    expect(registered[0]!.options).toMatchObject({ name: 'shell.overlay', id: 'gargantua-wallpaper', order: -2000 })
    expect(registered[0]!.component).toBe(BlackholeWallpaper)
  })

  it('leaves early without the wallpaper registry service', () => {
    const { ctx, registered, effects } = makeCtx(undefined)
    apply(ctx as never)
    expect(registered).toHaveLength(1) // the slot entry still lands
    expect(effects).toHaveLength(0)
  })

  it('registers gargantua and disposes through ctx.effect', () => {
    const stop = vi.fn()
    const register = vi.fn((_entry: unknown) => stop)
    const { ctx, effects } = makeCtx({ register })
    apply(ctx as never)
    expect(register).toHaveBeenCalledTimes(1)
    const entry = register.mock.calls[0]![0] as WallpaperEntry
    expect(entry.id).toBe('gargantua')
    expect(entry.label).toContain('GARGANTUA')
    expect(entry.note).toContain('WebGL2')
    expect(effects).toHaveLength(1)
    // The effect returns the registry disposer (typed unknown by the stub).
    const dispose = effects[0]!() as () => void
    expect(stop).toHaveBeenCalledTimes(0)
    dispose()
    expect(stop).toHaveBeenCalledTimes(1)

    // show/hide drive the visibility bridge, with or without a mounted component
    visibility.apply = null
    entry.show()
    expect(visibility.desired).toBe(true)
    const bridge = vi.fn()
    visibility.apply = bridge
    entry.show()
    expect(bridge).toHaveBeenLastCalledWith(true)
    entry.hide()
    expect(visibility.desired).toBe(false)
    expect(bridge).toHaveBeenLastCalledWith(false)
  })
})
