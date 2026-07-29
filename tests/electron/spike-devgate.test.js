import { describe, it, expect } from 'vitest'
import { isSpikeEnabled } from '../../electron/spike-devgate.js'

describe('isSpikeEnabled', () => {
  it('prod (packaged, no dev-server) → false', () => {
    expect(isSpikeEnabled({ isPackaged: true }, {})).toBe(false)
  })
  it('patched darwin dev (isPackaged mis-true, VITE set, opt-in) → true', () => {
    expect(isSpikeEnabled({ isPackaged: true }, { VITE_DEV_SERVER_URL: 'http://localhost:5173', AUTOFLOWCUT_SPIKE: '1' })).toBe(true)
  })
  it('unpackaged dev with opt-in → true', () => {
    expect(isSpikeEnabled({ isPackaged: false }, { AUTOFLOWCUT_SPIKE: '1' })).toBe(true)
  })
  it('dev but no opt-in env → false', () => {
    expect(isSpikeEnabled({ isPackaged: false }, {})).toBe(false)
  })
  it('opt-in but prod (packaged, no VITE) → false', () => {
    expect(isSpikeEnabled({ isPackaged: true }, { AUTOFLOWCUT_SPIKE: '1' })).toBe(false)
  })
})
