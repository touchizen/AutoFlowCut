// tests/integration/storyPipelineM1.test.js
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { renderHook, act } from '@testing-library/react'
import { createStepMachine } from '../../electron/story/stepMachine.js'
import { useScenes } from '../../src/hooks/useScenes.js'

describe('M1 통합: 제목 → 대본 → 씬 → 프롬프트 → 그리드 push', () => {
  it('push payload가 그리드에 반영되고 ack로 revision이 확정된다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'int-'))
    const llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '# 운수 좋은 날\n김첨지는...' })),
      splitScenes: vi.fn(async () => ({
        scenes: [
          { sceneNo: 1, summary: '비 오는 아침', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] },
          { sceneNo: 2, summary: '인력거', segments: [{ speaker: 'kim', text: '가'.repeat(35), emotion: 'happy' }] },
        ],
        speakers: [{ id: 'narrator', name: '나레이션' }, { id: 'kim', name: '김첨지' }],
      })),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: `IMG${s.sceneNo}`, videoPrompt: `VID${s.sceneNo}` })) })),
    }
    const emitted = []
    const machine = createStepMachine({ projectPath: dir, llm, emit: (ch, p) => emitted.push({ ch, p }), getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: '운수 좋은 날' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})

    const push = emitted.find((e) => e.ch === 'story:pushScenes')
    expect(push.p.scenes).toHaveLength(2)

    // renderer 측 적용
    const { result } = renderHook(() => useScenes())
    let ret
    act(() => { ret = result.current.importStoryScenes({ scenes: push.p.scenes }) })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].prompt).toBe('IMG1')
    expect(result.current.scenes[1].startTime).toBeGreaterThan(0)  // 폴백 타이밍 순차 배치

    // ack → revision 확정
    await machine.ackPush({ pushRevision: push.p.pushRevision, ok: true })
    const state = await machine.getState()
    expect(state.lastPushedRevision).toBe(state.pendingPushRevision)

    // 재open 시 재발신 없음
    const before = emitted.length
    await machine.open()
    expect(emitted.slice(before).filter((e) => e.ch === 'story:pushScenes')).toHaveLength(0)
  })
})
