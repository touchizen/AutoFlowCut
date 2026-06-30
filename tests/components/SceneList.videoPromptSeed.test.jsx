/**
 * SceneList — 비디오 상세 모달은 IMAGE 프롬프트가 아니라 source별 VIDEO 프롬프트로 seed 해야 한다.
 *
 * 회귀: T2V/I2V 썸네일 클릭 시 모달 payload 의 prompt 가 scene.prompt(이미지 프롬프트)로
 * 들어가, 저장된 videoT2VPrompt/videoI2VPrompt 가 보이지 않고 저장 시 이미지 프롬프트로
 * 덮어써졌다. 이 테스트는 모달에 전달되는 prompt 를 검증한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

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

// VideoDetailModal 을 가벼운 stub 으로 — video prop 을 캡처한다.
const capturedVideo = { current: null }
vi.mock('../../src/components/VideoDetailModal', () => ({
  default: ({ video }) => {
    capturedVideo.current = video
    return <div data-testid="video-detail-modal">{video?.prompt}</div>
  },
}))

import SceneList from '../../src/components/SceneList'

const baseScene = {
  id: 'scene_3',
  prompt: 'IMAGE prompt — a queen in a forest',
  subtitle: '',
  startTime: 0,
  endTime: 3,
  duration: 3,
  status: 'pending',
}

function renderList(scene, extra = {}) {
  return render(
    <SceneList
      scenes={[scene]}
      onUpdate={vi.fn()}
      onUpdateFramePair={vi.fn()}
      onDelete={vi.fn()}
      onAdd={vi.fn()}
      defaultDuration={3}
      projectName="P"
      {...extra}
    />
  )
}

beforeEach(() => {
  capturedVideo.current = null
})

describe('SceneList — video detail modal seeds from source-specific video prompt', () => {
  it('T2V 썸네일 클릭 → 모달은 videoT2VPrompt 로 seed (이미지 프롬프트 아님)', () => {
    const scene = {
      ...baseScene,
      videoT2VPath: '/abs/t2v.mp4',
      videoT2VPrompt: 'T2V prompt — camera pans across the throne room',
    }
    const { container } = renderList(scene)
    const thumb = container.querySelector('.media-thumb.clickable')
    fireEvent.click(thumb)
    expect(capturedVideo.current).toBeTruthy()
    expect(capturedVideo.current.source).toBe('t2v')
    expect(capturedVideo.current.prompt).toBe('T2V prompt — camera pans across the throne room')
    expect(capturedVideo.current.prompt).not.toBe(scene.prompt)
  })

  it('T2V 비디오 프롬프트 없으면 빈 문자열로 seed (이미지 프롬프트로 폴백 안 함)', () => {
    const scene = { ...baseScene, videoT2VPath: '/abs/t2v.mp4' }
    const { container } = renderList(scene)
    fireEvent.click(container.querySelector('.media-thumb.clickable'))
    expect(capturedVideo.current.prompt).toBe('')
  })

  it('I2V 썸네일 클릭 → 모달은 videoI2VPrompt 로 seed', () => {
    const scene = {
      ...baseScene,
      videoI2VPath: '/abs/i2v.mp4',
      videoI2VPrompt: 'I2V prompt — slow zoom on the crown',
    }
    const { container } = renderList(scene)
    fireEvent.click(container.querySelector('.media-thumb.clickable'))
    expect(capturedVideo.current).toBeTruthy()
    expect(capturedVideo.current.source).toBe('i2v')
    expect(capturedVideo.current.prompt).toBe('I2V prompt — slow zoom on the crown')
    expect(capturedVideo.current.prompt).not.toBe(scene.prompt)
  })

  it('I2V 비디오 프롬프트 없고 owning framePair.prompt 있으면 그 값으로 seed', () => {
    const scene = { ...baseScene, videoI2VPath: '/abs/i2v.mp4' }
    const framePairs = [{ id: 'fp_9', ownerSceneId: 'scene_3', prompt: 'FP prompt — fade in' }]
    const { container } = renderList(scene, { framePairs })
    fireEvent.click(container.querySelector('.media-thumb.clickable'))
    expect(capturedVideo.current.prompt).toBe('FP prompt — fade in')
  })
})
