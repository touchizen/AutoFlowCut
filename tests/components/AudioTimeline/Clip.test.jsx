import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
vi.mock('../../../src/hooks/useI18n', () => ({ useI18n: () => ({ t: (k) => k }) }))
import Clip from '../../../src/components/AudioTimeline/Clip'

const vidClip = (extra = {}) => ({
  id: 'vid-i2v-scene_1', startMs: 0, endMs: 3000, color: '#888',
  role: 'video-i2v', sceneRef: { id: 'scene_1' }, ...extra,
})

describe('Clip — 영상 eye 토글', () => {
  it('video clip + onToggleVideo → eye 버튼 렌더', () => {
    const { container } = render(<Clip clip={vidClip()} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} onToggleVideo={vi.fn()} />)
    expect(container.querySelector('.atl-clip-eye-btn')).toBeTruthy()
  })
  it('eye 클릭 → onToggleVideo(clip) 호출, onClickClip 미발화', () => {
    const onToggleVideo = vi.fn(); const onClickClip = vi.fn(); const clip = vidClip()
    const { container } = render(<Clip clip={clip} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} onToggleVideo={onToggleVideo} onClickClip={onClickClip} />)
    fireEvent.click(container.querySelector('.atl-clip-eye-btn'))
    expect(onToggleVideo).toHaveBeenCalledWith(clip)
    expect(onClickClip).not.toHaveBeenCalled()
  })
  it('disabled 클립 → atl-clip-disabled 클래스(dim)', () => {
    const { container } = render(<Clip clip={vidClip({ disabled: true })} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} onToggleVideo={vi.fn()} />)
    expect(container.querySelector('.atl-clip-disabled')).toBeTruthy()
  })
  it('non-video clip(이미지) → eye 버튼 없음', () => {
    const { container } = render(<Clip clip={{ id: 'img-1', startMs: 0, endMs: 3000, color: '#888', role: 'image', imagePath: '/i.png' }} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} onToggleVideo={vi.fn()} />)
    expect(container.querySelector('.atl-clip-eye-btn')).toBeFalsy()
  })
  it('생성 중(generating) 클립 → eye 버튼 없음(완료 시 선택이 리셋되므로 토글 숨김)', () => {
    const { container } = render(<Clip clip={vidClip({ generating: true })} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} onToggleVideo={vi.fn()} />)
    expect(container.querySelector('.atl-clip-eye-btn')).toBeFalsy()
  })
})

describe('Clip — 생성 중 클록/경과시간 (Results 와 동일)', () => {
  it('생성 중 block 클립 → 스톱워치 아이콘 + 경과시간 배지 렌더', () => {
    const startedAt = Date.now() - 5000 // 5초 전 시작
    const { container } = render(
      <Clip clip={vidClip({ generating: true, generatingStartedAt: startedAt, generatingEndedAt: null })}
        variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} />
    )
    const badge = container.querySelector('.atl-clip-gentimer')
    expect(badge).toBeTruthy()
    expect(badge.querySelector('.stopwatch-icon')).toBeTruthy()
    expect(badge.textContent).toMatch(/\d{2}:\d{2}/) // mm:ss
  })

  it('생성 중 아님 → 클록 배지 없음', () => {
    const { container } = render(
      <Clip clip={vidClip({ generating: false })} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} />
    )
    expect(container.querySelector('.atl-clip-gentimer')).toBeFalsy()
  })

  it('text variant 는 클록 배지 없음(block 전용)', () => {
    const { container } = render(
      <Clip clip={{ id: 't', startMs: 0, endMs: 3000, color: '#888', label: 'x', generating: true, generatingStartedAt: Date.now() }}
        variant="text" pxPerMs={0.1} height={40} totalDurationMs={3000} />
    )
    expect(container.querySelector('.atl-clip-gentimer')).toBeFalsy()
  })
})
