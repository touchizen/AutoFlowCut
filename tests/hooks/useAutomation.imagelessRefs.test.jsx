import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({
    styledPrompt: prompt,
    appliedStyle: null,
  })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

function setup({ mode, scene, references }) {
  const submitGeneration = vi.fn().mockResolvedValue({
    success: true,
    images: [{ base64: 'generated-image' }],
  })
  const genAPI = {
    submitGeneration,
    checkGeneration: vi.fn(),
    collectGeneration: vi.fn(),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const scenesHook = {
    scenes: [scene],
    references,
    updateScene: vi.fn(),
    updateReferences: vi.fn(),
    getMatchingReferences: vi.fn(() => references),
  }

  const hook = renderHook(() =>
    useAutomation(
      genAPI,
      scenesHook,
      null,
      null,
      null,
      key => key,
      null,
      null,
      null,
      mode
    )
  )

  return { hook, submitGeneration }
}

describe('useAutomation M1 Flow reference guard', () => {
  it('removes null, undefined, and empty mediaId refs from Flow submissions', async () => {
    const references = [
      { id: 'null', name: 'Null', type: 'character', mediaId: null },
      { id: 'undefined', name: 'Undefined', type: 'scene', mediaId: undefined },
      { id: 'empty', name: 'Empty', type: 'style', mediaId: '' },
      { id: 'valid', name: 'Valid', type: 'character', mediaId: 'media-ok' },
    ]
    const { hook, submitGeneration } = setup({
      mode: 'flow',
      scene: { id: 's1', prompt: 'plain prompt', status: 'pending' },
      references,
    })

    await act(async () => {
      await hook.result.current.start({
        projectName: 'Project',
        saveMode: 'memory',
      })
    })

    expect(submitGeneration.mock.calls[0][1]).toEqual([
      {
        category: undefined,
        mediaId: 'media-ok',
        caption: '',
        name: 'Valid',
        data: null,
        filePath: null,
      },
    ])
  })

  it('strips only M1-excluded mentions before matching and submission', async () => {
    const ghost = {
      id: 'ghost',
      name: 'Ghost',
      type: 'character',
      mediaId: null,
    }
    const { hook, submitGeneration } = setup({
      mode: 'flow',
      scene: {
        id: 's1',
        prompt: '@Ghost meets @Unknown',
        status: 'pending',
      },
      references: [ghost],
    })

    await act(async () => {
      await hook.result.current.start({
        projectName: 'Project',
        saveMode: 'memory',
        m1ExcludedMentionNamesBySceneId: {
          s1: ['Ghost'],
        },
      })
    })

    expect(submitGeneration.mock.calls[0][0]).toBe('Ghost meets @Unknown')
    expect(submitGeneration.mock.calls[0][1]).toEqual([])
  })

  it('maps imagePath into filePath in API mode', async () => {
    const reference = {
      id: 'forest',
      name: 'Forest',
      type: 'scene',
      mediaId: 'media-forest',
      imagePath: 'references/Forest',
    }
    const { hook, submitGeneration } = setup({
      mode: 'api',
      scene: { id: 's1', prompt: 'forest', status: 'pending' },
      references: [reference],
    })

    await act(async () => {
      await hook.result.current.start({
        projectName: 'Project',
        saveMode: 'memory',
      })
    })

    expect(submitGeneration.mock.calls[0][1][0].filePath).toBe(
      'references/Forest'
    )
  })
})
