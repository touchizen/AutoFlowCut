const DEFAULT_START_BYTES = 256 * 1024

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

/**
 * Deterministic sizes for the R1 operator-run image boundary probe.
 * The explicit ceiling is always included and no generated size exceeds it.
 */
export function buildImageSizeLadder({
  safetyCeilingBytes,
  startBytes = DEFAULT_START_BYTES,
} = {}) {
  const ceiling = positiveInteger(safetyCeilingBytes, 'safetyCeilingBytes')
  const start = positiveInteger(startBytes, 'startBytes')
  if (ceiling < start) throw new RangeError('safetyCeilingBytes must be at least startBytes')

  const sizes = []
  for (let size = start; size <= ceiling; size *= 2) {
    sizes.push(size)
    if (size > Number.MAX_SAFE_INTEGER / 2) break
  }
  if (sizes.at(-1) !== ceiling) sizes.push(ceiling)
  return sizes
}

/**
 * Returns the deterministic optimistic candidates between an observed success
 * and rejection. The measurement runner must stop/re-bracket immediately when
 * a candidate rejects; this helper never labels a candidate as an outcome.
 */
export function buildBoundedSizeSearch({
  largestVerifiedBytes,
  firstRejectedBytes,
  precisionBytes = 1024,
} = {}) {
  let lower = positiveInteger(largestVerifiedBytes, 'largestVerifiedBytes')
  const upper = positiveInteger(firstRejectedBytes, 'firstRejectedBytes')
  const precision = positiveInteger(precisionBytes, 'precisionBytes')
  if (lower >= upper) throw new RangeError('largestVerifiedBytes must be below firstRejectedBytes')

  const candidates = []
  while (upper - lower > precision) {
    const midpoint = lower + Math.floor((upper - lower) / 2)
    if (midpoint === lower || midpoint === upper) break
    candidates.push(midpoint)
    lower = midpoint
  }
  return candidates
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PADDING_CHUNK_TYPE = Buffer.from('afCS', 'ascii')

let crcTable = null
function getCrcTable() {
  if (crcTable) return crcTable
  crcTable = Array.from({ length: 256 }, (_, n) => {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    return value >>> 0
  })
  return crcTable
}

function crc32(parts) {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const part of parts) {
    for (const byte of part) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function assertPngWithTerminalIend(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new TypeError('sourceBytes must be a PNG Buffer')
  }
  if (bytes.subarray(-8, -4).toString('ascii') !== 'IEND') {
    throw new TypeError('sourceBytes must end with an IEND chunk')
  }
}

/**
 * Inserts a private ancillary PNG chunk immediately before IEND. The returned
 * buffer remains a decodable PNG and has exactly targetBytes bytes.
 */
export function padPngToExactSize(sourceBytes, targetBytes) {
  assertPngWithTerminalIend(sourceBytes)
  const target = positiveInteger(targetBytes, 'targetBytes')
  if (target < sourceBytes.length) throw new RangeError('targetBytes cannot be smaller than sourceBytes')
  if (target === sourceBytes.length) return Buffer.from(sourceBytes)

  const addedBytes = target - sourceBytes.length
  if (addedBytes < 12) throw new RangeError('targetBytes must leave room for a PNG chunk')
  const payloadLength = addedBytes - 12
  if (payloadLength > 0xffffffff) throw new RangeError('PNG padding chunk exceeds the format limit')

  const length = Buffer.alloc(4)
  length.writeUInt32BE(payloadLength)
  const payload = Buffer.alloc(payloadLength)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32([PADDING_CHUNK_TYPE, payload]))
  const iendOffset = sourceBytes.length - 12

  return Buffer.concat([
    sourceBytes.subarray(0, iendOffset),
    length,
    PADDING_CHUNK_TYPE,
    payload,
    checksum,
    sourceBytes.subarray(iendOffset),
  ], target)
}

