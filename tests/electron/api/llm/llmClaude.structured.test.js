import { describe, it, expect, vi } from 'vitest'
import {
  splitScenes,
  writePrompts,
  groupSrtLines,
  reviewScript,
  reviseScript,
  reviewScenes,
  reviseScenes,
  reviewPrompts,
  revisePrompts,
} from '../../../../electron/api/llm/llmClaude.js'

const SCENES = { scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'narrator', text: 'hi' }] }], speakers: [{ id: 'narrator', name: '내레이터' }] }

function resultOf(msg) { return async function* () { yield msg } }

describe('llmClaude.splitScenes', () => {
  it('structured_output을 그대로 사용', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: SCENES })
    const out = await splitScenes('SCRIPT', { language: 'ko' }, { queryImpl })
    expect(out.scenes[0].sceneNo).toBe(1)
    expect(out.speakers[0].id).toBe('narrator')
  })
  it('reasoningEffort를 structured Claude SDK query options로 전달한다', async () => {
    const queryImpl = vi.fn(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: SCENES }
    })
    await splitScenes('SCRIPT', { model: 'claude-sonnet-5', reasoningEffort: 'max' }, { queryImpl })
    expect(queryImpl.mock.calls[0][0].options).toMatchObject({
      model: 'claude-sonnet-5',
      thinking: { type: 'adaptive' },
      effort: 'max',
      outputFormat: expect.objectContaining({ type: 'json_schema' }),
    })
    expect(queryImpl.mock.calls[0][0].options).not.toHaveProperty('reasoningEffort')
  })
  it('structured 없으면 result 텍스트(코드펜스 포함)를 파싱', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, result: '```json\n' + JSON.stringify(SCENES) + '\n```' })
    const out = await splitScenes('SCRIPT', { language: 'ko' }, { queryImpl })
    expect(out.scenes[0].summary).toBe('S')
  })
  it('retries 에러면 outputFormat 없는 재요청으로 폴백', async () => {
    let call = 0
    const queryImpl = async function* (args) {
      call += 1
      if (call === 1) { yield { type: 'result', subtype: 'error_max_structured_output_retries', errors: [] }; return }
      yield { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(SCENES) }
    }
    const out = await splitScenes('SCRIPT', {}, { queryImpl })
    expect(call).toBe(2)
    expect(out.scenes.length).toBe(1)
  })
  it('폴백 경로에서 result가 {} 이면 스키마 검증 실패로 throw', async () => {
    let call = 0
    const queryImpl = async function* () {
      call += 1
      if (call === 1) { yield { type: 'result', subtype: 'error_max_structured_output_retries', errors: [] }; return }
      yield { type: 'result', subtype: 'success', is_error: false, result: '{}' }
    }
    await expect(splitScenes('SCRIPT', {}, { queryImpl })).rejects.toThrow(/structured output/)
    expect(call).toBe(2)
  })
  it('Fix A: sceneNo가 문자열이면 INTEGER 타입 검증 실패로 throw', async () => {
    let call = 0
    const bad = { scenes: [{ sceneNo: '1', summary: 'S', segments: [{ speaker: 'narrator', text: 'hi' }] }], speakers: [{ id: 'narrator', name: '내레이터' }] }
    const queryImpl = async function* () {
      call += 1
      if (call === 1) { yield { type: 'result', subtype: 'success', is_error: false, structured_output: bad }; return }
      yield { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(bad) }
    }
    await expect(splitScenes('SCRIPT', {}, { queryImpl })).rejects.toThrow(/expected integer/)
    expect(call).toBe(2)
  })
  it('M2b: sfx 세그먼트(type/description)가 그대로 통과한다', async () => {
    const withSfx = { scenes: [{ sceneNo: 1, summary: 'S', segments: [
      { speaker: 'narrator', text: '문이 열렸다' },
      { type: 'sfx', description: 'door creaking open' },
    ] }], speakers: [{ id: 'narrator', name: '내레이터' }] }
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: withSfx })
    const out = await splitScenes('SCRIPT', {}, { queryImpl })
    expect(out.scenes[0].segments[1]).toMatchObject({ type: 'sfx', description: 'door creaking open' })
  })
  it('M2b: sfx인데 description이 없으면 post-validation으로 throw', async () => {
    let call = 0
    const bad = { scenes: [{ sceneNo: 1, summary: 'S', segments: [{ type: 'sfx' }] }], speakers: [] }
    const queryImpl = async function* () {
      call += 1
      // structured/fallback 둘 다 같은 bad → post-validation이 최종적으로 throw
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: bad }
    }
    await expect(splitScenes('SCRIPT', {}, { queryImpl })).rejects.toThrow(/sfx/)
  })
})

