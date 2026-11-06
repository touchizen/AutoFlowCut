import { expect, it, vi } from 'vitest'
import * as galleryProbe from '../../electron/flow-gallery-snapshot.js'
import { PROJECT, OLD, NEW, PAGE, card, gallery } from '../fixtures/flow-passive-image.js'
const scan = html => { document.body.innerHTML = html; return galleryProbe.scanImageGallery(document, PAGE) }
it('reads redirect media ids from project cards and excludes composer assets', () => {
  const s = scan(gallery(card(OLD)) + '<button class="asset-item"><img src="https://flow.google.com/asb/opaque"></button>')
  expect(s).toMatchObject({ ok: true, projectId: PROJECT, items: [{ mediaId: OLD }] })
})
it('supports asb only with an explicit gallery media id', () => {
  expect(scan(gallery(card(OLD, { src: 'https://flow.google.com/asb/token=s1600' })))).toMatchObject({ ok: true, items: [{ mediaId: OLD }] })
  expect(scan(gallery(card(OLD, { src: 'https://flow.google.com/asb/token=s1600', opaque: true })))).toMatchObject({ ok: false })
})
it('never treats an edit id as a media id', () => {
  expect(scan(gallery(card(OLD, { src: 'blob:opaque', opaque: true })))).toMatchObject({ ok: false })
})
it('rejects a missing gallery instead of accepting an empty baseline', () => {
  expect(scan('<div class="ProseMirror"></div>')).toMatchObject({ ok: false })
})
it.each([
  ['duplicate', () => gallery(card(OLD), card(OLD))],
  ['foreign project', () => gallery(card(OLD).replace(`/project/${PROJECT}/`, '/project/other/'))],
  ['conflicting id', () => gallery(card(OLD).replace(`name=${OLD}`, `name=${NEW}`))],
  ['loading', () => gallery(card(OLD)) + '<div role="progressbar"></div>'],
  ['virtualized', () => '<cdk-virtual-scroll-viewport>' + gallery(card(OLD)) + '</cdk-virtual-scroll-viewport>'],
])('rejects %s galleries', (_name, html) => expect(scan(html())).toMatchObject({ ok: false }))
it('requires exact count, unchanged baseline and stable identity', () => {
  const before = scan(gallery(card(OLD)))
  const after = scan(gallery(card(NEW), card(OLD)))
  expect(galleryProbe.galleryDelta(before, after, 1)).toMatchObject({ ok: true, items: [{ mediaId: NEW }] })
  expect(galleryProbe.galleryDelta(before, before, 1)).toMatchObject({ pending: true })
  expect(galleryProbe.galleryDelta(before, scan(gallery(card(NEW))), 1)).toMatchObject({ ok: false, pending: false })
  expect(galleryProbe.galleryDelta(before, after, 0)).toMatchObject({ ok: false, pending: false })
})
it('ignores unattached data-media-id previews outside result cards', () => {
  const s = scan(gallery(card(OLD)) + `<aside><img data-media-id="${NEW}" src="https://flow.google.com/asb/preview=s160"></aside>`)
  expect(s.items.map(i => i.mediaId)).toEqual([OLD])
})
it.each(['<flow-image-tile></flow-image-tile>', `<a href="/project/${PROJECT}/edit/empty"></a>`])('rejects pre-existing incomplete result containers: %s', incomplete => {
  expect(scan(gallery(card(OLD), incomplete))).toMatchObject({ ok: false, reason: 'gallery-incomplete' })
})
it('records first appearance between polls in an isolated gallery observer and disconnects', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  document.body.innerHTML = gallery(card(OLD))
  const watch = galleryProbe.observeImageGallery(document, PAGE, galleryProbe.scanImageGallery)
  try {
    expect(watch.read().firstSeen[OLD]).toBe(1000)
    vi.setSystemTime(1100)
    document.querySelector('main').insertAdjacentHTML('beforeend', card(NEW))
    await Promise.resolve()
    vi.setSystemTime(1200)
    document.querySelector(`img[data-media-id="${NEW}"]`).closest('a').remove()
    await Promise.resolve()
    expect(watch.read().firstSeen[NEW]).toBe(1100)
    watch.disconnect()
    const revision = watch.read().revision
    document.querySelector('main').insertAdjacentHTML('beforeend', card(NEW))
    await Promise.resolve()
    expect(watch.read().revision).toBe(revision)
  } finally { watch.disconnect(); vi.useRealTimers() }
})
it('retains first appearance while the gallery is still loading', async () => {
  document.body.innerHTML = gallery(card(OLD))
  const watch = galleryProbe.observeImageGallery(document, PAGE, galleryProbe.scanImageGallery)
  try {
    document.querySelector('main').insertAdjacentHTML('beforeend', '<div role="progressbar"></div>' + card(NEW))
    await Promise.resolve()
    expect(watch.read()).toMatchObject({ ok: false, firstSeen: { [NEW]: expect.any(Number) } })
  } finally { watch.disconnect() }
})
it('rereads currentSrc even when the image resource changes without a DOM mutation', () => {
  document.body.innerHTML = gallery(card(OLD))
  const watch = galleryProbe.observeImageGallery(document, PAGE, galleryProbe.scanImageGallery)
  try {
    const src = 'https://flow.google.com/asb/resized=s1600'
    Object.defineProperty(document.querySelector('img'), 'currentSrc', { get: () => src })
    expect(watch.read().items[0].src).toBe(src)
  } finally { watch.disconnect() }
})
