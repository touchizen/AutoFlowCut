// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdir, mkdtemp, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'
import { defaultStoryState } from '../../../electron/story/storyStore.js'
import { ProviderAuthError, MissingProviderKeyError } from '../../../electron/api/keyErrors.js'
import { resolveWorkflowProjectContext } from '../../../electron/ipc/workflowProjectContext.js'

// manifest 를 심는 픽스처는 audio 스텝이 성공한 상태여야 현실과 맞는다 — manifest 는 조립
// (전체 성공) 경로에서만 쓰인다. done 이 아닌데 manifest 가 남은 경우는 옛 실행의 잔재라
// readAudioPackage 가 export 를 막는다(stepMachine.loadAudioPackage.test.js 가 그쪽을 본다).
const audioDoneState = (lastPushedRevision) => {
  const base = defaultStoryState()
  return { ...base, lastPushedRevision, steps: { ...base.steps, audio: { ...base.steps.audio, status: 'done' } } }
}

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

let ipc, sent, dir, llm
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ipc-'))
  ipc = fakeIpcMain()
  sent = []
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (s) => ({ scenes: s })),
    generateTitle: vi.fn(async () => ({ title: '자동제목' })),
  }
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: (ch, p) => sent.push({ ch, p }) }, isDestroyed: () => false }),
    getActiveWorkFolder: () => path.dirname(dir),
    llm,
    // 실제 CLI/app-server 를 띄우지 않는다. []는 "조회 실패" → 정적 카탈로그 폴백.
    listClaudeModels: async () => [],
    listCodexModels: async () => [],
  })
})

