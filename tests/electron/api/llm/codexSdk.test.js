import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildCodexClientOptions,
  buildCodexThreadOptions,
  defaultAuthCheck,
  mapCodexError,
  parseCodexJson,
  prepareCodexRuntimeHome,
  resolveCodexExecutablePath,
  runCodexJson,
  runCodexText,
} from '../../../../electron/api/llm/codexSdk.js'

class FakeCodex {
  static instances = []

  constructor(options) {
    this.options = options
    this.threadOptions = null
    FakeCodex.instances.push(this)
  }

  startThread(options) {
    this.threadOptions = options
    return this.thread
  }
}

describe('codexSdk helper', () => {
  it('client env는 API key를 제거하고 ChatGPT 로그인 모드 config를 고정한다', () => {
    const options = buildCodexClientOptions({
      env: {
        HOME: '/home/me',
        PATH: '/bin',
        Path: 'C:\\Windows\\System32',
        CODEX_HOME: '/custom/codex',
        USERPROFILE: 'C:\\Users\\me',
        APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
        SystemRoot: 'C:\\Windows',
        OPENAI_API_KEY: 'api-key',
        CODEX_API_KEY: 'codex-key',
        CODEX_ACCESS_TOKEN: 'token',
      },
    })
    expect(options).not.toHaveProperty('apiKey')
    expect(options.env).toMatchObject({
      HOME: '/home/me',
      PATH: '/bin',
      Path: 'C:\\Windows\\System32',
      CODEX_HOME: '/custom/codex',
      USERPROFILE: 'C:\\Users\\me',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      SystemRoot: 'C:\\Windows',
    })
    expect(options.env.OPENAI_API_KEY).toBeUndefined()
    expect(options.env.CODEX_API_KEY).toBeUndefined()
    expect(options.env.CODEX_ACCESS_TOKEN).toBeUndefined()
    expect(options.config).toMatchObject({
      forced_login_method: 'chatgpt',
      model_instructions_file: 'AUTOFLOWCUT_STORY_INSTRUCTIONS.md',
      include_permissions_instructions: false,
      include_environment_context: false,
      include_apps_instructions: false,
      include_collaboration_mode_instructions: false,
      skills: { include_instructions: false },
      mcp_servers: {},
      hooks: {},
      features: expect.objectContaining({
        shell_tool: false,
        shell_snapshot: false,
        unified_exec: false,
        browser_use: false,
        computer_use: false,
        plugins: false,
        multi_agent: false,
      }),
    })
  })

  it('caller config cannot override Codex auth/isolation defaults', () => {
    const options = buildCodexClientOptions({
      config: {
        forced_login_method: 'api_key',
        model_instructions_file: 'AGENTS.md',
        mcp_servers: { local: { command: 'x' } },
        hooks: { pre_model: ['x'] },
        features: { shell_tool: true, browser_use: true, plugins: true },
      },
    })
    expect(options.config).toMatchObject({
      forced_login_method: 'chatgpt',
      model_instructions_file: 'AUTOFLOWCUT_STORY_INSTRUCTIONS.md',
      include_permissions_instructions: false,
      include_environment_context: false,
      skills: { include_instructions: false },
      mcp_servers: {},
      hooks: {},
      features: expect.objectContaining({
        shell_tool: false,
        browser_use: false,
        plugins: false,
      }),
    })
  })

  it('thread options는 외부 workingDirectory를 무시하고 read-only sandbox와 approval never를 사용한다', () => {
    expect(buildCodexThreadOptions({
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      workingDirectory: '/tmp/hijack',
    })).toMatchObject({
      model: 'gpt-5.5',
      modelReasoningEffort: 'xhigh',
      workingDirectory: expect.stringContaining('autoflowcut-story-codex'),
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
    })
  })

  it('runCodexText는 Codex thread를 만들고 finalResponse를 반환한다', async () => {
    FakeCodex.instances = []
    const thread = { run: vi.fn(async () => ({ finalResponse: '응답', items: [], usage: null })) }
    FakeCodex.prototype.thread = thread
    const authCheck = vi.fn(async () => 'Logged in using ChatGPT')
    const text = await runCodexText('프롬프트', {
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      workingDirectory: '/tmp/story-codex',
    }, { CodexImpl: FakeCodex, env: { HOME: '/home/me', PATH: '/bin' }, authCheck })
    expect(text).toBe('응답')
    expect(authCheck).toHaveBeenCalledOnce()
    expect(FakeCodex.instances[0].threadOptions).toMatchObject({
      model: 'gpt-5.5',
      modelReasoningEffort: 'high',
      workingDirectory: expect.stringContaining('autoflowcut-story-codex-'),
    })
    expect(thread.run).toHaveBeenCalledWith('프롬프트', { signal: expect.any(AbortSignal) })
  })

  it('runCodexText는 isolated 작업 폴더에 non-empty model instructions 파일을 만든다', async () => {
    FakeCodex.instances = []
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'story-codex-work-'))
    const cleanup = vi.fn(async () => {})
    const thread = { run: vi.fn(async () => ({ finalResponse: '응답', items: [], usage: null })) }
    FakeCodex.prototype.thread = thread

    await runCodexText('프롬프트', {
      model: 'gpt-5.5',
      workingDirectory: '/tmp/hijack',
    }, {
      CodexImpl: FakeCodex,
      authCheck: vi.fn(async () => 'Logged in using ChatGPT'),
      workingDirectoryFactory: vi.fn(async () => ({
        workingDirectory: workDir,
        cleanup,
      })),
    })

    const instructions = await readFile(path.join(workDir, 'AUTOFLOWCUT_STORY_INSTRUCTIONS.md'), 'utf8')
    expect(instructions).toContain('AutoFlowCut Story backend')
    expect(instructions.trim().length).toBeGreaterThan(0)
    expect(FakeCodex.instances[0].options.config.model_instructions_file)
      .toBe('AUTOFLOWCUT_STORY_INSTRUCTIONS.md')
    expect(FakeCodex.instances[0].threadOptions.workingDirectory).toBe(workDir)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('runCodexText는 untrusted workingDirectory 옵션에 instructions 파일을 쓰지 않는다', async () => {
    FakeCodex.instances = []
    const hijackDir = await mkdtemp(path.join(os.tmpdir(), 'story-codex-hijack-'))
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'story-codex-private-'))
    const thread = { run: vi.fn(async () => ({ finalResponse: '응답', items: [], usage: null })) }
    FakeCodex.prototype.thread = thread

    await runCodexText('프롬프트', {
      model: 'gpt-5.5',
      workingDirectory: hijackDir,
    }, {
      CodexImpl: FakeCodex,
      authCheck: vi.fn(async () => 'Logged in using ChatGPT'),
      workingDirectoryFactory: vi.fn(async () => ({
        workingDirectory: workDir,
        cleanup: vi.fn(async () => {}),
      })),
    })

    expect(FakeCodex.instances[0].threadOptions.workingDirectory).toBe(workDir)
    await expect(readFile(path.join(hijackDir, 'AUTOFLOWCUT_STORY_INSTRUCTIONS.md'), 'utf8'))
      .rejects.toThrow()
  })

  it('runCodexText는 streaming event에서 agent_message delta를 전달한다', async () => {
    FakeCodex.instances = []
    async function* events() {
      yield { type: 'item.completed', item: { type: 'agent_message', text: '초안' } }
      yield { type: 'item.completed', item: { type: 'agent_message', text: '초안 완성' } }
      yield { type: 'turn.completed', usage: null }
    }
    FakeCodex.prototype.thread = { runStreamed: vi.fn(async () => ({ events: events() })) }
    const onDelta = vi.fn()
    const text = await runCodexText('프롬프트', { model: 'gpt-5.5' }, {
      CodexImpl: FakeCodex,
      onDelta,
      authCheck: vi.fn(async () => 'Logged in using ChatGPT'),
    })
    expect(text).toBe('초안 완성')
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(['초안', ' 완성'])
  })

  it('runCodexJson은 outputSchema를 넘기고 finalResponse JSON을 파싱한다', async () => {
    FakeCodex.instances = []
    const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
    const thread = { run: vi.fn(async () => ({ finalResponse: '{"title":"T"}', items: [], usage: null })) }
    FakeCodex.prototype.thread = thread
    await expect(runCodexJson('프롬프트', schema, { model: 'gpt-5.5' }, {
      CodexImpl: FakeCodex,
      authCheck: vi.fn(async () => 'Logged in using ChatGPT'),
    }))
      .resolves.toEqual({ title: 'T' })
    expect(thread.run).toHaveBeenCalledWith('프롬프트', { outputSchema: schema, signal: expect.any(AbortSignal) })
  })

  it('parseCodexJson은 코드펜스와 앞뒤 텍스트를 허용한다', () => {
    expect(parseCodexJson('```json\n{"ok":true}\n```')).toEqual({ ok: true })
    expect(parseCodexJson('result:\n{"ok":true}\nthanks')).toEqual({ ok: true })
  })

  it('auth preflight 실패는 Codex 로그인 안내로 매핑한다', async () => {
    FakeCodex.instances = []
    FakeCodex.prototype.thread = { run: vi.fn() }
    await expect(runCodexText('프롬프트', { model: 'gpt-5.5' }, {
      CodexImpl: FakeCodex,
      authCheck: vi.fn(async () => 'Not logged in'),
    })).rejects.toThrow(/Codex login required/)
  })

  it('run timeout은 Codex 프로세스 AbortSignal로 전달되고 명확한 timeout 에러를 낸다', async () => {
    FakeCodex.instances = []
    const thread = {
      run: vi.fn((_prompt, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by test')))
      })),
    }
    FakeCodex.prototype.thread = thread
    await expect(runCodexText('프롬프트', { model: 'gpt-5.5', timeoutMs: 1 }, {
      CodexImpl: FakeCodex,
      authCheck: vi.fn(async () => 'Logged in using ChatGPT'),
    })).rejects.toThrow(/Codex timed out/)
  })

  it('prepareCodexRuntimeHome은 auth.json만 임시 CODEX_HOME으로 복사하고 config는 복사하지 않는다', async () => {
    const src = await mkdtemp(path.join(os.tmpdir(), 'codex-home-src-'))
    await writeFile(path.join(src, 'auth.json'), '{"auth":true}')
    await writeFile(path.join(src, 'config.toml'), 'mcp_servers = {}')
    const runtime = await prepareCodexRuntimeHome({ env: { CODEX_HOME: src } })
    try {
      expect(runtime.env.CODEX_HOME).not.toBe(src)
      expect(await readFile(path.join(runtime.codexHome, 'auth.json'), 'utf8')).toBe('{"auth":true}')
      await expect(readFile(path.join(runtime.codexHome, 'config.toml'), 'utf8')).rejects.toThrow()
    } finally {
      await runtime.cleanup()
    }
  })

  it('prepareCodexRuntimeHome cleans up temp home if auth copy fails', async () => {
    const cleanupCalls = []
    await expect(prepareCodexRuntimeHome({
      env: { CODEX_HOME: '/source' },
      mkdtempImpl: vi.fn(async () => '/tmp/autoflowcut-codex-home-fail'),
      copyFileImpl: vi.fn(async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) }),
      rmImpl: vi.fn(async (p) => cleanupCalls.push(p)),
    })).rejects.toThrow(/denied/)
    expect(cleanupCalls).toEqual(['/tmp/autoflowcut-codex-home-fail'])
  })

  it('mapCodexError maps auth-looking SDK errors to login guidance', () => {
    expect(mapCodexError(new Error('not logged in')).message).toMatch(/Codex login required/)
    expect(mapCodexError(new Error('401 unauthorized')).message).toMatch(/Codex login required/)
  })

  it('defaultAuthCheck invokes the native Codex binary, not process.execPath', async () => {
    const calls = []
    const status = await defaultAuthCheck({
      env: { HOME: '/home/me', PATH: '/bin' },
      execFileImpl: vi.fn(async (...args) => {
        calls.push(args)
        return { stdout: 'Logged in using ChatGPT', stderr: '' }
      }),
    })
    expect(status).toContain('Logged in using ChatGPT')
    const [file, args] = calls[0]
    expect(file).toBe(resolveCodexExecutablePath())
    expect(file).not.toBe(process.execPath)
    expect(file).not.toMatch(/codex\.js$/)
    expect(args).toEqual(['login', 'status'])
  })

  it('auth failure cleans up the temporary runtime CODEX_HOME', async () => {
    const cleanup = vi.fn(async () => {})
    await expect(runCodexText('프롬프트', { model: 'gpt-5.5' }, {
      CodexImpl: FakeCodex,
      authCheck: vi.fn(async () => 'Not logged in'),
      runtimeHomeFactory: vi.fn(async () => ({
        codexHome: '/tmp/autoflowcut-codex-home-test',
        env: { CODEX_HOME: '/tmp/autoflowcut-codex-home-test' },
        cleanup,
      })),
    })).rejects.toThrow(/Codex login required/)
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
