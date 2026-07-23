// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  HTML_FETCH_POLICY,
  IMAGE_FETCH_POLICY,
} from '../../../electron/api/net/safeHttpFetch.js'
import {
  createContentAddressedStaging,
  createFetchProduct,
} from '../../../electron/shopping/fetchProduct.js'

const PRODUCT_URL = 'https://www.coupang.com/vp/products/9593899670'
const FETCHED_AT = '2026-07-23T09:10:11.000Z'

let fixtureHtml
const temporaryDirectories = []

beforeAll(async () => {
  fixtureHtml = await readFile(
    path.join(process.cwd(), 'tests', 'fixtures', 'shopping', 'coupang-product.html'),
    'utf8',
  )
})

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

async function createSubject({ html = fixtureHtml, imageFetch } = {}) {
  const projectPath = await makeTempProject()
  const httpFetch = vi.fn(async () => ({
    body: Buffer.from(html),
    mimeType: 'text/html',
    statusCode: 200,
    url: PRODUCT_URL,
  }))
  const effectiveImageFetch = imageFetch || vi.fn(async (url) => makeImageResponse(url))
  const staging = createContentAddressedStaging({
    fs: { mkdir, readFile, writeFile },
  })
  const fetchProduct = createFetchProduct({
    httpFetch,
    imageFetch: effectiveImageFetch,
    staging,
    now: () => FETCHED_AT,
  })
  return { fetchProduct, httpFetch, imageFetch: effectiveImageFetch, projectPath }
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
  it('fetches the captured Coupang fixture through fixed policies and returns a stamped byte-free summary', async () => {
    const { fetchProduct, httpFetch, imageFetch, projectPath } = await createSubject()
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
        sku: '9593899670-28671723349',
        priceKrw: 29800,
      },
    })
    expect(result.sourceFacts.length).toBeGreaterThan(0)
    expect(result.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(/^fact-[0-9a-f]{64}$/),
        field: 'name',
        fetchedAt: FETCHED_AT,
        verification: 'page-asserted',
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

    expect(httpFetch).toHaveBeenCalledWith(
      PRODUCT_URL,
      HTML_FETCH_POLICY,
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
    ['name', '<meta property="og:image" content="https://thumbnail.coupangcdn.com/image/product.jpg">'],
    ['image', '<meta property="og:title" content="상품명">'],
  ])('returns unsupported when the required %s is absent', async (_field, html) => {
    const { fetchProduct, imageFetch, projectPath } = await createSubject({ html })

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
