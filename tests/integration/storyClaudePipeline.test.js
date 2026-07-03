import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../electron/story/stepMachine.js'
import * as llmClaude from '../../electron/api/llm/llmClaude.js'

// SDK query만 목킹 — llmClaude 실제 로직(스트리밍/structured) 경유
function fakeQueryFactory() {
  return async function* (args) {
    if (args.options?.includePartialMessages) {
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '# 대본' } } }
      yield { type: 'result', subtype: 'success', is_error: false, result: '# 대본' }
      return
    }
    if (args.options?.outputFormat) {
      // splitScenes 또는 writePrompts 스키마에 따라 최소 유효 데이터 반환
      const isPrompts = /imagePrompt/.test(JSON.stringify(args.options.outputFormat.schema))
      const data = isPrompts
        ? { scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }
        : { scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'narrator', text: 'hi' }] }], speakers: [{ id: 'narrator', name: 'N' }] }
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: data }
      return
    }
    yield { type: 'result', subtype: 'success', is_error: false, result: '{}' }
  }
}

describe('Story Claude 파이프라인 (통합)', () => {
  it('대본→씬분리→프롬프트가 Claude 엔진으로 끝까지 돈다', async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'proj-'))
    const queryImpl = fakeQueryFactory()
    // llmClaude 함수들을 queryImpl 주입 버전으로 래핑
    const llm = {
      generateScript: (i, o, ctx) => llmClaude.generateScript(i, o, { ...ctx, queryImpl }),
      splitScenes: (s, o, ctx) => llmClaude.splitScenes(s, o, { ...ctx, queryImpl }),
      writePrompts: (s, c, o, ctx) => llmClaude.writePrompts(s, c, o, { ...ctx, queryImpl }),
    }
    const loadMetaPrompt = async () => 'META'
    const machine = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null, loadMetaPrompt })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { genre: 'yadam', language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})

    const scenes = JSON.parse(await readFile(path.join(projectPath, 'story', 'scenes.json'), 'utf8')).scenes
    expect(scenes[0].imagePrompt).toBe('IMG')
    expect(scenes[0].videoPrompt).toBe('VID')
    const script = await readFile(path.join(projectPath, 'story', 'script.md'), 'utf8')
    expect(script).toContain('대본')
  })
})
