import { describe, it, expect } from 'vitest'
import { splitScenes, writePrompts } from '../../../../electron/api/llm/llmClaude.js'

const SCENES = { scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'narrator', text: 'hi' }] }], speakers: [{ id: 'narrator', name: '내레이터' }] }

function resultOf(msg) { return async function* () { yield msg } }

describe('llmClaude.splitScenes', () => {
  it('structured_output을 그대로 사용', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: SCENES })
    const out = await splitScenes('SCRIPT', { language: 'ko' }, { queryImpl })
    expect(out.scenes[0].sceneNo).toBe(1)
    expect(out.speakers[0].id).toBe('narrator')
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
})
