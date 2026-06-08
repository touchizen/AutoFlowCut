/**
 * referenceResolver.test.js — 레퍼런스 객체 → inline base64 변환 단위 테스트.
 *
 * 메모리 data 우선, 없으면 디스크(name) 읽기, 해석 실패는 건너뜀, 순서 보존.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveReferenceImages } from '../../src/utils/referenceResolver'

const mkFs = (map, pathMap = {}) => ({
  readReference: vi.fn(async (_proj, name) =>
    map[name] != null ? { success: true, data: map[name] } : { success: false }),
  readFileByPath: vi.fn(async (filePath) =>
    pathMap[filePath] != null ? { success: true, data: pathMap[filePath] } : { success: false }),
})

describe('resolveReferenceImages', () => {
  it('메모리 data 우선 사용 (디스크 안 읽음)', async () => {
    const fs = mkFs({})
    const out = await resolveReferenceImages(
      [{ name: 'a', data: 'data:image/png;base64,iVBORmem' }],
      { projectName: 'p', fs }
    )
    expect(out).toEqual([{ mimeType: 'image/png', data: 'iVBORmem' }])
    expect(fs.readReference).not.toHaveBeenCalled()
  })

  it('메모리에 없으면 name 으로 디스크 읽기', async () => {
    const fs = mkFs({ hero: '/9j/diskjpg' })
    const out = await resolveReferenceImages([{ name: 'hero' }], { projectName: 'p', fs })
    expect(out).toEqual([{ mimeType: 'image/jpeg', data: '/9j/diskjpg' }])
    expect(fs.readReference).toHaveBeenCalledWith('p', 'hero')
  })

  it('메모리에 없고 filePath 가 있으면 정확한 파일 경로를 먼저 읽기', async () => {
    const fs = mkFs({ style: 'iVBORname' }, { '/refs/style.webp': 'UklGRwebp' })
    const out = await resolveReferenceImages([{ name: 'style', filePath: '/refs/style.webp' }], { projectName: 'p', fs })
    expect(out).toEqual([{ mimeType: 'image/webp', data: 'UklGRwebp' }])
    expect(fs.readFileByPath).toHaveBeenCalledWith('/refs/style.webp')
    expect(fs.readReference).not.toHaveBeenCalled()
  })

  it('name 이 없는 filePath-only 레퍼런스도 정확한 파일 경로로 읽기', async () => {
    const fs = mkFs({}, { '/refs/style.png': 'iVBORstyle' })
    const out = await resolveReferenceImages([{ filePath: '/refs/style.png' }], { projectName: 'p', fs })
    expect(out).toEqual([{ mimeType: 'image/png', data: 'iVBORstyle' }])
    expect(fs.readFileByPath).toHaveBeenCalledWith('/refs/style.png')
    expect(fs.readReference).not.toHaveBeenCalled()
  })

  it('filePath 읽기 실패 시 name 기반 디스크 읽기로 fallback', async () => {
    const fs = mkFs({ style: '/9j/namejpg' }, {})
    const out = await resolveReferenceImages([{ name: 'style', filePath: '/refs/missing.png' }], { projectName: 'p', fs })
    expect(out).toEqual([{ mimeType: 'image/jpeg', data: '/9j/namejpg' }])
    expect(fs.readFileByPath).toHaveBeenCalledWith('/refs/missing.png')
    expect(fs.readReference).toHaveBeenCalledWith('p', 'style')
  })

  it('해석 불가(파일 없음/필드 없음) 레퍼런스는 건너뜀', async () => {
    const fs = mkFs({})
    const out = await resolveReferenceImages([{ name: 'missing' }, { foo: 1 }, null], { projectName: 'p', fs })
    expect(out).toEqual([])
  })

  it('빈/널 입력 → []', async () => {
    expect(await resolveReferenceImages([], { projectName: 'p' })).toEqual([])
    expect(await resolveReferenceImages(null, {})).toEqual([])
  })

  it('다중 + 순서 보존', async () => {
    const fs = mkFs({ a: 'iVBORaaa', b: '/9j/bbb' })
    const out = await resolveReferenceImages([{ name: 'a' }, { name: 'b' }], { projectName: 'p', fs })
    expect(out).toEqual([
      { mimeType: 'image/png', data: 'iVBORaaa' },
      { mimeType: 'image/jpeg', data: '/9j/bbb' },
    ])
  })

  it('명시 MIME 이 있으면 data URL 헤더/시그니처보다 우선 보존', async () => {
    const fs = mkFs({})
    const out = await resolveReferenceImages(
      [{ name: 'hero', mimeType: 'image/gif', data: 'data:image/png;base64,iVBORpng' }],
      { projectName: 'p', fs }
    )
    expect(out).toEqual([{ mimeType: 'image/gif', data: 'iVBORpng' }])
  })

  it('strictMime=true 에서는 MIME 을 확정할 수 없는 raw base64 를 null 로 반환', async () => {
    const fs = mkFs({})
    const out = await resolveReferenceImages(
      [{ name: 'hero', data: 'UNKNOWNRAWBASE64' }],
      { projectName: 'p', fs, strictMime: true }
    )
    expect(out).toEqual([{ mimeType: null, data: 'UNKNOWNRAWBASE64' }])
  })

  it('readReference throw 시 안전하게 건너뜀', async () => {
    const fs = { readReference: vi.fn().mockRejectedValue(new Error('io')) }
    const out = await resolveReferenceImages([{ name: 'x' }], { projectName: 'p', fs })
    expect(out).toEqual([])
  })

  it('해석 실패 레퍼런스는 console.warn 으로 표면화 (조용히 묻지 않음)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fs = mkFs({})
    await resolveReferenceImages([{ name: 'missing' }], { projectName: 'p', fs })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'missing'"))
    warn.mockRestore()
  })

  it('readReference throw 도 경고 로그', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fs = { readReference: vi.fn().mockRejectedValue(new Error('io')) }
    await resolveReferenceImages([{ name: 'boom' }], { projectName: 'p', fs })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
    warn.mockRestore()
  })
})
