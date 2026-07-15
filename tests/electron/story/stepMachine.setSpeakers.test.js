// @vitest-environment node
// setSpeakers는 에이전트가 보내는 부분 payload를 받는다. mock state로 검증하면 flush 뒤 실제
// story.json 손실을 놓치므로, 매 테스트가 디스크 정본을 연 real stepMachine을 사용한다.
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'

const narratorVoice = { provider: 'typecast', voiceId: 'tc_narrator' }
const chulsooVoice = { provider: 'typecast', voiceId: 'tc_chulsoo' }
const youngheeVoice = { provider: 'typecast', voiceId: 'tc_younghee' }

const confirmedSpeakers = [
  { id: 'narrator', name: '나레이션', voice: narratorVoice },
  {
    id: '김철수', name: '김철수', voice: chulsooVoice,
    gender: 'male', age: '30대', role: '주인공', appearance: '검은 코트',
  },
  {
    id: '이영희', name: '이영희', voice: youngheeVoice,
    gender: 'female', age: '20대', role: '조력자', appearance: '붉은 머리',
  },
]

const scenes = [{
  storyId: 'story-1',
  sceneNo: 1,
  segments: [
    { id: 'seg-1', type: 'narration', speaker: '김철수', text: '철수의 대사' },
    { id: 'seg-2', type: 'narration', speaker: '이영희', text: '영희의 대사' },
  ],
}]

let dir, machine

async function readStory() {
  return JSON.parse(await readFile(path.join(dir, 'story', 'story.json'), 'utf-8'))
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-set-speakers-'))
  await mkdir(path.join(dir, 'story'), { recursive: true })
  await writeFile(path.join(dir, 'story', 'story.json'), JSON.stringify({
    version: 1,
    input: { type: 'title', title: '테스트' },
    engine: { llm: 'claude' },
    steps: {
      script: { status: 'done' },
      scenes: { status: 'done' },
      audio: { status: 'pending', registration: null },
      prompts: { status: 'pending' },
    },
    charactersConfirmed: true,
    autoRun: false,
    pushedAt: null,
    pendingPushRevision: 0,
    lastPushedRevision: 0,
    speakers: confirmedSpeakers,
  }, null, 2))
  await writeFile(path.join(dir, 'story', 'scenes.json'), JSON.stringify({ scenes }, null, 2))

  machine = createStepMachine({
    projectPath: dir,
    llm: {},
    emit: () => {},
    getApiKey: () => 'k',
    defaultVoice: narratorVoice,
    tts: {
      capabilities: () => ({ maxConcurrency: 2 }),
      synthesize: async () => ({ audio: Buffer.from('audio'), format: 'mp3' }),
    },
    probe: async () => 1000,
  })
  await machine.open()
})

describe('stepMachine.setSpeakers durable roster 보호', () => {
  it('씬이 참조하는 non-narrator가 빠진 부분 roster를 거부하고 story.json 정본을 보존한다', async () => {
    const before = await readStory()

    const result = await machine.setSpeakers({
      speakers: [{ id: '김철수', name: '김철수' }],
    })

    expect(result).toEqual({ error: 'roster-incomplete', speakers: ['이영희'] })
    expect((await readStory()).speakers).toEqual(before.speakers)
  })

  it('완전한 요청 roster는 기존 필드와 누락 voice를 상속하고 명시한 voice만 갱신해 저장한다', async () => {
    const replacementVoice = { provider: 'typecast', voiceId: 'tc_chulsoo_v2' }

    await expect(machine.setSpeakers({
      speakers: [
        { id: '김철수', name: '김철수', voice: replacementVoice },
        { id: '이영희', name: '이영희' },
      ],
    })).resolves.toMatchObject({ ok: true, operationId: expect.any(String) })

    expect((await readStory()).speakers).toEqual([
      { id: 'narrator', name: '나레이션', voice: narratorVoice },
      {
        id: '김철수', name: '김철수', voice: replacementVoice,
        gender: 'male', age: '30대', role: '주인공', appearance: '검은 코트',
      },
      {
        id: '이영희', name: '이영희', voice: youngheeVoice,
        gender: 'female', age: '20대', role: '조력자', appearance: '붉은 머리',
      },
    ])
  })

  it('id/name이 없는 항목은 거부하고 story.json 정본을 보존한다', async () => {
    const before = await readStory()

    await expect(machine.setSpeakers({ speakers: [{}] }))
      .rejects.toThrow('speakers[0].id and name are required')
    expect((await readStory()).speakers).toEqual(before.speakers)
  })
})

describe('agent story_start_step은 화자 설정 경계를 우회하지 않는다', () => {
  it('유효한 grant여도 audio params.speakers를 거부하고 실제 story.json roster를 보존한다', async () => {
    const args = {
      step: 'audio',
      params: { speakers: [{ id: 'HIJACK', name: 'HIJACK' }] },
    }
    const ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
    const core = createToolCore({
      grantLedger: ledger,
      sessionId: 'r1-session',
      projectToken: machine.projectToken,
    })
    core.use({ ...machine, hasProject: () => true })
    ledger.grant({
      nonce: 'r1-valid-grant',
      tool: 'story_start_step',
      argsHash: hashArgs(args),
      sessionId: 'r1-session',
      projectToken: machine.projectToken,
    })
    const before = await readStory()

    const result = await core.call('story_start_step', args, { nonce: 'r1-valid-grant' })

    expect.soft(result).toEqual({
      status: 'rejected',
      reason: 'invalid-params',
      params: ['speakers'],
    })
    expect((await readStory()).speakers).toEqual(before.speakers)
  })
})
