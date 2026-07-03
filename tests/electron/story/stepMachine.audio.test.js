import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

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
  beforeEach(async () => { projectPath = await tmpProject() })

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
})
