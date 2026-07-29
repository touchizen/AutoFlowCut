// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { IMAGE_FETCH_POLICY } from '../../../electron/api/net/safeHttpFetch.js'
import {
  createContentAddressedStaging,
  createFetchProduct,
} from '../../../electron/shopping/fetchProduct.js'

const PRODUCT_URL = 'https://www.coupang.com/vp/products/9593899670'
const FETCHED_AT = '2026-07-23T09:10:11.000Z'
const IMAGE_URLS = [1, 2, 3, 4, 5].map((index) => (
  `https://thumbnail${index}.coupangcdn.com/image/product-${index}.jpg`
))

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function makeTempProject() {
  const directory = await mkdtemp(path.join(tmpdir(), 'shopping-fetch-product-'))
  temporaryDirectories.push(directory)
  return directory
}

function makeImageResponse(url) {
  return {
    body: Buffer.from(`admitted image bytes for ${url}`),
    mimeType: 'image/jpeg',
    width: 492,
    height: 492,
    statusCode: 200,
    url,
  }
}

function productExtraction(overrides = {}) {
  return {
    status: 'ok',
    trust: 'untrusted-web-data',
    sourceUrl: PRODUCT_URL,
    product: {
      name: '댄트롤 딥 클린 비듬샴푸',
      priceKrw: 29800,
      currency: 'KRW',
    },
    sourceFacts: [{
      field: 'name',
      value: '댄트롤 딥 클린 비듬샴푸',
      sourceKind: 'dom',
      sourceUrl: PRODUCT_URL,
      jsonPathOrProperty: 'document:title',
      verification: 'page-rendered',
      trust: 'untrusted-web-data',
    }],
    imageUrls: IMAGE_URLS,
    ...overrides,
  }
}

async function createSubject({ extraction = productExtraction(), cdpProductFetch, imageFetch } = {}) {
  const projectPath = await makeTempProject()
  const effectiveCdpProductFetch = cdpProductFetch || vi.fn(async () => extraction)
  const effectiveImageFetch = imageFetch || vi.fn(async (url) => makeImageResponse(url))
  const staging = createContentAddressedStaging({
    fs: { mkdir, readFile, writeFile },
  })
  const fetchProduct = createFetchProduct({
    cdpProductFetch: effectiveCdpProductFetch,
    imageFetch: effectiveImageFetch,
    staging,
    now: () => FETCHED_AT,
  })
  return {
    fetchProduct,
    cdpProductFetch: effectiveCdpProductFetch,
    imageFetch: effectiveImageFetch,
    projectPath,
  }
}

function collectUnsafeSummaryValues(value, pathName = '$', found = []) {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    found.push(`${pathName}:binary`)
    return found
  }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:body|bytes|base64|data|content|path|localPath)$/i.test(key)) {
      found.push(`${pathName}.${key}`)
    }
    collectUnsafeSummaryValues(child, `${pathName}.${key}`, found)
  }
  return found
}

