import { describe, expect, it } from 'vitest'
import { computeRobotGaze } from '../../../src/components/agent/robotGaze.js'

const FIXTURE = {
  fabCenter: { x: 0, y: 0 },
  radius: 320,
  maxYaw: 14,
  maxPitch: 8,
  maxEye: 2.6,
}

describe('computeRobotGaze', () => {
  it.each([
    [{ x: 0, y: 0 }, { engaged: true, yaw: 0, pitch: 0, eyeX: 0, eyeY: 0 }],
    [{ x: 320, y: 0 }, { engaged: true, yaw: 14, pitch: 0, eyeX: 2.6, eyeY: 0 }],
    [{ x: -320, y: 0 }, { engaged: true, yaw: -14, pitch: 0, eyeX: -2.6, eyeY: 0 }],
    [{ x: 0, y: -320 }, { engaged: true, yaw: 0, pitch: 8, eyeX: 0, eyeY: -2.6 }],
    [{ x: 160, y: 0 }, { engaged: true, yaw: 7, pitch: 0, eyeX: 1.3, eyeY: 0 }],
    [{ x: 321, y: 0 }, { engaged: false, yaw: 0, pitch: 0, eyeX: 0, eyeY: 0 }],
    [{ x: 260, y: 260 }, { engaged: false, yaw: 0, pitch: 0, eyeX: 0, eyeY: 0 }],
  ])('maps pointer %o through the non-product truth-table fixture', (pointer, expected) => {
    expect(computeRobotGaze({ ...FIXTURE, pointer })).toEqual(expected)
  })

  it.each([0, -1])('rejects the radius precondition for %s', (radius) => {
    expect(() => computeRobotGaze({ ...FIXTURE, radius, pointer: { x: 0, y: 0 } }))
      .toThrow(RangeError)
  })
})
