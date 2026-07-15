import { describe, it, expect } from 'vitest'
import { entityPatchForNewImage, clearedImageFields } from '../../src/utils/refEntityRegistration'
import { planCharacterSync } from '../../src/utils/flowCharacterSync'

/**
 * #R37 회귀 방지 — 새 이미지가 들어왔는데 fresh entity 가 없으면 옛 entity 필드를 반드시 비운다.
 *
 * ReferenceCard(#R31-3)와 ReferenceDetailModal(#R16-3)은 이미 이 정책을 지키는데
 * useReferenceGeneration(재생성)만 빠져 있었다: `...(entityPatch || {})` 라서 API 모드로 캐릭터를
 * 재생성하면 data/mediaId 만 새 이미지로 바뀌고 옛 entityId/workflowId 가 살아남았다.
 *
 * 그 잔존 id 때문에 planCharacterSync 가 'repair-registration' 으로 가서 **옛 entity 를 PATCH** 하고
 * "동기화 완료" 라고 보고한다 — 새 이미지는 영영 업로드되지 않고 @멘션은 계속 옛 얼굴을 가리킨다.
 * (이전엔 Sync 가 곧 재업로드였기 때문에 그게 유일한 복구 수단이었다.)
 */
describe('entityPatchForNewImage', () => {
  const char = { id: 1, type: 'character', name: 'Zed', entityId: 'OLD', workflowId: 'OLDW', registered: true, flowNameSyncStatus: 'synced' }

  it('fresh entity 가 오면 그걸로 등록 패치', () => {
    const patch = entityPatchForNewImage(char, { entityId: 'NEW', workflowId: 'NEWW', mediaId: 'm', registered: true })
    expect(patch.entityId).toBe('NEW')
    expect(patch.flowNameSyncStatus).toBe('synced')
  })

  it('character + fresh entity 없음 → 옛 entity 를 비운다 (새 이미지가 옛 캐릭터에 묶이지 않게)', () => {
    const patch = entityPatchForNewImage(char, { mediaId: 'm-new' })  // API 모드: entityId 없음
    expect(patch).toEqual({ entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null })
  })

  // 타입 무관하게 비운다 — character 일 때만 비우면 character→scene→재생성→character 로 되돌렸을 때
  //   옛 entityId 가 부활한다(타입 변경 UI 가 entity 필드를 보존하므로).
  it('비-character 여도 옛 entity 를 비운다 (타입 왕복으로 부활하지 않게)', () => {
    const wasChar = { id: 2, type: 'scene', name: 's', entityId: 'OLD', workflowId: 'OLDW', flowNameSyncStatus: 'synced' }
    expect(entityPatchForNewImage(wasChar, { mediaId: 'm' }))
      .toEqual({ entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null })
  })

  it('result 가 없어도 터지지 않는다', () => {
    expect(entityPatchForNewImage(char, null)).toEqual({ entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null })
  })
})

describe('clearedImageFields — 이미지 제거 시 entity 도 함께 비운다', () => {
  it('Flow entity 필드까지 null 로 만든다', () => {
    expect(clearedImageFields()).toEqual({
      data: null, filePath: null, mediaId: null, caption: null, dataStorage: null,
      entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null,
    })
  })

  // MCP 의 clear-reference-image 가 미디어만 지우고 entityId 를 남기면, 이미지 없는 ref 가
  //   planCharacterSync 에서 'repair-registration' 으로 빠져 옛 entity 를 다시 등록한다.
  it('제거 후 ref 는 더 이상 repair 대상이 아니다 (옛 entity 재등록 방지)', () => {
    const ref = { id: 1, type: 'character', name: 'Zed', mediaId: 'm', entityId: 'e', workflowId: 'w', flowNameSyncStatus: 'synced' }
    const cleared = { ...ref, ...clearedImageFields() }
    expect(planCharacterSync(cleared)).toBe('upload')
  })
})