describe('story IPC', () => {
  it('story:list-llm-options → Story LLM catalog 반환', async () => {
    const r = await ipc.invoke('story:list-llm-options', {})
    expect(r.defaultOption).toMatchObject({ id: 'claude:claude-opus-4-8' })
    expect(r.options.map((o) => o.id)).toEqual([
      'claude:claude-opus-4-8',
      'claude:claude-sonnet-5',
      'claude:claude-fable-5',
      'claude:claude-haiku-4-5',
      'codex:gpt-5.5',
      'codex:gpt-5.4',
    ])
  })

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
  it('story:generate-title은 renderer options를 machine에 전달한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    const options = { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'xhigh', language: 'ko' }
    const r = await ipc.invoke('story:generate-title', { projectToken, scriptMd: '대본', options })
    expect(r).toEqual({ title: '자동제목' })
    // 세 번째 인자는 DI seam — signal 이 실려야 abort() 가 이 호출을 잡는다. 예전엔 `{}` 였고,
    // 그래서 프로젝트 전환이 진행 중 제목 생성을 넘겨받았다.
    expect(llm.generateTitle).toHaveBeenCalledWith(
      '대본',
      expect.objectContaining(options),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
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

  it('story:open — main work-folder context가 없으면 fail-closed한다', async () => {
    const ipc2 = fakeIpcMain()
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => null,
      getActiveWorkFolder: () => null,
      llm,
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
    })

    const r = await ipc2.invoke('story:open', { projectPath: dir })

    expect(r).toEqual({ error: 'project-context-not-ready' })
  })

  it('story:open — getActiveWorkFolder가 throw해도 reject 대신 {error}로 fail-closed한다 (R3 F1)', async () => {
    // getVerifiedContext 로 승격된 getActiveWorkFolder 는 미확정/폴더삭제(ENOENT)/identity 불일치에
    // throw 한다. throw 가 open/IPC 로 새면 invoke reject → renderer unhandled rejection + 침묵 죽은 뷰.
    const ipc2 = fakeIpcMain()
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => null,
      getActiveWorkFolder: () => { throw new Error('ENOENT: work folder deleted') },
      llm,
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
    })

    // reject 하면 이 await 가 throw → 테스트 실패. {error} 계약이 유지돼야 한다.
    const r = await ipc2.invoke('story:open', { projectPath: dir })

    expect(r).toEqual({ error: 'project-context-not-ready' })
  })

  it('story:open — work folder 내부 symlink가 외부를 가리키면 realpath containment로 거부한다', async () => {
    const workFolder = await mkdtemp(path.join(tmpdir(), 'story-symlink-work-'))
    const outside = await mkdtemp(path.join(tmpdir(), 'story-symlink-outside-'))
    await writeFile(path.join(outside, 'project.json'), JSON.stringify({ workflowType: 'story' }))
    const linkedProject = path.join(workFolder, 'linked-project')
    await symlink(outside, linkedProject, 'dir')
    const ipc2 = fakeIpcMain()
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => null,
      getActiveWorkFolder: () => workFolder,
      llm,
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
    })

    const r = await ipc2.invoke('story:open', { projectPath: linkedProject })

    expect(r).toEqual({ error: 'invalid-project-path' })
  })

  it('workflow context는 work-folder와 project directory의 dev/ino identity를 snapshot한다', async () => {
    const workFolder = await mkdtemp(path.join(tmpdir(), 'story-identity-work-'))
    const projectDir = path.join(workFolder, 'identity-project')
    await mkdir(projectDir)
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify({ workflowType: 'story' }))

    const context = await resolveWorkflowProjectContext({
      projectPath: projectDir,
      getActiveWorkFolder: () => workFolder,
      expectedWorkflowType: 'story',
    })
    const [workInfo, projectInfo] = await Promise.all([stat(workFolder), stat(projectDir)])

    expect(context.workFolderIdentity).toEqual({ dev: workInfo.dev, ino: workInfo.ino })
    expect(context.projectIdentity).toEqual({ dev: projectInfo.dev, ino: projectInfo.ino })
  })

  it('workflow context는 verified work-folder authority context를 입력으로 받는다', async () => {
    const workFolder = await mkdtemp(path.join(tmpdir(), 'story-authority-context-'))
    const projectDir = path.join(workFolder, 'project')
    await mkdir(projectDir)
    const workInfo = await stat(workFolder)

    const context = await resolveWorkflowProjectContext({
      projectPath: projectDir,
      getActiveWorkFolder: () => ({
        path: workFolder,
        identity: { dev: workInfo.dev, ino: workInfo.ino },
      }),
      expectedWorkflowType: 'story',
    })

    expect(context.error).toBeUndefined()
    expect(context.workFolderIdentity).toEqual({ dev: workInfo.dev, ino: workInfo.ino })
  })

  it('validated project path가 같은 문자열의 다른 inode로 교체되면 revalidate가 거부한다', async () => {
    const workFolder = await mkdtemp(path.join(tmpdir(), 'story-project-rebind-'))
    const projectDir = path.join(workFolder, 'project')
    const moved = path.join(workFolder, 'original-project')
    await mkdir(projectDir)
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify({ workflowType: 'story' }))
    const context = await resolveWorkflowProjectContext({
      projectPath: projectDir,
      getActiveWorkFolder: () => workFolder,
      expectedWorkflowType: 'story',
    })

    const contextModule = await import('../../../electron/ipc/workflowProjectContext.js')
    expect(contextModule.revalidateWorkflowProjectContext).toBeTypeOf('function')
    await import('node:fs/promises').then(({ rename }) => rename(projectDir, moved))
    await mkdir(projectDir)
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify({ workflowType: 'story' }))

    await expect(contextModule.revalidateWorkflowProjectContext(context))
      .resolves.toEqual({ error: 'invalid-project-path' })
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
      getActiveWorkFolder: () => path.dirname(dir),
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
      getActiveWorkFolder: () => path.dirname(dir),
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

  // M2a-4 IP-A2: export(renderer)가 story 나레이션 배치에 쓸 { manifest, lastPushedRevision }.
  // guarded 아님 — export 는 projectToken 없이 현재 열린 프로젝트 것을 로드한다.
  it('story:load-audio-package — 열린 machine의 manifest+lastPushedRevision 반환', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.join(dir, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'audio', 'manifest.json'),
      JSON.stringify({ version: 1, pushRevision: 2, segments: [{ id: 's1', type: 'narration', audioPath: '/p/story/audio/segments/s1.wav', startMs: 0, durationMs: 500 }] }))
    await writeFile(path.join(dir, 'story', 'story.json'),
      JSON.stringify(audioDoneState(2)))
    await ipc.invoke('story:open', { projectPath: dir })
    const pkg = await ipc.invoke('story:load-audio-package', {})
    expect(pkg.manifest.pushRevision).toBe(2)
    expect(pkg.lastPushedRevision).toBe(2)
    expect(pkg.manifest.segments).toHaveLength(1)
  })

  // readAudioPackage 는 stale/손상 manifest 를 throw 로 알린다. 그 throw 가 ipcRenderer.invoke 를
  // 그냥 건너가면 errorKind 가 소실되고(Electron 은 message 만 직렬화한다) renderer 는 번역할 게
  // 없어 한국어 UI에도 내부 영문 문구가 뜬다. 이 파일의 관습대로 { error: kind } 로 넘긴다.
  it('story:load-audio-package — stale manifest 는 errorKind 를 실어 보낸다(영문 생메시지 금지)', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.join(dir, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'audio', 'manifest.json'),
      JSON.stringify({ version: 1, pushRevision: 2, segments: [] }))
    // audio 가 done 이 아닌데 manifest 가 남아 있다(③/④ 재실행 또는 절단 실패 후).
    await writeFile(path.join(dir, 'story', 'story.json'), JSON.stringify(defaultStoryState()))
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:load-audio-package', {})
    expect(r).toEqual({ error: 'story-audio-stale-manifest' })
  })

  it('story:load-audio-package — 손상 manifest 도 errorKind 로 넘긴다', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.join(dir, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'audio', 'manifest.json'), '{ not valid json ')
    await writeFile(path.join(dir, 'story', 'story.json'), JSON.stringify(audioDoneState(1)))
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:load-audio-package', {})
    expect(r).toEqual({ error: 'story-audio-manifest-corrupt' })
  })

  it('story:load-audio-package — projectPath 없고 machine 도 없으면 null', async () => {
    const pkg = await ipc.invoke('story:load-audio-package', {})
    expect(pkg).toBeNull()
  })

  // Codex finding 1(round3): fresh session — story view 미진입이라 machine 이 없어도 projectPath
  // 만으로 디스크 manifest 를 읽어야 export 가 나레이션을 놓치지 않는다.
  it('story:load-audio-package — machine 안 열려도 projectPath 로 디스크 읽기', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.join(dir, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'audio', 'manifest.json'),
      JSON.stringify({ version: 1, pushRevision: 4, segments: [] }))
    await writeFile(path.join(dir, 'story', 'story.json'),
      JSON.stringify(audioDoneState(4)))
    // open 하지 않음(machine null)
    const pkg = await ipc.invoke('story:load-audio-package', { projectPath: dir })
    expect(pkg.manifest.pushRevision).toBe(4)
    expect(pkg.lastPushedRevision).toBe(4)
  })

  // Codex finding 2(round3): projectPath 도 story:open 과 동일하게 검증한다(상대/traversal 거부).
  it('story:load-audio-package — 상대경로/traversal 은 null', async () => {
    expect(await ipc.invoke('story:load-audio-package', { projectPath: 'relative/path' })).toBeNull()
    expect(await ipc.invoke('story:load-audio-package', { projectPath: `${dir}/../etc` })).toBeNull()
  })

  it('story:load-audio-package — activeWorkFolder 밖 경로는 null', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const outside = await mkdtemp(path.join(tmpdir(), 'lap-outside-'))
    const workFolder = await mkdtemp(path.join(tmpdir(), 'lap-work-'))
    await mkdir(path.join(outside, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(outside, 'story', 'audio', 'manifest.json'),
      JSON.stringify({ version: 1, pushRevision: 1, segments: [] }))
    await writeFile(path.join(outside, 'story', 'story.json'),
      JSON.stringify(audioDoneState(1)))
    const ipc2 = fakeIpcMain()
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      llm: { generateScript: vi.fn(), splitScenes: vi.fn(), writePrompts: vi.fn() },
      getActiveWorkFolder: () => workFolder,
    })
    expect(await ipc2.invoke('story:load-audio-package', { projectPath: outside })).toBeNull()
  })

  // Codex finding 1: 요청된 projectPath 의 manifest 를 읽는다 — machine 이 다른 프로젝트로 열려
  // 있어도 교차 주입 없이 요청 경로 것만(누락도 없음).
  it('story:load-audio-package — 요청 projectPath 의 manifest 를 읽는다(machine 독립)', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const other = await mkdtemp(path.join(tmpdir(), 'ipc-other-'))
    await mkdir(path.join(other, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(other, 'story', 'audio', 'manifest.json'),
      JSON.stringify({ version: 1, pushRevision: 7, segments: [{ id: 'x', type: 'narration', audioPath: '/p/story/audio/segments/x.wav', startMs: 0, durationMs: 1 }] }))
    await writeFile(path.join(other, 'story', 'story.json'),
      JSON.stringify(audioDoneState(7)))
    // machine 은 dir(A) 로 열고, other(B) manifest 를 요청
    await ipc.invoke('story:open', { projectPath: dir })
    const pkg = await ipc.invoke('story:load-audio-package', { projectPath: other })
    expect(pkg.manifest.pushRevision).toBe(7)
    expect(pkg.lastPushedRevision).toBe(7)
  })

  // §4.8 R3: machine.synthPreview는 어댑터가 던진 ProviderAuthError/MissingProviderKeyError를
  // (errorKind 있는 타입) 그대로 throw한다. ipcRenderer.invoke는 message만 직렬화하므로 그냥
  // 던지면 errorKind가 소실돼 renderer가 번역 못 하는 raw 영문 진단문이 뜬다(story:load-audio-package
  // 의 asKind 와 같은 문제). story:tts-preview 핸들러가 같은 관습으로 { error: kind, provider }
  // 를 돌려주는지 IPC 경계에서 검증한다.
  it('story:tts-preview — 무효 키(401) 는 throw 대신 { error: errorKind, provider } 로 resolve', async () => {
    const ipc2 = fakeIpcMain()
    const tts = {
      capabilities: () => ({ maxConcurrency: 2 }),
      synthesize: async () => { throw new ProviderAuthError('typecast', { status: 401 }) },
    }
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      getActiveWorkFolder: () => path.dirname(dir),
      llm: {
        generateScript: vi.fn(async () => ({ scriptMd: '#' })),
        splitScenes: vi.fn(async () => ({
          scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '한 문장입니다.', emotion: 'normal' }] }],
          speakers: [{ id: 'narrator', name: '나레이션' }],
        })),
      },
      tts,
    })
    const { projectToken } = await ipc2.invoke('story:open', { projectPath: dir })
    await ipc2.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: { language: 'ko' } } })
    await ipc2.invoke('story:start', { projectToken, step: 'scenes', params: {} })
    const state = await ipc2.invoke('story:get-state', { projectToken })
    const segId = state.scenes[0].segments[0].id

    const r = await ipc2.invoke('story:tts-preview', {
      projectToken, segmentIds: [segId], speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }],
    })
    expect(r).toEqual({ error: 'story-audio-tts-auth', provider: 'typecast' })
  })

  it('story:tts-preview — 키 없음(MissingProviderKeyError) 도 같은 모양으로 resolve', async () => {
    const ipc2 = fakeIpcMain()
    const tts = {
      capabilities: () => ({ maxConcurrency: 2 }),
      synthesize: async () => { throw new MissingProviderKeyError('typecast') },
    }
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      getActiveWorkFolder: () => path.dirname(dir),
      llm: {
        generateScript: vi.fn(async () => ({ scriptMd: '#' })),
        splitScenes: vi.fn(async () => ({
          scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '한 문장입니다.', emotion: 'normal' }] }],
          speakers: [{ id: 'narrator', name: '나레이션' }],
        })),
      },
      tts,
    })
    const { projectToken } = await ipc2.invoke('story:open', { projectPath: dir })
    await ipc2.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: { language: 'ko' } } })
    await ipc2.invoke('story:start', { projectToken, step: 'scenes', params: {} })
    const state = await ipc2.invoke('story:get-state', { projectToken })
    const segId = state.scenes[0].segments[0].id

    const r = await ipc2.invoke('story:tts-preview', {
      projectToken, segmentIds: [segId], speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }],
    })
    expect(r).toEqual({ error: 'story-audio-no-tts-key', provider: 'typecast' })
  })

  // errorKind 없는 예외(네트워크 등)는 여전히 던져야 한다 — asKind 관습대로 삼키지 않는다.
  it('story:tts-preview — errorKind 없는 예외는 그대로 throw(삼키지 않는다)', async () => {
    const ipc2 = fakeIpcMain()
    const tts = {
      capabilities: () => ({ maxConcurrency: 2 }),
      synthesize: async () => { throw new Error('network down') },
    }
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      getActiveWorkFolder: () => path.dirname(dir),
      llm: {
        generateScript: vi.fn(async () => ({ scriptMd: '#' })),
        splitScenes: vi.fn(async () => ({
          scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '한 문장입니다.', emotion: 'normal' }] }],
          speakers: [{ id: 'narrator', name: '나레이션' }],
        })),
      },
      tts,
    })
    const { projectToken } = await ipc2.invoke('story:open', { projectPath: dir })
    await ipc2.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: { language: 'ko' } } })
    await ipc2.invoke('story:start', { projectToken, step: 'scenes', params: {} })
    const state = await ipc2.invoke('story:get-state', { projectToken })
    const segId = state.scenes[0].segments[0].id

    await expect(ipc2.invoke('story:tts-preview', {
      projectToken, segmentIds: [segId], speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }],
    })).rejects.toThrow('network down')
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

