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
    yaw: horizontal * maxYaw,
    // pitch 만 가드가 필요하다: 단항 마이너스 때문에 vertical=0 이면 -0 이 나오고,
    // -0 은 Object.is 상 0 이 아니라 toBe(0) 이 실패한다. 다른 셋은 -0 을 못 만든다.
    pitch: vertical === 0 ? 0 : -vertical * maxPitch,
    eyeX: horizontal * maxEye,
    eyeY: vertical * maxEye,
  }
}
