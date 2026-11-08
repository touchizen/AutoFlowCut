// Windows: use Flow's read-only project records instead of writing a NetLog
// containing credentials to disk. A workflow echoes the UI's outgoing batch
// UUID at [3][5]. Timestamps, latest tile and prompt alone are never evidence.
import { verifyImageRecords, verifyVideoRecords } from './flow-native-response.js'
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const fail = (reason) => {
  throw new Error('response-proof-' + reason)
}
export async function startProjectProof(read, { projectId, signal }) {
  if (!uuid.test(projectId)) fail('project')
  let closed = false
  const guard = () => {
    if (closed || signal?.aborted) fail('aborted')
  }
  async function list() {
    guard()
    const data = await read('Zzl0ze', ['projects/' + projectId, null, null, null, [1]])
    guard()
    if (!Array.isArray(data?.[1])) fail('project-list')
    return data[1].filter((w) => w?.[4] === projectId && uuid.test(w[0]) && uuid.test(w?.[3]?.[4]))
  }
  const baseline = new Set((await list()).map((w) => w[0]))
  return {
    assertReady: guard,
    async cancel() {
      closed = true
    },
    async finish(_requestUrl, request) {
      const { rpcid, filename, expectedFilename, batchId } = request
      if (request.projectId !== projectId) fail('project')
      const upload = rpcid === 'maseQ'
      if (
        upload
          ? !filename || filename !== expectedFilename || !/-[0-9a-f]{12}\.(?:png|jpg)$/.test(filename)
          : !uuid.test(batchId)
      )
        fail('missing-correlation')
      const count = upload ? 1 : request.count
      if (!Number.isInteger(count) || count < 1 || count > 4) fail('count')
      const until = Date.now() + 45000
      do {
        const matches = (await list()).filter(
          (w) => !baseline.has(w[0]) && (upload ? w[3][0] === filename : w[3][5] === batchId),
        )
        if (matches.length > count) fail('ambiguous')
        if (matches.length === count) {
          const records = []
          for (const w of matches) {
            const id = w[3][4],
              rec = await read('as29s', [id])
            guard()
            // Some image records omit the project in slot 1. Their project is
            // still bound by the workflow's project, batch UUID and back-link.
            const image = !rpcid || rpcid === 'ogiZ0b'
            if (rec?.[0] !== id || rec[2] !== w[0] || (rec[1] !== projectId && !(image && rec[1] == null)))
              fail('media-record')
            records.push(rec)
          }
          if (upload) return { mediaId: records[0][0] }
          if (!rpcid || rpcid === 'ogiZ0b') return verifyImageRecords([records], request)
          return verifyVideoRecords([null, null, matches, records], request)
        }
        await new Promise((resolve) => setTimeout(resolve, 1100))
      } while (Date.now() < until)
      fail('project-record-timeout')
    },
  }
}