// 동적 카탈로그 경로: supportedModels() 가 응답하면 그걸로 목록을 만들고, 메인 라우터/스텝머신이
// 쓰는 활성 카탈로그도 같이 바꿔야 렌더러가 보낸 별칭 model('sonnet')이 검증을 통과한다.
describe('story:list-llm-options — 동적 카탈로그', () => {
  const MODELS = [
    { value: 'default', resolvedModel: 'claude-opus-4-8[1m]', displayName: 'Default', supportsEffort: true, supportedEffortLevels: ['low', 'xhigh'], supportsAdaptiveThinking: true },
    { value: 'opus[1m]', resolvedModel: 'claude-opus-4-8[1m]', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'xhigh'], supportsAdaptiveThinking: true },
    { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
  ]

  function register(listClaudeModels) {
    const ipc2 = fakeIpcMain()
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      llm,
      listClaudeModels,
      listCodexModels: async () => [],
    })
    return ipc2
  }

  it('SDK 가 보고한 모델로 목록을 만든다 (codex 는 정적 폴백)', async () => {
    const r = await register(async () => MODELS).invoke('story:list-llm-options', {})
    expect(r.options.map((o) => o.id)).toEqual([
      'claude:opus[1m]', 'claude:haiku', 'codex:gpt-5.5', 'codex:gpt-5.4',
    ])
    expect(r.defaultOption.id).toBe('claude:opus[1m]')
  })

  it('xhigh 를 살린다', async () => {
    const r = await register(async () => MODELS).invoke('story:list-llm-options', {})
    expect(r.options[0].reasoningEfforts).toContain('xhigh')
  })

  it('조회 결과를 캐시한다 (CLI 를 매번 띄우지 않는다)', async () => {
    const spy = vi.fn(async () => MODELS)
    const ipc2 = register(spy)
    await ipc2.invoke('story:list-llm-options', {})
    await ipc2.invoke('story:list-llm-options', {})
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('조회가 던져도 정적 카탈로그를 돌려준다', async () => {
    const r = await register(async () => { throw new Error('spawn ENOENT') }).invoke('story:list-llm-options', {})
    expect(r.options.map((o) => o.id)).toContain('claude:claude-opus-4-8')
  })

  it('활성 카탈로그가 갱신돼 별칭 model 이 검증을 통과한다', async () => {
    await register(async () => MODELS).invoke('story:list-llm-options', {})
    const { normalizeActiveStoryLlmOptions } = await import('../../../electron/api/llm/storyLlmCatalog.js')
    expect(() => normalizeActiveStoryLlmOptions({ engine: 'claude', model: 'haiku' })).not.toThrow()
    expect(normalizeActiveStoryLlmOptions({ engine: 'claude', model: 'haiku' }).resolvedModel)
      .toBe('claude-haiku-4-5-20251001')
  })
})

