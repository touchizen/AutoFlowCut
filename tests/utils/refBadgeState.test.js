import { describe, it, expect } from 'vitest'
import { refBadgeState } from '../../src/utils/flowCharacterSync'

/**
 * 카드의 녹색 ✅ 는 mediaId 만 보고 그려져서, Flow 동기화가 "실패"한 캐릭터에도 성공 체크가
 * 떴다 — 같은 화면의 Sync(N) 배지는 여전히 "미동기화"라고 말하는데도. 실제 사용자 리포트가
 * 여기서 나왔다: 이미지가 올라갔으니 다 됐다고 믿고 생성 → @멘션이 안 붙음.
 *
 * refBadgeState 는 Sync 버튼/게이트와 동일한 술어(isRefSynced)를 쓴다 — 카드와 배지가
 * 구조적으로 엇갈릴 수 없게 하는 게 이 함수의 존재 이유다.
 */
describe('refBadgeState', () => {
  const char = (over = {}) => ({ id: 1, type: 'character', name: 'Zed', ...over })

  describe('flow 모드 + character — Flow 엔티티 동기화가 기준', () => {
    it('동기화 완료면 ok', () => {
      const ref = char({ mediaId: 'm1', entityId: 'e1', flowNameSyncStatus: 'synced' })
      expect(refBadgeState(ref, 'flow')).toBe('ok')
    })

    // 회귀 방지 — 이 케이스가 녹색 ✅ 를 그리던 버그.
    it('업로드는 됐지만 이름 PATCH 실패면 needs-sync (성공 체크 금지)', () => {
      const ref = char({ mediaId: 'm1', entityId: 'e1', flowNameSyncStatus: 'failed' })
      expect(refBadgeState(ref, 'flow')).toBe('needs-sync')
    })

    it('업로드는 됐지만 entityId 가 없으면 needs-sync', () => {
      const ref = char({ mediaId: 'm1', entityId: null, flowNameSyncStatus: null })
      expect(refBadgeState(ref, 'flow')).toBe('needs-sync')
    })

    it('이미지 자체가 없으면 배지 없음', () => {
      expect(refBadgeState(char(), 'flow')).toBe('none')
    })
  })

  describe('api 모드 — Flow 엔티티는 무의미, mediaId 로 충분', () => {
    it('mediaId 있으면 ok (미동기화여도 경고하지 않는다)', () => {
      const ref = char({ mediaId: 'm1', entityId: null, flowNameSyncStatus: null })
      expect(refBadgeState(ref, 'api')).toBe('ok')
    })

    it('mediaId 없으면 none', () => {
      expect(refBadgeState(char(), 'api')).toBe('none')
    })
  })

  describe('비-character ref — flow 모드에서도 mediaId 로 충분', () => {
    it('scene/style 은 mediaId 만 있으면 ok', () => {
      for (const type of ['scene', 'style']) {
        expect(refBadgeState({ id: 2, type, name: 'x', mediaId: 'm1' }, 'flow')).toBe('ok')
      }
    })
  })

  it('ref 가 없으면 none', () => {
    expect(refBadgeState(null, 'flow')).toBe('none')
  })
})
