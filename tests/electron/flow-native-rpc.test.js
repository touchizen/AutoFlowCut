import { it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { nativeFlowReads } from '../../electron/flow-native-rpc.js'
const project = '/project/47e05abe-19de-4aeb-a1a3-4d49b91cd23e',
  origin = 'https://flow.google.com'
function fixture() {
  const wc = Object.assign(new EventEmitter(), {
    id: 17,
    getURL: () => origin + project,
    session: { fetch: vi.fn() },
  })
  const client = nativeFlowReads(wc),
    query = new URLSearchParams({ 'source-path': project, bl: 'build', 'f.sid': 'sid', hl: 'ko' })
  const observed = {
    method: 'POST',
    url: origin + '/_/AiSandboxAngularFrontend/data/batchexecute?' + query,
    webContentsId: 17,
    uploadData: [{ bytes: Buffer.from('at=sample%2Btoken&') }],
  }
  return { wc, client, observed }
}
it('uses the same project and session only for allowlisted reads, never for generating or uploading', async () => {
  const { wc, client, observed } = fixture()
  client.observe({ ...observed, webContentsId: 19 })
  await expect(client.read('as29s', ['media'])).rejects.toThrow()
  client.observe(observed)
  await expect(client.read('ogiZ0b', [])).rejects.toThrow('not allowed')
  wc.session.fetch.mockResolvedValue(
    new Response(")]}'\n" + JSON.stringify([['wrb.fr', 'as29s', '[\"example\"]']])),
  )
  await expect(client.read('as29s', ['media'])).resolves.toEqual(['example'])
  const [url, opts] = wc.session.fetch.mock.calls[0]
  expect(new URL(url).searchParams.get('source-path')).toBe(project)
  expect(new URLSearchParams(opts.body).get('at')).toBe('sample+token')
  expect(wc.session.fetch).toHaveBeenCalledTimes(1)
})
it('discards inflight results after reloading the same URL', async () => {
  const { wc, client, observed } = fixture()
  client.observe(observed)
  wc.session.fetch.mockImplementation(async () => {
    wc.emit('did-start-navigation', {}, wc.getURL(), false, true)
    client.observe(observed)
    return new Response('old document')
  })
  await expect(client.read('jwpduf', [])).rejects.toMatchObject({ reason: 'read-document-changed' })
})
