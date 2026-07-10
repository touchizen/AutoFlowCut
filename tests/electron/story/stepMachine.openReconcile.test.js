// @vitest-environment node
// open() 정합성 대조: story.json의 step 상태와 실제 산출물이 어긋나면 상태를 되돌린다.
//
// 진행 상황의 유일한 근거가 story.json의 steps라서, 산출물이 사라져도(폴더 정리·부분 복사 등)
// computeCurrentStep이 done을 믿고 하류 스텝으로 건너뛴다. 그러면 audio/prompts가 제일 먼저
// scenes.json을 열다가 "scenes.json not found — run scenes step first"로 터진다 — 원인에서
// 두 스텝 떨어진 곳에서, 엉뚱한 메시지로.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const DONE = (s) => ({ status: 'done', updatedAt: '2026-07-10T00:00:00.000Z' })

let dir, storyDir
const writeState = (state) => writeFile(path.join(storyDir, 'story.json'), JSON.stringify(state), 'utf-8')
const readState = async () => JSON.parse(await readFile(path.join(storyDir, 'story.json'), 'utf-8'))
const statusOf = (state) => Object.fromEntries(
  Object.entries(state.steps || {}).map(([k, v]) => [k, v.status]),
)

const makeMachine = () => createStepMachine({
  projectPath: dir,
  llm: { generateScript: vi.fn(), splitScenes: vi.fn(), writePrompts: vi.fn(), generateSynopsis: vi.fn() },
  emit: () => {},
  getApiKey: () => 'k',
})

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-reconcile-'))
  storyDir = path.join(dir, 'story')
  await mkdir(storyDir, { recursive: true })
})

describe('open(): step 상태 ↔ 산출물 정합성', () => {
  it('script=done인데 script.md가 없으면 script와 하류를 pending으로 되돌린다', async () => {
    await writeState({
      steps: { script: DONE(), scenes: DONE(), audio: { status: 'pending' }, prompts: { status: 'pending' } },
    })
    const r = await makeMachine().open()
    expect(statusOf(r.state)).toEqual({ script: 'pending', scenes: 'pending', audio: 'pending', prompts: 'pending' })
  })

  it('scenes=done인데 scenes.json이 없으면 scenes와 하류만 되돌리고 script는 유지한다', async () => {
    await writeFile(path.join(storyDir, 'script.md'), '# 대본', 'utf-8')
    await writeState({
      steps: { script: DONE(), scenes: DONE(), audio: DONE(), prompts: DONE() },
    })
    const r = await makeMachine().open()
    expect(statusOf(r.state)).toEqual({ script: 'done', scenes: 'pending', audio: 'pending', prompts: 'pending' })
  })

  // 실제로 사용자가 밟은 상태: script/scenes가 done인데 폴더엔 story.json뿐. audio는 이미 그
  // 예외를 기록해 두었다. 되돌린 뒤 currentStep이 script가 되어 setup [시작]이 다시 동작해야 한다.
  it('보고된 상태(산출물 전무 + audio.error 기록)를 복구해 script부터 다시 시작할 수 있게 한다', async () => {
    await writeState({
      steps: {
        script: DONE(),
        scenes: DONE(),
        audio: { status: 'error', error: 'scenes.json not found — run scenes step first' },
        prompts: { status: 'pending' },
      },
    })
    const r = await makeMachine().open()
    const s = statusOf(r.state)
    expect(s.script).toBe('pending')
    expect(s.scenes).toBe('pending')
    // 되살아난 audio는 stale error를 들고 있으면 안 된다.
    expect(r.state.steps.audio.status).toBe('pending')
    expect(r.state.steps.audio.error).toBeUndefined()
  })

  it('되돌린 상태를 디스크에 영속화한다 (다음 open도 같은 결과)', async () => {
    await writeState({ steps: { script: DONE(), scenes: DONE(), audio: { status: 'pending' }, prompts: { status: 'pending' } } })
    await makeMachine().open()
    expect(statusOf(await readState())).toMatchObject({ script: 'pending', scenes: 'pending' })
  })

  it('산출물이 멀쩡하면 아무것도 건드리지 않는다', async () => {
    await writeFile(path.join(storyDir, 'script.md'), '# 대본', 'utf-8')
    await writeFile(path.join(storyDir, 'scenes.json'), JSON.stringify({ scenes: [{ sceneNo: 1 }] }), 'utf-8')
    await writeState({ steps: { script: DONE(), scenes: DONE(), audio: DONE(), prompts: DONE() } })
    const r = await makeMachine().open()
    expect(statusOf(r.state)).toEqual({ script: 'done', scenes: 'done', audio: 'done', prompts: 'done' })
  })

  it('빈 script.md는 산출물 없음으로 본다', async () => {
    await writeFile(path.join(storyDir, 'script.md'), '   \n', 'utf-8')
    await writeState({ steps: { script: DONE(), scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } } })
    const r = await makeMachine().open()
    expect(statusOf(r.state).script).toBe('pending')
  })

  it('done이 아닌 스텝은 산출물이 없어도 그대로 둔다 (error 상태 보존)', async () => {
    await writeState({
      steps: { script: { status: 'error', error: 'boom' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
    })
    const r = await makeMachine().open()
    expect(r.state.steps.script).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('신규 프로젝트(story.json 없음)에서도 안전하다', async () => {
    const r = await makeMachine().open()
    expect(statusOf(r.state)).toMatchObject({ script: 'pending' })
  })

  // "없다"와 "못 읽었다"는 다르다. 권한/IO 오류로 잠깐 못 읽은 산출물을 없다고 보면 done을
  // pending으로 내리고 그걸 디스크에 굳혀 버린다 — 원인이 사라져도 진행 상태는 안 돌아온다.
  // (여기선 디렉토리를 만들어 EISDIR로 읽기를 실패시킨다. uid와 무관하게 재현된다.)
  describe('읽을 수 없는 산출물은 없는 것으로 보지 않는다', () => {
    it('scenes.json을 읽을 수 없으면 scenes/하류의 done을 유지한다', async () => {
      await writeFile(path.join(storyDir, 'script.md'), '# 대본', 'utf-8')
      await mkdir(path.join(storyDir, 'scenes.json')) // readFile → EISDIR
      await writeState({ steps: { script: DONE(), scenes: DONE(), audio: DONE(), prompts: DONE() } })
      const r = await makeMachine().open()
      expect(statusOf(r.state)).toEqual({ script: 'done', scenes: 'done', audio: 'done', prompts: 'done' })
    })

    it('script.md를 읽을 수 없으면 script/하류의 done을 유지한다', async () => {
      await mkdir(path.join(storyDir, 'script.md'))
      await writeFile(path.join(storyDir, 'scenes.json'), JSON.stringify({ scenes: [{ sceneNo: 1 }] }), 'utf-8')
      await writeState({ steps: { script: DONE(), scenes: DONE(), audio: DONE(), prompts: DONE() } })
      const r = await makeMachine().open()
      expect(statusOf(r.state).script).toBe('done')
    })

    it('되돌리지 않았으니 story.json도 그대로다', async () => {
      await writeFile(path.join(storyDir, 'script.md'), '# 대본', 'utf-8')
      await mkdir(path.join(storyDir, 'scenes.json'))
      await writeState({ steps: { script: DONE(), scenes: DONE(), audio: DONE(), prompts: DONE() } })
      await makeMachine().open()
      expect(statusOf(await readState())).toEqual({ script: 'done', scenes: 'done', audio: 'done', prompts: 'done' })
    })
  })
})
