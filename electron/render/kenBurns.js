// 순수 Ken Burns 파라미터 생성 — 결정론(인덱스 시드), Math.random 금지.
const DEFAULT_MIN = 1.0
const DEFAULT_MAX = 1.3
const ANCHORS = [
  { x: 0.5, y: 0.5 }, { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 },
  { x: 0.0, y: 1.0 }, { x: 1.0, y: 1.0 },
]

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sanitizeScales(scaleMin, scaleMax) {
  let lo = Number.isFinite(scaleMin) ? scaleMin : DEFAULT_MIN
  let hi = Number.isFinite(scaleMax) ? scaleMax : DEFAULT_MAX
  if (lo > hi) [lo, hi] = [hi, lo]
  lo = Math.max(1.0, lo)
  hi = Math.max(lo, hi)
  return { lo, hi }
}

export function computeKenBurns(scene, index, { mode = 'random', scaleMin, scaleMax } = {}) {
  const { lo, hi } = sanitizeScales(scaleMin, scaleMax)
  if (mode === 'pattern') {
    const zoomIn = index % 2 === 0
    return {
      startScale: zoomIn ? lo : hi,
      endScale: zoomIn ? hi : lo,
      startAnchor: ANCHORS[index % ANCHORS.length],
      endAnchor: ANCHORS[(index + 1) % ANCHORS.length],
    }
  }
  const rnd = mulberry32(index + 1)
  const zoomIn = rnd() < 0.5
  const a1 = ANCHORS[Math.floor(rnd() * ANCHORS.length)]
  const a2 = ANCHORS[Math.floor(rnd() * ANCHORS.length)]
  return {
    startScale: zoomIn ? lo : hi,
    endScale: zoomIn ? hi : lo,
    startAnchor: a1,
    endAnchor: a2,
  }
}
