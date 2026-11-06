/** Serializable read-only DOM probe; no main-world state, observers or writes. */
export function scanImageGallery(doc, pageUrl) {
  const fail = reason => ({ ok: false, reason })
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let page
  try { page = new URL(pageUrl) } catch { return fail('not-on-project') }
  const route = /^\/project\/([^/]+)\/?$/.exec(page.pathname)
  if (page.origin !== 'https://flow.google.com' || !route || !UUID.test(route[1])) return fail('not-on-project')
  if (doc.querySelector('cdk-virtual-scroll-viewport, [role="progressbar"], [aria-busy="true"], flow-video-tile')) return fail('gallery-incomplete')
  const cards = [...doc.querySelectorAll('a[href*="/edit/"], flow-image-tile')]
  if (cards.some(card => !card.querySelector('img'))) return fail('gallery-incomplete')
  const imgs = [...doc.querySelectorAll('img')].filter(im => !im.closest('button.chip-container, button.asset-item, flow-rich-text-editor')
    && im.closest('a[href*="/edit/"], flow-image-tile'))
  // An unrecognized/empty gallery cannot prove the absence of old results.
  if (!imgs.length) return fail('gallery-unrecognized')
  const items = []
  for (const im of imgs) {
    const link = im.closest('a[href]')
    if (link) {
      let href
      try { href = new URL(link.getAttribute('href'), page) } catch { return fail('gallery-link') }
      if (href.origin !== page.origin || !href.pathname.startsWith(`/project/${route[1]}/edit/`)) return fail('gallery-project')
    }
    const src = im.currentSrc || im.getAttribute('src') || ''
    let u
    try { u = new URL(src, page) } catch { return fail('gallery-src') }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return fail('gallery-src')
    const direct = /^\/image\/([0-9a-f-]{36})$/i.exec(u.pathname)
    const redirect = /\/(?:media\.)?getMediaUrlRedirect$/.test(u.pathname)
    const asb = /^\/asb\/[A-Za-z0-9_-]+(?:=|$)/.test(u.pathname)
    let urlId = null
    if (u.hostname === 'flow-content.google' && direct) urlId = direct[1]
    else if (['flow.google.com', 'labs.google'].includes(u.hostname) && redirect) urlId = u.searchParams.get('name')
    else if (!(['flow.google.com', 'lh3.googleusercontent.com'].includes(u.hostname) && asb)) return fail('gallery-src')
    const attr = im.getAttribute('data-media-id') || im.closest('flow-image-tile')?.getAttribute('data-media-id')
    const id = attr || urlId
    if (!UUID.test(id || '') || (urlId && urlId !== id)) return fail('gallery-id')
    if (items.some(i => i.mediaId === id)) return fail('gallery-duplicate')
    items.push({ mediaId: id, src: u.href, width: im.naturalWidth || 0, height: im.naturalHeight || 0 })
  }
  return { ok: true, projectId: route[1], items }
}
export const IMAGE_GALLERY_PROBE = `(${scanImageGallery.toString()})(document, location.href)`
export function galleryDelta(before, after, count) {
  const fail = reason => ({ ok: false, pending: false, reason })
  if (!before?.ok || !after?.ok || before.projectId !== after.projectId) return fail('gallery-unreadable')
  const prior = new Map(before.items.map(i => [i.mediaId, i]))
  for (const item of before.items) {
    const current = after.items.find(i => i.mediaId === item.mediaId)
    if (!current || current.src !== item.src) return fail('gallery-changed')
  }
  const items = after.items.filter(i => !prior.has(i.mediaId))
  if (items.length > count || count < 1) return fail('gallery-count')
  if (items.length < count) return { ok: false, pending: true }
  return { ok: true, items }
}
