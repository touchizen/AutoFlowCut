// Write-ahead protection for the interval between a native paid click and
// project autosave. No project names, prompts, thumbnails or signed URLs on disk.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const hash = value => createHash('sha256').update(value).digest('hex')
const lost = () => new Error('video-journal-unavailable')
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i

export function createVideoJournal(directory) {
  const file = scope => {
    if (!directory || !path.isAbsolute(directory) || typeof scope !== 'string' || !scope) throw lost()
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    return path.join(directory, hash(scope) + '.json')
  }
  function read(name) {
    let data
    try { data = fs.readFileSync(name, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw lost() }
    try {
      const r = JSON.parse(data)
      if (r.version !== 1 || !Number.isSafeInteger(r.epoch ?? 0) || (r.epoch ?? 0) < 0 || typeof r.intent !== 'string' || !r.flowSubmission?.id || !r.flowSubmission.postClick
        || (r.generationId != null && !uuid.test(r.generationId))) throw lost()
      return r
    } catch { throw lost() }
  }
  function syncDirectory() {
    const fd = fs.openSync(directory, 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  }
  function write(name, r) {
    const tmp = name + '.' + randomUUID()
    const fd = fs.openSync(tmp, 'wx', 0o600)
    try {
      try { fs.writeFileSync(fd, JSON.stringify(r)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(tmp, name); syncDirectory()
    } finally { try { fs.unlinkSync(tmp) } catch {} }
  }
  function exclusive(scope, operation) {
    const name = file(scope), lock = name + '.lock'
    // A process death during an update leaves the lock closed, never admitting
    // a second click until the journal can be inspected.
    fs.mkdirSync(lock, { mode: 0o700 })
    try { return operation(name, read(name)) } finally { fs.rmdirSync(lock) }
  }
  function inspectRecord(r, intent, previousId, epoch) {
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw lost()
    if (r && epoch < (r.epoch ?? 0)) return { blocked: true, flowSubmission: r.flowSubmission }
    if (!r || epoch > (r.epoch ?? 0) || (r.generationId && r.generationId === previousId)) return null
    if (r.generationId && r.intent === hash(intent)) return { generationId: r.generationId }
    return { blocked: true, flowSubmission: r.flowSubmission }
  }
  return {
    inspect(scope, intent, previousId, epoch = 0) {
      const name = file(scope)
      if (fs.existsSync(name + '.lock')) throw lost()
      return inspectRecord(read(name), intent, previousId, epoch)
    },
    reserve(scope, intent, flowSubmission, previousId, epoch = 0) {
      return exclusive(scope, (name, r) => {
        if (inspectRecord(r, intent, previousId, epoch) || !flowSubmission?.postClick || !flowSubmission.id) throw lost()
        write(name, { version: 1, epoch, intent: hash(intent), flowSubmission: { id: flowSubmission.id,
          submittedAt: flowSubmission.submittedAt, promptHash: flowSubmission.promptHash, postClick: true,
          retryBlocked: true, reason: 'awaiting-result' } })
      })
    },
    confirm(scope, id, generationId) {
      return exclusive(scope, (name, r) => {
        if (!r || r.flowSubmission.id !== id || !uuid.test(generationId) || (r.generationId && r.generationId !== generationId)) throw lost()
        write(name, { ...r, generationId })
      })
    },
    cancel(scope, id) {
      return exclusive(scope, (name, r) => {
        if (!r || r.flowSubmission.id !== id || r.generationId) return false
        fs.unlinkSync(name); syncDirectory(); return true
      })
    },
  }
}
