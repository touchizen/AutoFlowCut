/**
 * codex 런타임 헬퍼 — 바이너리 경로, 격리된 CODEX_HOME/작업 폴더, 로그인 검증, 에러 매핑.
 * 트랜스포트는 codexAppServer.js(app-server JSON-RPC)가 담당한다.
 */
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

const SAFE_ENV_KEYS = [
  'HOME', 'PATH', 'Path', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'USER', 'USERNAME', 'LOGNAME',
  'CODEX_HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec',
]
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const AUTH_CHECK_TIMEOUT_MS = 15 * 1000
const LOGIN_HINT = 'Codex login required: run `codex login` and choose Sign in with ChatGPT.'
export const STORY_INSTRUCTIONS_TEXT = [
  'AutoFlowCut Story backend.',
  'Return only the requested story content or JSON.',
  'Do not inspect files, call tools, browse, or modify the workspace.',
].join('\n')
const TOOL_FEATURE_OVERRIDES = Object.freeze({
  shell_tool: false,
  shell_snapshot: false,
  unified_exec: false,
  unified_exec_zsh_fork: false,
  shell_zsh_fork: false,
  browser_use: false,
  browser_use_external: false,
  browser_use_full_cdp_access: false,
  in_app_browser: false,
  computer_use: false,
  image_generation: false,
  plugins: false,
  plugin_sharing: false,
  multi_agent: false,
  apps: false,
  workspace_dependencies: false,
  tool_suggest: false,
})
/**
 * `features` **밖에** 있는 tool surface 들. 여기를 안 막으면 caller config 가 격리를 뚫는다.
 * (실측: `config.tools.web_search=true`, `config.experimental_use_unified_exec_tool=true` 가
 *  builder 를 그대로 통과했다. `TOOL_FEATURE_OVERRIDES` 는 `features` 안만 덮는다.)
 *
 * ⚠️ `false` 로 끌 수 있는 것만 여기 넣는다. **불리언이 아닌 키를 `false` 로 두면 Codex 가
 *    설정 로딩 자체를 거부한다** — 실측:
 *      `-32600 failed to load configuration: invalid type: boolean 'false',
 *       expected struct ExperimentalRequestUserInput in 'tools.experimental_request_user_input'`
 *    (단위 테스트는 통과했다. **실제 codex 를 띄우는 스파이크만 이걸 잡았다.**)
 *    → 불리언이 아닌 tool 키는 `TOOLS_TABLE_DROP` 으로 **지운다**(= 기본값 = 꺼짐).
 */
const TOOLS_TABLE_OVERRIDES = Object.freeze({
  web_search: false,
})
const TOOLS_TABLE_DROP = Object.freeze(['experimental_request_user_input'])

const PLATFORM_PACKAGE_BY_TARGET = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
}

