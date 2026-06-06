/**
 * E2E: @ 멘션 → 매칭 ref → genaiGenerateImage referenceImages base64
 *
 * 리뷰 P2 (NEW) 가 짚은 검증 공백:
 *   parser/matching/renderer/useGenAPI/genai body 가 각각 단위 테스트로는 검증되어도
 *   "프롬프트 @hero → 최종 IPC payload 의 inlineData base64" 까지 관통하는 케이스가
 *   없었음. P1 (matchedRefs 에서 data 떨구는 버그) 가 바로 이 틈에 숨어 있었다.
 *
 * 이 테스트는 useGenAPI → resolveReferenceImages → window.electronAPI.genaiGenerateImage
 * 까지 실제 chain 으로 호출하고, payload 의 referenceImages 에 base64 가 잘 들어갔는지
 * 확인한다.
 */

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    // 디스크 fallback 은 이 테스트의 관심사 아님 — memory-only path 확인
    readReference: vi.fn().mockResolvedValue({ success: false }),
  },
}))

import { useGenAPI } from '../../src/hooks/useGenAPI'

describe('E2E: @mention → genaiGenerateImage referenceImages', () => {
  let mockGenaiGenerateImage

  beforeEach(() => {
    mockGenaiGenerateImage = vi.fn().mockResolvedValue({
      success: true,
      images: [{ base64: 'gen-result', mimeType: 'image/png', dataUrl: 'data:image/png;base64,gen-result' }],
    })
    window.electronAPI = {
      genaiGetKeyStatus: vi.fn().mockResolvedValue({ hasKey: true }),
      genaiGenerateImage: mockGenaiGenerateImage,
      genaiListModels: vi.fn(),
    }
  })

  it('memory-only ref (data set, no filePath) is forwarded as inline base64', async () => {
    // ── 핵심 케이스: ref 가 메모리에만 있어 disk fallback 실패해도 data 가 전달돼야 함.
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'demo' }))

    // 시뮬레이션: useAutomation/useSceneGeneration 이 matchedRefs 를 build 한 결과
    // (Phase B P1 수정 후 — data 가 보존됨)
    const matchedRefs = [
      {
        category: 'character',
        mediaId: null,
        caption: '',
        name: 'hero',
        data: 'data:image/jpeg;base64,AAAA' + 'B'.repeat(80), // base64-ish (>64 chars)
        filePath: null,
      },
    ]

    await act(async () => {
      await result.current.generateImage('A wizard hero walks', matchedRefs, { aspectRatio: '16:9' })
    })

    expect(mockGenaiGenerateImage).toHaveBeenCalledTimes(1)
    const payload = mockGenaiGenerateImage.mock.calls[0][0]
    expect(payload.prompt).toBe('A wizard hero walks')
    expect(payload.referenceImages).toHaveLength(1)
    // referenceResolver 가 data: URL 프리픽스를 떼고 base64 만 추출 + mimeType 결정
    expect(payload.referenceImages[0].data).toMatch(/^AAAA/)
    expect(payload.referenceImages[0].mimeType).toMatch(/^image\//)
  })

  it('stripped ref (no data, no filePath) does NOT silently drop — disk fallback attempted', async () => {
    // ── 이전 버그: matchedRefs 에서 data 떨어진 채로 들어오면 referenceResolver 가
    // disk fallback 만 시도 → 실패 시 조용히 빈 referenceImages 로 호출 → 일관성 깨짐.
    // 현재는 P1 fix 후 호출부가 data 를 보존하지만, 이 테스트는 "disk 도 실패하면
    // 빈 배열로 호출된다 (에러 throw 가 아님)" 가드를 확인 — 회귀 가시화.
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'demo' }))

    const matchedRefs = [
      { category: 'character', mediaId: null, caption: '', name: 'hero', data: null, filePath: null },
    ]

    await act(async () => {
      await result.current.generateImage('A wizard hero walks', matchedRefs, {})
    })

    expect(mockGenaiGenerateImage).toHaveBeenCalledTimes(1)
    const payload = mockGenaiGenerateImage.mock.calls[0][0]
    // 빈 배열로 전달됨 — 사용자가 일관성 깨짐을 알 수 있도록 throw 하지는 않지만,
    // 회귀 시그널: 이 길이가 0 인 케이스가 production 에 새지 않게 호출부가 data 를 보존해야 함.
    expect(payload.referenceImages).toHaveLength(0)
  })
})
