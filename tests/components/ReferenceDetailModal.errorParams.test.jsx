/**
 * ReferenceDetailModal / VideoDetailModal — errorParams 가 ErrorSection 까지 닿는가 (R1#4 / R2#6)
 *
 * ref 는 이제 errorParams 를 저장한다(useReferenceGeneration). 모달이 그걸 ErrorSection 에 안 넘기면
 * "{requested}" 플레이스홀더가 그대로 보인다. ErrorSection 을 props 캡처 스텁으로 바꿔 받은 props 를 본다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const captured = vi.hoisted(() => ({ props: [] }))

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: vi.fn().mockResolvedValue({ success: true, history: [], histories: [] }),
    readHistoryFile: vi.fn().mockResolvedValue({ success: false }),
    restoreFromHistory: vi.fn(),
    checkPermission: vi.fn().mockResolvedValue({ hasPermission: false }),
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true }),
    saveReference: vi.fn().mockResolvedValue({ success: false }),
  },
}))
vi.mock('../../src/utils/imageProcessing', () => ({ tryUpscaleImage: vi.fn(), extractThumbnailBase64: vi.fn().mockResolvedValue('thumb') }))
vi.mock('../../src/utils/urls', () => ({ cleanBase64: vi.fn((s) => s), toDataURL: vi.fn((s) => s) }))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/components/Modal', () => ({ default: ({ children, footer }) => (<div data-testid="modal">{children}<div>{footer}</div></div>) }))
vi.mock('../../src/components/ErrorSection', () => ({ default: (props) => { captured.props.push(props); return null } }))
vi.mock('../../src/components/PromptInput', () => ({ default: () => null }))

import ReferenceDetailModal from '../../src/components/ReferenceDetailModal'
import VideoDetailModal from '../../src/components/VideoDetailModal'

beforeEach(() => { captured.props.length = 0 })

describe('errorParams → ErrorSection', () => {
  it('ReferenceDetailModal 은 editData.errorParams 를 ErrorSection 에 넘긴다', () => {
    const reference = { id: 'r1', name: 'hero', type: 'character', category: 'character', prompt: 'p', status: 'error', errorMessage: 'flow-resolution-not-offered', errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } }
    render(<ReferenceDetailModal reference={reference} references={[reference]} index={0} onUpdate={vi.fn()} onUpload={vi.fn()} onGenerate={vi.fn()} onClose={vi.fn()} isGenerating={false} t={(k) => k} isKo projectName="test" thumbnails={{}} />)
    const errorProps = captured.props.find((p) => p.errorKind === 'flow-resolution-not-offered')
    expect(errorProps).toBeTruthy()
    expect(errorProps.errorParams).toEqual({ requested: '1080p' })
  })

  it('VideoDetailModal 은 video.errorParams 를 ErrorSection 에 넘긴다', () => {
    const video = { id: 't2v_1', prompt: 'p', video: null, videoPath: null, status: 'error', error: 'flow-video-settings-mismatch', errorKind: 'flow-video-settings-mismatch', errorParams: { expected: 'veo_3_1_t2v_fast', actual: 'abra_t2v_6s' } }
    render(<VideoDetailModal video={video} onClose={vi.fn()} t={(k) => k} projectName="proj" onUpdate={vi.fn()} />)
    const errorProps = captured.props.find((p) => p.errorKind === 'flow-video-settings-mismatch')
    expect(errorProps).toBeTruthy()
    expect(errorProps.errorParams).toEqual({ expected: 'veo_3_1_t2v_fast', actual: 'abra_t2v_6s' })
  })
})
