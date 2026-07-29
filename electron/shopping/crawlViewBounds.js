export function normalizeShoppingCrawlBounds(bounds, contentBounds, zoomFactor = 1) {
  if (!bounds || typeof bounds !== 'object') {
    return null
  }

  const scale = Number(zoomFactor)
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(bounds[key]) * scale)
  if (
    !values.every(Number.isFinite)
    || !Number.isFinite(scale)
    || scale <= 0
  ) {
    return null
  }

  const [rawX, rawY, rawWidth, rawHeight] = values.map(Math.round)
  if (rawX === 0 && rawY === 0 && rawWidth === 0 && rawHeight === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  if (!contentBounds || typeof contentBounds !== 'object') return null

  const contentWidth = Math.round(Number(contentBounds.width))
  const contentHeight = Math.round(Number(contentBounds.height))
  if (
    !Number.isFinite(contentWidth)
    || !Number.isFinite(contentHeight)
    || contentWidth <= 0
    || contentHeight <= 0
  ) {
    return null
  }

  const x = Math.max(0, Math.min(rawX, contentWidth - 1))
  const y = Math.max(0, Math.min(rawY, contentHeight - 1))
  const width = Math.min(rawWidth, contentWidth - x)
  const height = Math.min(rawHeight, contentHeight - y)
  return width > 0 && height > 0 ? { x, y, width, height } : null
}
