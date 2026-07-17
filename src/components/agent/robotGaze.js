export function computeRobotGaze({ fabCenter, pointer, radius, maxYaw, maxPitch, maxEye }) {
  if (!(radius > 0)) {
    throw new RangeError('radius must be greater than 0')
  }

  const dx = pointer.x - fabCenter.x
  const dy = pointer.y - fabCenter.y
  const engaged = Math.hypot(dx, dy) <= radius

  if (!engaged) {
    return { engaged: false, yaw: 0, pitch: 0, eyeX: 0, eyeY: 0 }
  }

  const horizontal = dx / radius
  const vertical = dy / radius

  return {
    engaged: true,
    yaw: dx === 0 ? 0 : horizontal * maxYaw,
    pitch: dy === 0 ? 0 : -vertical * maxPitch,
    eyeX: dx === 0 ? 0 : horizontal * maxEye,
    eyeY: dy === 0 ? 0 : vertical * maxEye,
  }
}
