/**
 * partitionDownloadOnly — Phase 0 의 download-only 항목을 "게이트를 지나야 하는 것" 과 "이미 배치 다운로드 권한이 확인된 것" 으로 가른다.
 *
 * M2-R3 H6(B2): 옛 규칙은 errorKind==='download-entitlement' 만 게이트로 보냈다 — G1(b) 로 download-only 가 된 stopped/타임아웃/폴 auth 항목은 배치 다운로드 게이트
 * (consumeGate.ensure)를 한 번도 지난 적이 없는데 "이미 과금됨" 으로 분류돼 무료 재다운로드됐다. 지금은 **downloadGated:true 마커**(그 배치의 게이트가 ok 를 돌려준 뒤 훅이
 * 남긴다)가 없는 항목은 전부 게이트를 지난다. download-entitlement 는 마커와 무관하게 게이트.
 */
import { describe, it, expect } from 'vitest'
import { partitionDownloadOnly } from '../../src/hooks/downloadOnlyGate'

describe('partitionDownloadOnly (M2-R3 H6)', () => {
  it('download-entitlement 는 마커가 있어도 gated', () => {
    const { gated, ungated } = partitionDownloadOnly([
      { id: '1', errorKind: 'download-entitlement', generationId: 'g1', mediaId: 'm1' },
      { id: '2', errorKind: 'download-entitlement', downloadGated: true, generationId: 'g2', mediaId: 'm2' },
    ])
    expect(gated.map((i) => i.id)).toEqual(['1', '2'])
    expect(ungated).toHaveLength(0)
  })

  it('마커 없는 download-only(stopped·flow-video-fetch-failed·auth·save 실패·kind 없음) 는 전부 gated', () => {
    const { gated, ungated } = partitionDownloadOnly([
      { id: '1', errorKind: 'stopped' }, { id: '2', errorKind: 'flow-video-fetch-failed' }, { id: '3', errorKind: 'auth' }, { id: '4', errorKind: 'save-failed' }, { id: '5' }, { id: '6', downloadGated: false }, { id: '7', downloadGated: null },
    ])
    expect(gated.map((i) => i.id)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(ungated).toHaveLength(0)
  })

  it('downloadGated:true 마커가 있으면(entitlement 아님) ungated — 이미 그 배치의 게이트를 지났다', () => {
    const { gated, ungated } = partitionDownloadOnly([
      { id: '1', errorKind: 'stopped', downloadGated: true }, { id: '2', downloadGated: true }, { id: '3', errorKind: 'stopped' },
    ])
    expect(ungated.map((i) => i.id)).toEqual(['1', '2'])
    expect(gated.map((i) => i.id)).toEqual(['3'])
  })

  it('빈 입력 → 둘 다 빈 배열', () => {
    expect(partitionDownloadOnly([])).toEqual({ gated: [], ungated: [] })
  })
})
