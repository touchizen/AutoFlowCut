/**
 * PreviewPanel — hiddenRoles(트랙 View off)로 이미지/자막/비디오 렌더를 끄는지.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PreviewPanel from '../../../src/components/AudioTimeline/PreviewPanel'

const scenes = [{ id: 's1', imagePath: '/a.png', start_time: 0, end_time: 5 }]
const srtEntries = [{ startMs: 0, endMs: 5000, text: 'Hello' }]

const renderAt = (hiddenRoles) =>
  render(<PreviewPanel playheadMs={1000} scenes={scenes} srtEntries={srtEntries} hiddenRoles={hiddenRoles} />)

describe('PreviewPanel — hiddenRoles (View off)', () => {
  it('기본: 이미지 + 자막 렌더', () => {
    const { container } = renderAt()
    expect(container.querySelector('.atl-preview-img')).toBeInTheDocument()
    expect(container.querySelector('.atl-preview-subtitle')?.textContent).toBe('Hello')
  })

  it("hiddenRoles=subtitle → 자막 숨김 (이미지는 유지)", () => {
    const { container } = renderAt(new Set(['subtitle']))
    expect(container.querySelector('.atl-preview-subtitle')).toBeNull()
    expect(container.querySelector('.atl-preview-img')).toBeInTheDocument()
  })

  it("hiddenRoles=image → 이미지 숨김 (빈 placeholder)", () => {
    const { container } = renderAt(new Set(['image']))
    expect(container.querySelector('.atl-preview-img')).toBeNull()
    expect(container.querySelector('.atl-preview-empty')).toBeInTheDocument()
  })
})
