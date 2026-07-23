// @vitest-environment node
//
// #R34: Ref 탭 동기화(단건/일괄) 공통 로직 — isRefSynced / selectUnsyncedRefs / syncRefToFlow.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: true, data: 'data:image/png;base64,FROMFILE' }) },
}))

import * as flowSync from '../../src/utils/flowCharacterSync'

const { isRefSynced, selectUnsyncedRefs, syncRefToFlow, needsComposerRefresh } = flowSync

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

// #R34 selectUnsyncedMentionedRefs 는 제거됐다 — 게이트 대상 선정은 엔진과 같은 파서를 쓰는
// selectMentionSyncTargets 하나로 합쳤다(tests/utils/mentionSyncTargets.test.js).

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
    const onUpload = vi.fn().mockResolvedValue({ success: false, errorKind: 'character-upload-timeout', error: 'Character upload timed out' })
    const res = await syncRefToFlow({ id: 1, type: 'character', name: 'king', data: 'data:image/png;base64,X' }, onUpload)
    expect(res.ok).toBe(false)
    expect(res).toMatchObject({
      errorKind: 'character-upload-timeout',
      error: 'Character upload timed out',
    })
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

// DOM 자동화의 nameApplied 는 타이밍에 따라 true 여도 마지막 목록 캐시가 갱신되지 않을 수 있다.
// 캐릭터 entity 동기화가 실제로 있었으면 마지막에 한 번 refresh 하고, 대상이 없으면 하지 않는다.
describe('needsComposerRefresh', () => {
  const CHAR = { type: 'character' }

  it('nameApplied=true 여도 캐릭터 entity 동기화가 있었으면 refresh 필요', () => {
    expect(needsComposerRefresh(CHAR, { success: true, entityId: 'e1', nameApplied: true })).toBe(true)
  })

  it('반영 실패면 refresh 필요', () => {
    expect(needsComposerRefresh(CHAR, { success: true, entityId: 'e1', nameApplied: false })).toBe(true)
  })

  it('nameApplied 를 안 주는 옛 응답은 refresh 필요 (안전한 쪽)', () => {
    expect(needsComposerRefresh(CHAR, { success: true, entityId: 'e1' })).toBe(true)
  })

  it('이름 등록이 실패했어도 entity 등록 시도가 있었으면 refresh 필요', () => {
    expect(needsComposerRefresh(CHAR, {
      success: true, entityId: 'e1', registered: false, nameApplied: false,
    })).toBe(true)
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