describe('llmClaude.writePrompts', () => {
  it('sceneNo로 image/videoPrompt를 병합', async () => {
    const scenes = [{ sceneNo: 1, storyId: 'a', summary: 'S' }]
    const structured = { scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: structured })
    const out = await writePrompts(scenes, {}, {}, { queryImpl })
    expect(out.scenes[0].imagePrompt).toBe('IMG')
    expect(out.scenes[0].videoPrompt).toBe('VID')
  })
  it('imagePrompt/videoPrompt 누락이면 1차 검증 실패→폴백→2차 검증 실패로 throw', async () => {
    let call = 0
    const invalid = { scenes: [{ sceneNo: 1 }] }
    const queryImpl = async function* () {
      call += 1
      if (call === 1) { yield { type: 'result', subtype: 'success', is_error: false, structured_output: invalid }; return }
      yield { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(invalid) }
    }
    await expect(writePrompts([{ sceneNo: 1 }], {}, {}, { queryImpl })).rejects.toThrow(/structured output/)
    expect(call).toBe(2)
  })
  it('Fix A: sceneNo가 문자열이면 INTEGER 타입 검증 실패로 throw', async () => {
    let call = 0
    const bad = { scenes: [{ sceneNo: '1', imagePrompt: 'IMG', videoPrompt: 'VID' }] }
    const queryImpl = async function* () {
      call += 1
      if (call === 1) { yield { type: 'result', subtype: 'success', is_error: false, structured_output: bad }; return }
      yield { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(bad) }
    }
    await expect(writePrompts([{ sceneNo: 1 }], {}, {}, { queryImpl })).rejects.toThrow(/expected integer/)
    expect(call).toBe(2)
  })
  it('Fix B: 입력 씬이 있는데 결과가 빈 배열이면 커버리지 계약 위반으로 throw', async () => {
    const empty = { scenes: [] }
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: empty })
    await expect(writePrompts([{ sceneNo: 1 }], {}, {}, { queryImpl })).rejects.toThrow(/scene 1 missing\/empty prompt/)
  })
  it('Fix B: 입력 씬 일부만 커버해도 throw', async () => {
    const partial = { scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: partial })
    await expect(writePrompts([{ sceneNo: 1 }, { sceneNo: 2 }], {}, {}, { queryImpl })).rejects.toThrow(/scene 2 missing\/empty prompt/)
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
    ['empty prompt', [{ sceneNo: 1, imagePrompt: '', videoPrompt: 'VID' }]],
    ['zero sceneNo', [{ sceneNo: 0, imagePrompt: 'IMG', videoPrompt: 'VID' }]],
  ])('Map 전에 %s를 거부한다', async (_label, rawScenes) => {
    const queryImpl = resultOf({
      type: 'result', subtype: 'success', is_error: false, structured_output: { scenes: rawScenes },
    })
    await expect(writePrompts([{ sceneNo: 1 }], {}, {}, { queryImpl })).rejects.toThrow()
  })
})

describe('llmClaude.groupSrtLines', () => {
  it('GROUPS structured call 결과를 반환한다', async () => {
    const queryImpl = vi.fn(async function* (args) {
      expect(args.prompt).toContain('1. 본문')
      expect(args.prompt).not.toContain('TIMING_SECRET')
      expect(args.options.outputFormat.schema.properties.groups).toBeTruthy()
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: { groups: [{ fromLine: 1, toLine: 1, summary: '요약' }] },
      }
    })
    await expect(groupSrtLines(
      [{ lineNo: 1, text: '본문', startTime: 'TIMING_SECRET' }],
      {},
      { queryImpl },
    )).resolves.toEqual({ groups: [{ fromLine: 1, toLine: 1, summary: '요약' }] })
  })
})