// codex 는 app-server model/list 로 동적 조회한다. 한쪽 엔진이 죽어도 다른 쪽은 동적으로 남는다.
describe('story:list-llm-options — codex 동적 카탈로그', () => {
  const CODEX = [{ id: 'gpt-5.5', displayName: 'GPT-5.5', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'xhigh' }] }]

  function register({ listClaudeModels = async () => [], listCodexModels = async () => [] }) {
    const ipc2 = fakeIpcMain()
    registerStoryIPC(ipc2, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      llm,
      listClaudeModels,
      listCodexModels,
    })
    return ipc2
  }

  it('codex 만 조회되면 claude 는 정적, codex 는 동적', async () => {
    const r = await register({ listCodexModels: async () => CODEX }).invoke('story:list-llm-options', {})
    const ids = r.options.map((o) => o.id)
    expect(ids).toContain('claude:claude-opus-4-8') // 정적 폴백
    expect(ids.filter((i) => i.startsWith('codex:'))).toEqual(['codex:gpt-5.5'])
  })

  it('codex 라벨/effort 를 app-server 응답에서 만든다', async () => {
    const r = await register({ listCodexModels: async () => CODEX }).invoke('story:list-llm-options', {})
    const o = r.options.find((x) => x.id === 'codex:gpt-5.5')
    expect(o.label).toBe('Codex GPT-5.5')
    expect(o.reasoningEfforts).toEqual(['xhigh'])
  })

  it('codex 조회가 던져도 claude 동적 목록은 살아 있다', async () => {
    const claude = [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' }]
    const r = await register({
      listClaudeModels: async () => claude,
      listCodexModels: async () => { throw new Error('app-server ENOENT') },
    }).invoke('story:list-llm-options', {})
    expect(r.options.map((o) => o.id)).toEqual(['claude:sonnet', 'codex:gpt-5.5', 'codex:gpt-5.4'])
  })

  it('두 엔진을 동시에 조회한다 (직렬로 기다리지 않는다)', async () => {
    let claudeStarted = false
    let codexStartedBeforeClaudeResolved = false
    const listClaudeModels = () => new Promise((res) => { claudeStarted = true; setTimeout(() => res([]), 20) })
    const listCodexModels = async () => { if (claudeStarted) codexStartedBeforeClaudeResolved = true; return [] }
    await register({ listClaudeModels, listCodexModels }).invoke('story:list-llm-options', {})
    expect(codexStartedBeforeClaudeResolved).toBe(true)
  })
})
