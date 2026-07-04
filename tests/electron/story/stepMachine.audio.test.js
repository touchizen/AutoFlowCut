import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

// I1: audio 스텝의 산출물 쓰기 순서(SRT → manifest → scenes.json)를 검증하기 위해 storyStore를
// 얇게 감싸 saveText 호출 순서를 기록한다. 실제 쓰기는 그대로 위임하므로 다른 테스트의 동작에는
// 영향이 없다.
const writeOrder = vi.hoisted(() => [])
// Codex-2 MED: abort recheck 테스트용 훅 — 특정 relPath 쓰기 직후 콜백을 실행할 수 있게 한다
// (real saveText 완료 후에 호출해 "그 쓰기는 이미 커밋됐고, 그 다음 재체크가 막아야 한다"를 재현).
const afterWriteHooks = vi.hoisted(() => ({ current: null }))
vi.mock('../../../electron/story/storyStore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createStoryStore: (projectPath) => {
      const real = actual.createStoryStore(projectPath)
      return {
        ...real,
        saveText: async (relPath, text) => {
          writeOrder.push(relPath)
          const result = await real.saveText(relPath, text)
          if (afterWriteHooks.current) await afterWriteHooks.current(relPath)
          return result
        },
      }
    },
  }
})

async function tmpProject() { return await mkdtemp(path.join(tmpdir(), 'story-audio-')) }

function makeMachine(projectPath) {
  // scenes.json 세그먼트를 미리 심어두기 위해 store 경유 대신 llm.splitScenes mock 사용은
  // 이 테스트 범위 밖 — audio 스텝만 검증하려 scenes.json을 직접 배치한다.
  const emitted = []
  const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }) }
  const probe = async () => 2000 // 모든 세그먼트 2초로 실측 가정
  const machine = createStepMachine({
    projectPath,
    llm: {},
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
    tts,
    probe,
  })
  return { machine, emitted }
}

