// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

describe('stepMachine scenes streaming preview', () => {
  it('started 뒤 좌표와 preview 전용 필드만 보낸 뒤 최종 splitScenes 결과만 저장한다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sm-scenes-streaming-'))
    const emitted = []
    const finalScene = {
      sceneNo: 1,
      summary: 'FINAL',
      segments: [{ type: 'narration', speaker: 'narrator', text: '최종 본문', emotion: 'normal' }],
    }
    const llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
      splitScenes: vi.fn(async (_scriptMd, _opts, ctx) => {
        ctx.onPartialScene?.({
          sceneNo: 7,
          summary: 'GHOST',
          segments: [{
            type: 'narration',
            speaker: 'alice',
            text: '미리보기 본문',
            emotion: 'happy',
            id: 'heavy-segment-id',
            audioPath: '/secret/audio.wav',
          }, {
            type: 'sfx',
            description: 'door slamming shut',
            source: 'heavy-sfx-source',
          }],
          storyId: 'heavy-story-id',
          imagePrompt: 'HEAVY-IMAGE-PROMPT',
          videoPrompt: 'HEAVY-VIDEO-PROMPT',
          appearingCharacters: ['alice'],
        }, 4)
        return { scenes: [finalScene], speakers: [{ id: 'narrator', name: '나레이션' }] }
      }),
    }
    const machine = createStepMachine({
      projectPath: dir,
      llm,
      emit: (ch, payload) => emitted.push({ ch, payload }),
      getApiKey: () => 'k',
    })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })

    const { operationId } = await machine.start('scenes', {})
    const sceneEvents = emitted.filter((event) => (
      event.ch === 'story:progress' && event.payload.kind === 'scene-delta'
    ))

    expect(sceneEvents).toHaveLength(2)
    expect(sceneEvents[0].payload).toMatchObject({ operationId, kind: 'scene-delta', phase: 'started' })
    const { projectToken, usage, operationId: deltaOp, ...deltaBody } = sceneEvents[1].payload
    expect(projectToken).toBeTruthy()
    expect(usage).toBeTruthy()
    expect(deltaOp).toBe(operationId)
    expect(deltaBody).toEqual({
      kind: 'scene-delta',
      chunkIndex: 0,
      localSceneNo: 4,
      scene: {
        sceneNo: 7,
        summary: 'GHOST',
        segments: [
          { type: 'narration', speaker: 'alice', text: '미리보기 본문' },
          { type: 'sfx', speaker: '', text: 'door slamming shut' },
        ],
      },
    })
    expect(llm.splitScenes).toHaveBeenCalledTimes(1)

    const saved = JSON.parse(await readFile(path.join(dir, 'story', 'scenes.json'), 'utf8'))
    expect(saved.scenes[0]).toMatchObject({ summary: 'FINAL', segments: [{ text: '최종 본문' }] })
    expect(saved.scenes[0].summary).not.toBe('GHOST')
  })
})
