// @vitest-environment node
//
// #R34: Ref 탭 동기화(단건/일괄) 공통 로직 — isRefSynced / selectUnsyncedRefs / syncRefToFlow.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: true, data: 'data:image/png;base64,FROMFILE' }) },
}))

import { isRefSynced, selectUnsyncedRefs, selectUnsyncedMentionedRefs, syncRefToFlow } from '../../src/utils/flowCharacterSync'

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
