const textEncoder = new TextEncoder()

let crcTable = null

function getCrcTable() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    crcTable[n] = c >>> 0
  }
  return crcTable
}

function crc32(bytes) {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeU16(view, offset, value) {
  view.setUint16(offset, value, true)
}

function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true)
}

async function base64ToBytes(value) {
  const normalized = value.trim()
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new Error('Invalid base64 media data')
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalized, 'base64'))
  }
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer())
  }
  if (typeof value === 'string') return base64ToBytes(value)
  throw new Error('Unsupported ZIP entry data type')
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export async function writeStoreZipEntries(entries) {
  const localChunks = []
  const centralChunks = []
  let localOffset = 0

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name)
    const data = await toBytes(entry.data)
    const crc = crc32(data)

    const localHeader = new Uint8Array(30)
    const localView = new DataView(localHeader.buffer)
    writeU32(localView, 0, 0x04034b50)
    writeU16(localView, 4, 20)
    writeU16(localView, 6, 0)
    writeU16(localView, 8, 0)
    writeU16(localView, 10, 0)
    writeU16(localView, 12, 0)
    writeU32(localView, 14, crc)
    writeU32(localView, 18, data.length)
    writeU32(localView, 22, data.length)
    writeU16(localView, 26, nameBytes.length)
    writeU16(localView, 28, 0)

    localChunks.push(localHeader, nameBytes, data)

    const centralHeader = new Uint8Array(46)
    const centralView = new DataView(centralHeader.buffer)
    writeU32(centralView, 0, 0x02014b50)
    writeU16(centralView, 4, 20)
    writeU16(centralView, 6, 20)
    writeU16(centralView, 8, 0)
    writeU16(centralView, 10, 0)
    writeU16(centralView, 12, 0)
    writeU16(centralView, 14, 0)
    writeU32(centralView, 16, crc)
    writeU32(centralView, 20, data.length)
    writeU32(centralView, 24, data.length)
    writeU16(centralView, 28, nameBytes.length)
    writeU16(centralView, 30, 0)
    writeU16(centralView, 32, 0)
    writeU16(centralView, 34, 0)
    writeU16(centralView, 36, 0)
    writeU32(centralView, 38, 0)
    writeU32(centralView, 42, localOffset)

    centralChunks.push(centralHeader, nameBytes)
    localOffset += localHeader.length + nameBytes.length + data.length
  }

  const centralDirectory = concat(centralChunks)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  writeU32(endView, 0, 0x06054b50)
  writeU16(endView, 4, 0)
  writeU16(endView, 6, 0)
  writeU16(endView, 8, entries.length)
  writeU16(endView, 10, entries.length)
  writeU32(endView, 12, centralDirectory.length)
  writeU32(endView, 16, localOffset)
  writeU16(endView, 20, 0)

  return concat([...localChunks, centralDirectory, end])
}

function projectMediaPaths(projectJson) {
  return (Array.isArray(projectJson?.files) ? projectJson.files : [])
    .map((file) => file?.path || file?.mediaId)
    .filter((mediaId) => typeof mediaId === 'string' && mediaId.length > 0)
}

function projectMediaIds(projectJson) {
  return (Array.isArray(projectJson?.files) ? projectJson.files : [])
    .map((file) => file?.mediaId)
    .filter((mediaId) => typeof mediaId === 'string' && mediaId.length > 0)
}

function isProjectArchivePath(value) {
  return typeof value === 'string' && value.startsWith('media/')
}

