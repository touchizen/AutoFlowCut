/**
 * galleryUpload.test.js — F2V 디스크 업로드 프레임 영속 저장 단위 테스트.
 *
 * 회귀(P1): saveResource 가 {success:false} 를 반환할 때 "조용한 성공" 으로 넘어가면
 * 재오픈 시 frames/ 폴백이 없어 "No start image". → 실패를 감지하고 보정 재시도를
 * 등록하는지 검증.
 */
import { describe, it, expect, vi } from 'vitest'
import { persistGalleryFrame } from '../../src/utils/galleryUpload'

const base = { localId: 'local-1', dataUrl: 'data:image/png;base64,AAA', saveMode: 'folder', projectName: 'proj' }

describe('persistGalleryFrame', () => {
  it('folder 저장 성공 → persisted true, 보정 등록 없음', async () => {
    const fs = { saveResource: vi.fn().mockResolvedValue({ success: true, path: '/p/frames/local-1.png' }) }
    const addPendingSave = vi.fn()
    const r = await persistGalleryFrame({ ...base, fs, addPendingSave })
    expect(r.persisted).toBe(true)
    expect(fs.saveResource).toHaveBeenCalledWith('proj', 'frames', 'local-1', base.dataUrl)
    expect(addPendingSave).not.toHaveBeenCalled()
  })

  it('저장 실패({success:false}) → 조용한 성공 금지: persisted false + 보정 재시도 등록', async () => {
    const fs = { saveResource: vi.fn().mockResolvedValue({ success: false, error: 'not_set' }) }
    const addPendingSave = vi.fn()
    const r = await persistGalleryFrame({ ...base, fs, addPendingSave })
    expect(r.persisted).toBe(false)
    expect(r.error).toBeTruthy()
    expect(addPendingSave).toHaveBeenCalledTimes(1)
    // 등록된 재시도가 동일 저장을 수행 (폴더/권한 준비 후 영속화)
    await addPendingSave.mock.calls[0][0]()
    expect(fs.saveResource).toHaveBeenCalledTimes(2)
  })

  it('saveResource throw → persisted false + 보정 재시도 등록', async () => {
    const fs = { saveResource: vi.fn().mockRejectedValue(new Error('io')) }
    const addPendingSave = vi.fn()
    const r = await persistGalleryFrame({ ...base, fs, addPendingSave })
    expect(r.persisted).toBe(false)
    expect(addPendingSave).toHaveBeenCalledTimes(1)
  })

  it('memory 모드(folder 아님) → 디스크 저장 시도 안 함', async () => {
    const fs = { saveResource: vi.fn() }
    const r = await persistGalleryFrame({ ...base, saveMode: 'memory', fs, addPendingSave: vi.fn() })
    expect(r.persisted).toBe(false)
    expect(fs.saveResource).not.toHaveBeenCalled()
  })

  it('projectName 없으면 저장 안 함', async () => {
    const fs = { saveResource: vi.fn() }
    const r = await persistGalleryFrame({ ...base, projectName: '', fs, addPendingSave: vi.fn() })
    expect(r.persisted).toBe(false)
    expect(fs.saveResource).not.toHaveBeenCalled()
  })
})
