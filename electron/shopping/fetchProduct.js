import { createHash } from 'node:crypto'
import path from 'node:path'

import { IMAGE_FETCH_POLICY } from '../api/net/safeHttpFetch.js'
import { canonicalStringify } from './planCanonical.js'

const TRUST = 'untrusted-web-data'
const IMAGE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
})

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function unsupported(reason) {
  return { status: 'unsupported', trust: TRUST, reason }
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) return
  throw signal.reason || new DOMException('The operation was aborted', 'AbortError')
}

function asBytes(value) {
  if (Buffer.isBuffer(value)) return value
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new TypeError('safe fetch body must be binary')
}

function normalizeFetchedAt(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  throw new TypeError('now() must return a timestamp string, Date, or epoch milliseconds')
}

function isAdmittedImage(response) {
  return Boolean(
    response
    && Object.hasOwn(IMAGE_EXTENSIONS, response.mimeType)
    && Number.isSafeInteger(response.width)
    && response.width > 0
    && Number.isSafeInteger(response.height)
    && response.height > 0,
  )
}

function assertFactoryInputs({ cdpProductFetch, imageFetch, staging, now }) {
  if (typeof cdpProductFetch !== 'function') {
    throw new TypeError('cdpProductFetch must be a function')
  }
  if (typeof imageFetch !== 'function') throw new TypeError('imageFetch must be a function')
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  const stageImage = typeof staging === 'function' ? staging : staging?.stageImage
  if (typeof stageImage !== 'function') throw new TypeError('staging.stageImage must be a function')
  return stageImage.bind(staging)
}

/**
 * Creates a filesystem adapter without giving fetchProduct ambient filesystem access.
 * Files are stored below `<projectPath>/.shopping-staging/images/<prefix>/`.
 */
export function createContentAddressedStaging({ fs } = {}) {
  if (
    !fs
    || typeof fs.mkdir !== 'function'
    || typeof fs.readFile !== 'function'
    || typeof fs.writeFile !== 'function'
  ) {
    throw new TypeError('fs.mkdir, fs.readFile, and fs.writeFile are required')
  }

  return Object.freeze({
    async stageImage({ projectPath, digest, bytes, mimeType }) {
      if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
        throw new TypeError('projectPath must be an absolute path')
      }
      if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
        throw new TypeError('digest must be a lowercase SHA-256 hex string')
      }

      const admittedBytes = asBytes(bytes)
      if (sha256(admittedBytes) !== digest) throw new Error('staging digest mismatch')
      const extension = IMAGE_EXTENSIONS[mimeType]
      if (!extension) throw new TypeError('unsupported staged image MIME type')

      const projectRoot = path.resolve(projectPath)
      const directory = path.join(
        projectRoot,
        '.shopping-staging',
        'images',
        digest.slice(0, 2),
      )
      const filePath = path.join(directory, `${digest}.${extension}`)
      await fs.mkdir(directory, { recursive: true })
      try {
        await fs.writeFile(filePath, admittedBytes, { flag: 'wx' })
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        const existingBytes = asBytes(await fs.readFile(filePath))
        if (sha256(existingBytes) !== digest) {
          throw new Error('existing staged image digest mismatch')
        }
      }
      return Object.freeze({ path: filePath })
    },
  })
}

/**
 * @param {{
 *   cdpProductFetch: Function,
 *   imageFetch: Function,
 *   staging: Function|{stageImage: Function},
 *   now: Function,
 * }} dependencies
 * @returns {(url: string, context: {projectPath: string, signal?: AbortSignal}) => Promise<object>}
 */
export function createFetchProduct(dependencies = {}) {
  const { cdpProductFetch, imageFetch, staging, now } = dependencies
  const stageImage = assertFactoryInputs(dependencies)

  return async function fetchProduct(url, { projectPath, signal } = {}) {
    abortIfNeeded(signal)
    const fetchedAt = normalizeFetchedAt(now())
    const parsed = await cdpProductFetch(url, { signal })
    abortIfNeeded(signal)

    if (parsed.status !== 'ok') return parsed
    if (
      !parsed.product
      || typeof parsed.product.name !== 'string'
      || !parsed.product.name.trim()
      || !Array.isArray(parsed.sourceFacts)
      || !Array.isArray(parsed.imageUrls)
    ) {
      return unsupported('Required product name or image is unavailable')
    }
    const sourceUrl = typeof parsed.sourceUrl === 'string' && parsed.sourceUrl
      ? parsed.sourceUrl
      : url

    const sourceFacts = parsed.sourceFacts.map((fact, index) => {
      const stamped = { ...fact, fetchedAt }
      return {
        id: `fact-${sha256(canonicalStringify({ index, ...stamped }))}`,
        ...stamped,
      }
    })

    const images = []
    for (const imageUrl of parsed.imageUrls) {
      abortIfNeeded(signal)
      let response
      let bytes
      try {
        response = await imageFetch(imageUrl, IMAGE_FETCH_POLICY, { signal })
        abortIfNeeded(signal)
        if (!isAdmittedImage(response)) throw new Error('invalid admitted image response')
        bytes = asBytes(response.body)
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error
        return unsupported('Product image could not be fetched')
      }

      const digest = sha256(bytes)
      await stageImage({
        projectPath,
        digest,
        bytes,
        mimeType: response.mimeType,
        signal,
      })
      abortIfNeeded(signal)

      const admittedSourceUrl = typeof response.url === 'string' && response.url
        ? response.url
        : imageUrl
      images.push({
        id: `image-${sha256(canonicalStringify({ sourceUrl: admittedSourceUrl, digest }))}`,
        assetId: `asset-${digest}`,
        sourceUrl: admittedSourceUrl,
        digest,
        mimeType: response.mimeType,
        width: response.width,
        height: response.height,
      })
    }

    if (images.length === 0) return unsupported('Required product image is unavailable')

    const snapshotId = `snapshot-${sha256(canonicalStringify({
      sourceUrl,
      fetchedAt,
      product: parsed.product,
      sourceFacts,
      images,
    }))}`

    return {
      status: 'ok',
      trust: TRUST,
      snapshotId,
      fetchedAt,
      product: parsed.product,
      sourceFacts,
      images,
      selectedImageIds: images.slice(0, 5).map(({ id }) => id),
    }
  }
}
