/**
 * useAutomation — ref 업로드 진입 전 사용자 Stop 회귀
 *
 * 회귀: getAccessToken 대기 중 stop()을 누른 뒤 업로드 단계로 진입하면, 업로드 코디네이터가
 * 아무 작업도 투입하지 못한 채 resolve 출구를 잃어 start()와 실행 상태가 영원히 고착됐다.
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockResolvedValue({ success: true, data: 'base64data==' }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../src/services/styleService', () => ({
  presetTagForStyleId: vi.fn(() => null),
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'p', appliedStyle: null })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useAutomation — ref upload stop settlement', () => {
  it('getAccessToken 대기 중 stop 후에도 start가 정산되고 stopped 상태가 된다', async () => {
    let resolveToken
    const tokenPromise = new Promise((resolve) => { resolveToken = resolve })
    const getAccessToken = vi.fn(() => tokenPromise)
    const genAPI = {
      submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
      checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
      collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ id: 'img-1', mediaId: 'm-1' }] }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
      uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'ref-media-1' }),
      getAccessToken,
    }
    const styleRef = {
      id: 'ref1', name: 'style.png', type: 'style', category: 'style',
      data: 'base64data==', mediaId: null,
    }
    const scenesHook = {
      // image가 있으면 stopped 직후의 empty-state reset effect가 status를 ready로 덮지 않는다.
      scenes: [{ id: 's1', prompt: 'a', status: 'pending', image: 'data:image/png;base64,old' }],
      references: [styleRef],
      updateScene: vi.fn(),
      getMatchingReferences: vi.fn(() => [styleRef]),
      updateReferences: vi.fn(),
    }
    const hook = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, (key) => key, vi.fn(), null, null, 'flow')
    )

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'folder' })
    })
    expect(getAccessToken).toHaveBeenCalledTimes(1)

    act(() => { hook.result.current.stop() })
    await act(async () => { resolveToken('fake-token') })
    await act(async () => { await startPromise })

    expect(hook.result.current.isRunning).toBe(false)
    expect(hook.result.current.status).toBe('stopped')
  }, 1500)
})
