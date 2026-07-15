// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// electron nativeImage 를 mock 해 wrapper 배선만 검증한다. 실제 WebP/GIF empty 판정은 패키징 smoke 몫.
const createFromPath = vi.fn()
vi.mock('electron', () => ({ nativeImage: { createFromPath: (...a) => createFromPath(...a) } }))

const { createNativeImageReader } = await import('../../../electron/agent/nativeImageReader.js')

function fakeNativeImage({ empty = false, width = 400, height = 600 } = {}) {
  const jpegBuf = Buffer.from('JPEGBYTES')
  const resized = { toJPEG: vi.fn(() => Buffer.from('RESIZED')) }
  return {
    isEmpty: vi.fn(() => empty),
    getSize: vi.fn(() => ({ width, height })),
    resize: vi.fn(() => resized),
    toJPEG: vi.fn(() => jpegBuf),
    _resized: resized,
  }
}

let reader
beforeEach(() => {
  createFromPath.mockReset()
  reader = createNativeImageReader()
})

describe('createNativeImageReader.decodeFile', () => {
  it('empty 이미지 → isEmpty true, size 0', async () => {
    const img = fakeNativeImage({ empty: true })
    createFromPath.mockReturnValue(img)
    const decoded = await reader.decodeFile('/x.webp')
    expect(decoded.isEmpty).toBe(true)
    expect(decoded.width).toBe(0)
    expect(decoded.height).toBe(0)
  })

  it('비어있지 않으면 getSize 로 width/height', async () => {
    createFromPath.mockReturnValue(fakeNativeImage({ width: 720, height: 1280 }))
    const decoded = await reader.decodeFile('/x.png')
    expect(decoded).toMatchObject({ isEmpty: false, width: 720, height: 1280 })
  })

  it('toBlock(resize) → nativeImage.resize 후 JPEG base64', async () => {
    const img = fakeNativeImage({ width: 720, height: 1280 })
    createFromPath.mockReturnValue(img)
    const decoded = await reader.decodeFile('/x.png')
    const block = decoded.toBlock({ resize: { height: 768 } })
    expect(img.resize).toHaveBeenCalledWith({ height: 768 })
    expect(block.mimeType).toBe('image/jpeg')
    expect(block.data).toBe(Buffer.from('RESIZED').toString('base64'))
  })

  it('toBlock(resize:null) → resize 없이 원본 JPEG', async () => {
    const img = fakeNativeImage({ width: 400, height: 600 })
    createFromPath.mockReturnValue(img)
    const decoded = await reader.decodeFile('/x.png')
    const block = decoded.toBlock({ resize: null })
    expect(img.resize).not.toHaveBeenCalled()
    expect(block.data).toBe(Buffer.from('JPEGBYTES').toString('base64'))
  })
})

describe('createNativeImageReader.exists', () => {
  it('존재하는 파일 → true, 없는 파일 → false', async () => {
    expect(await reader.exists('/definitely/not/here.png')).toBe(false)
  })
})
