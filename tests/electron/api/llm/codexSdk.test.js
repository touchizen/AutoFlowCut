import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
