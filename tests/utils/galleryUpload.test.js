/**
 * galleryUpload.test.js — F2V 디스크 업로드 프레임 영속 저장 단위 테스트.
 *
 * 회귀(P1): saveResource 가 {success:false} 를 반환할 때 "조용한 성공" 으로 넘기면
 * 재오픈 시 frames/ 폴백이 없어 "No start image". desktop 의 addPendingSave 가 no-op 이라
 * 재시도도 안 됨 → folder 모드에서 영속 실패 시 업로드 자체를 실패로 돌려야 한다
 * (호출부가 gallery::local-* pair 를 만들지 않도록).
 */
import { describe, it, expect, vi } from 'vitest'
import { saveGalleryFrame } from '../../src/utils/galleryUpload'

const base = { localId: 'local-1', dataUrl: 'data:image/png;base64,AAA', saveMode: 'folder', projectName: 'proj' }

describe('saveGalleryFrame', () => {
  it('folder 저장 성공 → success + persisted', async () => {
    const fs = { saveResource: vi.fn().mockResolvedValue({ success: true, path: '/p/frames/local-1.png' }) }
    const r = await saveGalleryFrame({ ...base, fs })
    expect(r).toEqual({ success: true, persisted: true })
    expect(fs.saveResource).toHaveBeenCalledWith('proj', 'frames', 'local-1', base.dataUrl)
  })

  it('folder 저장 실패({success:false}) → success:false (pair 생성 막음, 조용한 성공 금지)', async () => {
    const fs = { saveResource: vi.fn().mockResolvedValue({ success: false, error: 'not_set' }) }
    const r = await saveGalleryFrame({ ...base, fs })
    expect(r.success).toBe(false)
    expect(r.persisted).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('folder + saveResource throw → success:false', async () => {
    const fs = { saveResource: vi.fn().mockRejectedValue(new Error('io')) }
    const r = await saveGalleryFrame({ ...base, fs })
    expect(r.success).toBe(false)
    expect(r.persisted).toBe(false)
  })

  it('memory 모드 → success:true, persisted:false, 디스크 저장 시도 안 함', async () => {
    const fs = { saveResource: vi.fn() }
    const r = await saveGalleryFrame({ ...base, saveMode: 'memory', fs })
    expect(r).toEqual({ success: true, persisted: false })
    expect(fs.saveResource).not.toHaveBeenCalled()
  })

  it('folder 인데 projectName 없으면 success:false (저장 시도 안 함)', async () => {
    const fs = { saveResource: vi.fn() }
    const r = await saveGalleryFrame({ ...base, projectName: '', fs })
    expect(r.success).toBe(false)
    expect(fs.saveResource).not.toHaveBeenCalled()
  })
})
