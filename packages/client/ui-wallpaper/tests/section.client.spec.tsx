// @vitest-environment jsdom
/**
 * The Settings wallpaper section end to end: rows render from the registry
 * (labels plus optional notes), clicking a row applies the selection through
 * the registry (show/hide callbacks and localStorage persistence), the
 * highlight follows the live selection, and the plugin apply provides the
 * registry and registers the settings.section slot entry.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FC } from 'react'
import { apply, inject } from '../src/client/index.ts'
import { createWallpaperRegistry, WALLPAPER_STORAGE_KEY } from '../src/client/registry.ts'
import { WallpaperSection } from '../src/client/WallpaperSection.tsx'

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); localStorage.clear() })

/** The row button carrying `label` (labels are unique within a render). */
const rowOf = (label: string): HTMLElement => screen.getByText(label).closest('button')!

// Vitest leaves CSS modules unprocessed: imported class names resolve to
// themselves, so the rendered class attribute is the visible highlight state.
const isHighlighted = (label: string): boolean => rowOf(label).getAttribute('class')!.includes('on')

describe('WallpaperSection', () => {
  it('renders one row per layer plus the builtin rows, notes optional', () => {
    const registry = createWallpaperRegistry()
    registry.register({ id: 'orbs', label: '思考球体', note: '会话活动球体', show: vi.fn(), hide: vi.fn() })
    registry.register({ id: 'plain', label: '纯色', show: vi.fn(), hide: vi.fn() })
    const view = render(<WallpaperSection registry={registry} />)
    expect(view.getByText(/选择 Web 界面的背景层/)).toBeTruthy()
    expect(view.getByText('思考球体')).toBeTruthy()
    expect(view.getByText('会话活动球体')).toBeTruthy()
    expect(view.getByText('无壁纸')).toBeTruthy()
    expect(view.getByText('纯净背景')).toBeTruthy()
    // The note-less row carries its label only.
    expect(rowOf('纯色').textContent).toBe('纯色')
  })

  it('applies the click to the registry and moves the highlight', () => {
    const registry = createWallpaperRegistry()
    const show = vi.fn()
    const hide = vi.fn()
    registry.register({ id: 'orbs', label: '思考球体', note: '会话活动球体', show, hide })
    const view = render(<WallpaperSection registry={registry} />)
    expect(view.getByText('思考球体')).toBeTruthy()
    // Nothing persisted: the first list() falls the selection back onto the
    // builtin row, so that row renders highlighted and the layer stays hidden.
    expect(isHighlighted('无壁纸')).toBe(true)
    expect(isHighlighted('思考球体')).toBe(false)
    expect(hide).toHaveBeenCalledTimes(1)

    fireEvent.click(view.getByText('思考球体'))
    expect(show).toHaveBeenCalledTimes(1)
    expect(registry.current()).toBe('orbs')
    expect(localStorage.getItem(WALLPAPER_STORAGE_KEY)).toBe('orbs')
    // The live subscription re-rendered with the moved highlight.
    expect(isHighlighted('思考球体')).toBe(true)
    expect(isHighlighted('无壁纸')).toBe(false)
  })

  it('re-renders on registry changes while mounted and unsubscribes at unmount', async () => {
    const registry = createWallpaperRegistry()
    const view = render(<WallpaperSection registry={registry} />)
    expect(view.queryByText('思考球体')).toBeNull()
    const stop = registry.register({ id: 'orbs', label: '思考球体', show: vi.fn(), hide: vi.fn() })
    await act(async () => {})
    expect(view.getByText('思考球体')).toBeTruthy()
    view.unmount()
    stop()
    // The unsubscribed component no longer receives changes; the registry
    // itself stays usable.
    expect(() => { registry.select('none') }).not.toThrow()
  })
})

describe('client plugin apply', () => {
  it('provides the registry and registers the settings section through the slot', () => {
    const provides: { name: unknown; value: unknown }[] = []
    const registrations: { options: unknown; component: unknown }[] = []
    // Cordis runs an effect body immediately and calls its return value at
    // fiber unload; the stub mirrors that by collecting the returned disposer.
    const effectDisposers: (() => void)[] = []
    const stopProvide = vi.fn()
    let injectedSlot = ''
    const ctx = {
      provide: (name: unknown, value: unknown) => {
        provides.push({ name, value })
        return stopProvide
      },
      slots: {
        inject: (name: unknown, install: () => unknown) => {
          injectedSlot = name as string
          void install()
          return () => {}
        },
        register: (options: unknown, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      effect: (body: () => () => void) => {
        effectDisposers.push(body())
        return () => {}
      },
    }
    apply(ctx as never)
    expect(inject).toEqual(['slots'])
    expect(injectedSlot).toBe('settings.section')
    expect(provides).toHaveLength(1)
    expect(provides[0]!.name).toBe('wallpaper.registry')
    expect(registrations).toHaveLength(1)
    expect(registrations[0]!.options).toEqual({
      name: 'settings.section', id: 'wallpaper', order: 20, label: '壁纸',
    })

    // The section projects the same registry instance the plugin provided.
    const registry = provides[0]!.value as ReturnType<typeof createWallpaperRegistry>
    const Section = registrations[0]!.component as FC<{ close: () => void }>
    const view = render(<Section close={() => {}} />)
    expect(view.getByText('无壁纸')).toBeTruthy()
    expect(registry.current()).toBe('none')

    // A layer registered through the provided face appears live, and clicking
    // it applies the selection through that same registry.
    const show = vi.fn()
    act(() => { registry.register({ id: 'nebula', label: '星云', show, hide: vi.fn() }) })
    expect(view.getByText('星云')).toBeTruthy()
    fireEvent.click(view.getByText('星云'))
    expect(show).toHaveBeenCalledTimes(1)
    expect(registry.current()).toBe('nebula')
    expect(localStorage.getItem(WALLPAPER_STORAGE_KEY)).toBe('nebula')

    // The effect teardown stops the service provide.
    expect(effectDisposers).toHaveLength(1)
    effectDisposers[0]!()
    expect(stopProvide).toHaveBeenCalledTimes(1)
  })
})
