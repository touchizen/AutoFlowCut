import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

vi.mock('../../src/utils/videoPoster', () => ({
  getVideoPoster: vi.fn(),
}))

import ResultsTable from '../../src/components/ResultsTable'
import { I18nProvider } from '../../src/hooks/useI18n'
import { getVideoPoster } from '../../src/utils/videoPoster'

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>)

describe('ResultsTable — generated video poster thumbnails', () => {
  beforeEach(() => {
    getVideoPoster.mockReset()
  })

  it('poster 이미지가 없는 video row는 video source에서 생성한 poster img를 표시한다', async () => {
    getVideoPoster.mockResolvedValue('data:image/jpeg;base64,VIDEOPOSTER')

    const { container } = wrap(
      <ResultsTable
        mediaType="video"
        onShowDetail={vi.fn()}
        items={[
          {
            id: 'v1',
            prompt: 'A young scholar reading under an oak tree',
            status: 'complete',
            videoPath: '/abs/v1.mp4',
          },
        ]}
      />
    )

    expect(container.querySelectorAll('video')).toHaveLength(0)
    expect(container.querySelector('.video-placeholder')).toBeInTheDocument()

    await waitFor(() => {
      const poster = container.querySelector('img.result-thumbnail')
      expect(poster).toBeInTheDocument()
      expect(poster.getAttribute('src')).toBe('data:image/jpeg;base64,VIDEOPOSTER')
    })

    expect(getVideoPoster).toHaveBeenCalledWith(
      'file:///abs/v1.mp4',
      { signal: expect.any(AbortSignal) }
    )
    expect(container.querySelectorAll('video')).toHaveLength(0)
  })
})