/** caller 의 `tools` 테이블에서 tool surface 를 잠근다. 불리언이 아닌 키는 지운다(=기본값=꺼짐). */
function lockedTools(callerTools) {
  const tools = { ...plainObject(callerTools), ...TOOLS_TABLE_OVERRIDES }
  for (const key of TOOLS_TABLE_DROP) delete tools[key]
  return tools
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * @param runtimeProfile  `'story'` (기본) — 작가 LLM. 툴 0개. `mcp_servers` 를 지운다.
 *                        `'orchestrator'` — 인앱 에이전트. `mcpServers` 인자로 넘긴 MCP 서버를 **싣는다.**
 *                        (스펙 §340. 이게 없으면 M0-8 이 RED 다 — M0-S06 이 `mcp_servers:{}` 후처리를
 *                         명시적 RED 조건으로 지목한다.)
 * @param mcpServers      orchestrator 프로필에서만 쓰인다. per-server `env` 포함.
 *                        ⚠️ `config.mcp_servers` 로는 **절대 안 붙는다** — caller config 가 격리를 뚫는 길을
 *                        열어두지 않기 위해서다. 붙이려면 이 인자를 명시해야 한다.
 *
 * tool feature lockdown(shell/browser/plugins/**apps**)은 **어느 프로필에서도 안 풀린다.**
 * `apps:false` 를 빠뜨리면 내장 `codex_apps` 가 사용자 ChatGPT 계정에 작용하는 툴 31개를
 * **승인 게이트 없이** 노출한다 (M0-8 실측).
 */
export function buildCodexClientOptions({
  env = process.env,
  config = {},
  runtimeProfile = 'story',
  mcpServers = {},
} = {}) {
  const safeEnv = {}
  for (const key of SAFE_ENV_KEYS) {
    if (env?.[key] != null) safeEnv[key] = String(env[key])
  }
  const callerConfig = plainObject(config)
  return {
    env: safeEnv,
    config: {
      ...callerConfig,
      // ⚠️ **allowlist 다. caller 의 features 는 통째로 버린다.**
      //    denylist(=caller features 를 spread 한 뒤 아는 키만 덮기)는 구조적으로 틀렸다 —
      //    Codex 가 feature 를 추가할 때마다 우리 tool surface 가 조용히 넓어진다.
      //    실측(0.142.5): `enable_mcp_apps`, `code_mode`, `standalone_web_search`, `sleep_tool`,
      //    `request_permissions_tool`, `multi_agent_v2` 가 전부 `true` 로 새어나갔다.
      //    (`enable_mcp_apps` 는 codex_apps — 사용자 계정에 작용하는 툴 31개 — 를 되살릴 수 있는 이름이다.)
      features: { ...TOOL_FEATURE_OVERRIDES },
      tools: lockedTools(callerConfig.tools),
      experimental_use_unified_exec_tool: false,
      skills: {
        ...plainObject(callerConfig.skills),
        include_instructions: false,
      },
      forced_login_method: 'chatgpt',
      include_permissions_instructions: false,
      include_environment_context: false,
      include_apps_instructions: false,
      include_collaboration_mode_instructions: false,
      mcp_servers: runtimeProfile === 'orchestrator' ? plainObject(mcpServers) : {},
      hooks: {},
      sandbox_permissions: [],
      shell_environment_policy: { inherit: 'none' },
    },
  }
}

function resolveCodexHome(env = process.env) {
  if (env?.CODEX_HOME) return env.CODEX_HOME
  const home = env?.HOME || env?.USERPROFILE || os.homedir()
  return path.join(home, '.codex')
}

async function copyIfPresent(src, dest, { copyFileImpl = copyFile } = {}) {
  try {
    await copyFileImpl(src, dest)
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err
  }
}

export async function prepareCodexRuntimeHome({
  env = process.env,
  mkdtempImpl = mkdtemp,
  copyFileImpl = copyFile,
  rmImpl = rm,
} = {}) {
  const codexHome = await mkdtempImpl(path.join(os.tmpdir(), 'autoflowcut-codex-home-'))
  const cleanup = () => rmImpl(codexHome, { recursive: true, force: true })
  try {
    const sourceHome = resolveCodexHome(env)
    await copyIfPresent(path.join(sourceHome, 'auth.json'), path.join(codexHome, 'auth.json'), { copyFileImpl })
    return {
      codexHome,
      env: { ...(env || {}), CODEX_HOME: codexHome },
      cleanup,
    }
  } catch (err) {
    await cleanup()
    throw err
  }
}

function targetTriple({ platform = process.platform, arch = process.arch } = {}) {
  if ((platform === 'linux' || platform === 'android') && arch === 'x64') return 'x86_64-unknown-linux-musl'
  if ((platform === 'linux' || platform === 'android') && arch === 'arm64') return 'aarch64-unknown-linux-musl'
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin'
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin'
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc'
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc'
  throw new Error(`Unsupported Codex platform: ${platform} (${arch})`)
}

export function resolveCodexExecutablePath({ platform = process.platform, arch = process.arch } = {}) {
  const require = createRequire(import.meta.url)
  const triple = targetTriple({ platform, arch })
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple]
  const codexPackageJson = require.resolve('@openai/codex/package.json')
  const codexRequire = createRequire(codexPackageJson)
  const platformPackageJson = codexRequire.resolve(`${platformPackage}/package.json`)
  const executable = path.join(
    path.dirname(platformPackageJson),
    'vendor',
    triple,
    'bin',
    platform === 'win32' ? 'codex.exe' : 'codex',
  )
  if (!existsSync(executable)) throw new Error(`Codex executable not found: ${executable}`)
  return executable
}

export async function defaultAuthCheck({ env, execFileImpl = execFileAsync, codexPath = resolveCodexExecutablePath() }) {
  const { stdout, stderr } = await execFileImpl(codexPath, ['login', 'status'], {
    env,
    timeout: AUTH_CHECK_TIMEOUT_MS,
    maxBuffer: 256 * 1024,
  })
  return `${stdout || ''}\n${stderr || ''}`
}

function isAuthStatusOk(status) {
  const text = typeof status === 'string' ? status : `${status?.stdout || ''}\n${status?.stderr || ''}`
  return /logged in/i.test(text) && /chatgpt/i.test(text) && !/api key/i.test(text)
}

export function mapCodexError(err, { timedOut = false, parentSignal } = {}) {
  if (timedOut) return new Error(`Codex timed out after ${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s`)
  if (parentSignal?.aborted) return new Error('Aborted')
  const msg = String(err?.message || err || '')
  if (/not logged in|login required|unauthorized|401|403|access token|chatgpt login|authentication/i.test(msg)) {
    return new Error(LOGIN_HINT)
  }
  return err instanceof Error ? err : new Error(msg || 'Codex SDK failed')
}

export async function assertCodexChatGptLogin({ env, authCheck }) {
  const check = authCheck || defaultAuthCheck
  let status
  try {
    status = await check({ env })
  } catch (err) {
    throw mapCodexError(err)
  }
  if (!isAuthStatusOk(status)) throw new Error(LOGIN_HINT)
}

export function createRunSignal(parentSignal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort(parentSignal?.reason)
  if (parentSignal) {
    if (parentSignal.aborted) onAbort()
    else parentSignal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    : null
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timer) clearTimeout(timer)
      if (parentSignal) parentSignal.removeEventListener?.('abort', onAbort)
    },
  }
}

export async function prepareCodexWorkingDirectory({
  mkdtempImpl = mkdtemp,
  rmImpl = rm,
} = {}) {
  const workingDirectory = await mkdtempImpl(path.join(os.tmpdir(), 'autoflowcut-story-codex-'))
  return {
    workingDirectory,
    cleanup: () => rmImpl(workingDirectory, { recursive: true, force: true }),
  }
}

export function parseCodexJson(text) {
  let t = String(text || '').trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}
