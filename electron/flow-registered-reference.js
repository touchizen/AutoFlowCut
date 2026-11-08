// The reference card stores a media UUID. A project workflow has a different UUID
// in slot 0. Only its output in [3][4] identifies a selectable media asset.
import { isFlowProjectMediaId } from '../src/utils/flowProjectMediaId.js'

const key = (s) => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : ''
const fail = () => { throw new Error('reference-registered-unverified') }

export function registeredAsset(data, project, id) {
  const rows = data?.[1]
  if (!Array.isArray(rows)) fail()
  const matches = rows.filter(w => w?.[4] === project && w?.[3]?.[4] === id)
  const w = matches[0], label = w?.[3]?.[0]
  if (matches.length !== 1 || !isFlowProjectMediaId(w[0]) || !key(label) || label.length > 512 ||
      rows.filter(other => key(other?.[3]?.[0]) === key(label)).length !== 1) fail()
  return { id, workflow: w[0], label }
}

export function thumbnailKey(url) {
  if (typeof url !== 'string') return null
  const direct = /^https:\/\/flow-content\.google\/image\/([a-f0-9-]{36})(?:[?#]|$)/i.exec(url)
  if (direct && isFlowProjectMediaId(direct[1])) return 'media:' + direct[1].toLowerCase()
  const asb = /^https:\/\/(?:flow\.google\.com|lh3\.googleusercontent\.com)\/asb\/([A-Za-z0-9_-]+)(?:[=?#]|$)/.exec(url)
  return asb ? 'asb:' + asb[1] : null
}

// Bind opaque ASB thumbnails to the exact project workflow/media record.
export function recordThumbnailKey(rec, asset, project) {
  if (rec?.[0] !== asset.id || (rec[1] != null && rec[1] !== project) || rec[2] !== asset.workflow) fail()
  return thumbnailKey(rec?.[5]?.[10])
}
