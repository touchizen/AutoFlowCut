import { describe, it, expect, vi } from 'vitest'
import {
  continueScript,
  generateScript,
  generateTitle,
  reviewScript,
  reviseScript,
  reviewScenes,
  reviseScenes,
  reviewPrompts,
  revisePrompts,
  splitScenes,
  writePrompts,
  groupSrtLines,
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
    expect(runJson.mock.calls[0][0]).toContain('Codex strict JSON')
    expect(runJson.mock.calls[0][0]).toContain('speaker/text/emotion')
    expect(runJson.mock.calls[0][0]).toContain('non-narrator')
    expect(runJson.mock.calls[0][0]).not.toContain('off-screen')
    const schema = runJson.mock.calls[0][1]
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(schema.required).toEqual(['scenes', 'speakers'])
    expect(schema.properties.scenes.items.additionalProperties).toBe(false)
    const segmentSchema = schema.properties.scenes.items.properties.segments.items
    expect(segmentSchema.additionalProperties).toBe(false)
    expect(segmentSchema.required).toEqual(['type', 'speaker', 'text', 'emotion', 'description'])
    expect(segmentSchema.properties.description.type).toEqual(['string', 'null'])
  })

  it('splitScenes는 non-narrator speaker appearance 누락을 실패시킨다', async () => {
    const out = {
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'a', text: '안녕', emotion: 'normal' }] }],
      speakers: [{ id: 'a', name: '민수', appearance: null }],
    }
    const runJson = vi.fn(async () => out)
    await expect(splitScenes('SCRIPT', OPTS, { runJson })).rejects.toThrow(/appearance.*민수/)
  })

  it('splitScenes는 나레이션 별칭 speaker를 narrator로 취급해 appearance 없이 허용한다', async () => {
    const out = {
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: '나레이션', text: '안녕', emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션', appearance: null }],
    }
    const runJson = vi.fn(async () => out)
    await expect(splitScenes('SCRIPT', OPTS, { runJson })).resolves.toEqual(out)
  })

  it('reviewScript는 pass/revise 외 verdict를 pass로 정규화한다', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'maybe', critique: 'c' }))
    await expect(reviewScript('SCRIPT', OPTS, { runJson })).resolves.toEqual({ verdict: 'pass', critique: 'c', score: null })
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

  it.each([
    ['duplicate raw sceneNo', [
      { sceneNo: 1, imagePrompt: 'IMG1', videoPrompt: 'VID1' },
      { sceneNo: 1, imagePrompt: 'IMG2', videoPrompt: 'VID2' },
    ]],
    ['extra raw sceneNo', [
      { sceneNo: 1, imagePrompt: 'IMG1', videoPrompt: 'VID1' },
      { sceneNo: 2, imagePrompt: 'IMG2', videoPrompt: 'VID2' },
    ]],
    ['length mismatch/missing', []],
    ['empty prompt', [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: '   ' }]],
    ['non-integer sceneNo', [{ sceneNo: 1.5, imagePrompt: 'IMG', videoPrompt: 'VID' }]],
    ['zero sceneNo', [{ sceneNo: 0, imagePrompt: 'IMG', videoPrompt: 'VID' }]],
  ])('writePrompts는 Map 전에 %s를 거부한다', async (_label, rawScenes) => {
    const runJson = vi.fn(async () => ({ scenes: rawScenes }))
    await expect(writePrompts([{ sceneNo: 1 }], {}, OPTS, { runJson })).rejects.toThrow()
  })

  it('groupSrtLines는 GROUPS schema와 guarded prompt를 사용한다', async () => {
    const runJson = vi.fn(async () => ({
      groups: [{ fromLine: 1, toLine: 1, summary: '요약' }],
    }))
    await expect(groupSrtLines(
      [{ lineNo: 1, text: '본문', startTime: 'TIMING_SECRET' }],
      OPTS,
      { runJson },
    )).resolves.toEqual({ groups: [{ fromLine: 1, toLine: 1, summary: '요약' }] })
    expect(runJson.mock.calls[0][0]).toContain('1. 본문')
    expect(runJson.mock.calls[0][0]).toContain('Do not inspect local files')
    expect(runJson.mock.calls[0][0]).not.toContain('TIMING_SECRET')
    expect(runJson.mock.calls[0][1].properties.groups).toBeTruthy()
  })

  it('reviewScenes/reviewPrompts는 Codex JSON runner와 backend guard를 사용한다', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'revise', critique: 'fix' }))
    await expect(reviewScenes('SCRIPT', [{ sceneNo: 1, segments: [] }], [], OPTS, { runJson }))
      .resolves.toEqual({ verdict: 'revise', critique: 'fix' })
    await expect(reviewPrompts([{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }], { scriptMd: 'SCRIPT' }, OPTS, { runJson }))
      .resolves.toEqual({ verdict: 'revise', critique: 'fix' })
    expect(runJson.mock.calls[0][0]).toContain('Do not inspect local files')
    expect(runJson.mock.calls[0][1]).toMatchObject({ type: 'object', additionalProperties: false })
    expect(runJson.mock.calls[0][2]).toEqual({ model: 'gpt-5.5', reasoningEffort: 'high' })
    expect(runJson.mock.calls[1][2]).toEqual({ model: 'gpt-5.5', reasoningEffort: 'high' })
  })

  it('reviseScenes/revisePrompts는 수정 JSON을 검증하고 병합한다', async () => {
    const scenesPayload = {
      scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'narrator', text: '안녕', emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '내레이터' }],
    }
    const runScenesJson = vi.fn(async () => scenesPayload)
    await expect(reviseScenes('SCRIPT', [], [], 'fix', OPTS, { runJson: runScenesJson })).resolves.toEqual(scenesPayload)

    const runPromptsJson = vi.fn(async () => ({ scenes: [{ sceneNo: 1, imagePrompt: 'IMG2', videoPrompt: 'VID2' }] }))
    await expect(revisePrompts([{ sceneNo: 1, storyId: 's1' }], { scriptMd: 'SCRIPT' }, 'fix', OPTS, { runJson: runPromptsJson }))
      .resolves.toEqual({ scenes: [{ sceneNo: 1, storyId: 's1', imagePrompt: 'IMG2', videoPrompt: 'VID2' }] })
  })

  it('reviseScenes는 기존 speaker appearance가 있으면 수정 JSON의 null appearance를 허용한다', async () => {
    const scenesPayload = {
      scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'a', text: '안녕', emotion: 'normal' }] }],
      speakers: [{ id: 'a', name: '민수', appearance: null }],
    }
    const runJson = vi.fn(async () => scenesPayload)
    await expect(reviseScenes('SCRIPT', [], [{ id: 'a', name: '민수', appearance: 'tall man in black coat' }], 'fix', OPTS, { runJson }))
      .resolves.toEqual(scenesPayload)
  })

  it('reviseScenes는 수정 JSON speakers에서 기존 speaker가 빠져도 fallback appearance가 있으면 허용한다', async () => {
    const scenesPayload = {
      scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'a', text: '안녕', emotion: 'normal' }] }],
      speakers: [],
    }
    const runJson = vi.fn(async () => scenesPayload)
    await expect(reviseScenes('SCRIPT', [], [{ id: 'a', name: '민수', appearance: 'tall man in black coat' }], 'fix', OPTS, { runJson }))
      .resolves.toEqual(scenesPayload)
  })
})
