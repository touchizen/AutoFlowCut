/**
 * M0-8 보강 — 내장 `codex_apps` 격리.
 *
 * **이 파일이 존재하는 이유:** 이전 라운드에서 나는 "codex_apps 를 끄는 스위치가 없다" 고 **오판**했다.
 * 두 가지를 틀렸다:
 *   1. 제품 코드(`electron/api/llm/codexSdk.js` 의 `TOOL_FEATURE_OVERRIDES`)에 이미 `apps: false` 가 있는데
 *      **열어보지 않았다.**
 *   2. `mcpServerStatus/list` 를 **threadId 없이** 불러서 thread 스코프가 아니라 전역 인벤토리를 보고 있었다.
 *
 * 그래서 여기서 **thread 스코프로** 두 프로필을 나란히 재고 raw 에 남긴다.
 *
 * ⚠️ 왜 중요한가: 기본 프로필의 `codex_apps` 는 사용자 ChatGPT 계정에 작용하는 툴 31개
 *    (`sites.create_site`, `sites.deploy_site_version`, `sites.create_source_repository_write_credential`,
 *     `sites.generate_siwc_bypass_token`, `codex_document_control.*`, `hotline.*` …)를 노출하고,
 *    **어떤 approvalPolicy 로도 elicitation 게이트를 타지 않는다** (never/granular/on-request/untrusted 전부 0회 실측).
 *    D9 의 승인 게이트는 **user MCP 서버만** 덮는다. 따라서 lockdown 은 선택이 아니라 필수다.
 *
 * 이 테스트는 **툴을 호출하지 않는다** — 인벤토리만 읽는다. (사용자 계정에 부작용을 내지 않기 위해서다.)
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, existsSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildCodexClientOptions, resolveCodexExecutablePath } from '../../electron/api/llm/codexSdk.js'

const RESULT_DIR = 'docs/superpowers/specs'
const CODEX_BIN = resolveCodexExecutablePath()
const CODEX_VERSION = execFileSync(CODEX_BIN, ['--version'], { encoding: 'utf-8' }).trim()

const RUN_ID = process.env.SPIKE_RUN_ID ?? `nofile-${process.pid}`

const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(
    `${RESULT_DIR}/m0-8-9-raw.jsonl`,
    JSON.stringify({ runId: RUN_ID, label, codexBin: CODEX_BIN, codexVersion: CODEX_VERSION, ...data }) + '\n',
  )
}

/** raw 행만 봐서는 PASS 였는지 알 수 없다 (report 는 assertion 전에 기록한다). 판정을 따로 남긴다. */
afterEach((ctx) => {
  record('__verdict__', { test: ctx?.task?.name ?? '(?)', verdict: ctx?.task?.result?.state ?? 'unknown' })
})

// 🔴 temp CODEX_HOME 에는 사용자의 진짜 auth.json 복사본이 있다. 반드시 지운다.
const workDirs = []
afterEach(() => {
  while (workDirs.length) rmSync(workDirs.pop(), { recursive: true, force: true })
})

/** thread 하나를 열고 **그 thread 가 보는** MCP 인벤토리를 읽는다. 턴은 돌리지 않는다. */
function threadInventory({ config }) {
  return new Promise((resolve_) => {
    const workDir = mkdtempSync(join(tmpdir(), 'm0-8-iso-'))
    workDirs.push(workDir)
    const codexHome = join(workDir, 'codex-home')
    mkdirSync(codexHome, { recursive: true })
    const realAuth = join(process.env.HOME, '.codex', 'auth.json')
    if (existsSync(realAuth)) copyFileSync(realAuth, join(codexHome, 'auth.json'))

    const child = spawn(CODEX_BIN, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_HOME: codexHome },
    })
    const send = (m) => child.stdin.write(JSON.stringify(m) + '\n')
    let buf = ''
    let settled = false
    let tid = null
    const servers = []
    const finish = (out) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      resolve_(out)
    }
    const timer = setTimeout(() => finish({ timedOut: true, servers: null }), 120_000)

    child.stdout.on('data', (d) => {
      buf += d.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line) continue
        let m; try { m = JSON.parse(line) } catch { continue }
        if (m.method) continue

        if (m.id === 0 && m.result) {
          send({ jsonrpc: '2.0', method: 'initialized', params: {} })
          send({ jsonrpc: '2.0', id: 1, method: 'thread/start', params: { cwd: workDir, sandbox: 'read-only', config } })
        }
        if (m.id === 1) {
          if (m.error) return finish({ threadError: m.error, servers: null })
          tid = m.result?.threadId ?? m.result?.thread?.id
          // ⚠️ threadId 를 반드시 준다. 없으면 thread 스코프가 아니라 전역 목록이 온다 — 이걸로 오판했었다.
          setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'mcpServerStatus/list', params: { threadId: tid } }), 8000)
        }
        if (m.id === 2) {
          if (m.error) return finish({ listError: m.error, servers: null })
          servers.push(...(m.result?.data ?? []).map((sv) => ({ name: sv.name, tools: Object.keys(sv.tools ?? {}) })))
          // ⚠️ 페이지네이션. 첫 페이지만 읽으면 둘째 페이지의 codex_apps 를 놓친다.
          if (m.result?.nextCursor) {
            send({ jsonrpc: '2.0', id: 2, method: 'mcpServerStatus/list', params: { threadId: tid, cursor: m.result.nextCursor } })
          } else {
            finish({ timedOut: false, servers })
          }
        }
      }
    })
    child.on('error', (e) => finish({ spawnError: String(e.message || e), servers: null }))

    send({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: {
        clientInfo: { name: 'autoflowcut-m0-8-iso', title: 'AutoFlowCut M0-8', version: '0.0.1' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    })
  })
}

describe('M0-8 — 내장 codex_apps 격리', () => {
  it('기본 프로필: codex_apps 가 붙고 사용자 계정 툴을 노출한다 (= lockdown 없이 ship 하면 안 되는 이유)', async () => {
    const r = await threadInventory({ config: {} })
    record('M0-8 격리: 기본 프로필 (lockdown 없음)', r)
    console.log('\n[기본 프로필] servers:', r.servers?.map((s) => `${s.name}[${s.tools.length}]`).join(' '))

    expect(r.timedOut).toBe(false)
    const apps = r.servers?.find((s) => s.name === 'codex_apps')
    expect(apps, 'codex_apps 가 안 붙었다 — 이 테스트의 전제가 깨졌다(그 자체가 finding 이다)').toBeTruthy()
    expect(apps.tools.length).toBeGreaterThan(0)
    // 노출되는 게 무해한 툴이 아니라 **계정에 작용하는 툴**임을 못박는다.
    expect(apps.tools).toContain('sites.create_site')
    expect(apps.tools).toContain('sites.deploy_site_version')
  }, 4 * 60 * 1000)

  it('제품 프로필(buildCodexClientOptions): codex_apps 가 사라진다', async () => {
    const { config } = buildCodexClientOptions({ env: process.env })
    expect(config.features.apps, '제품 lockdown 에서 apps 가 false 가 아니다').toBe(false)

    const r = await threadInventory({ config })
    record('M0-8 격리: 제품 프로필 (TOOL_FEATURE_OVERRIDES)', r)
    console.log('[제품 프로필] servers:', r.servers?.map((s) => `${s.name}[${s.tools.length}]`).join(' ') || '(없음)')

    expect(r.timedOut).toBe(false)
    expect(r.servers).toEqual([])   // MCP 서버 0개. codex_apps 도 없다.
  }, 4 * 60 * 1000)
})
