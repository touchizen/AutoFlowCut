/** Serializable read-only DOM probe; no main-world state, observers or writes. */
export function scanImageGallery(doc, pageUrl) {
  const fail = reason => ({ ok: false, reason })
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let page
  try { page = new URL(pageUrl) } catch { return fail('not-on-project') }
  const route = /^\/project\/([^/]+)\/?$/.exec(page.pathname)
  if (page.origin !== 'https://flow.google.com' || !route || !UUID.test(route[1])) return fail('not-on-project')
  const loading = !!doc.querySelector('cdk-virtual-scroll-viewport, [role="progressbar"], [aria-busy="true"], flow-video-tile')
  const cards = [...doc.querySelectorAll('a[href*="/edit/"], flow-image-tile')]
  const incomplete = loading || cards.some(card => !card.querySelector('img'))
  const imgs = [...doc.querySelectorAll('img')].filter(im => !im.closest('button.chip-container, button.asset-item, flow-rich-text-editor')
    && im.closest('a[href*="/edit/"], flow-image-tile'))
  // An unrecognized/empty gallery cannot prove the absence of old results.
  if (!imgs.length) return fail(incomplete ? 'gallery-incomplete' : 'gallery-unrecognized')
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
  // Readable identities still carry timing evidence while other cards load.
  // They cannot form a baseline/result until the whole gallery is complete.
  return { ok: !incomplete, ...(incomplete ? { reason: 'gallery-incomplete' } : {}), projectId: route[1], items }
}
export const IMAGE_GALLERY_PROBE = `(${scanImageGallery.toString()})(document, location.href)`

/** Runs only in isolated world 995. The shared DOM is read, never modified.
 * Keep first sightings even after removal so transient foreign cards cannot
 * disappear between polls and make an ambiguous result look like an exact fit. */
export function observeImageGallery(doc, pageUrl, scan) {
  const firstSeen = {}
  const unprovenChanges = []
  let snapshot, key, revision = 0, disconnected = false
  const update = () => {
    snapshot = scan(doc, pageUrl)
    const next = JSON.stringify([snapshot.ok, snapshot.reason, snapshot.items?.map(i => [i.mediaId, i.src]).sort()])
    if (next !== key) {
      key = next; revision++
      // A result container may precede its img/media identity. Preserve that
      // interval too; inferring a media ID from an edit-card URL is unsafe.
      if (!snapshot.ok) unprovenChanges.push({ revision, at: Date.now() })
    }
    for (const item of snapshot.items || []) firstSeen[item.mediaId] ??= Date.now()
  }
  update()
  const observer = new MutationObserver(update)
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['src', 'srcset', 'sizes', 'href', 'data-media-id', 'aria-busy', 'role'] })
  return {
    read() {
      // currentSrc can change after zoom/resource selection with no attribute
      // mutation. Every guard/restore read must inspect the actual DOM again.
      if (!disconnected) { observer.takeRecords(); update() }
      return { ...snapshot, revision, firstSeen: { ...firstSeen }, unprovenChanges: [...unprovenChanges] }
    },
    disconnect: () => { disconnected = true; observer.disconnect() },
  }
}

export function galleryWatchCode(token, action = 'read') {
  const slot = `globalThis[${JSON.stringify(token)}]`
  if (action === 'stop') return `(() => { ${slot}?.disconnect(); delete ${slot}; return true })()`
  return `(() => { ${slot} ||= (${observeImageGallery.toString()})(document, location.href, ${scanImageGallery.toString()}); return ${slot}.read() })()`
}

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
