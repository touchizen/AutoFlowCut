import { describe, it, expect, vi } from 'vitest'
import { planCharacterSync, syncRefToFlow, needsComposerRefresh } from '../../src/utils/flowCharacterSync'

/**
 * #R37: 등록 실패한 캐릭터를 재동기화할 때 이미지를 다시 올리면 Flow 가 매번 새 entity 를 만든다
 *   (useAutomation #R34 주석). 실제 사용자 Flow 라이브러리에 같은 캐릭터가 4개 쌓였다.
 *
 * 업로드는 성공했는데 등록 PATCH 만 실패한 경우 entityId/workflowId 는 이미 손에 있다 —
 * 재업로드 없이 그 PATCH 만 다시 치면 된다(복구). 업로드는 entityId 가 없을 때만.
 *
 * ⚠️ rename(displayName 만) 으로 복구하면 안 된다: register 는
 *   updateMask 'entityInfo.displayName,entityInfo.characterInfo.imageReferences' 로
 *   imageReferences[{workflowId}] 까지 함께 쓴다(flow-character-api.js). rename 은 이름만 써서,
 *   이미지 레퍼런스가 빈 채로 synced 마킹되는 더 나쁜 상태가 된다. 그래서 복구도 full register.
 */
describe('planCharacterSync — 재업로드할지 등록만 복구할지', () => {
  const char = (over = {}) => ({ id: 1, type: 'character', name: 'Zed', ...over })

  it('entityId+workflowId 가 있고 미동기화면 재업로드 없이 등록만 복구', () => {
    const ref = char({ mediaId: 'm1', entityId: 'e1', workflowId: 'w1', flowNameSyncStatus: 'failed' })
    expect(planCharacterSync(ref)).toBe('repair-registration')
  })

  it('entityId 가 없으면 업로드', () => {
    expect(planCharacterSync(char())).toBe('upload')
  })

  it('workflowId 가 없으면 업로드 — register PATCH 가 imageReferences 를 못 쓴다', () => {
    const ref = char({ mediaId: 'm1', entityId: 'e1', workflowId: null, flowNameSyncStatus: 'failed' })
    expect(planCharacterSync(ref)).toBe('upload')
  })

  // 모달 Sync 버튼은 stale entity 복구용으로 synced 여도 눌린다. 그 경로가 upload 로 가면
  //   멀쩡한 캐릭터를 다시 눌렀을 때 중복 entity 가 생긴다 → 멱등한 register PATCH 로 보낸다.
  it('이미 동기화된 캐릭터를 다시 눌러도 재업로드가 아니라 등록 PATCH (중복 방지)', () => {
    const ref = char({ mediaId: 'm1', entityId: 'e1', workflowId: 'w1', flowNameSyncStatus: 'synced' })
    expect(planCharacterSync(ref)).toBe('repair-registration')
  })

  it('비-character 는 항상 업로드 (Flow entity 개념이 없다)', () => {
    expect(planCharacterSync({ id: 2, type: 'scene', name: 's', mediaId: 'm1' })).toBe('upload')
  })
})

