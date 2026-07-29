import { describe, it, expect, vi } from 'vitest'
import { extFromContentType, saveImage } from '../../electron/spike-chatgpt-image.js'

const CDN = 'https://chatgpt.com/backend-api/estuary/content?id=new1&sig=x'
const app = { getPath: () => '/UD' }

function makeView({ ok = true, status = 200, contentType = 'image/png', bytes = [1, 2, 3] } = {}) {
  const fetch = vi.fn(async () => ({
    ok, status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  }))
  return { view: { webContents: { session: { fetch } } }, fetch }
}

function makeFs() {
  const calls = []
  return {
    calls,
    mkdirSync: vi.fn((...a) => { calls.push(['mkdir', ...a]) }),
    writeFileSync: vi.fn((...a) => { calls.push(['write', a[0]]) }),
  }
}

describe('extFromContentType', () => {
  it('maps the image content types', () => {
    expect(extFromContentType('image/png')).toBe('png')
    expect(extFromContentType('image/jpeg')).toBe('jpg')
    expect(extFromContentType('image/webp')).toBe('webp')
  })
  it('ignores charset/parameters and case', () => {
    expect(extFromContentType('Image/WEBP; charset=binary')).toBe('webp')
  })
  it('falls back to the src extension, then png', () => {
    expect(extFromContentType(null, 'https://x/y/a.webp?sig=1')).toBe('webp')
    expect(extFromContentType('application/octet-stream', 'https://x/y/a.jpeg')).toBe('jpg')
    expect(extFromContentType(null, CDN)).toBe('png')
    expect(extFromContentType(undefined, undefined)).toBe('png')
  })
})

describe('saveImage', () => {
  it('fetches through the view session (partition cookies) and writes the bytes', async () => {
    const { view, fetch } = makeView()
    const fs = makeFs()
    const p = await saveImage(app, view, CDN, fs, { now: () => 1700000000000 })
    expect(fetch).toHaveBeenCalledWith(CDN)
    expect(p).toBe('/UD/spike-chatgpt/generated-1700000000000.png')
    expect(fs.writeFileSync).toHaveBeenCalledOnce()
    expect(fs.writeFileSync.mock.calls[0][0]).toBe(p)
    expect(Buffer.isBuffer(fs.writeFileSync.mock.calls[0][1])).toBe(true)
    expect([...fs.writeFileSync.mock.calls[0][1]]).toEqual([1, 2, 3])
  })
  it('creates the directory BEFORE writing', async () => {
    const { view } = makeView()
    const fs = makeFs()
    await saveImage(app, view, CDN, fs, { now: () => 1 })
    expect(fs.calls.map((c) => c[0])).toEqual(['mkdir', 'write'])
    expect(fs.mkdirSync).toHaveBeenCalledWith('/UD/spike-chatgpt', { recursive: true })
  })
  it('uses the response content-type for the extension', async () => {
    const { view } = makeView({ contentType: 'image/webp' })
    const fs = makeFs()
    const p = await saveImage(app, view, CDN, fs, { now: () => 7 })
    expect(p.endsWith('generated-7.webp')).toBe(true)
  })
  it('throws and writes nothing when the response is not ok', async () => {
    const { view } = makeView({ ok: false, status: 403 })
    const fs = makeFs()
    await expect(saveImage(app, view, CDN, fs, {})).rejects.toThrow(/403/)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})
