import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn() },
}))

import { toast } from '../../src/components/Toast'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useScenes CSV generation warnings', () => {
  it('G3: parseFromCSV returns parser and merge warnings and surfaces them through toast', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV([
        'scene,prompt,i2v_provider,i2v_model',
        '1,p,google,veo-3.1-fast-generate-preview',
      ].join('\n'))
    })

    let returned
    act(() => {
      returned = result.current.parseFromCSV([
        'scene,prompt,image_provider,i2v_model',
        '1,p,unknown-image,not-a-google-model',
      ].join('\n'), 3, [], {
        generationSettings: {
          generation: { image: { provider: 'google' }, video: { i2v: { provider: 'google' } } },
        },
      })
    })

    const expectedWarnings = [
      "Rejected unknown provider 'unknown-image' at generation.image.",
      "Rejected invalid model 'not-a-google-model' at generation.video.i2v.",
    ]
    expect(returned.warnings).toEqual(expectedWarnings)
    expect(toast.warning).toHaveBeenCalledWith(expectedWarnings.join('\n'))
  })

  it('G3: legacy CSV import returns parser and merge warnings and surfaces them through toast', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV([
        'prompt,i2v_provider,i2v_model',
        'p,google,veo-3.1-fast-generate-preview',
      ].join('\n'))
    })

    let returned
    act(() => {
      returned = result.current.parseFromCSV([
        'prompt,image_provider,i2v_model',
        'p,unknown-image,not-a-google-model',
      ].join('\n'), 3, [], {
        generationSettings: {
          generation: { image: { provider: 'google' }, video: { i2v: { provider: 'google' } } },
        },
      })
    })

    const expectedWarnings = [
      "Rejected unknown provider 'unknown-image' at generation.image.",
      "Rejected invalid model 'not-a-google-model' at generation.video.i2v.",
    ]
    expect(returned.warnings).toEqual(expectedWarnings)
    expect(toast.warning).toHaveBeenLastCalledWith(expectedWarnings.join('\n'))
  })
})