function assertUnique(values, label) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`)
    }
    seen.add(value)
  }
}

function assertValidArchivePath(ref) {
  const archivePath = ref?.archivePath
  if (typeof archivePath !== 'string' || archivePath.length === 0) {
    throw new Error(`mediaRef archivePath is required for mediaId=${ref?.mediaId || ''}`)
  }
  if (archivePath === 'project.json') {
    throw new Error('reserved archive path cannot be used by media: project.json')
  }
  if (!archivePath.startsWith('media/')) {
    throw new Error(`mediaRef archivePath must be under media/: ${archivePath}`)
  }
  if (archivePath.includes('\\') || /[\x00-\x1f\x7f]/.test(archivePath)) {
    throw new Error(`mediaRef archivePath must be a normalized media path: ${archivePath}`)
  }
  const segments = archivePath.split('/')
  if (
    segments[0] !== 'media' ||
    segments.length < 2 ||
    segments.slice(1).some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`mediaRef archivePath must be a normalized media path: ${archivePath}`)
  }
  return archivePath
}

async function normalizeMediaCandidates(media) {
  const byKey = new Map()
  const bySourcePath = new Map()

  function addKey(key, candidate) {
    if (!key) return
    if (byKey.has(key)) {
      throw new Error(`Duplicate media candidate key: ${key}`)
    }
    byKey.set(key, candidate)
  }

  function addSourcePath(sourcePath, candidate) {
    if (!sourcePath) return
    if (bySourcePath.has(sourcePath)) {
      throw new Error(`Duplicate media candidate sourcePath: ${sourcePath}`)
    }
    bySourcePath.set(sourcePath, [candidate])
  }

  async function addCandidate(candidate) {
    const bytes = await toBytes(candidate.bytes ?? candidate.data)
    const normalized = { ...candidate, bytes }
    for (const key of new Set([candidate.mediaId, candidate.archivePath])) {
      addKey(key, normalized)
    }
    addSourcePath(candidate.sourcePath, normalized)
  }

  if (Array.isArray(media)) {
    for (const candidate of media) await addCandidate(candidate)
    return { byKey, bySourcePath }
  }

  if (media && typeof media === 'object') {
    for (const [key, value] of Object.entries(media)) {
      const candidate = { sourcePath: key, bytes: await toBytes(value) }
      addKey(key, candidate)
      addSourcePath(key, candidate)
    }
  }

  return { byKey, bySourcePath }
}

function resolveMediaBytes(ref, candidates) {
  const direct = candidates.byKey.get(ref.mediaId) || candidates.byKey.get(ref.archivePath)
  if (direct) return direct.bytes

  if (ref.sourcePath) {
    const sourceMatches = candidates.bySourcePath.get(ref.sourcePath) || []
    if (sourceMatches.length > 1) {
      throw new Error(`Ambiguous sourcePath for ${ref.sourcePath}`)
    }
    if (sourceMatches.length === 1) return sourceMatches[0].bytes
  }

  throw new Error(`Missing media bytes: sourcePath=${ref.sourcePath || ''} mediaId=${ref.mediaId || ''} archivePath=${ref.archivePath || ''}`)
}

export async function packVrewProject({ projectJson, mediaRefs, media }) {
  const projectFiles = Array.isArray(projectJson?.files) ? projectJson.files : []
  const paths = projectMediaPaths(projectJson)
  assertUnique(projectMediaIds(projectJson), 'project mediaId')
  assertUnique(paths, 'project media path')
  if (paths.includes('project.json')) {
    throw new Error('reserved archive path cannot be used by media: project.json')
  }

  const refsList = Array.isArray(mediaRefs) ? mediaRefs : []
  assertUnique(refsList.map((ref) => ref?.mediaId).filter(Boolean), 'mediaRef mediaId')
  assertUnique(refsList.map((ref) => ref?.archivePath).filter(Boolean), 'mediaRef archivePath')

  const refsByArchivePath = new Map(refsList.map((ref) => [ref.archivePath, ref]))
  const refsByMediaId = new Map(refsList.map((ref) => [ref.mediaId, ref]))
  const refs = []
  for (const file of projectFiles) {
    const mediaId = file?.mediaId
    const projectPath = file?.path || mediaId
    if (!projectPath) continue
    const projectArchivePath = isProjectArchivePath(file?.path) ? file.path : null
    const ref = file?.path
      ? (refsByArchivePath.get(file.path) || refsByMediaId.get(mediaId))
      : refsByMediaId.get(mediaId)
    if (!ref) {
      throw new Error(`Missing mediaRef for project path ${projectPath}`)
    }
    assertValidArchivePath(ref)
    if (projectArchivePath && ref.archivePath !== projectArchivePath) {
      throw new Error(`mediaRef invariant failed for project path ${projectPath}: mediaId=${ref.mediaId || ''} archivePath=${ref.archivePath || ''}`)
    }
    refs.push(ref)
  }
  assertUnique(refs.map((ref) => assertValidArchivePath(ref)), 'media archive path')

  const entries = [
    {
      name: 'project.json',
      data: textEncoder.encode(JSON.stringify(projectJson, null, 2)),
    },
  ]
  const candidates = await normalizeMediaCandidates(media)

  for (const ref of refs) {
    entries.push({
      name: ref.archivePath,
      data: resolveMediaBytes(ref, candidates),
    })
  }

  return writeStoreZipEntries(entries)
}

export default {
  packVrewProject,
  writeStoreZipEntries,
}
