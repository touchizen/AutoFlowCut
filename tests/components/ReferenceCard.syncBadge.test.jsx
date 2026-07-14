import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReferenceCard from '../../src/components/ReferenceCard'

/**
 * #R37 회귀 방지 — 배지가 실제로 렌더되는지까지 본다.
 *
 * refBadgeState 는 util 테스트로 고정돼 있지만, 그것만으로는 부족하다: ReferencePanel 이
 * `appMode` 를 카드로 안 넘기면 `refBadgeState(ref, undefined)` 가 `mediaId → 'ok'` 분기로 떨어져
 * **동기화 실패한 캐릭터에 다시 녹색 ✅ 가 뜬다** — 그런데 util 테스트는 전부 통과한다.
 * 즉 원래 버그가 조용히 되살아나는 경로다. 그래서 렌더 결과를 직접 assert 한다.
 */
const baseProps = {
  index: 0,
  onUpdate: vi.fn(),
  onRemove: vi.fn(),
  onUpload: vi.fn(),
  onGenerate: vi.fn(),
  aspectRatio: '16:9',
  t: (k) => k,
  isGenerating: false,
  onShowDetail: vi.fn(),
  projectName: 'p',
  getScopeToken: () => 's',
}

const char = (over = {}) => ({
  id: 1, type: 'character', name: 'Zed', data: 'data:image/png;base64,AAA', ...over,
})

describe('ReferenceCard — Flow 동기화 배지', () => {
  it('flow 모드: 업로드는 됐지만 등록 실패면 경고(⚠️), 성공 체크(✅)를 그리지 않는다', () => {
    const ref = char({ mediaId: 'm1', entityId: 'e1', flowNameSyncStatus: 'failed' })
    render(<ReferenceCard {...baseProps} reference={ref} appMode="flow" />)

    expect(screen.getByTitle('reference.needsFlowSync')).toBeTruthy()
    expect(screen.queryByTitle('reference.uploadedToFlow')).toBeNull()
  })

  it('flow 모드: 동기화 완료면 ✅', () => {
    const ref = char({ mediaId: 'm1', entityId: 'e1', flowNameSyncStatus: 'synced' })
    render(<ReferenceCard {...baseProps} reference={ref} appMode="flow" />)

    expect(screen.getByTitle('reference.uploadedToFlow')).toBeTruthy()
    expect(screen.queryByTitle('reference.needsFlowSync')).toBeNull()
  })

  it('api 모드: Flow entity 는 무의미 — mediaId 만 있으면 ✅ (경고 없음)', () => {
    const ref = char({ mediaId: 'm1', entityId: null, flowNameSyncStatus: null })
    render(<ReferenceCard {...baseProps} reference={ref} appMode="api" />)

    expect(screen.getByTitle('reference.uploadedToFlow')).toBeTruthy()
    expect(screen.queryByTitle('reference.needsFlowSync')).toBeNull()
  })
})
