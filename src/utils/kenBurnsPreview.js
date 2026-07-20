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

export function aspectRatioToRenderFormat(aspectRatio) {
  return aspectRatio === '9:16' ? 'portrait' : 'landscape'
}

export function normalizePreviewImageSrc(src) {
  if (typeof src !== 'string' || !src) return src
  if (/^(?:data:|file:|https?:|blob:)/i.test(src)) return src

  const base64 = src.replace(/\s/g, '')
  if (base64.length <= 64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return src

  const mime = base64.startsWith('iVBORw0KGgo') ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${base64}`
}
