import { createHash } from 'node:crypto'

const ASCII_EDGE_WHITESPACE = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g
const UINT32_MAX = 0xffffffff

const ID_OR_ENUM_KEYS = new Set([
  'id',
  'sku',
  'schemaVersion',
  'mode',
  'sceneKey',
  'field',
  'sourceKind',
  'verification',
  'trust',
  'decision',
  'claimType',
  'role',
  'gender',
  'ageBand',
  'ethnicity',
  'provider',
  'imageModel',
  'videoModel',
  'aspectRatio',
  'videoResolution',
  'speechMode',
  'productStillAudio',
  'subtitleTiming',
  'visualType',
  'sourceAudioPolicy',
  'mimeType',
  'state',
  'status',
])

export function trimAsciiEdges(value) {
  return value.replace(ASCII_EDGE_WHITESPACE, '')
}

function isIdOrEnumKey(key) {
  return typeof key === 'string' && (
    ID_OR_ENUM_KEYS.has(key)
    || /(?:Id|Ids|Version)$/.test(key)
  )
}

function isUrlKey(key) {
  return typeof key === 'string' && /url$/i.test(key)
}

function isIntegerMillisecondKey(key) {
  return typeof key === 'string' && /Ms$/.test(key)
}

export function normalizeCanonicalString(value) {
  if (typeof value !== 'string') throw new TypeError('canonical string must be a string')

  const lines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\p{White_Space}+$/u, ''))

  while (lines[0] === '') lines.shift()
  while (lines.at(-1) === '') lines.pop()
  return lines.join('\n').normalize('NFC')
}

export function normalizeCanonicalUrl(value) {
  const normalized = normalizeCanonicalString(value)
  let url
  try {
    url = new URL(normalized)
  } catch (error) {
    throw new TypeError(`invalid canonical URL: ${error.message}`)
  }

  url.protocol = url.protocol.toLowerCase()
  url.hostname = url.hostname.toLowerCase()
  if (url.port === '443') url.port = ''
  url.hash = ''
  return url.toString()
}

function normalizeNumber(value, key, path) {
  if (!Number.isFinite(value)) throw new TypeError(`${path} must be a finite number`)
  const normalized = Object.is(value, -0) ? 0 : value

  if (isIntegerMillisecondKey(key) && !Number.isInteger(normalized)) {
    throw new TypeError(`${path} must be an integer millisecond value`)
  }
  if (key === 'videoSeed' && (!Number.isInteger(normalized) || normalized < 0 || normalized > UINT32_MAX)) {
    throw new RangeError(`${path} must be a uint32`)
  }
  return normalized
}

function normalizeValue(value, key, path, ancestors) {
  if (value === undefined) throw new TypeError(`${path} cannot be undefined; omit optional properties`)
  if (value === null) {
    if (key === 'trim') return null
    throw new TypeError(`${path} must omit optional values instead of using null`)
  }

  if (typeof value === 'string') {
    let normalized = isUrlKey(key) ? normalizeCanonicalUrl(value) : normalizeCanonicalString(value)
    if (isIdOrEnumKey(key)) normalized = trimAsciiEdges(normalized)
    return normalized
  }
  if (typeof value === 'number') return normalizeNumber(value, key, path)
  if (typeof value === 'boolean') return value

  if (typeof value !== 'object') throw new TypeError(`${path} contains unsupported ${typeof value}`)
  if (ancestors.has(value)) throw new TypeError(`${path} contains a circular reference`)
  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => {
        const normalized = normalizeValue(item, key, `${path}[${index}]`, ancestors)
        if (normalized === undefined) throw new TypeError(`${path}[${index}] cannot be undefined`)
        return normalized
      })
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain objects`)
    }

    const normalized = {}
    for (const childKey of Object.keys(value).sort()) {
      const child = normalizeValue(value[childKey], childKey, `${path}.${childKey}`, ancestors)
      if (child !== undefined) normalized[childKey] = child
    }
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

export function normalizeCanonicalPlan(plan) {
  if (plan === null || Array.isArray(plan) || typeof plan !== 'object') {
    throw new TypeError('canonical plan must be an object')
  }
  return normalizeValue(plan, '', '$', new WeakSet())
}

export function canonicalStringify(canonicalPlan) {
  return JSON.stringify(normalizeCanonicalPlan(canonicalPlan))
}

export function computePlanHash(canonicalPlan) {
  return createHash('sha256').update(canonicalStringify(canonicalPlan), 'utf8').digest('hex')
}

export function deriveVideoSeed(videoSeedBase, sceneKey) {
  if (typeof videoSeedBase !== 'string' || typeof sceneKey !== 'string') {
    throw new TypeError('videoSeedBase and sceneKey must be strings')
  }
  return createHash('sha256')
    .update(`${videoSeedBase}:${sceneKey}`, 'utf8')
    .digest()
    .readUInt32BE(0)
}

function deriveUuid(namespace, planId, revision, sceneKey) {
  if (typeof planId !== 'string' || !Number.isInteger(revision) || typeof sceneKey !== 'string') {
    throw new TypeError('planId and sceneKey must be strings and revision must be an integer')
  }

  const bytes = Buffer.from(
    createHash('sha256').update(`${namespace}:${planId}:${revision}:${sceneKey}`, 'utf8').digest().subarray(0, 16),
  )
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function deriveStoryId(planId, revision, sceneKey) {
  return deriveUuid('shopping-story', planId, revision, sceneKey)
}

export function deriveRendererSceneId(planId, revision, sceneKey) {
  return deriveUuid('shopping-renderer', planId, revision, sceneKey)
}

export function deriveDeterministicSceneIds(planId, revision, sceneKey) {
  return {
    storyId: deriveStoryId(planId, revision, sceneKey),
    rendererSceneId: deriveRendererSceneId(planId, revision, sceneKey),
  }
}
