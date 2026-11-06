// @vitest-environment node
import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { inputShieldHarness } from '../fixtures/flow-input-shield.js'

it('shields only the Flow region and follows native bounds changes without covering app Stop', () => {
  const flowView = new EventEmitter()
  let bounds = { x: 0, y: 0, width: 1200, height: 900 }
  flowView.getBounds = () => bounds
  const h = inputShieldHarness(flowView)
  const shield = h.create({ flowView })
  expect(h.covers(1800, 40)).toBe(false)
  expect(h.covers(100, 40)).toBe(true)
  bounds = { x: 1203, y: 0, width: 1197, height: 900 }
  flowView.emit('bounds-changed')
  expect(h.covers(100, 40)).toBe(false)
  expect(h.covers(1800, 40)).toBe(true)
  bounds = { x: 0, y: 0, width: 0, height: 0 }
  flowView.emit('bounds-changed')
  expect(h.covers(1800, 40)).toBe(false)
  const native = h.surfaces[0]
  shield.remove()
  expect(h.surfaces).toHaveLength(0)
  expect(native.closed).toBe(true)
  expect(flowView.listenerCount('bounds-changed')).toBe(0)
})
