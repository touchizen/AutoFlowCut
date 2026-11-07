import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../electron/flow-native-settings.js', () => ({ applyNativeSettings: vi.fn(async () => ({ ok: true })) }))
vi.mock('electron', () => ({ screen: { getAllDisplays: () => [] } }))
import { _resetDomStageForTests } from '../../electron/ipc/flow-angular.js'
import { harness } from '../fixtures/flow-passive-harness.js'
import { PROJECT, PROMPT, NEW, card } from '../fixtures/flow-passive-image.js'
import liveLineage from '../fixtures/flow-live-lineage-20261107.json'

beforeEach(() => { vi.useFakeTimers(); _resetDomStageForTests() })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })
const LATE_OLD = '30000000-0000-4000-8000-000000000003'
function setup(options = {}) {
  const h = harness(options)
  const proof = { assertReady: vi.fn(), cancel: vi.fn(async () => {}), finish: vi.fn(async () => [
    { mediaId: NEW, src: `https://flow-content.google/image/${NEW}?Signature=synthetic`, width: 1376, height: 768 },
  ]) }
  h.deps.startResponseCapture = vi.fn(async () => proof)
  return { ...h, proof }
}
async function drive(h, overrides = {}) {
  const pending = h.angular.generateImage({ prompt: PROMPT, projectId: PROJECT, ...overrides })
  await vi.runAllTimersAsync()
  return pending
}
function recordedTile(phase, root) {
  const card = liveLineage.frames.find(frame => frame.phase === phase).cards[0]
  const nodes = new Map()
  for (const node of card.nodes) {
    const el = node.id === card.rootId && root ? root : document.createElement(node.tag)
    el.replaceChildren()
    for (const attr of [...el.attributes]) el.removeAttribute(attr.name)
    for (const [name, value] of Object.entries(node.attributes)) el.setAttribute(name, value)
    if (node.text) el.append(document.createTextNode(node.text))
    nodes.set(node.id, el)
  }
  for (const node of card.nodes) if (nodes.has(node.parentId)) nodes.get(node.parentId).append(nodes.get(node.id))
  return nodes.get(card.rootId)
}
it('assigns the exact response media ID instead of an old card rendered 4s after listing', async () => {
  const h = setup({ missing: true })
  setTimeout(() => document.querySelector('main').insertAdjacentHTML('beforeend', card(LATE_OLD)), 4000)
  const result = await drive(h)
  expect(result).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
  expect(result.images.some(image => image.mediaId === LATE_OLD)).toBe(false)
  expect(h.proof.finish).toHaveBeenCalledWith(expect.stringContaining('rpcids=ogiZ0b'), expect.objectContaining({ projectId: PROJECT, prompts: [PROMPT] }))
  expect(h.net.request).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining(`/image/${NEW}`) }))
})
it('does not own a late same-prompt old pending even when its DOM node survives until completion', async () => {
  const prompt = liveLineage.request.imageRequest.prompts[0]
  const h = setup({ missing: true, prompt })
  let oldRoot
  h.proof.finish.mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 5000))
    return [{ mediaId: NEW, src: `https://flow-content.google/image/${NEW}`, width: 1376, height: 768 }]
  })
  setTimeout(() => { oldRoot = recordedTile('pending'); document.querySelector('main').append(oldRoot) }, 2000)
  setTimeout(() => recordedTile('complete', oldRoot), 4000)
  const result = await drive(h, { prompt })
  expect(result.reason).toBeUndefined()
  expect(result).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
  expect(result.images[0].mediaId).not.toBe('92e85bf9-b276-44eb-abb0-47159ccffcdc')
})
it.each(['virtualized', 'empty'])('collects its native response in an otherwise %s gallery', async kind => {
  const h = setup()
  const main = document.querySelector('main')
  if (kind === 'virtualized') main.outerHTML = '<cdk-virtual-scroll-viewport>' + main.outerHTML + '</cdk-virtual-scroll-viewport>'
  else main.innerHTML = ''
  expect(await drive(h)).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
})
it('refuses before native submission when response capture cannot start', async () => {
  const h = setup()
  h.deps.startResponseCapture.mockRejectedValue(new Error('response-proof-unavailable'))
  expect(await drive(h)).toMatchObject({ success: false, reason: 'response-proof-unavailable',
    errorParams: { reason: 'response-proof-unavailable' } })
  expect(h.submit).not.toHaveBeenCalled()
})
it('rechecks collector readiness at the last dispatch guard', async () => {
  const h = setup()
  h.proof.assertReady.mockImplementation(() => { throw new Error('response-proof-size') })
  expect(await drive(h)).toMatchObject({ success: false, reason: 'response-proof-size' })
  expect(h.submit).not.toHaveBeenCalled()
})
it('never assigns gallery media after a native response proof failure', async () => {
  const h = setup()
  h.proof.finish.mockRejectedValue(new Error('response-proof-request-ambiguous'))
  expect(await drive(h)).toMatchObject({ success: false, postClick: true, retryBlocked: true, reason: 'response-proof-request-ambiguous' })
  expect(h.net.request).not.toHaveBeenCalled()
  expect(h.proof.cancel).toHaveBeenCalledOnce()
})
