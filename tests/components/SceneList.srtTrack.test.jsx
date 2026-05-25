/**
 * SceneList — Phase 6: srtTrack 기반 자막/duration 표시
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/components/TagBatchModal', () => ({
  default: ({ tagType }) => <div data-testid="tag-batch-modal">{tagType}</div>,
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

describe('SceneList — srtTrack 표시 (Phase 6)', () => {
  it('scene 의 srtLineIds 가 srtTrack 의 여러 라인 가리키면 묶음 자막 표시 (\\n join)', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0,   endTime: 3.5,  text: '자막1' },
      { id: 'sub_2', startTime: 3.5, endTime: 7.0,  text: '자막2' },
      { id: 'sub_3', startTime: 7.0, endTime: 11.0, text: '자막3' },
    ]
    const scene = {
      ...baseScene,
      id: 'scene_1',
      srtLineIds: ['sub_1', 'sub_2', 'sub_3'],
      subtitle: '', // 비어있어도 srtTrack 으로 표시됨
      startTime: 0,
      endTime: 11,
      duration: 11,
    }
    render(
      <SceneList
        scenes={[scene]}
        srtTrack={srtTrack}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const textarea = screen.getByPlaceholderText('sceneList.subtitlePlaceholder')
    expect(textarea.value).toBe('자막1\n자막2\n자막3')
  })

  it('srtTrack 없으면 scene.subtitle 그대로 표시 (back-compat)', () => {
    const scene = { ...baseScene, subtitle: 'LEGACY_SUB' }
    render(
      <SceneList
        scenes={[scene]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const textarea = screen.getByPlaceholderText('sceneList.subtitlePlaceholder')
    expect(textarea.value).toBe('LEGACY_SUB')
  })

  it('srtLineIds 빈 배열이면 scene.subtitle 폴백', () => {
    const scene = { ...baseScene, srtLineIds: [], subtitle: 'FALLBACK' }
    const srtTrack = [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'X' }]
    render(
      <SceneList
        scenes={[scene]}
        srtTrack={srtTrack}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const textarea = screen.getByPlaceholderText('sceneList.subtitlePlaceholder')
    expect(textarea.value).toBe('FALLBACK')
  })

  it('단일 srtLine 이면 그 텍스트만 표시', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 3, text: 'OnlyOne' },
    ]
    const scene = {
      ...baseScene,
      srtLineIds: ['sub_1'],
      subtitle: '',
    }
    render(
      <SceneList
        scenes={[scene]}
        srtTrack={srtTrack}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const textarea = screen.getByPlaceholderText('sceneList.subtitlePlaceholder')
    expect(textarea.value).toBe('OnlyOne')
  })
})
