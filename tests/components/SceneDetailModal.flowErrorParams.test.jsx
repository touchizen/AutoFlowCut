/**
 * SceneDetailModal — 훅이 만든 씬 상태(finalizeGeneratedImage 의 sceneUpdate) 를 렌더하면 kind 별 params 가 문구에 들어가고
 * {requested} 같은 플레이스홀더가 보이지 않는다 (M1-13; errorParams 배선 회귀 감지).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: vi.fn(async () => ({ success: true, histories: [] })),
    readHistoryFile: vi.fn(), restoreFromHistory: vi.fn(),
    saveImage: vi.fn(), saveExtraToHistory: vi.fn(),
  },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/components/Modal', () => ({ default: ({ children, footer }) => (<div data-testid="modal">{children}<div>{footer}</div></div>) }))

import SceneDetailModal from '../../src/components/SceneDetailModal'
import { I18nProvider } from '../../src/hooks/useI18n'
import { finalizeGeneratedImage } from '../../src/services/imageFinalize'

const base = { id: 'scene_1', prompt: 'a sunset', subtitle: '', duration: 3, startTime: 0, image: null, imagePath: null, status: 'pending', seed: null, generatedAt: null, model: 'flow', image_size: null, mediaId: null }

async function sceneFromResult(result) {
  const { sceneUpdate } = await finalizeGeneratedImage({ result, genAPI: {}, saveMode: 'folder', projectName: 'proj', sceneId: 'scene_1', prompt: 'a sunset' })
  return { ...base, ...sceneUpdate }
}

beforeEach(() => { vi.clearAllMocks() })

describe('SceneDetailModal — errorParams 렌더 (M1-13)', () => {
  it('flow-resolution-not-offered {requested:"1080p"} → 1080p 가 보이고 플레이스홀더 없음', async () => {
    const scene = await sceneFromResult({ success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    expect(scene).toMatchObject({ status: 'error', errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    const { container } = render(<I18nProvider><SceneDetailModal scene={scene} onUpdate={vi.fn()} onClose={vi.fn()} t={(k) => k} projectName="proj" aspectRatio="16:9" /></I18nProvider>)
    const text = container.querySelector('.error-section').textContent
    expect(text).toContain('1080p')
    expect(text).not.toMatch(/\{\w+\}/)
    expect(text).not.toContain('errorSection.kind')
  })

  it('flow-image-model-mismatch {requested, panel} → 두 모델명이 보인다', async () => {
    const scene = await sceneFromResult({ success: false, errorKind: 'flow-image-model-mismatch', error: 'flow-image-model-mismatch', errorParams: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' } })
    const { container } = render(<I18nProvider><SceneDetailModal scene={scene} onUpdate={vi.fn()} onClose={vi.fn()} t={(k) => k} projectName="proj" aspectRatio="16:9" /></I18nProvider>)
    const text = container.querySelector('.error-section').textContent
    expect(text).toContain('Nano Banana Pro')
    expect(text).toContain('Nano Banana 2')
    expect(text).not.toMatch(/\{\w+\}/)
  })
})
