// @vitest-environment node
// IP5-b/c(M2a-2b): prompts done 후 re-TTS의 push 정책(스펙 §4 표).
// - 멤버십 불변(세그먼트 id 집합 동일): audio가 push 소유 → revision++ + manifest 재스탬프 +
//   timing-only push(프롬프트·이미지 보존). prompts는 done 유지(재실행 강제 안 함).
// - 멤버십 변화(재그룹 경계 이동): audio no-push 대기 전이 → prompts=pending, manifest.pushRevision=null,
//   pendingPushRevision 불변, push 없음. 사용자 prompts 재실행이 full push 소유.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

describe('re-TTS push 정책 (IP5-b/c)', () => {
  let dir, machine, llm, emitted, durById

  const readScenes = async () => JSON.parse(await readFile(path.join(dir, 'story/scenes.json'), 'utf8')).scenes
  const readManifest = async () => JSON.parse(await readFile(path.join(dir, 'story/audio/manifest.json'), 'utf8'))
  const pushes = () => emitted.filter((e) => e.ch === 'story:pushScenes')
  const segId = async (text) => (await readScenes()).flatMap((s) => s.segments).find((g) => g.text === text).id
  const spk = { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-retts-'))
    emitted = []
    durById = {}
    llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: '', segments: [
          { speaker: 'narrator', text: '가', emotion: 'normal' },
          { speaker: 'narrator', text: '나', emotion: 'normal' },
          { speaker: 'narrator', text: '다', emotion: 'normal' },
        ] }],
        speakers: [{ id: 'narrator', name: 'n' }],
      })),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s, i) => ({ ...s, imagePrompt: `img${i}`, videoPrompt: `vid${i}` })) })),
    }
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from(text), format: 'wav' }) }
    const probe = async (fp) => { const m = fp.match(/segments\/(.+)\.\w+$/); return durById[m?.[1]] ?? 7000 }
    machine = createStepMachine({ projectPath: dir, llm, tts, probe, emit: (ch, p) => emitted.push({ ch, p }), getApiKey: () => 'k' })
    await machine.open()
    // 최초 정밀 실행: script→scenes→audio→prompts (prompts가 첫 push rev 소유)
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('audio', spk)
    await machine.start('prompts', {})
  })

  it('멤버십 불변 re-TTS는 audio가 push를 소유(revision++/manifest 재스탬프/timing-only)하고 프롬프트를 보존한다 (IP5-b)', async () => {
    const before = await machine.getState()
    const rev1 = before.pendingPushRevision
    expect(before.steps.prompts.status).toBe('done')

    const id = await segId('가')
    durById[id] = 8000 // 재생성해도 여전히 싱글톤(≥6000) → 멤버십 불변, 타이밍만 변화
    emitted.length = 0
    await machine.start('audio', { ...spk, regenerate: [id] })
    const after = await machine.getState()

    expect(after.pendingPushRevision).toBe(rev1 + 1)          // audio가 revision 소유
    expect(after.steps.prompts.status).toBe('done')           // prompts 재실행 강제 안 함
    expect((await readManifest()).pushRevision).toBe(after.pendingPushRevision) // 재스탬프

    const push = pushes().pop()
    expect(push).toBeTruthy()
    expect(push.p.pushRevision).toBe(after.pendingPushRevision)
    for (const sc of push.p.scenes) expect(sc.prompt).toBeTruthy() // 프롬프트 보존(빈값으로 덮지 않음)
    expect((await readScenes()).every((sc) => sc.imagePrompt)).toBe(true)
  })

  it('멤버십 변화 re-TTS는 no-push 대기 전이(prompts=pending/manifest null/revision 불변/push 없음) (IP5-c)', async () => {
    const before = await machine.getState()
    const rev1 = before.pendingPushRevision

    const idA = await segId('가')
    const idB = await segId('나')
    durById[idA] = 3000; durById[idB] = 3000 // 병합 → 재그룹 경계 이동 → 멤버십 변화
    emitted.length = 0
    await machine.start('audio', { ...spk, regenerate: [idA, idB] })
    const after = await machine.getState()

    expect(after.steps.prompts.status).toBe('pending')        // prompts 재실행 강제
    expect((await readManifest()).pushRevision).toBeNull()     // export 차단
    expect(after.pendingPushRevision).toBe(rev1)              // revision 불변(push 안 함)
    expect(pushes()).toEqual([])                              // audio는 push 안 함
  })
})
