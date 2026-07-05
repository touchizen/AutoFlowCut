import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

const SAFE_ENV_KEYS = [
  'HOME', 'PATH', 'Path', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'USER', 'USERNAME', 'LOGNAME',
  'CODEX_HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec',
]
const DEFAULT_WORKING_DIRECTORY = path.join(os.tmpdir(), 'autoflowcut-story-codex')
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const AUTH_CHECK_TIMEOUT_MS = 15 * 1000
const LOGIN_HINT = 'Codex login required: run `codex login` and choose Sign in with ChatGPT.'
const STORY_INSTRUCTIONS_FILENAME = 'AUTOFLOWCUT_STORY_INSTRUCTIONS.md'
const STORY_INSTRUCTIONS_TEXT = [
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
const PLATFORM_PACKAGE_BY_TARGET = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function buildCodexClientOptions({ env = process.env, config = {} } = {}) {
  const safeEnv = {}
  for (const key of SAFE_ENV_KEYS) {
    if (env?.[key] != null) safeEnv[key] = String(env[key])
  }
  const callerConfig = plainObject(config)
  return {
    env: safeEnv,
    config: {
      ...callerConfig,
      features: {
        ...plainObject(callerConfig.features),
        ...TOOL_FEATURE_OVERRIDES,
      },
      skills: {
        ...plainObject(callerConfig.skills),
        include_instructions: false,
      },
      forced_login_method: 'chatgpt',
      model_instructions_file: STORY_INSTRUCTIONS_FILENAME,
      include_permissions_instructions: false,
      include_environment_context: false,
      include_apps_instructions: false,
      include_collaboration_mode_instructions: false,
      mcp_servers: {},
      hooks: {},
      sandbox_permissions: [],
      shell_environment_policy: { inherit: 'none' },
    },
  }
}

export function buildCodexThreadOptions(opts = {}, { workingDirectory = DEFAULT_WORKING_DIRECTORY } = {}) {
  return {
    model: opts.model,
    modelReasoningEffort: opts.reasoningEffort || opts.modelReasoningEffort || 'xhigh',
    workingDirectory,
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    webSearchEnabled: false,
  }
}

async function defaultCodexImpl() {
  const { Codex } = await import('@openai/codex-sdk')
  return Codex
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

async function assertCodexChatGptLogin({ env, authCheck, CodexImpl }) {
  if (!authCheck && CodexImpl) return
  const check = authCheck || defaultAuthCheck
  let status
  try {
    status = await check({ env })
  } catch (err) {
    throw mapCodexError(err)
  }
  if (!isAuthStatusOk(status)) throw new Error(LOGIN_HINT)
}

function createRunSignal(parentSignal, timeoutMs = DEFAULT_TIMEOUT_MS) {
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

async function ensureStoryInstructionsFile(workingDirectory) {
  await writeFile(path.join(workingDirectory, STORY_INSTRUCTIONS_FILENAME), `${STORY_INSTRUCTIONS_TEXT}\n`, 'utf8')
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

async function createThread(
  opts,
  {
    CodexImpl,
    env,
    config,
    authCheck,
    runtimeHomeFactory = prepareCodexRuntimeHome,
    workingDirectoryFactory = prepareCodexWorkingDirectory,
  } = {},
) {
  const CodexClass = CodexImpl || await defaultCodexImpl()
  const work = await workingDirectoryFactory()
  let runtime
  try {
    const threadOptions = buildCodexThreadOptions(opts, { workingDirectory: work.workingDirectory })
    await mkdir(threadOptions.workingDirectory, { recursive: true })
    await ensureStoryInstructionsFile(threadOptions.workingDirectory)
    runtime = await runtimeHomeFactory({ env })
    const clientOptions = buildCodexClientOptions({ env: runtime.env, config })
    await assertCodexChatGptLogin({ env: clientOptions.env, authCheck, CodexImpl })
    const codex = new CodexClass(clientOptions)
    return {
      thread: codex.startThread(threadOptions),
      cleanup: async () => {
        await runtime.cleanup?.()
        await work.cleanup?.()
      },
    }
  } catch (err) {
    await runtime?.cleanup?.()
    await work.cleanup?.()
    throw err
  }
}

function deltaFromFullText(previous, next) {
  if (!next) return ''
  return next.startsWith(previous) ? next.slice(previous.length) : next
}

export async function runCodexText(
  prompt,
  opts = {},
  { CodexImpl, env, config, signal, onDelta, authCheck, runtimeHomeFactory, workingDirectoryFactory } = {},
) {
  const { thread, cleanup } = await createThread(opts, {
    CodexImpl,
    env,
    config,
    authCheck,
    runtimeHomeFactory,
    workingDirectoryFactory,
  })
  const runSignal = createRunSignal(signal, opts.timeoutMs)
  try {
    if (!onDelta) {
      const turn = await thread.run(prompt, { signal: runSignal.signal })
      return turn.finalResponse || ''
    }

    const { events } = await thread.runStreamed(prompt, { signal: runSignal.signal })
    let full = ''
    for await (const event of events) {
      if (event.type === 'turn.failed') throw new Error(event.error?.message || 'Codex turn failed')
      if (event.type === 'error') throw new Error(event.message || 'Codex stream failed')
      if ((event.type === 'item.completed' || event.type === 'item.updated')
        && event.item?.type === 'agent_message') {
        const next = event.item.text || ''
        const delta = deltaFromFullText(full, next)
        full = next
        if (delta) onDelta(delta)
      }
    }
    return full
  } catch (err) {
    throw mapCodexError(err, { timedOut: runSignal.timedOut(), parentSignal: signal })
  } finally {
    runSignal.cleanup()
    await cleanup()
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

export async function runCodexJson(
  prompt,
  outputSchema,
  opts = {},
  { CodexImpl, env, config, signal, authCheck, runtimeHomeFactory, workingDirectoryFactory } = {},
) {
  const { thread, cleanup } = await createThread(opts, {
    CodexImpl,
    env,
    config,
    authCheck,
    runtimeHomeFactory,
    workingDirectoryFactory,
  })
  const runSignal = createRunSignal(signal, opts.timeoutMs)
  try {
    const turn = await thread.run(prompt, { outputSchema, signal: runSignal.signal })
    return parseCodexJson(turn.finalResponse)
  } catch (err) {
    throw mapCodexError(err, { timedOut: runSignal.timedOut(), parentSignal: signal })
  } finally {
    runSignal.cleanup()
    await cleanup()
  }
}
