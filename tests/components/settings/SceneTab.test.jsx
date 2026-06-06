/**
 * SceneTab — project aspect ratio selector
 *
 * The Scene settings tab exposes the project format (16:9 longform /
 * 9:16 shortform) as a button group, editable after project creation.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SceneTab from '../../../src/components/settings/SceneTab'

const t = (k) => k
const baseSettings = {
  aspectRatio: '16:9',
  defaultDuration: 3,
  exportThreshold: 50,
  imageBatchCount: 1,
  videoBatchCount: 1,
  imageUpscale: 'off',
  videoResolution: '1080p',
}

describe('SceneTab — aspect ratio', () => {
  it('marks the current aspect ratio button active', () => {
    render(<SceneTab localSettings={{ ...baseSettings, aspectRatio: '9:16' }} setLocalSettings={vi.fn()} t={t} />)

    expect(screen.getByRole('button', { name: /9:16/ }).className).toContain('active')
    expect(screen.getByRole('button', { name: /16:9/ }).className).not.toContain('active')
  })

  it('defaults the active button to 16:9 when aspectRatio is unset', () => {
    render(<SceneTab localSettings={{ ...baseSettings, aspectRatio: undefined }} setLocalSettings={vi.fn()} t={t} />)

    expect(screen.getByRole('button', { name: /16:9/ }).className).toContain('active')
  })

  it('switches the project to 9:16 (shortform) on click', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={baseSettings} setLocalSettings={setLocalSettings} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /9:16/ }))

    const updater = setLocalSettings.mock.calls[0][0]
    expect(updater(baseSettings)).toMatchObject({ aspectRatio: '9:16' })
  })

  it('switches the project back to 16:9 (longform) on click', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={{ ...baseSettings, aspectRatio: '9:16' }} setLocalSettings={setLocalSettings} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /16:9/ }))

    const updater = setLocalSettings.mock.calls[0][0]
    expect(updater(baseSettings)).toMatchObject({ aspectRatio: '16:9' })
  })
})

describe('SceneTab — model selectors (T2I/T2V/F2V)', () => {
  it('3개 모델 섹션(T2I/T2V/F2V) 렌더', () => {
    render(<SceneTab localSettings={baseSettings} setLocalSettings={vi.fn()} t={t} />)
    expect(screen.getByText('settings.modelImageTitle')).toBeTruthy()
    expect(screen.getByText('settings.modelVideoT2VTitle')).toBeTruthy()
    expect(screen.getByText('settings.modelVideoF2VTitle')).toBeTruthy()
  })

  it('이미지 모델 select 변경 → setLocalSettings(imageModel)', () => {
    const setLocalSettings = vi.fn()
    const { container } = render(<SceneTab localSettings={baseSettings} setLocalSettings={setLocalSettings} t={t} />)
    const t2iSelect = container.querySelectorAll('select.model-select')[0] // T2I 가 첫 셀렉터
    fireEvent.change(t2iSelect, { target: { value: 'gemini-3.1-flash-image' } })
    expect(setLocalSettings.mock.calls[0][0](baseSettings).imageModel).toBe('gemini-3.1-flash-image')
  })

  it('imageModel 미지정 시 기본(Nano Banana 2 = gemini-3.1-flash-image)이 select 현재값', () => {
    const { container } = render(<SceneTab localSettings={{ ...baseSettings, imageModel: undefined }} setLocalSettings={vi.fn()} t={t} />)
    const t2iSelect = container.querySelectorAll('select.model-select')[0]
    expect(t2iSelect.value).toBe('gemini-3.1-flash-image')
  })

  it('imageModels/videoModels prop 주면 동적 옵션 사용 (없으면 정적 카탈로그 폴백)', () => {
    const imageModels = [{ id: 'dyn-img', label: 'Dynamic Img', cost: '$9' }]
    const videoModels = [{ id: 'dyn-vid', label: 'Dynamic Vid', cost: '$8' }]
    // 저장된 모델이 제공된 동적 목록 안에 있는 정상 케이스 (없으면 합성 옵션이 붙음).
    const ls = { ...baseSettings, imageModel: 'dyn-img', videoModelT2V: 'dyn-vid', videoModelF2V: 'dyn-vid' }
    const { container } = render(
      <SceneTab localSettings={ls} setLocalSettings={vi.fn()} t={t} imageModels={imageModels} videoModels={videoModels} />
    )
    const selects = container.querySelectorAll('select.model-select')
    expect([...selects[0].querySelectorAll('option')].map(o => o.value)).toEqual(['dyn-img'])
    // T2V, F2V 둘 다 비디오 동적 목록
    expect([...selects[1].querySelectorAll('option')].map(o => o.value)).toEqual(['dyn-vid'])
    expect([...selects[2].querySelectorAll('option')].map(o => o.value)).toEqual(['dyn-vid'])
  })
})

describe('SceneTab — concurrency', () => {
  it('renders the current concurrency value', () => {
    render(<SceneTab localSettings={{ ...baseSettings, concurrency: 5 }} setLocalSettings={vi.fn()} t={t} />)
    expect(screen.getByLabelText('settings.concurrency').value).toBe('5')
  })

  it('falls back to 5 when concurrency is unset', () => {
    render(<SceneTab localSettings={{ ...baseSettings, concurrency: undefined }} setLocalSettings={vi.fn()} t={t} />)
    expect(screen.getByLabelText('settings.concurrency').value).toBe('5')
  })

  it('updates concurrency on change', () => {
    const setLocalSettings = vi.fn()
    render(<SceneTab localSettings={{ ...baseSettings, concurrency: 5 }} setLocalSettings={setLocalSettings} t={t} />)
    fireEvent.change(screen.getByLabelText('settings.concurrency'), { target: { value: '8' } })
    expect(setLocalSettings.mock.calls[0][0](baseSettings).concurrency).toBe(8)
  })
})
