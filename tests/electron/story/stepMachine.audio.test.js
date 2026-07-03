import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

// I1: audio 스텝의 산출물 쓰기 순서(SRT → manifest → scenes.json)를 검증하기 위해 storyStore를
// 얇게 감싸 saveText 호출 순서를 기록한다. 실제 쓰기는 그대로 위임하므로 다른 테스트의 동작에는
// 영향이 없다.
const writeOrder = vi.hoisted(() => [])
vi.mock('../../../electron/story/storyStore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createStoryStore: (projectPath) => {
      const real = actual.createStoryStore(projectPath)
      return {
        ...real,
        saveText: (relPath, text) => { writeOrder.push(relPath); return real.saveText(relPath, text) },
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
  beforeEach(async () => { projectPath = await tmpProject(); writeOrder.length = 0 })

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
    expect(state.steps.audio.error).toMatch(/audio measurement failed/)
    expect(state.steps.audio.error).toMatch(/s2/)
  })
})
