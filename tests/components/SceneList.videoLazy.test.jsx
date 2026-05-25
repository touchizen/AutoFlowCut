/**
 * SceneList — review T2 fix
 *
 * 비디오 썸네일은 duration 캐시 (videoT2VDuration/videoI2VDuration) 가 있으면
 * 정적 poster (image) 만 보여주고 <video> 디코더를 mount 안 함. VRAM 절약.
 * 캐시 없으면 1회 mount → onLoadedMetadata 로 duration 추출 후 다음 render
 * 부터는 poster.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/components/TagBatchModal', () => ({
  default: () => <div data-testid="tag-batch-modal" />,
}))

import SceneList from '../../src/components/SceneList'

const baseScene = {
  id: 'scene_1',
  prompt: '',
  subtitle: '',
  startTime: 0,
  endTime: 3,
  duration: 3,
  status: 'pending',
}

describe('T2 — SceneList video lazy mount', () => {
  it('videoT2VDuration 캐시 있으면 <video> 아닌 poster (img) 표시', () => {
    const scene = {
      ...baseScene,
      videoT2VPath: '/abs/t2v.mp4',
      videoT2VDuration: 5.5, // 이미 캐시됨
      image: 'data:image/png;base64,XXX',
    }
    const { container } = render(
      <SceneList
        scenes={[scene]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const videos = container.querySelectorAll('video')
    expect(videos).toHaveLength(0) // 비디오 mount 안 됨
  })

  it('R26 review fix: duration 캐시 없어도 첫 로드에는 <video> mount 안 함 (hover-activated)', () => {
    const scene = {
      ...baseScene,
      videoT2VPath: '/abs/t2v.mp4',
      // videoT2VDuration 없음
      image: 'data:image/png;base64,XXX',
    }
    const { container } = render(
      <SceneList
        scenes={[scene]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const videos = container.querySelectorAll('video')
    expect(videos).toHaveLength(0) // 첫 로드: VRAM burst 없음
  })

  it('videoI2VDuration 캐시 있으면 I2V 도 poster only', () => {
    const scene = {
      ...baseScene,
      videoI2VPath: '/abs/i2v.mp4',
      videoI2VDuration: 4.2,
      image: 'data:image/png;base64,XXX',
    }
    const { container } = render(
      <SceneList
        scenes={[scene]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    expect(container.querySelectorAll('video')).toHaveLength(0)
  })
})
