/**
 * referenceResolver.test.js — 레퍼런스 객체 → inline base64 변환 단위 테스트.
 *
 * 메모리 data 우선, 없으면 디스크(name) 읽기, 해석 실패는 건너뜀, 순서 보존.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveReferenceImages } from '../../src/utils/referenceResolver'

const mkFs = (map) => ({
  readReference: vi.fn(async (_proj, name) =>
    map[name] != null ? { success: true, data: map[name] } : { success: false }),
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

  it('readReference throw 시 안전하게 건너뜀', async () => {
    const fs = { readReference: vi.fn().mockRejectedValue(new Error('io')) }
    const out = await resolveReferenceImages([{ name: 'x' }], { projectName: 'p', fs })
    expect(out).toEqual([])
  })
})