describe('llmClaude.reviewScript (M3)', () => {
  const R = (msg) => async function* () { yield msg }
  it('structured verdict/critique를 반환', async () => {
    const queryImpl = R({ type: 'result', subtype: 'success', is_error: false, structured_output: { verdict: 'revise', critique: '도입이 약함' } })
    const out = await reviewScript('대본', {}, { queryImpl })
    expect(out).toEqual({ verdict: 'revise', critique: '도입이 약함', score: null })
  })
  it("verdict가 pass/revise 외 값이면 'pass'로 정규화", async () => {
    const queryImpl = R({ type: 'result', subtype: 'success', is_error: false, structured_output: { verdict: 'maybe', critique: '' } })
    const out = await reviewScript('대본', {}, { queryImpl })
    expect(out.verdict).toBe('pass')
  })
  it('몰입도 중심 루브릭을 쓰고 장르 metaPrompt를 프롬프트에 넣지 않는다', async () => {
    let promptText = ''
    const queryImpl = async function* (args) {
      promptText = args.prompt
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: { verdict: 'pass', critique: '' } }
    }
    await reviewScript('대본', { metaPrompt: '야담 전용 공식', genre: 'yadam' }, { queryImpl })
    expect(promptText).toContain('궁금증')
    expect(promptText).toContain('기대감')
    expect(promptText).not.toContain('야담 전용 공식')
  })
})

describe('llmClaude.reviseScript (M3)', () => {
  it('NON-streaming으로 개선된 scriptMd 반환(onDelta 미사용)', async () => {
    const queryImpl = async function* () { yield { type: 'result', subtype: 'success', is_error: false, result: '개선된 대본' } }
    const out = await reviseScript('원본', '도입 강화', {}, { queryImpl })
    expect(out.scriptMd).toBe('개선된 대본')
  })
})

describe('llmClaude scenes/prompts review controls', () => {
  it('reviewScenes는 verdict/critique를 반환한다', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: { verdict: 'revise', critique: '씬 2가 너무 김' } })
    const out = await reviewScenes('SCRIPT', SCENES.scenes, SCENES.speakers, {}, { queryImpl })
    expect(out).toEqual({ verdict: 'revise', critique: '씬 2가 너무 김' })
  })
  it('reviseScenes는 revised scenes/speakers를 반환하고 세그먼트를 검증한다', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: SCENES })
    const out = await reviseScenes('SCRIPT', SCENES.scenes, SCENES.speakers, 'fix', {}, { queryImpl })
    expect(out.scenes[0].sceneNo).toBe(1)
    expect(out.speakers[0].id).toBe('narrator')
  })
  it('reviewPrompts는 verdict/critique를 반환한다', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: { verdict: 'pass', critique: '' } })
    const out = await reviewPrompts([{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }], { scriptMd: 'SCRIPT' }, {}, { queryImpl })
    expect(out).toEqual({ verdict: 'pass', critique: '' })
  })
  it('revisePrompts는 sceneNo 기준 prompt 필드를 병합한다', async () => {
    const scenes = [{ sceneNo: 1, storyId: 's1', imagePrompt: 'old', videoPrompt: 'old' }]
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: { scenes: [{ sceneNo: 1, imagePrompt: 'IMG2', videoPrompt: 'VID2' }] } })
    const out = await revisePrompts(scenes, { scriptMd: 'SCRIPT' }, 'fix prompts', {}, { queryImpl })
    expect(out.scenes).toEqual([{ sceneNo: 1, storyId: 's1', imagePrompt: 'IMG2', videoPrompt: 'VID2' }])
  })
})

describe('llmClaude.splitScenes appearance 통과(V2)', () => {
  it('speakers[].appearance가 그대로 반환된다', async () => {
    const withApp = { scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'a', text: 'hi' }] }], speakers: [{ id: 'a', name: '민수', appearance: 'tall man' }] }
    const queryImpl = async function* () { yield { type: 'result', subtype: 'success', is_error: false, structured_output: withApp } }
    const out = await splitScenes('SCRIPT', {}, { queryImpl })
    expect(out.speakers[0].appearance).toBe('tall man')
  })
})
