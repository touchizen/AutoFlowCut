export const PROJECT = '00000001-0000-4000-8000-000000000000'
export const OLD = '10000000-0000-4000-8000-000000000001'
export const NEW = '20000000-0000-4000-8000-000000000002'
export const PROMPT = '궁정안에 있는 왕'
export const PAGE = `https://flow.google.com/project/${PROJECT}`
export function request(overrides = {}, change) {
  // ogiZ0b shape copied from the masked 2026-09-24 recording.
  const context = [null, 22, null, null, null, PROJECT]
  const inner = [null, [[null, null, null, 1687588041, 3, 'NARWHAL', null, context, [[[PROMPT]]]]], 1, context]
  const envelope = [[['ogiZ0b', '', null, 'generic']]]
  const form = new URLSearchParams({ at: 'SECRET' })
  change?.(inner, envelope)
  envelope[0][0][1] = JSON.stringify(inner)
  form.set('f.req', JSON.stringify(envelope))
  return { id: 10, webContentsId: 7, method: 'POST',
    url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
    uploadData: [{ bytes: Buffer.from(form.toString()) }], ...overrides }
}
// Contract fixture built from the recorded edit-card and tile/data-media-id shapes.
// This is NOT a new live-page recording.
export function card(id, { src, opaque = false } = {}) {
  return `<a href="/project/${PROJECT}/edit/${id}"><img ${opaque ? '' : `data-media-id="${id}"`} src="${src || `https://flow.google.com/api/trpc/media.getMediaUrlRedirect?name=${id}`}"></a>`
}
export const gallery = (...cards) => `<main>${cards.join('')}</main>`

// Reproduce Flow's handset breakpoint: the Agent chip is absent, not merely
// hidden by a small native bounds value. Zoom changes the CSS viewport width.
export function responsiveComposer(doc) {
  const chip = doc.querySelector('flow-agent-mode-toggle-chip')
  const parent = chip.parentElement
  return width => {
    // Live 2026-11-07: absent at 597 AND 700px; the 957px native
    // generation passed the Agent-OFF gate. Model these known observations,
    // without claiming that 957 is Flow's exact CSS breakpoint.
    if (width < 957) chip.remove()
    else if (!chip.isConnected) parent.append(chip)
  }
}

export function galleryRequest(overrides = {}) {
  return request({ id: 20, url: request().url.replace('ogiZ0b', 'Zzl0ze'), ...overrides }, (_i, e) => { e[0][0][0] = 'Zzl0ze' })
}
