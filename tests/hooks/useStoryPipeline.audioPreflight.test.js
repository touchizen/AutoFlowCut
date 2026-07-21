// M3b-2a Task1: story:audio-preflight IPC를 useStoryPipeline.audioPreflight로 노출.
// story-api.js:187 핸들러는 payload.projectToken이 아니라 params를 그대로 machine.audioPreflight(params)에
// 넘긴다(guarded()로 감싸지 않음, 주석 참조) — 따라서 wrapper는 projectToken을 주입하지 않고
// pickAudioImportFile(useStoryPipeline.js:584)처럼 params를 그대로 전달한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

let listeners
beforeEach(() => {
  listeners = {}
  window.electronAPI = {
    storyOpen: vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} } })),
    storyGetState: vi.fn(async () => ({ steps: {} })),
    storyStart: vi.fn(async () => ({ operationId: 'op1' })),
    storyAbort: vi.fn(async () => ({})),
    storyPushAck: vi.fn(async () => ({})),
    storyAudioPreflight: vi.fn(async () => ({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing', encryptionAvailable: true }],
      encryptionAvailable: true,
    })),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

async function openHook(props = {}) {
  const rendered = renderHook(
    ({ projectPath }) => useStoryPipeline({ projectPath, onPushScenes: vi.fn(), ...props }),
    { initialProps: { projectPath: '/p' } },
  )
  await act(() => rendered.result.current.open())
  return rendered
}

describe('useStoryPipeline.audioPreflight', () => {
  it('params를 그대로(projectToken 미주입) storyAudioPreflight에 전달한다', async () => {
    const { result } = await openHook()
    const params = { speakers: [{ id: 'A', voice: { provider: 'typecast', voiceId: 'v' } }] }
    const res = await act(() => result.current.audioPreflight(params))
    expect(window.electronAPI.storyAudioPreflight).toHaveBeenCalledWith(params)
    expect(res.providers[0].status).toBe('missing')
  })
})
