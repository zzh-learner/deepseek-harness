import { describe, expect, it } from 'vitest'
import * as NodePlugin from '../src/index.ts'

describe('ui-orbs node plugin', () => {
  it('is an inert loader seat with no host-side effects', () => {
    expect(NodePlugin.name).toBe('client-ui-orbs')
    expect(NodePlugin.apply()).toBeUndefined()
    expect('default' in NodePlugin).toBe(false)
  })
})
