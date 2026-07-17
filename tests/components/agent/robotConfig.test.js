import { describe, expect, it } from 'vitest'
import { ROBOT_3D } from '../../../src/components/agent/robotConfig.js'

describe('ROBOT_3D', () => {
  it('pins every human-approved preset D calibration value', () => {
    expect(ROBOT_3D).toEqual({
      perspective: 150,
      perspectiveOrigin: '50% 50%',
      depth: 14,
      slices: 10,
      zFace: 14.5,
      zGlass: 12.9,
      zEyes: 12.5,
      zScreen: 10,
      zLimb: 6,
      zGround: -1,
      maxYaw: 24,
      maxPitch: 8,
      maxEye: 2.6,
      radius: 320,
    })
  })

  it('cannot be mutated at runtime', () => {
    expect(Object.isFrozen(ROBOT_3D)).toBe(true)
  })
})
