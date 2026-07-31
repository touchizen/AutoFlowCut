import { describe, it, expect } from 'vitest'
import {
  FLOW_SIDE_EFFECT_CHANNELS,
  FLOW_READ_ONLY_CHANNELS,
} from '../../../electron/ipc/flowTargetGate.js'

describe('Flow channel classification', () => {
  it.each([
    'flow:list-agent-models',
    'flow:validate-token',
    'flow:list-projects',
    'flow:fetch-gallery',
  ])('gates %s because it causes synthetic or remote work', (channel) => {
    expect(FLOW_SIDE_EFFECT_CHANNELS.has(channel)).toBe(true)
    expect(FLOW_READ_ONLY_CHANNELS.has(channel)).toBe(false)
  })
})
