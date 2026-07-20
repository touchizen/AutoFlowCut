export function kenBurnsPreviewStyle(kb, p) {
  const progress = Math.min(1, Math.max(0, p))
  const z = kb.startScale + (kb.endScale - kb.startScale) * progress
  const ax = kb.startAnchor.x + (kb.endAnchor.x - kb.startAnchor.x) * progress
  const ay = kb.startAnchor.y + (kb.endAnchor.y - kb.startAnchor.y) * progress
  const rawTxPct = -(z - 1) * ax * 100
  const rawTyPct = -(z - 1) * ay * 100
  const txPct = Object.is(rawTxPct, -0) ? 0 : rawTxPct
  const tyPct = Object.is(rawTyPct, -0) ? 0 : rawTyPct

  return {
    transform: `translate(${txPct}%, ${tyPct}%) scale(${z})`,
    transformOrigin: '0 0',
  }
}

export function toKenBurnsRatios(settings) {
  return {
    mode: settings.kenBurnsMode,
    scaleMin: Number(settings.kenBurnsScaleMin) / 100 || 1.0,
    scaleMax: Number(settings.kenBurnsScaleMax) / 100 || 1.15,
  }
}
