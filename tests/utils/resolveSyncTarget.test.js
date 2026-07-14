import { describe, it, expect } from 'vitest'
import { resolveSyncTarget } from '../../src/utils/flowCharacterSync'

/**
 * #R37 회귀 방지 — 중복 Flow entity 의 근본 원인은 "stale 스냅샷 동기화" 다.
 *
 * 진입점(패널 Sync-all / 모달 Sync / 생성 게이트)은 모두 스냅샷을 들고 루프를 돈다. 캐릭터 동기화는
 * 최대 ~120s DOM 자동화라, 그 사이 다른 진입점이 같은 ref 를 끝낼 수 있다. 그러면 스냅샷엔
 * entityId 가 없고 live 엔 있다 → 스냅샷으로 판단하면 'upload' 를 골라 entity 를 하나 더 만든다.
 *
 * 실제 사용자 Flow 라이브러리에 Zed 가 4개 쌓인 이유가 이것이다.
 */
describe('resolveSyncTarget — 스냅샷이 아니라 live 로 판단한다', () => {
  const snapshot = { id: 1, type: 'character', name: 'Zed', data: 'x' }  // 캡처 시점: entity 없음

  it('그 사이 다른 진입점이 동기화를 끝냈으면 건너뛴다 (재업로드 금지)', () => {
    const live = { ...snapshot, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', flowNameSyncStatus: 'synced' }
    expect(resolveSyncTarget(live)).toEqual({ action: 'skip', reason: 'already-synced' })
  })

  it('다른 진입점이 동기화 중이면 건너뛴다 (동시 업로드 금지)', () => {
    const live = { ...snapshot, syncing: true }
    expect(resolveSyncTarget(live)).toEqual({ action: 'skip', reason: 'in-flight' })
  })

  it('그 사이 삭제됐으면 건너뛴다', () => {
    expect(resolveSyncTarget(undefined)).toEqual({ action: 'skip', reason: 'gone' })
  })

  // 핵심: 동기화가 필요하면 **live** 를 돌려준다. 스냅샷을 넘기면 그 사이 생긴 entityId 를 못 보고
  //   재업로드로 빠진다.
  it('동기화가 필요하면 스냅샷이 아니라 live ref 를 돌려준다', () => {
    const live = { ...snapshot, entityId: 'e1', workflowId: 'w1', flowNameSyncStatus: 'failed' }
    const out = resolveSyncTarget(live)
    expect(out.action).toBe('sync')
    expect(out.ref).toBe(live)
    expect(out.ref.entityId).toBe('e1')   // 이게 있어야 repair 로 가고 중복이 안 생긴다
  })
})