describe('audio 스텝', () => {
  let projectPath
  beforeEach(async () => { projectPath = await tmpProject(); writeOrder.length = 0; afterWriteHooks.current = null })

  it('세그먼트 TTS 생성 → 실측 → SRT → 재그룹 → manifest 저장', async () => {
    // scenes.json 준비: narrator 화자 2 세그먼트
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' },
        { id: 's2', type: 'narration', speaker: 'narrator', text: '둘째 문장' },
      ] }],
    }))
    const { machine } = makeMachine(projectPath)
    // 화자 voice 배정
    await machine.open()
    // state.speakers에 narrator voiceId 주입 경로가 필요 — start의 params로 전달
    const res = await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    expect(res.operationId).toBeTruthy()

    // 세그먼트 오디오 파일
    const s1 = await readFile(path.join(projectPath, 'story', 'audio', 'segments', 's1.wav'))
    expect(s1.toString()).toBe('AUDIO:첫 문장')
    // SRT
    const srt = await readFile(path.join(projectPath, 'story', 'audio', 'final.srt'), 'utf-8')
    expect(srt).toContain('첫 문장')
    // manifest: pushRevision null(최초), 세그먼트 startMs 부여
    const manifest = JSON.parse(await readFile(path.join(projectPath, 'story', 'audio', 'manifest.json'), 'utf-8'))
    expect(manifest.pushRevision).toBe(null)
    expect(manifest.segments[0].startMs).toBe(0)
    expect(manifest.segments[1].startMs).toBe(2150) // 2000 + 150 gap
  })

  // HIGH4: 세그먼트 파일 확장자는 어댑터가 반환한 format을 따라야 한다 — .wav 하드코딩 금지
  // (미래 mp3 반환 프로바이더(ElevenLabs 등)가 붙어도 내용≠확장자 불일치가 나지 않게).
  it('세그먼트 파일 확장자는 어댑터가 반환한 format을 따른다(.wav 하드코딩 금지)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [{ id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' }] }],
    }))
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'mp3' }) }
    const probe = async () => 2000
    const machine = createStepMachine({
      projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k', tts, probe,
    })
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'elevenlabs', voiceId: 'el_x' } }] })
    const s1 = await readFile(path.join(projectPath, 'story', 'audio', 'segments', 's1.mp3'))
    expect(s1.toString()).toBe('AUDIO:첫 문장')
  })

  // C1: scenes.json의 내레이션 세그먼트가 id 없이(혹은 중복 id로) 저장돼 있으면 TTS 파일명/
  // results 맵/manifest 키가 undefined로 조용히 붕괴한다 — audio 스텝 진입 시 fail-fast해야 한다.
  it('scenes.json 세그먼트에 id가 없으면 audio 스텝은 즉시 throw한다', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { type: 'narration', speaker: 'narrator', text: '첫 문장' }, // id 없음
      ] }],
    }))
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.error).toMatch(/segment id/)
  })

  it('scenes.json 세그먼트 id가 중복되면 audio 스텝은 즉시 throw한다', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 'dup', type: 'narration', speaker: 'narrator', text: '첫 문장' },
        { id: 'dup', type: 'narration', speaker: 'narrator', text: '둘째 문장' },
      ] }],
    }))
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.error).toMatch(/segment id/)
  })

  // Codex-2 HIGH: segment id가 파일명에 그대로 쓰이는데(audio/segments/${id}.${format}),
  // storyStore.writeAtomic은 경로 포함 검증을 하지 않는다 — id에 `../`가 섞이면 segments 밖으로
  // 쓸 수 있다. audio 진입 시점에 안전 패턴(영숫자/`_`/`-`)이 아닌 id는 즉시 거부해야 하고,
  // TTS/파일쓰기가 전혀 일어나지 않아야 한다.
  it('scenes.json 세그먼트 id가 안전 패턴(영숫자/_/-)을 벗어나면 audio 스텝은 즉시 throw하고 TTS를 호출하지 않는다', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: '../evil', type: 'narration', speaker: 'narrator', text: '첫 문장' },
      ] }],
    }))
    const synthesize = vi.fn(async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }))
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize }
    const probe = async () => 2000
    const machine = createStepMachine({
      projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k', tts, probe,
    })
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.error).toMatch(/segment id/)
    expect(state.steps.audio.error).toMatch(/evil/)
    expect(synthesize).not.toHaveBeenCalled()
    // segments 디렉터리 밖으로 아무 파일도 써지지 않았어야 한다
    const evilPath = path.join(projectPath, 'evil.wav')
    await expect(readFile(evilPath)).rejects.toThrow()
  })

  it('세그먼트 id에 슬래시가 섞여도(a/b) audio 스텝은 즉시 throw한다', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 'a/b', type: 'narration', speaker: 'narrator', text: '첫 문장' },
      ] }],
    }))
    const synthesize = vi.fn(async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }))
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize }
    const probe = async () => 2000
    const machine = createStepMachine({
      projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k', tts, probe,
    })
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.error).toMatch(/segment id/)
    expect(synthesize).not.toHaveBeenCalled()
  })

  // Codex-2 MED: signal.aborted는 최종 쓰기 시퀀스 시작 전 한 번만 체크됐다 — abort가
  // final.srt 쓰기와 manifest.json 쓰기 사이에 도착하면 이후 커밋들이 그대로 진행됐다.
  // 각 최종 커밋 직전에 재체크해야 한다. afterWriteHooks로 final.srt 쓰기 "직후"(이미 커밋된 뒤)
  // machine.abort()를 걸어, 그 다음 재체크가 manifest.json/scenes.json 쓰기를 막는지 검증한다.
  it('final.srt 쓰기 직후 abort되면 manifest.json/scenes.json은 쓰이지 않는다 (각 커밋 직전 재체크)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [{ id: 's1', type: 'narration', speaker: 'narrator', text: 'x' }] }],
    }))
    const { machine } = makeMachine(projectPath)
    afterWriteHooks.current = async (relPath) => {
      if (relPath === 'audio/final.srt') await machine.abort()
    }
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })

    expect(writeOrder).toContain('audio/final.srt')
    expect(writeOrder).not.toContain('audio/manifest.json')
    // scenes.json은 audio 스텝 시작 전 setup 단계에서 한 번 쓰였다(위 writeFile) — audio 스텝의
    // 최종 커밋 재쓰기는 없어야 하므로 writeOrder에는 딱 1번만 나타나야 한다(스텝 내부 mock 경유분 0회).
    const scenesWritesDuringStep = writeOrder.filter((p) => p === 'scenes.json').length
    expect(scenesWritesDuringStep).toBe(0)
    // 디스크상 scenes.json도 원본(pre-audio) 그대로 — finalScenes로 덮어써지지 않았다
    const scenesOnDisk = JSON.parse(await readFile(path.join(projectPath, 'story', 'scenes.json'), 'utf-8'))
    expect(scenesOnDisk.scenes[0].segments[0].id).toBe('s1')
    expect(scenesOnDisk.scenes[0].storyId).toBeUndefined() // finalScenes였다면 storyId가 부여됐을 것

    const manifestExists = await readFile(path.join(projectPath, 'story', 'audio', 'manifest.json')).then(() => true, () => false)
    expect(manifestExists).toBe(false)

    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.error).toBe('aborted')
  })

  it('audio 완료 시 steps.audio.status=done, prompts는 pending 리셋', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [{ id: 's1', type: 'narration', speaker: 'narrator', text: 'x' }] }],
    }))
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('done')
    expect(state.steps.prompts.status).toBe('pending')
  })

  // I1: 스펙 §5 write safety — "세그먼트 파일 쓰기 완료 → manifest atomic write → scenes.json
  // atomic write → story.json flush". manifest가 scenes.json보다 먼저 확정돼야 크래시가
  // 스텝 사이에서 나도 "새 씬 + 옛 manifest" 조합이 남지 않는다(manifest가 항상 먼저 있거나
  // 함께 없다).
  it('manifest.json은 scenes.json보다 먼저 쓰인다 (스펙 §5 write order)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [{ id: 's1', type: 'narration', speaker: 'narrator', text: 'x' }] }],
    }))
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })

    const manifestIdx = writeOrder.indexOf('audio/manifest.json')
    const scenesIdx = writeOrder.indexOf('scenes.json')
    expect(manifestIdx).toBeGreaterThanOrEqual(0)
    expect(scenesIdx).toBeGreaterThanOrEqual(0)
    expect(manifestIdx).toBeLessThan(scenesIdx)
  })

  // I2: probe가 0을 반환하는 건 측정 실패의 안전값 합의다 — 실제로 파일이 써졌는데 0으로
  // 나오면 그대로 받아들이지 말고(SRT 0ms 줄·클립 겹침·manifest.durationMs=0 ≠ 실제 wav 길이)
  // 재시도 유도를 위해 스텝을 명확한 에러로 실패시켜야 한다.
  it('narration 세그먼트 실측이 0ms면 audio 스텝은 즉시 실패한다(0 accept 금지)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' },
        { id: 's2', type: 'narration', speaker: 'narrator', text: '둘째 문장' },
      ] }],
    }))
    const emitted = []
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }) }
    const probe = async (filePath) => (filePath.includes('s2') ? 0 : 2000) // s2 측정 실패 시뮬레이션
    const machine = createStepMachine({
      projectPath, llm: {}, emit: (ch, payload) => emitted.push({ ch, payload }), getApiKey: () => 'k', tts, probe,
    })
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    // M2a-2b: probe 0은 해당 세그먼트를 실패로 표시하고 스텝을 실패시킨다(부분재시도: 성공분은 done 영속).
    expect(state.steps.audio.error).toMatch(/audio failed for segment/)
    expect(state.steps.audio.error).toMatch(/s2/)
    // 성공분(s1)은 done으로 영속돼 재실행 시 재사용된다(전체 재-TTS 아님).
    const persisted = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(projectPath, 'story', 'scenes.json'), 'utf8'))
    const seg1 = persisted.scenes.flatMap((s) => s.segments).find((g) => g.id === 's1')
    expect(seg1.status).toBe('done')
  })

  // Minor M2: 미배정 화자가 있으면 배치 루프를 시작하기 전에 즉시 실패해야 한다 —
  // 루프 중간에 던지면 이미 앞선 세그먼트들의 TTS 비용을 지불한 뒤다(스펙 §6).
  it('미배정 화자가 있으면 TTS 호출 전에 즉시 throw한다 (사전 검증)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' },
        { id: 's2', type: 'narration', speaker: 'ghost', text: '둘째 문장' }, // ghost 화자는 미배정
      ] }],
    }))
    const synthesize = vi.fn(async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }))
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize }
    const probe = async () => 2000
    const machine = createStepMachine({
      projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k', tts, probe,
    })
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.error).toMatch(/ghost/)
    // s1(narrator)은 배정돼 있어도 s2(ghost) 검증 실패로 아예 호출되면 안 됨 — 비용 낭비 방지
    expect(synthesize).not.toHaveBeenCalled()
  })

  // Codex-3 LOW: 화자의 voice 객체가 존재해도 voiceId가 없으면(또는 빈 문자열이면) 사전
  // 검증이 통과해 루프 중간에 tts.synthesize(voiceId:undefined)로 낭비된다 —
  // voiceId가 non-empty string인지 확인해야 한다(발급된 id는 그런 특성을 가짐).
  it('voice 객체가 있어도 voiceId가 없으면 TTS 호출 전에 즉시 throw한다 (말형 voice 검증)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' },
      ] }],
    }))
    const synthesize = vi.fn(async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }))
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize }
    const probe = async () => 2000
    const machine = createStepMachine({
      projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k', tts, probe,
    })
    await machine.open()
    // narrator에 voice는 주어졌으나 voiceId가 없다 — 말형 voice 객체
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.error).toMatch(/narrator/)
    expect(state.steps.audio.error).toMatch(/voice not assigned/)
    // 사전 검증에서 실패했으므로 TTS가 전혀 호출되면 안 됨
    expect(synthesize).not.toHaveBeenCalled()
  })

  // Codex-3 LOW: voiceId가 빈 문자열('')인 경우도 마찬가지로 사전 검증에서 거부돼야 한다.
  it('voiceId가 빈 문자열이면 TTS 호출 전에 즉시 throw한다', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' },
      ] }],
    }))
    const synthesize = vi.fn(async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }))
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize }
    const probe = async () => 2000
    const machine = createStepMachine({
      projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k', tts, probe,
    })
    await machine.open()
    // narrator의 voiceId가 빈 문자열
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: '' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.error).toMatch(/narrator/)
    expect(state.steps.audio.error).toMatch(/voice not assigned/)
    expect(synthesize).not.toHaveBeenCalled()
  })
})
