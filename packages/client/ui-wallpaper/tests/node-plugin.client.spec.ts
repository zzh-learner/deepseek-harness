import { describe, expect, it } from 'vitest'
import * as NodePlugin from '../src/index.ts'

describe('ui-wallpaper node plugin', () => {
  it('is an inert loader seat with no host-side effects', () => {
    expect(NodePlugin.name).toBe('client-ui-wallpaper')
    // An unknown-return face reads the runtime value a typed-void return hides.
    const nodePlugin = NodePlugin as { apply: () => unknown }
    expect(nodePlugin.apply()).toBeUndefined()
    expect('default' in NodePlugin).toBe(false)
  })
})
