// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

let ipc, sent, dir
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ipc-'))
  ipc = fakeIpcMain()
  sent = []
  const llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (s) => ({ scenes: s })),
  }
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: (ch, p) => sent.push({ ch, p }) }, isDestroyed: () => false }),
    llm,
  })
})

describe('story IPC', () => {
  it('story:open → projectToken 발급 + state 반환', async () => {
    const r = await ipc.invoke('story:open', { projectPath: dir })
    expect(r.projectToken).toBeTruthy()
    expect(r.state.steps.script.status).toBe('pending')
  })
  it('stale token 명령 거부', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:start', { projectToken: 'wrong', step: 'script', params: {} })
    expect(r.error).toBe('stale-token')
  })
  it('start 실행 시 story:state 이벤트가 window로 발신된다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: {} } })
    const stateEvents = sent.filter((e) => e.ch === 'story:state')
    expect(stateEvents.length).toBeGreaterThan(0)
    expect(stateEvents[0].p.projectToken).toBe(projectToken)
  })
  it('재open 시 새 토큰 발급 (이전 토큰 무효)', async () => {
    const a = await ipc.invoke('story:open', { projectPath: dir })
    const b = await ipc.invoke('story:open', { projectPath: dir })
    expect(a.projectToken).not.toBe(b.projectToken)
    const r = await ipc.invoke('story:get-state', { projectToken: a.projectToken })
    expect(r.error).toBe('stale-token')
  })

  it('동시 story:open 호출은 직렬화되어 마지막 토큰만 유효하다', async () => {
    const p1 = ipc.invoke('story:open', { projectPath: dir })
    const p2 = ipc.invoke('story:open', { projectPath: dir })
    const [a, b] = await Promise.all([p1, p2])
    expect(a.projectToken).not.toBe(b.projectToken)
    const stale = await ipc.invoke('story:get-state', { projectToken: a.projectToken })
    expect(stale.error).toBe('stale-token')
    const fresh = await ipc.invoke('story:get-state', { projectToken: b.projectToken })
    expect(fresh.error).toBeUndefined()
  })

  // HIGH/Codex: renderer가 준 projectPath를 무검증으로 사용하면 상대경로나 traversal 경로,
  // 존재하지 않는 경로로도 스텝 머신이 만들어져 임의 파일시스템 위치에 쓰기가 발생할 수 있다.
  it('story:open — 상대경로는 거부한다', async () => {
    const r = await ipc.invoke('story:open', { projectPath: 'relative/path' })
    expect(r.error).toBe('invalid-project-path')
  })

  it('story:open — traversal(".." 세그먼트) 경로는 거부한다', async () => {
    const r = await ipc.invoke('story:open', { projectPath: `${dir}/../../etc` })
    expect(r.error).toBe('invalid-project-path')
  })

  it('story:open — 존재하지 않는 디렉토리는 거부한다', async () => {
    const r = await ipc.invoke('story:open', { projectPath: path.join(dir, 'does-not-exist') })
    expect(r.error).toBe('invalid-project-path')
  })

  it('story:open — 파일(디렉토리 아님) 경로는 거부한다', async () => {
    const { writeFile } = await import('node:fs/promises')
    const filePath = path.join(dir, 'not-a-dir.txt')
    await writeFile(filePath, 'x')
    const r = await ipc.invoke('story:open', { projectPath: filePath })
    expect(r.error).toBe('invalid-project-path')
  })

  it('story:open — projectPath 누락 시 거부한다', async () => {
    const r = await ipc.invoke('story:open', {})
    expect(r.error).toBe('invalid-project-path')
  })

  it('story:open — 검증 통과한 절대경로는 정상적으로 machine을 연다', async () => {
    const r = await ipc.invoke('story:open', { projectPath: dir })
    expect(r.error).toBeUndefined()
    expect(r.projectToken).toBeTruthy()
  })

  // HIGH: projectPath 자체 검증(절대경로/존재)은 통과해도, 활성 workFolder 밖의 임의
  // 디렉토리를 지정하면 그쪽에 story.md/scenes.json 등을 쓸 수 있다 — 렌더러가 activate한
  // workFolder 하위로 범위를 제한한다.
  it('story:open — activeWorkFolder가 설정되면 그 하위가 아닌 경로는 거부한다', async () => {
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'outside-'))
    const workFolder = await mkdtemp(path.join(tmpdir(), 'work-'))
    const ipc2 = fakeIpcMain()
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      llm: { generateScript: vi.fn(), splitScenes: vi.fn(), writePrompts: vi.fn() },
      getActiveWorkFolder: () => workFolder,
    })
    const r = await ipc2.invoke('story:open', { projectPath: outsideDir })
    expect(r.error).toBe('invalid-project-path')
  })

  it('story:open — activeWorkFolder 하위 경로는 정상적으로 연다', async () => {
    const { mkdir } = await import('node:fs/promises')
    const workFolder = await mkdtemp(path.join(tmpdir(), 'work-'))
    const projectDir = path.join(workFolder, 'my-project')
    await mkdir(projectDir)
    const ipc2 = fakeIpcMain()
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      llm: { generateScript: vi.fn(), splitScenes: vi.fn(), writePrompts: vi.fn() },
      getActiveWorkFolder: () => workFolder,
    })
    const r = await ipc2.invoke('story:open', { projectPath: projectDir })
    expect(r.error).toBeUndefined()
    expect(r.projectToken).toBeTruthy()
  })

  it('story:open — activeWorkFolder가 없으면(활성화 전) 기존 검증만 적용한다(하위호환)', async () => {
    // 기본 beforeEach의 ipc는 getActiveWorkFolder를 넘기지 않는다 → 항상 null 취급
    const r = await ipc.invoke('story:open', { projectPath: dir })
    expect(r.error).toBeUndefined()
  })

  // C1-a: audio 스텝은 tts/probe를 필요로 한다(stepMachine.js). story-api가 createStepMachine에
  // 이 둘을 주입하지 않으면 실앱에서 audio가 tts.capabilities() 접근 시 즉시 크래시한다 —
  // M2a-1은 테스트가 직접 machine에 mock을 넣어 통과했을 뿐 IPC 경로엔 배선이 없었다.
  it('story:open이 주입된 tts/probe를 machine에 전달해 audio 스텝이 IPC 경로로 동작한다', async () => {
    const ipc2 = fakeIpcMain()
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('A:' + text), format: 'wav' }) }
    const probe = async () => 7000
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      llm: {
        generateScript: vi.fn(async () => ({ scriptMd: '#' })),
        splitScenes: vi.fn(async () => ({
          scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '한 문장입니다.', emotion: 'normal' }] }],
          speakers: [{ id: 'narrator', name: '나레이션' }],
        })),
        writePrompts: vi.fn(async (s) => ({ scenes: s.map((x) => ({ ...x, imagePrompt: 'i', videoPrompt: 'v' })) })),
      },
      tts,
      probe,
    })
    const { projectToken } = await ipc2.invoke('story:open', { projectPath: dir })
    await ipc2.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: { language: 'ko' } } })
    await ipc2.invoke('story:start', { projectToken, step: 'scenes', params: {} })
    await ipc2.invoke('story:start', { projectToken, step: 'audio', params: { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] } })
    const state = await ipc2.invoke('story:get-state', { projectToken })
    expect(state.steps.audio.status).toBe('done')
  })

  // C1-a(하드 default voice): 실앱 경로는 화자 매핑 UI(M2a-3) 전이라 audio를 speakers 없이 실행한다.
  // story-api가 기본 화자 voice를 주입하지 않으면 audio가 "voice not assigned"로 error → 앱에서 못 돈다.
  // Codex High: 이전 테스트는 speakers를 수동으로 넘겨 이 블로커를 놓쳤다 — speakers 없이 검증한다.
  it('story:start audio를 speakers 없이 실행해도 주입된 기본 voice로 동작한다', async () => {
    const ipc2 = fakeIpcMain()
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('A:' + text), format: 'wav' }) }
    const probe = async () => 7000
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      llm: {
        generateScript: vi.fn(async () => ({ scriptMd: '#' })),
        splitScenes: vi.fn(async () => ({
          scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '한 문장입니다.', emotion: 'normal' }] }],
          speakers: [{ id: 'narrator', name: '나레이션' }],
        })),
        writePrompts: vi.fn(async (s) => ({ scenes: s.map((x) => ({ ...x, imagePrompt: 'i', videoPrompt: 'v' })) })),
      },
      tts,
      probe,
      defaultVoice: { provider: 'typecast', voiceId: 'tc_default' },
    })
    const { projectToken } = await ipc2.invoke('story:open', { projectPath: dir })
    await ipc2.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: { language: 'ko' } } })
    await ipc2.invoke('story:start', { projectToken, step: 'scenes', params: {} })
    await ipc2.invoke('story:start', { projectToken, step: 'audio', params: {} }) // speakers 없음 — 실앱 경로
    const state = await ipc2.invoke('story:get-state', { projectToken })
    expect(state.steps.audio.status).toBe('done')
  })

  it('story:push-ack(ok:false)는 operationId/reason을 버리지 않고 lastPushError로 보존한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: {} } })
    await ipc.invoke('story:start', { projectToken, step: 'scenes', params: {} })
    await ipc.invoke('story:start', { projectToken, step: 'prompts', params: {} })
    const pushEvent = sent.find((e) => e.ch === 'story:pushScenes')

    await ipc.invoke('story:push-ack', {
      projectToken, operationId: 'op-1', pushRevision: pushEvent.p.pushRevision, ok: false, reason: 'save failed',
    })

    const state = await ipc.invoke('story:get-state', { projectToken })
    expect(state.lastPushedRevision).toBe(0)
    expect(state.lastPushError).toMatchObject({ pushRevision: pushEvent.p.pushRevision, reason: 'save failed' })
  })
})
