// @vitest-environment node
//
// #R34: Ref 탭 동기화(단건/일괄) 공통 로직 — isRefSynced / selectUnsyncedRefs / syncRefToFlow.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: true, data: 'data:image/png;base64,FROMFILE' }) },
}))

import * as flowSync from '../../src/utils/flowCharacterSync'

const { isRefSynced, selectUnsyncedRefs, selectUnsyncedMentionedRefs, syncRefToFlow, needsComposerRefresh } = flowSync

describe('#R34: isRefSynced', () => {
  it('character → entityId + synced', () => {
    expect(isRefSynced({ type: 'character', entityId: 'e', flowNameSyncStatus: 'synced' })).toBe(true)
    expect(isRefSynced({ type: 'character', entityId: 'e', flowNameSyncStatus: 'failed' })).toBe(false)
    expect(isRefSynced({ type: 'character', entityId: null, flowNameSyncStatus: 'synced' })).toBe(false)
  })
  it('non-character → mediaId 보유', () => {
    expect(isRefSynced({ type: 'scene', mediaId: 'm' })).toBe(true)
    expect(isRefSynced({ type: 'scene', mediaId: null })).toBe(false)
  })
})

describe('#R34: selectUnsyncedRefs', () => {
  const refs = [
    { id: 1, type: 'character', name: 'king', data: 'x', entityId: null, flowNameSyncStatus: 'failed' }, // 미동기화
    { id: 2, type: 'character', name: 'queen', data: 'x', entityId: 'e', flowNameSyncStatus: 'synced' }, // 동기화됨
    { id: 3, type: 'character', name: 'noimg', entityId: null },                                          // 이미지 없음 → 제외
    { id: 4, type: 'scene', name: 'intro', data: 'x', mediaId: null },                                    // 미동기화 scene
    { id: 5, type: 'style', name: 's', data: 'x', mediaId: null },                                        // style → 제외
    { id: 6, type: 'character', name: '', data: 'x', entityId: null },                                    // 이름 없음 → 제외
  ]
  it('미동기화 + 이미지 + 이름 있는 character/scene 만', () => {
    const out = selectUnsyncedRefs(refs).map(r => r.id)
    expect(out).toEqual([1, 4])
  })
})

describe('#R34: selectUnsyncedMentionedRefs (생성 전 가드)', () => {
  const refs = [
    { id: 1, type: 'character', name: 'king', data: 'x', entityId: null, flowNameSyncStatus: 'failed' },  // 미동기화
    { id: 2, type: 'character', name: 'queen', data: 'x', entityId: 'e', flowNameSyncStatus: 'synced' },  // 동기화됨
  ]
  it('@멘션된 캐릭터 중 미동기화만 반환', () => {
    const scenes = [{ prompt: '@king and @queen walk in' }]
    expect(selectUnsyncedMentionedRefs(scenes, refs).map(r => r.id)).toEqual([1])
  })
  it('멘션 안 된 씬은 빈 배열', () => {
    expect(selectUnsyncedMentionedRefs([{ prompt: 'no mention' }], refs)).toEqual([])
  })
  it('한국어 조사 멘션(@king이)도 인식', () => {
    expect(selectUnsyncedMentionedRefs([{ prompt: '@king이 들어온다' }], refs).map(r => r.id)).toEqual([1])
  })
  it('id 없는 legacy/CSV character 도 생성 전 sync gate 대상에 포함', () => {
    const legacy = { id: null, type: 'character', name: 'legacyzed', data: 'x', flowNameSyncStatus: 'failed' }
    expect(selectUnsyncedMentionedRefs([{ prompt: '@legacyzed enters' }], [legacy])).toEqual([legacy])
  })
})

