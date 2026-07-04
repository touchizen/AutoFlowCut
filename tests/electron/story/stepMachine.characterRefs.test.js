// @vitest-environment node
// V2: 스토리 캐릭터 → 씬 characters 태그(id→name) + push storyCharacters(appearance) + appearance 승계.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

describe('stepMachine 캐릭터 레퍼런스 브리지 (V2)', () => {
  let dir, machine, llm, emitted
  const pushes = () => emitted.filter((e) => e.ch === 'story:pushScenes')
  const lastPush = () => pushes()[pushes().length - 1].p

  const splitOut = (speakers) => ({
    scenes: [{ sceneNo: 1, summary: '', segments: [
      { speaker: 'narrator', text: '한밤중이었다', emotion: 'normal' },
      { speaker: 'a', text: '누구세요?', emotion: 'normal' },
    ] }],
    speakers,
  })

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-charref-'))
    emitted = []
    llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => splitOut([
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ])),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s, i) => ({ ...s, imagePrompt: `img${i}`, videoPrompt: `vid${i}` })) })),
    }
    machine = createStepMachine({ projectPath: dir, llm, emit: (ch, p) => emitted.push({ ch, p }), getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
  })

  it('mapScene가 segment speaker id(a)를 speaker.name(민수)으로 변환해 씬 characters에 넣는다(narrator 제외)', () => {
    const scene = lastPush().scenes[0]
    expect(scene.characters).toBe('민수')
  })

  it('push 페이로드에 storyCharacters(appearance 있는 non-narrator)가 실린다', () => {
    const p = lastPush()
    expect(p.storyCharacters).toEqual([{ name: '민수', appearance: 'tall man in black coat' }])
  })

  it('appearance 없는 speaker는 태그/카드에서 제외(narrator 및 무외형 단역)', async () => {
    // narrator는 appearance 없음 → 태그/스토리캐릭터 제외 확인(위에서 민수만)
    expect(lastPush().scenes[0].characters).not.toContain('narrator')
    expect(lastPush().storyCharacters.some((c) => c.name === 'narrator')).toBe(false)
  })

  it('writePrompts에 speakers(appearance)가 컨텍스트로 전달된다', () => {
    const ctxArg = llm.writePrompts.mock.calls[0][1]
    expect(ctxArg.speakers.find((s) => s.id === 'a').appearance).toBe('tall man in black coat')
  })

  it('재실행 시 appearance는 이전 값 승계(생성된 카드와 텍스트 일관)', async () => {
    // 두 번째 scenes: 같은 이름 민수인데 LLM이 다른 외형을 반환 → 이전 값 유지
    llm.splitScenes.mockResolvedValueOnce(splitOut([
      { id: 'narrator', name: 'narrator' },
      { id: 'a', name: '민수', appearance: 'short woman in red' },
    ]))
    await machine.start('scenes', {})
    const st = await machine.getState()
    expect(st.speakers.find((s) => s.name === '민수').appearance).toBe('tall man in black coat')
  })
})
