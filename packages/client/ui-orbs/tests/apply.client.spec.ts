// @vitest-environment jsdom
/**
 * The client plugin apply: the wallpaper-registry registration the plain
 * component specs cannot reach — descriptor shape, show/hide driving the
 * visibility bridge, disposal wired through ctx.effect, and the early exit
 * when the registry service is absent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { OrbBackdrop, visibility } from '../src/client/OrbBackdrop.tsx'

afterEach(() => {
  visibility.desired = true
  visibility.apply = null
})

describe('apply', () => {
  it('registers into the wallpaper registry and disposes through ctx.effect', () => {
    const registrations: { options: Record<string, unknown>; component: unknown }[] = []
    const descriptors: Record<string, unknown>[] = []
    const effects: unknown[] = []
    const stop = vi.fn()
    const ctx = {
      slots: {
        inject: (_name: string, install: () => unknown) => {
          install()
          return () => {}
        },
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      get: (name: string) => name === 'wallpaper.registry'
        ? { register: (d: Record<string, unknown>) => { descriptors.push(d); return stop } }
        : undefined,
      effect: (fn: () => unknown) => { effects.push(fn()) },
    }

    apply(ctx as never)

    // The overlay slot entry still registers alongside the registry one.
    expect(registrations).toHaveLength(1)
    expect(registrations[0]!.options.id).toBe('orbs-backdrop')
    expect(registrations[0]!.component).toBe(OrbBackdrop)

    expect(descriptors).toHaveLength(1)
    const descriptor = descriptors[0]!
    expect(descriptor.id).toBe('orbs')
    expect(descriptor.label).toBe('思考球体')
    expect(typeof descriptor.note).toBe('string')

    // show/hide drive the module bridge both ways.
    const bridge = vi.fn()
    visibility.apply = bridge
    ;(descriptor.show as () => void)()
    expect(visibility.desired).toBe(true)
    ;(descriptor.hide as () => void)()
    expect(visibility.desired).toBe(false)
    expect(bridge.mock.calls).toEqual([[true], [false]])

    // The registration's disposer is what ctx.effect recorded.
    expect(effects).toHaveLength(1)
    expect(effects[0]).toBe(stop)
  })

  it('skips the registry when the service resolves to nothing', () => {
    const effects: unknown[] = []
    const ctx = {
      slots: { inject: () => () => {}, register: () => () => {} },
      get: (_name: string) => undefined,
      effect: (fn: () => unknown) => { effects.push(fn()) },
    }

    apply(ctx as never)
    // The overlay entry still mounts; no registry effect is registered.
    expect(effects).toHaveLength(0)
  })
})
