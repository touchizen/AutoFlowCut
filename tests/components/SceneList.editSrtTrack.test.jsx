/**
 * SceneList — review R3 fix
 *
 * srtTrack-backed 씬의 자막 textarea 편집 가능 + 실제 srtTrack 갱신.
 * 단일 라인이면 inline 편집. 여러 라인이면 read-only (묶음 안내).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
  prompt: '', subtitle: '', startTime: 0, endTime: 3, duration: 3, status: 'pending',
}

describe('R3 — 단일 srtLine 씬의 자막 textarea 편집 가능', () => {
  it('타이핑 → onUpdateSrtLine 호출 (srtTrack 라인 갱신)', () => {
    const srtTrack = [{ id: 'sub_1', startTime: 0, endTime: 3, text: 'original' }]
    const scene = { ...baseScene, id: 'scene_1', srtLineIds: ['sub_1'] }
    const onUpdateSrtLine = vi.fn()
    render(
      <SceneList
        scenes={[scene]}
        srtTrack={srtTrack}
        onUpdate={vi.fn()}
        onUpdateSrtLine={onUpdateSrtLine}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const textarea = screen.getByPlaceholderText('sceneList.subtitlePlaceholder')
    expect(textarea.value).toBe('original')
    expect(textarea.readOnly).toBe(false)
    fireEvent.change(textarea, { target: { value: 'edited' } })
    expect(onUpdateSrtLine).toHaveBeenCalledWith('sub_1', 'edited')
  })
})

describe('R3 — 묶음 (여러 srtLine) 씬의 textarea 는 read-only', () => {
  it('readOnly = true + 묶음 텍스트 표시', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: 'B' },
      { id: 'sub_3', startTime: 2, endTime: 3, text: 'C' },
    ]
    const scene = { ...baseScene, id: 'scene_1', srtLineIds: ['sub_1', 'sub_2', 'sub_3'] }
    const onUpdateSrtLine = vi.fn()
    render(
      <SceneList
        scenes={[scene]}
        srtTrack={srtTrack}
        onUpdate={vi.fn()}
        onUpdateSrtLine={onUpdateSrtLine}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const textarea = screen.getByPlaceholderText('sceneList.subtitlePlaceholder')
    expect(textarea.value).toBe('A\nB\nC')
    expect(textarea.readOnly).toBe(true)
    // 편집해도 onUpdateSrtLine 안 불림
    fireEvent.change(textarea, { target: { value: 'edited' } })
    expect(onUpdateSrtLine).not.toHaveBeenCalled()
  })
})

describe('R3 — legacy 씬 (srtLineIds 없음) 은 scene.subtitle 편집 (back-compat)', () => {
  it('typing → onUpdate(sceneId, { subtitle })', () => {
    const scene = { ...baseScene, id: 'scene_1', subtitle: 'legacy' }
    const onUpdate = vi.fn()
    render(
      <SceneList
        scenes={[scene]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )
    const textarea = screen.getByPlaceholderText('sceneList.subtitlePlaceholder')
    expect(textarea.value).toBe('legacy')
    expect(textarea.readOnly).toBe(false)
    fireEvent.change(textarea, { target: { value: 'new' } })
    expect(onUpdate).toHaveBeenCalledWith('scene_1', { subtitle: 'new' })
  })
})
