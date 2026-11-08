import { it, expect, vi } from 'vitest'
import { startProjectProof } from '../../electron/flow-project-proof.js'
const [project, workflow, media, batch, ref] = [1, 2, 3, 4, 5].map(
  (n) => 'aaaaaaaa-bbbb-4ccc-9ddd-00000000000' + n,
)
const name = 'CupPalette-deadbeefabcd.jpg'
function setup({ filename = name, key = batch, mediaProject = project, dupe = false } = {}) {
  const row = [workflow, null, null, [filename, [123], null, null, media, key], project]
  const meta = []
  meta[1] = 42
  meta[13] = 'https://flow-content.google/image/' + media
  meta[15] = [null, null, [[null, null, [[['blue glaze']]]]], [[[null, 1, ref]]]]
  const record = [media, mediaProject, workflow, 'CAE', null, [], [meta, null, [12, 16]]]
  let old = true
  const read = vi.fn(async (id) => {
    if (id === 'Zzl0ze') {
      if (old) {
        old = false
        return [null, []]
      }
      return [null, dupe ? [row, row] : [row]]
    }
    if (id === 'as29s') return record
    throw new Error('not a read')
  })
  return { read }
}
it('links a byte-verified upload request to its unique generated filename and same-project workflow', async () => {
  const { read } = setup(),
    proof = await startProjectProof(read, { projectId: project })
  await expect(
    proof.finish('', { rpcid: 'maseQ', filename: name, expectedFilename: name, projectId: project }),
  ).resolves.toEqual({ mediaId: media })
})
it('requires the batch key and validates the image seed, reference, URL and prompt on the linked record', async () => {
  const { read } = setup({ mediaProject:null }),
    proof = await startProjectProof(read, { projectId: project })
  const req = {
    projectId: project,
    count: 1,
    batchId: batch,
    seeds: [42],
    prompts: ['blue glaze'],
    refs: [ref],
  }
  await expect(proof.finish('', req)).resolves.toEqual([
    { mediaId: media, src: 'https://flow-content.google/image/' + media, width: 12, height: 16 },
  ])
  await expect(proof.finish('', { ...req, seeds: [100] })).rejects.toThrow('mismatch')
})
it.each([{ dupe: true }, { mediaProject: ref }])(
  'rejects ambiguous or foreign records before returning their IDs',
  async (opts) => {
    const { read } = setup(opts),
      proof = await startProjectProof(read, { projectId: project })
    await expect(
      proof.finish('', { rpcid: 'maseQ', filename: name, expectedFilename: name, projectId: project }),
    ).rejects.toThrow('response-proof-')
  },
)
