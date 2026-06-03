/**
 * SceneList — export 미디어 표시가 실제 export(resolveExportVideos)와 일치하는지.
 * 하이브리드: auto + i2v·t2v 둘 다면 export 가 둘 다 보내므로 thumb 도 둘 다 selected 여야 함
 * ("UI 는 i2v 만, CapCut 은 둘 다" 불일치 방지).
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
vi.mock('../../src/components/TagBatchModal', () => ({ default: () => <div /> }))

import SceneList from '../../src/components/SceneList'

const bothScene = (extra = {}) => ({
  id: 'scene_1', prompt: '', subtitle: '', startTime: 0, endTime: 3, duration: 3, status: 'done',
  image: 'data:image/png;base64,XXX',
  videoI2VPath: '/i.mp4', videoI2VDuration: 2,
  videoT2VPath: '/t.mp4', videoT2VDuration: 4,
  ...extra,
})

const renderRow = (scene) => render(
  <SceneList scenes={[scene]} onUpdate={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} defaultDuration={3} projectName="P" />
)
const thumbFor = (container, label) =>
  [...container.querySelectorAll('.media-thumb')].find(el => el.querySelector('.media-label')?.textContent === label)

describe('SceneList — export 미디어 표시 일관성', () => {
  it('auto(exportMedia 미설정) + i2v·t2v 둘 다 → 두 영상 thumb 모두 selected', () => {
    const { container } = renderRow(bothScene())
    expect(thumbFor(container, 'I2V').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'T2V').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'IMG').classList.contains('selected')).toBe(false)
  })

  it("exportMedia='t2v' 명시 → t2v thumb 만 selected", () => {
    const { container } = renderRow(bothScene({ exportMedia: 't2v' }))
    expect(thumbFor(container, 'T2V').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'I2V').classList.contains('selected')).toBe(false)
  })

  it("exportMedia='image' → IMG thumb 만 selected (영상 export 안 함)", () => {
    const { container } = renderRow(bothScene({ exportMedia: 'image' }))
    expect(thumbFor(container, 'IMG').classList.contains('selected')).toBe(true)
    expect(thumbFor(container, 'I2V').classList.contains('selected')).toBe(false)
    expect(thumbFor(container, 'T2V').classList.contains('selected')).toBe(false)
  })
})