describe('createFetchProduct', () => {
  it('stamps a CDP DOM extraction into a byte-free snapshot and stages images through fixed policy', async () => {
    const { fetchProduct, cdpProductFetch, imageFetch, projectPath } = await createSubject()
    const controller = new AbortController()

    const result = await fetchProduct(PRODUCT_URL, {
      projectPath,
      signal: controller.signal,
    })

    expect(result).toMatchObject({
      status: 'ok',
      trust: 'untrusted-web-data',
      snapshotId: expect.stringMatching(/^snapshot-[0-9a-f]{64}$/),
      fetchedAt: FETCHED_AT,
      product: {
        name: expect.stringContaining('비듬샴푸'),
        priceKrw: 29800,
      },
    })
    expect(result.sourceFacts.length).toBeGreaterThan(0)
    expect(result.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(/^fact-[0-9a-f]{64}$/),
        field: 'name',
        fetchedAt: FETCHED_AT,
        sourceKind: 'dom',
        verification: 'page-rendered',
        trust: 'untrusted-web-data',
      }),
    ]))
    expect(result.images).toHaveLength(5)
    expect(result.images[0]).toEqual({
      id: expect.stringMatching(/^image-[0-9a-f]{64}$/),
      assetId: expect.stringMatching(/^asset-[0-9a-f]{64}$/),
      sourceUrl: expect.stringMatching(/^https:\/\/.*\.coupangcdn\.com\//),
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      mimeType: 'image/jpeg',
      width: 492,
      height: 492,
    })
    expect(result.selectedImageIds).toEqual(result.images.slice(0, 5).map(({ id }) => id))
    expect(collectUnsafeSummaryValues(result)).toEqual([])
    expect(JSON.stringify(result)).not.toMatch(/;base64,|<html|application\/ld\+json/i)

    expect(cdpProductFetch).toHaveBeenCalledWith(
      PRODUCT_URL,
      { signal: controller.signal },
    )
    expect(imageFetch).toHaveBeenCalledTimes(5)
    for (const [, policy, options] of imageFetch.mock.calls) {
      expect(policy).toBe(IMAGE_FETCH_POLICY)
      expect(options).toEqual({ signal: controller.signal })
    }
  })

  it('stores identical bytes at the same project-internal content-addressed path', async () => {
    const projectPath = await makeTempProject()
    const fs = await import('node:fs/promises')
    const staging = createContentAddressedStaging({ fs })
    const bytes = Buffer.from('same image bytes')
    const digest = 'f10266197016b8e8842aeba6800100997ce04f35a45a3bff974711e9615ea597'

    const first = await staging.stageImage({ projectPath, digest, bytes, mimeType: 'image/jpeg' })
    const second = await staging.stageImage({ projectPath, digest, bytes, mimeType: 'image/jpeg' })

    expect(second).toEqual(first)
    expect(first.path.startsWith(`${projectPath}${path.sep}`)).toBe(true)
    expect(await readFile(first.path)).toEqual(bytes)
    expect(await readdir(path.dirname(first.path))).toEqual([`${digest}.jpg`])
  })

  it('rejects a relative projectPath before staging any image', async () => {
    const projectPath = await makeTempProject()
    const relativeProjectPath = path.relative(process.cwd(), projectPath)
    const fs = await import('node:fs/promises')
    const staging = createContentAddressedStaging({ fs })
    const bytes = Buffer.from('same image bytes')
    const digest = 'f10266197016b8e8842aeba6800100997ce04f35a45a3bff974711e9615ea597'

    await expect(staging.stageImage({
      projectPath: relativeProjectPath,
      digest,
      bytes,
      mimeType: 'image/jpeg',
    })).rejects.toThrow(TypeError)
  })

  it('rejects a non-hex digest before it can become a staging path component', async () => {
    const projectPath = await makeTempProject()
    const fs = await import('node:fs/promises')
    const staging = createContentAddressedStaging({ fs })

    await expect(staging.stageImage({
      projectPath,
      digest: 'g'.repeat(64),
      bytes: Buffer.from('same image bytes'),
      mimeType: 'image/jpeg',
    })).rejects.toThrow(TypeError)
  })

  it('refuses to reuse a content-addressed path whose existing bytes were tampered with', async () => {
    const projectPath = await makeTempProject()
    const fs = await import('node:fs/promises')
    const staging = createContentAddressedStaging({ fs })
    const bytes = Buffer.from('original image bytes')
    const digest = 'fe4f87951686e62398485bd0dbfc644c2aec3467729d139669483b20e58fcea3'
    const staged = await staging.stageImage({ projectPath, digest, bytes, mimeType: 'image/jpeg' })
    await writeFile(staged.path, Buffer.from('tampered'))

    await expect(staging.stageImage({ projectPath, digest, bytes, mimeType: 'image/jpeg' }))
      .rejects.toThrow('existing staged image digest mismatch')
  })

  it('uses distinct selectable IDs but one content asset for different URLs with identical bytes', async () => {
    const imageFetch = vi.fn(async (url) => ({
      ...makeImageResponse(url),
      body: Buffer.from('shared admitted bytes'),
    }))
    const { fetchProduct, projectPath } = await createSubject({ imageFetch })

    const result = await fetchProduct(PRODUCT_URL, { projectPath })

    expect(new Set(result.images.map(({ id }) => id)).size).toBe(5)
    expect(new Set(result.images.map(({ assetId }) => assetId)).size).toBe(1)
    expect(new Set(result.selectedImageIds).size).toBe(5)
  })

  it('returns unsupported for a malformed image body admitted by a broken DI adapter', async () => {
    const imageFetch = vi.fn(async (url) => ({ ...makeImageResponse(url), body: 'not binary' }))
    const { fetchProduct, projectPath } = await createSubject({ imageFetch })

    await expect(fetchProduct(PRODUCT_URL, { projectPath })).resolves.toEqual({
      status: 'unsupported',
      trust: 'untrusted-web-data',
      reason: 'Product image could not be fetched',
    })
  })

  it('returns unsupported without staging when an image fetch fails', async () => {
    const imageFetch = vi.fn(async () => {
      throw new Error('image transport failed')
    })
    const { fetchProduct, projectPath } = await createSubject({ imageFetch })

    await expect(fetchProduct(PRODUCT_URL, { projectPath })).resolves.toEqual({
      status: 'unsupported',
      trust: 'untrusted-web-data',
      reason: 'Product image could not be fetched',
    })
  })

  it.each([
    ['name', productExtraction({ product: {}, sourceFacts: [] })],
    ['image', productExtraction({ imageUrls: [] })],
  ])('returns unsupported when the required %s is absent', async (_field, extraction) => {
    const { fetchProduct, imageFetch, projectPath } = await createSubject({ extraction })

    const result = await fetchProduct(PRODUCT_URL, { projectPath })

    expect(result).toMatchObject({ status: 'unsupported', trust: 'untrusted-web-data' })
    expect(imageFetch).not.toHaveBeenCalled()
  })

  it('rethrows cancellation instead of converting it to unsupported', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('cancelled', 'AbortError')
    const imageFetch = vi.fn(async (_url, _policy, { signal }) => {
      expect(signal).toBe(controller.signal)
      controller.abort(abortError)
      throw abortError
    })
    const { fetchProduct, projectPath } = await createSubject({ imageFetch })

    await expect(fetchProduct(PRODUCT_URL, {
      projectPath,
      signal: controller.signal,
    })).rejects.toBe(abortError)
  })
})
