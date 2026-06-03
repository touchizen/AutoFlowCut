/**
 * SceneList Media 컬럼 — B1: export 는 "있는 영상 다" 내보냄(큐레이션은 CapCut).
 * 그래서 Media 썸네일은 "선택(pick one)" 이 아니라 "export 에 포함됨(✓)" 표시 전용이고,
 * 클릭하면 미리보기만 — exportMedia 를 바꾸지 않는다(onUpdate 호출 없음).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/components/TagBatchModal', () => ({ default: () => <div /> }))
vi.mock('../../src/components/VideoDetailModal', () => ({ default: () => <div /> }))
vi.mock('../../src/components/SceneDetailModal', () => ({ default: () => <div /> }))

import SceneList from '../../src/components/SceneList'

const bothScene = (extra = {}) => ({
  id: 'scene_1', prompt: '', subtitle: '', startTime: 0, endTime: 3, duration: 3, status: 'done',
  image: 'data:image/png;base64,XXX',
  videoI2VPath: '/i.mp4', videoI2VDuration: 2,
  videoT2VPath: '/t.mp4', videoT2VDuration: 4,
  ...extra,
})

const renderRow = (scene, props = {}) => render(
  <SceneList scenes={[scene]} onUpdate={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} defaultDuration={3} projectName="P" {...props} />
)
const thumbFor = (container, label) =>
  [...container.querySelectorAll('.media-thumb')].find(el => el.querySelector('.media-label')?.textContent === label)

describe('SceneList Media 컬럼 — B1 (있는 미디어 다 export, 표시 전용)', () => {
  it('있는 미디어(IMG·I2V·T2V) 전부 ✓ selected', () => {
    const { container } = renderRow(bothScene())
    expect(thumbFor(container, 'IMG').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'I2V').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'T2V').classList.contains('selected')).toBe(true)
  })

  it("exportMedia='t2v' 여도 전부 selected (핀은 export 에 영향 없음)", () => {
    const { container } = renderRow(bothScene({ exportMedia: 't2v' }))
    expect(thumbFor(container, 'IMG').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'I2V').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'T2V').classList.contains('selected')).toBe(true)
  })

  it("exportMedia='image' 여도 영상 thumb 도 selected (영상도 export)", () => {
    const { container } = renderRow(bothScene({ exportMedia: 'image' }))
    expect(thumbFor(container, 'I2V').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'T2V').classList.contains('selected')).toBe(true)
  })

  it('thumb 클릭 → export 변경 없음 (미리보기 전용, onUpdate 미호출)', () => {
    const onUpdate = vi.fn()
    const { container } = renderRow(bothScene(), { onUpdate })
    fireEvent.click(thumbFor(container, 'I2V'))
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
