import { describe, it, expect, vi } from 'vitest'
import {
  continueScript,
  generateScript,
  generateTitle,
  reviewScript,
  reviseScript,
  splitScenes,
  writePrompts,
} from '../../../../electron/api/llm/llmCodex.js'

const OPTS = { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high', language: 'ko' }

describe('llmCodex adapter', () => {
  it('generateScript는 Codex text runner를 호출하고 delta를 전달한다', async () => {
    const runText = vi.fn(async (_prompt, _opts, ctx) => {
      ctx.onDelta?.('부분')
      return '# 대본'
    })
    const onDelta = vi.fn()
    const r = await generateScript({ type: 'title', title: 'T' }, OPTS, { runText, onDelta, signal: 'sig' })
    expect(r).toEqual({ scriptMd: '# 대본' })
    expect(onDelta).toHaveBeenCalledWith('부분')
    expect(runText.mock.calls[0][0]).toContain('제목: T')
    expect(runText.mock.calls[0][0]).toContain('Do not inspect local files')
    expect(runText.mock.calls[0][1]).toEqual({ model: 'gpt-5.5', reasoningEffort: 'high' })
    expect(runText.mock.calls[0][2]).toMatchObject({ onDelta, signal: 'sig' })
  })

  it('generateScript는 runner에 SDK 제어 옵션을 넘기지 않는다', async () => {
    const runText = vi.fn(async () => '# 대본')
    await generateScript({ type: 'title', title: 'T' }, {
      ...OPTS,
      workingDirectory: '/tmp/hijack',
      sandboxMode: 'danger-full-access',
      networkAccessEnabled: true,
      timeoutMs: 1,
      config: { mcp_servers: { local: {} } },
      env: { OPENAI_API_KEY: 'x' },
    }, { runText })

    expect(runText.mock.calls[0][1]).toEqual({
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    })
  })

  it('generateTitle은 첫 줄만 제목으로 반환한다', async () => {
    const runText = vi.fn(async () => '멋진 제목\n설명')
    await expect(generateTitle('대본', OPTS, { runText })).resolves.toEqual({ title: '멋진 제목' })
  })

  it('continueScript는 새 내용만 받아 기존 대본 뒤에 이어 붙인다', async () => {
    const runText = vi.fn(async () => '이어진 내용')
    await expect(continueScript('앞부분', OPTS, { runText })).resolves.toEqual({ scriptMd: '앞부분\n\n이어진 내용' })
  })

  it('splitScenes는 structured JSON을 요청하고 세그먼트를 검증한다', async () => {
    const out = {
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '안녕', emotion: 'normal' }] }],
      speakers: [],
    }
    const runJson = vi.fn(async () => out)
    await expect(splitScenes('SCRIPT', OPTS, { runJson })).resolves.toEqual(out)
    expect(runJson.mock.calls[0][0]).toContain('--- 대본 ---')
    expect(runJson.mock.calls[0][0]).toContain('Return only the requested story content')
    expect(runJson.mock.calls[0][1]).toMatchObject({ type: 'object' })
  })

  it('reviewScript는 pass/revise 외 verdict를 pass로 정규화한다', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'maybe', critique: 'c' }))
    await expect(reviewScript('SCRIPT', OPTS, { runJson })).resolves.toEqual({ verdict: 'pass', critique: 'c' })
  })

  it('reviseScript는 Codex text runner 결과를 scriptMd로 반환한다', async () => {
    const runText = vi.fn(async () => '# 개선본')
    await expect(reviseScript('SCRIPT', 'critique', OPTS, { runText })).resolves.toEqual({ scriptMd: '# 개선본' })
  })

  it('writePrompts는 sceneNo 기준으로 프롬프트를 병합하고 누락은 실패시킨다', async () => {
    const scenes = [{ sceneNo: 1, summary: 's' }]
    const runJson = vi.fn(async () => ({ scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }))
    await expect(writePrompts(scenes, { scriptMd: '#' }, OPTS, { runJson })).resolves.toEqual({
      scenes: [{ sceneNo: 1, summary: 's', imagePrompt: 'IMG', videoPrompt: 'VID' }],
    })

    runJson.mockResolvedValueOnce({ scenes: [] })
    await expect(writePrompts(scenes, { scriptMd: '#' }, OPTS, { runJson })).rejects.toThrow(/scene 1 missing\/empty prompt/)
  })
})
