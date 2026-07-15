import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildSrtPromptHookConfig } from '../../src/App.jsx'
import { useScenes } from '../../src/hooks/useScenes'
import { useSrtPrompts } from '../../src/hooks/useSrtPrompts'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('SRT → prompt integration', () => {
  it('imports SRT, generates through mock IPC, applies fields, and flushes the exact live payload', async () => {
    const writeChunk = vi.fn(async ({ dtoScenes }) => dtoScenes.map(({ sceneNo, text }) => ({
      sceneNo,
      imagePrompt: `image:${text}`,
      videoPrompt: `video:${text}`,
    })))
    window.electronAPI.srtPromptsWriteChunk = writeChunk
    const saveCurrentProjectWithPayload = vi.fn(async () => ({ ok: true, persisted: true }))
    const framePairsRef = { current: [{ id: 'gallery', ownerSceneId: null }] }

    const { result } = renderHook(() => {
      const scenesHook = useScenes()
      const promptHook = useSrtPrompts(buildSrtPromptHookConfig({
        scenesRef: scenesHook.scenesRef,
        srtTrackRef: scenesHook.srtTrackRef,
        framePairsRef,
        getProjectIdentity: () => ({ projectId: 'folder:demo', switchEpoch: 1 }),
        applyPromptChunk: scenesHook.applySrtPromptChunk,
        saveCurrentProjectWithPayload,
        isFolderProject: true,
      }))
      return { scenesHook, promptHook }
    })

    act(() => {
      result.current.scenesHook.parseFromSRT(`1\n00:00:05,000 --> 00:00:07,000\nFirst line\n\n2\n00:00:10,000 --> 00:00:12,500\nSecond line`)
    })

    let report
    await act(async () => {
      report = await result.current.promptHook.run({ engine: 'claude', onlyEmpty: true })
    })

    expect(report.status).toBe('completed')
    expect(writeChunk).toHaveBeenCalledTimes(1)
    expect(writeChunk.mock.calls[0][0].dtoScenes).toEqual([
      { sceneNo: 1, summary: '', text: 'First line' },
      { sceneNo: 2, summary: '', text: 'Second line' },
    ])
    expect(result.current.scenesHook.scenes.map((scene) => ({
      prompt: scene.prompt,
      videoT2VPrompt: scene.videoT2VPrompt,
      startTime: scene.startTime,
      endTime: scene.endTime,
    }))).toEqual([
      { prompt: 'image:First line', videoT2VPrompt: 'video:First line', startTime: 5, endTime: 7 },
      { prompt: 'image:Second line', videoT2VPrompt: 'video:Second line', startTime: 10, endTime: 12.5 },
    ])
    expect(saveCurrentProjectWithPayload).toHaveBeenCalledTimes(1)
    expect(saveCurrentProjectWithPayload).toHaveBeenCalledWith({
      scenes: result.current.scenesHook.scenes,
      framePairs: framePairsRef.current,
      srtTrack: result.current.scenesHook.srtTrack,
    })
  })
})