describe('syncRefToFlow — 복구 경로', () => {
  const brokenChar = {
    id: 1, type: 'character', name: 'Zed', data: 'data:image/png;base64,AAA',
    mediaId: 'm1', entityId: 'e1', workflowId: 'w1', flowNameSyncStatus: 'failed',
  }

  it('등록만 실패한 캐릭터는 업로드를 호출하지 않는다 (중복 entity 방지)', async () => {
    const onUpload = vi.fn()
    const registerEntity = vi.fn().mockResolvedValue({ success: true, registered: true, nameApplied: true })

    const res = await syncRefToFlow(brokenChar, onUpload, { registerEntity })

    expect(onUpload).not.toHaveBeenCalled()
    expect(registerEntity).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'e1', workflowId: 'w1', displayName: 'Zed' })
    )
    expect(res.ok).toBe(true)
    expect(res.patch.flowNameSyncStatus).toBe('synced')
    // 기존 id 는 보존 — 복구는 새 entity 를 만들지 않는다.
    expect(res.patch.entityId).toBe('e1')
    expect(res.patch.mediaId).toBe('m1')
  })

  it('복구 PATCH 가 실패하면 ok:false — 업로드로 폴백해 새 entity 를 만들지 않는다', async () => {
    const onUpload = vi.fn()
    const registerEntity = vi.fn().mockResolvedValue({ success: false, status: 401, error: 'access token 추출 실패' })

    const res = await syncRefToFlow(brokenChar, onUpload, { registerEntity })

    expect(onUpload).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('access token')
    expect(res.status).toBe(401)
  })

  it('entityId 가 없으면 종전대로 업로드한다', async () => {
    const fresh = { id: 1, type: 'character', name: 'Zed', data: 'data:image/png;base64,AAA' }
    const onUpload = vi.fn().mockResolvedValue({ success: true, entityId: 'e9', workflowId: 'w9', mediaId: 'm9', registered: true })
    const registerEntity = vi.fn()

    const res = await syncRefToFlow(fresh, onUpload, { registerEntity })

    expect(onUpload).toHaveBeenCalled()
    expect(registerEntity).not.toHaveBeenCalled()
    expect(res.ok).toBe(true)
    expect(res.patch.flowNameSyncStatus).toBe('synced')
  })

  // 업로드는 성공했는데 등록이 실패한 경우 — 예전엔 ok:true 라 ReferencePanel/DetailModal 이
  //   "동기화 완료" 토스트를 띄웠다. (App 의 생성 게이트는 원래부터 `res.ok && isRefSynced(...)` 를
  //   봐서 영향이 없었다 — ok 시맨틱 수정은 패널/모달의 거짓 성공 보고를 잡는 것이다.)
  it('업로드 성공 + 등록 실패면 ok:false (성공이라고 보고하지 않는다)', async () => {
    const fresh = { id: 1, type: 'character', name: 'Zed', data: 'data:image/png;base64,AAA' }
    const onUpload = vi.fn().mockResolvedValue({ success: true, entityId: 'e9', workflowId: 'w9', mediaId: 'm9', registered: false })

    const res = await syncRefToFlow(fresh, onUpload, { registerEntity: vi.fn() })

    expect(res.ok).toBe(false)
    // 그래도 patch 는 돌려준다 — entityId/workflowId 를 보존해야 다음에 재업로드 없이 복구할 수 있다.
    expect(res.patch.entityId).toBe('e9')
    expect(res.patch.workflowId).toBe('w9')
    expect(res.patch.flowNameSyncStatus).toBe('failed')
  })

  it('비-character 는 업로드 성공이면 ok:true (Flow entity 등록 개념 없음)', async () => {
    const sceneRef = { id: 2, type: 'scene', name: 'village', data: 'data:image/png;base64,AAA' }
    const onUpload = vi.fn().mockResolvedValue({ success: true, mediaId: 'm2' })

    const res = await syncRefToFlow(sceneRef, onUpload, { registerEntity: vi.fn() })

    expect(res.ok).toBe(true)
    expect(res.patch.mediaId).toBe('m2')
  })

  // 사용자가 Flow 라이브러리에서 중복 캐릭터를 정리하다 앱이 들고 있는 entity 를 지우는 건 실제
  //   시나리오다(우리가 정리를 권하기까지 한다). 그때 복구는 영원히 404 다 — 여기서만 업로드로 self-heal.
  it('entity 가 stale 이면(Flow 에서 삭제됨) 업로드로 self-heal 한다', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: true, entityId: 'NEW', workflowId: 'NEWW', mediaId: 'NEWM', registered: true })
    const registerEntity = vi.fn().mockResolvedValue({ success: false, stale: true, status: 400, error: 'entity not found (stale)' })

    const res = await syncRefToFlow(brokenChar, onUpload, { registerEntity })

    expect(registerEntity).toHaveBeenCalled()
    expect(onUpload).toHaveBeenCalled()          // stale 일 때만 업로드 폴백
    expect(res.ok).toBe(true)
    expect(res.patch.entityId).toBe('NEW')       // 죽은 id 는 새 id 로 덮인다
  })

  it('stale 이 아닌 실패(401 등)는 업로드로 폴백하지 않는다 — 재업로드로 안 풀리고 entity 만 늘린다', async () => {
    const onUpload = vi.fn()
    const registerEntity = vi.fn().mockResolvedValue({ success: false, stale: false, status: 401, error: 'access token 추출 실패' })

    const res = await syncRefToFlow(brokenChar, onUpload, { registerEntity })

    expect(onUpload).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.status).toBe(401)
  })

  // bound projectId 를 안 넘기면 IPC 가 projectIdFromUrl() 로 폴백해, Flow 탭이 다른 프로젝트로
  //   드리프트했을 때 엉뚱한 프로젝트를 PATCH 한다(rename 경로가 같은 이유로 이미 명시 전달 중).
  it('복구 PATCH 에 bound projectId 를 함께 넘긴다', async () => {
    const registerEntity = vi.fn().mockResolvedValue({ success: true, registered: true, entityId: 'e1', nameApplied: true })

    await syncRefToFlow(brokenChar, vi.fn(), { registerEntity, projectId: 'proj-42' })

    expect(registerEntity).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-42' }))
  })

  // needsComposerRefresh 는 result.entityId 로 판정한다. 복구 결과에 entityId 가 없으면
  //   nameApplied:false 인데도 SPA 새로고침을 건너뛰고 'synced' 로 굳어 — 멘션 피커가 이름을
  //   모르는 채 생성으로 넘어간다(원래 버그의 재현).
  it('복구 결과에 entityId 를 실어 보낸다 (SPA 새로고침 판정에 필요)', async () => {
    const registerEntity = vi.fn().mockResolvedValue({ success: true, registered: true, nameApplied: false })

    const res = await syncRefToFlow(brokenChar, vi.fn(), { registerEntity })

    expect(res.result.entityId).toBe('e1')
    expect(needsComposerRefresh(brokenChar, res.result)).toBe(true)
  })
})