describe('#R34: syncRefToFlow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('character: 업로드 성공 → entity patch(synced)', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: true, mediaId: 'm', entityId: 'e2', workflowId: 'w', registered: true, flowNameSyncStatus: 'synced' })
    const ref = { id: 1, type: 'character', name: 'king', category: 'character', data: 'data:image/png;base64,KB64' }
    const res = await syncRefToFlow(ref, onUpload)
    expect(res.ok).toBe(true)
    expect(onUpload).toHaveBeenCalledWith('KB64', expect.objectContaining({ type: 'character', name: 'king', refId: 1 }))
    expect(res.patch.entityId).toBe('e2')
    expect(res.patch.flowNameSyncStatus).toBe('synced')
  })

  it('scene: 업로드 성공 → mediaId/caption patch (no entity)', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: true, mediaId: 'sm', caption: 'c' })
    const ref = { id: 4, type: 'scene', name: 'intro', data: 'data:image/png;base64,SB64' }
    const res = await syncRefToFlow(ref, onUpload)
    expect(res.ok).toBe(true)
    expect(res.patch).toEqual({ mediaId: 'sm', caption: 'c' })
    expect(res.patch.entityId).toBeUndefined()
  })

  it('data 없으면 filePath 에서 읽어 업로드', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: true, mediaId: 'm', entityId: 'e' })
    const ref = { id: 1, type: 'character', name: 'king', filePath: '/p/king.png' }
    const res = await syncRefToFlow(ref, onUpload)
    expect(res.ok).toBe(true)
    expect(onUpload).toHaveBeenCalledWith('FROMFILE', expect.objectContaining({ name: 'king' }))
  })

  it('업로드 실패 → ok:false', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: false, error: 'boom' })
    const res = await syncRefToFlow({ id: 1, type: 'character', name: 'king', data: 'data:image/png;base64,X' }, onUpload)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('boom')
  })

  it('이름 없으면 ok:false', async () => {
    const res = await syncRefToFlow({ id: 1, type: 'character', name: '', data: 'x' }, vi.fn())
    expect(res.ok).toBe(false)
  })
})

describe('planSyncGateCompletion — required mention sync 는 all-or-nothing', () => {
  const plan = (ok, fail) => flowSync.planSyncGateCompletion?.(ok, fail)

  it('전부 성공하면 생성 진행', () => {
    expect(plan(2, 0)).toEqual({ proceed: true, outcome: 'complete' })
  })
  it('전부 실패하면 생성 차단', () => {
    expect(plan(0, 2)).toEqual({ proceed: false, outcome: 'incomplete' })
  })
  it('부분 성공도 unresolved mention 이 남으므로 생성 차단', () => {
    expect(plan(1, 1)).toEqual({ proceed: false, outcome: 'incomplete' })
  })
})

// main 이 상세페이지 이름칸 타이핑으로 SPA 스토어를 갱신했으면(nameApplied) 프로젝트를 나갔다
// 재진입하는 refreshFlowComposer(loadURL 2회 + 1s 대기)가 필요 없다. 실패했을 때만 폴백한다.
describe('needsComposerRefresh', () => {
  const CHAR = { type: 'character' }

  it('이름이 SPA 에 반영됐으면 refresh 불필요', () => {
    expect(needsComposerRefresh(CHAR, { success: true, entityId: 'e1', nameApplied: true })).toBe(false)
  })

  it('반영 실패면 refresh 필요', () => {
    expect(needsComposerRefresh(CHAR, { success: true, entityId: 'e1', nameApplied: false })).toBe(true)
  })

  it('nameApplied 를 안 주는 옛 응답은 refresh 필요 (안전한 쪽)', () => {
    expect(needsComposerRefresh(CHAR, { success: true, entityId: 'e1' })).toBe(true)
  })

  it('캐릭터가 아니면 이름 자체가 없다 — refresh 불필요', () => {
    expect(needsComposerRefresh({ type: 'scene' }, { success: true, mediaId: 'm' })).toBe(false)
  })

  it('entity 가 안 생겼으면 refresh 해봐야 소용없다', () => {
    expect(needsComposerRefresh(CHAR, { success: true, nameApplied: false })).toBe(false)
  })

  it('실패한 결과는 refresh 하지 않는다', () => {
    expect(needsComposerRefresh(CHAR, { success: false })).toBe(false)
    expect(needsComposerRefresh(CHAR, null)).toBe(false)
  })
})
