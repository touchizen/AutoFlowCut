import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildCodexClientOptions,
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

  // ⚠️ builder 는 `callerConfig` 를 통째로 spread 한 뒤 **일부 필드만** 덮는다.
  //    그래서 `features` 밖에 있는 tool surface 는 그대로 샌다 — 실측으로 밟았다:
  //      config.tools.web_search = true            → 그대로 통과 (웹 검색 툴이 열린다)
  //      config.experimental_use_unified_exec_tool → 그대로 통과 (exec 툴)
  //    "caller config cannot override Codex auth/isolation defaults" 라는 이름의 테스트가 있었지만
  //    실제 계약은 그보다 좁았다. **이름이 계약을 지켜주지 않는다.**
  // 🔴 **한 층 위에서 똑같은 실수를 하고 있었다.** builder 가 `...callerConfig` 를 spread 하니
  //    우리가 열거하지 않은 **최상위 키가 전부 통과**한다. 실측:
  //      config.web_search = 'live'        → 그대로 통과 (native live web search. per-call 승인 없음)
  //      config.tools.future_tool = {...}  → 그대로 통과 (미지의 tool)
  //      config.some_unknown_top = 'x'     → 그대로 통과
  //    → **config 도 allowlist 로 뒤집는다.** 모델 튜닝 키만 통과시키고 나머지는 버린다.
  it('config 는 allowlist 다 — 우리가 허용한 키 말고는 전부 버린다', () => {
    const options = buildCodexClientOptions({
      config: {
        model: 'gpt-5.2',                       // ✅ 통과해야 함 (모델 튜닝)
        model_reasoning_effort: 'high',         // ✅
        web_search: 'live',                     // ❌ native web search — tool surface 다
        tools: { future_tool: { enabled: true } }, // ❌ 미지의 tool
        some_unknown_top: 'x',                  // ❌
        experimental_use_unified_exec_tool: true,  // ❌
        mcp_servers: { sneaky: { command: 'x' } }, // ❌ (mcpServers 인자로만 붙는다)
      },
    })
    expect(options.config.model).toBe('gpt-5.2')
    expect(options.config.model_reasoning_effort).toBe('high')

    expect(options.config).not.toHaveProperty('web_search')
    expect(options.config).not.toHaveProperty('some_unknown_top')
    expect(options.config.tools).not.toHaveProperty('future_tool')
    expect(options.config.experimental_use_unified_exec_tool).toBe(false)
    expect(options.config.mcp_servers).toEqual({})
  })

  // 🔴 **denylist 는 구조적으로 틀렸다.** builder 가 caller 의 `features` 를 spread 한 뒤 알려진 키만 덮으면,
  //    Codex 가 feature 를 새로 추가할 때마다 우리 tool surface 가 **조용히 넓어진다.**
  //    실측(vendored 0.142.5): `enable_mcp_apps`, `code_mode`, `standalone_web_search`, `sleep_tool`,
  //    `request_permissions_tool`, `multi_agent_v2` 가 전부 `true` 로 새어나갔다.
  //    (`enable_mcp_apps` 는 codex_apps 를 되살릴 수 있는 이름이다 — 그게 31개 계정-작용 툴을 여는 그것이다.)
  //    → **allowlist 로 뒤집는다: caller 의 features 는 통째로 버린다.**
  it('caller features 는 통째로 버려진다 — denylist 가 아니라 allowlist 여야 한다', () => {
    const options = buildCodexClientOptions({
      config: {
        features: {
          enable_mcp_apps: true,
          code_mode: true,
          standalone_web_search: true,
          sleep_tool: true,
          request_permissions_tool: true,
          multi_agent_v2: true,
          // 아직 존재하지도 않는 미래의 feature 도 못 들어와야 한다
          some_future_tool: true,
        },
      },
    })
    // 우리가 명시적으로 잠근 것 **말고는 아무것도 없다.**
    expect(Object.values(options.config.features).every((v) => v === false)).toBe(true)
    expect(options.config.features).not.toHaveProperty('enable_mcp_apps')
    expect(options.config.features).not.toHaveProperty('some_future_tool')
    expect(options.config.features.apps).toBe(false)
  })

  it('caller 가 features 밖의 tool surface 로 격리를 뚫을 수 없다', () => {
    const options = buildCodexClientOptions({
      config: {
        tools: { web_search: true, experimental_request_user_input: true },
        experimental_use_unified_exec_tool: true,
      },
    })
    expect(options.config.tools.web_search).toBe(false)
    // ⚠️ `experimental_request_user_input` 은 **불리언이 아니라 struct** 다. `false` 로 두면
    //    Codex 가 설정 로딩을 거부한다(-32600). 끄는 방법은 **키를 없애는 것**이다(=기본값=꺼짐).
    //    (단위 테스트만으론 못 잡는다 — 실제 codex 를 띄우는 스파이크가 잡았다.)
    expect(options.config.tools).not.toHaveProperty('experimental_request_user_input')
    expect(options.config.experimental_use_unified_exec_tool).toBe(false)
  })

  it('orchestrator 프로필도 features 밖 tool surface 를 막는다', () => {
    const options = buildCodexClientOptions({
      runtimeProfile: 'orchestrator',
      mcpServers: { echo: { command: '/bin/node' } },
      config: { tools: { web_search: true }, experimental_use_unified_exec_tool: true },
    })
    expect(options.config.tools.web_search).toBe(false)
    expect(options.config.experimental_use_unified_exec_tool).toBe(false)
    expect(options.config.mcp_servers).toEqual({ echo: { command: '/bin/node' } })
  })

  // ── runtimeProfile (스펙 §340) ──
  // story  : 현행 lockdown 유지 — caller 가 mcp_servers 를 넘겨도 지운다 (작가 LLM 은 툴 0개)
  // orchestrator: caller 의 mcp_servers 를 **지우지 않는다.** shell/browser/plugins/apps 는 여전히 deny.
  //
  // ⚠️ 이게 없으면 M0-8 이 RED 다 (스펙 M0-S06: "`mcp_servers:{}` 후처리 … 남으면 RED").
  //    오케스트레이터 adapter 를 붙일 방법이 없어서, 스파이크가 builder 를 우회할 수밖에 없었다.
  describe('runtimeProfile', () => {
    const ECHO = { echo: { command: '/bin/node', args: ['echo.js'], env: { TOKEN: 't' } } }

    it('기본(story): mcp_servers 를 지운다 — 작가 경로의 격리는 그대로', () => {
      const options = buildCodexClientOptions({ config: { mcp_servers: ECHO } })
      expect(options.config.mcp_servers).toEqual({})
    })

    it("orchestrator: mcpServers 를 **그대로 싣는다** (per-server env 포함)", () => {
      const options = buildCodexClientOptions({
        runtimeProfile: 'orchestrator',
        mcpServers: ECHO,
      })
      expect(options.config.mcp_servers).toEqual(ECHO)
    })

    it('orchestrator 여도 tool feature lockdown 은 안 풀린다', () => {
      const options = buildCodexClientOptions({
        runtimeProfile: 'orchestrator',
        mcpServers: ECHO,
        config: { features: { shell_tool: true, browser_use: true, plugins: true, apps: true } },
      })
      expect(options.config.features).toMatchObject({
        shell_tool: false,
        browser_use: false,
        plugins: false,
        apps: false,          // ← codex_apps(31개 계정-작용 툴)를 막는 그 스위치
      })
      expect(options.config.forced_login_method).toBe('chatgpt')
      expect(options.config.hooks).toEqual({})
    })

    it('orchestrator 라도 config.mcp_servers 로 몰래 넣는 건 안 된다 — mcpServers 인자로만 붙는다', () => {
      const options = buildCodexClientOptions({
        runtimeProfile: 'orchestrator',
        config: { mcp_servers: ECHO },
      })
      expect(options.config.mcp_servers).toEqual({})
    })
  })

  it('caller config cannot override Codex auth/isolation defaults', () => {
    const options = buildCodexClientOptions({
      config: {
        forced_login_method: 'api_key',
        mcp_servers: { local: { command: 'x' } },
        hooks: { pre_model: ['x'] },
        features: { shell_tool: true, browser_use: true, plugins: true },
      },
    })
    expect(options.config).toMatchObject({
      forced_login_method: 'chatgpt',
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

  it('parseCodexJson은 코드펜스와 앞뒤 텍스트를 허용한다', () => {
    expect(parseCodexJson('```json\n{"ok":true}\n```')).toEqual({ ok: true })
    expect(parseCodexJson('result:\n{"ok":true}\nthanks')).toEqual({ ok: true })
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
      // ⚠️ **source 도 지운다.** 예전엔 runtime home 만 지워서 실행마다 `codex-home-src-*` 가 하나씩 쌓였다
      //    (실측 384개). 자격증명 잔존 검사에 노이즈를 만들고 디스크를 먹는다.
      await rm(src, { recursive: true, force: true })
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

})
