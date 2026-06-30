/**
 * projectPersist.test.js — 프로젝트 저장 시 reference base64 strip 정책 단위 테스트.
 *
 * 회귀: 저장 실패로 filePath 없는 ref 의 base64 를 strip 하면 (desktop addPendingSave 가
 * no-op 이라 재시도 없음) 재오픈 시 이미지 유실. → filePath 없는 ref 는 data 보존해야 한다.
 */
import { describe, it, expect } from 'vitest'
import { stripReferencesForSave } from '../../src/utils/projectPersist'

describe('stripReferencesForSave', () => {
  it('filePath 있는 ref → data(base64) 제거 (디스크에서 복원)', () => {
    const out = stripReferencesForSave([{ name: 'a', data: 'BIGBASE64', filePath: '/p/a.png', status: 'done' }])
    expect(out[0]).not.toHaveProperty('data')
    expect(out[0].filePath).toBe('/p/a.png')
    expect(out[0].name).toBe('a')
  })

  it('filePath 없는 ref(저장 실패) → data 보존 (재오픈 유실 방지)', () => {
    const out = stripReferencesForSave([{ name: 'b', data: 'MEMBASE64', dataStorage: 'base64', status: 'done' }])
    expect(out[0].data).toBe('MEMBASE64')
  })

  it('혼합 배열: 저장된 것만 strip, 미저장은 보존', () => {
    const out = stripReferencesForSave([
      { name: 'a', data: 'X', filePath: '/p/a.png' },
      { name: 'b', data: 'Y' },
    ])
    expect(out[0]).not.toHaveProperty('data')
    expect(out[1].data).toBe('Y')
  })

  it('#R34: syncing 전이 플래그는 항상 제거(저장 안 함)', () => {
    const withPath = stripReferencesForSave([{ name: 'a', data: 'X', filePath: '/p/a.png', syncing: true }])
    expect(withPath[0]).not.toHaveProperty('syncing')
    expect(withPath[0]).not.toHaveProperty('data')
    const noPath = stripReferencesForSave([{ name: 'b', data: 'Y', syncing: true }])
    expect(noPath[0]).not.toHaveProperty('syncing')
    expect(noPath[0].data).toBe('Y')  // 미저장 data 는 보존
  })

  it('빈/널 입력 안전', () => {
    expect(stripReferencesForSave([])).toEqual([])
    expect(stripReferencesForSave(undefined)).toEqual([])
    expect(stripReferencesForSave(null)).toEqual([])
  })
})
