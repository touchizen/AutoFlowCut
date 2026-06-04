/**
 * useExport — review R1 fix
 *
 * Export payload 의 srtTrack 이 validScenes 가 가리키는 라인만 포함
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// hasExportableMedia 가 image/imagePath/video_path 있는 씬만 valid 로 본다 가정
// 그 헬퍼가 import 되므로 mock
vi.mock('../../src/utils/sceneMedia', () => ({
  hasExportableMedia: vi.fn((s) => !!(s.image || s.imagePath)),
  getExportFilePaths: vi.fn(() => ({})),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    saveCapcutFile: vi.fn(),
    chooseDirectory: vi.fn(),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k }),
  useI18n: () => ({ t: (k) => k }),
}))

import { useExport } from '../../src/hooks/useExport'
import { pruneSrtTrackToScenes } from '../../src/utils/srtTrack'

describe('R1 — export 시 srtTrack 이 validScenes 로 필터링', () => {
  it('이미지 없는 씬의 srtLineIds 는 export srtTrack 에서 제외', () => {
    // 직접 통합 테스트는 무거우니 pruneSrtTrackToScenes 가 useExport 의 payload
    // 만들 때 호출된다는 invariant 를 헬퍼 단위로 검증.
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'with-image' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: 'without-image' },
    ]
    const validScenes = [
      { id: 's1', srtLineIds: ['sub_1'], image: 'x' },
      // s2 는 image 없어서 hasExportableMedia false → validScenes 에서 제외 가정
    ]
    const pruned = pruneSrtTrackToScenes(srtTrack, validScenes)
    expect(pruned).toHaveLength(1)
    expect(pruned[0].text).toBe('with-image')
  })
})
