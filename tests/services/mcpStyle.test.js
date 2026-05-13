/**
 * mcpStyle.syncExplicitStyleId — UI sync 정책 단위 테스트
 *
 * useMcpServer.js의 batch path가 사용하는 헬퍼. 명시 styleId만 selectedStyleRefId 갱신,
 * sentinel ('auto'/'none')과 omit (null/undefined/'')는 UI를 건드리지 않는다.
 */

import { describe, it, expect, vi } from 'vitest'
import { syncExplicitStyleId } from '../../src/services/mcpStyle'

const fakeNormalize = (id) => {
  if (!id) return null
  if (id === 'auto' || id === 'none') return null
  if (id.startsWith('ref:') || id.startsWith('preset:')) return id
  return `preset:${id}`
}

describe('syncExplicitStyleId', () => {
  it('명시 preset:ID → setSelectedStyleRefId 호출', () => {
    const setSelectedStyleRefId = vi.fn()
    syncExplicitStyleId('preset:noir', { normalizeStyleId: fakeNormalize, setSelectedStyleRefId })
    expect(setSelectedStyleRefId).toHaveBeenCalledWith('preset:noir')
  })

  it('명시 ref:ID → setSelectedStyleRefId 호출', () => {
    const setSelectedStyleRefId = vi.fn()
    syncExplicitStyleId('ref:123', { normalizeStyleId: fakeNormalize, setSelectedStyleRefId })
    expect(setSelectedStyleRefId).toHaveBeenCalledWith('ref:123')
  })

  it('plain id → preset:* wrap 후 setSelectedStyleRefId 호출', () => {
    const setSelectedStyleRefId = vi.fn()
    syncExplicitStyleId('korean-ani', { normalizeStyleId: fakeNormalize, setSelectedStyleRefId })
    expect(setSelectedStyleRefId).toHaveBeenCalledWith('preset:korean-ani')
  })

  it("'auto' → setSelectedStyleRefId 호출 안 함", () => {
    const setSelectedStyleRefId = vi.fn()
    syncExplicitStyleId('auto', { normalizeStyleId: fakeNormalize, setSelectedStyleRefId })
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it("'none' → setSelectedStyleRefId 호출 안 함", () => {
    const setSelectedStyleRefId = vi.fn()
    syncExplicitStyleId('none', { normalizeStyleId: fakeNormalize, setSelectedStyleRefId })
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it.each([null, undefined, ''])("omitted (%s) → setSelectedStyleRefId 호출 안 함", (input) => {
    const setSelectedStyleRefId = vi.fn()
    syncExplicitStyleId(input, { normalizeStyleId: fakeNormalize, setSelectedStyleRefId })
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it('normalize가 falsy 반환하면 sync 안 함 (안전성 가드)', () => {
    const setSelectedStyleRefId = vi.fn()
    const normalize = vi.fn(() => null)
    syncExplicitStyleId('weird-input', { normalizeStyleId: normalize, setSelectedStyleRefId })
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it('setSelectedStyleRefId 미주입(undefined) 도 throw 없음', () => {
    expect(() => syncExplicitStyleId('preset:noir', { normalizeStyleId: fakeNormalize })).not.toThrow()
  })
})
