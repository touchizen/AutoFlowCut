/**
 * M0-13 — 패키징 Codex adapter (**시스템 PATH 에서 `node` 제거**).
 *
 * **스펙 criterion:** 시스템 PATH 에서 `node` 를 제거하고 **packaged Electron runtime** 으로
 * echo adapter **handshake / tool call** 을 완주한다. **FAIL 이면 Codex ship 금지.**
 *
 * 스펙 D19: *"Codex stdio adapter command 에 문자열 `node` 를 쓰지 않는다.
 *            후보 구현은 패키징된 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` + adapter 절대경로다."*
 *
 * ⚠️ **왜 이게 위험한가:** 개발 머신엔 `node` 가 PATH 에 있다. 그래서 `command: 'node'` 로 짜도
 *    dev 에선 멀쩡히 돌고 **사용자 머신에서만 죽는다.** (같은 부류의 사고를 이 프로젝트가 이미 겪었다 —
 *    minify 가 함수명을 뭉개서 dev 는 되고 패키징만 깨지던 Flow DOM 주입.)
 *    그래서 여기서는 **PATH 에서 node 를 아예 빼고** 잰다.
 *
 * 두 겹으로 잰다:
 *   1. **runtime 치환** — Electron 바이너리 + `ELECTRON_RUN_AS_NODE=1` 로 stdio MCP adapter 가 도는가.
 *      (여기가 급소다. 이게 안 되면 패키징해도 소용없다.)
 *   2. **codex 가 그걸 spawn 하고 tool call 이 완주하는가** — PATH 에 node 가 없는 채로.
 *
 * `ELECTRON_RUN_AS_NODE` 는 **per-server env** 로 넣는다 — M0-11 이 그 경로가 되는 걸 실측했다.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { buildCodexClientOptions, resolveCodexExecutablePath, prepareCodexRuntimeHome } from '../../electron/api/llm/codexSdk.js'
import { buildOrchestratorThreadParams } from '../../electron/api/llm/codexAppServer.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, 'fixtures/echo-mcp.js')
const RESULT_DIR = 'docs/superpowers/specs'
const CODEX_BIN = resolveCodexExecutablePath()
const CODEX_VERSION = execFileSync(CODEX_BIN, ['--version'], { encoding: 'utf-8' }).trim()
const RUN_ID = process.env.SPIKE_RUN_ID ?? `nofile-${process.pid}`

/**
 * 패키징 앱이 쓰게 될 Electron 실행파일. 제품은 `process.execPath` 로 얻지만
 * (Electron main 안에서 돌 때 그게 곧 Electron 바이너리다), vitest 안에서는 node 라서
 * `electron` 패키지가 알려주는 경로를 쓴다 — **같은 바이너리다.**
 */
function resolveElectronBinary() {
  const require = createRequire(import.meta.url)
  const p = require('electron')           // electron 패키지는 실행파일 절대경로를 export 한다
  if (typeof p !== 'string' || !existsSync(p)) throw new Error(`electron binary not found: ${p}`)
  return p
}

/** `node` 가 **없는** PATH. 여기서 돌아야 사용자 머신에서 돈다. */
const CLEAN_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * **실제로 패키징된** `.app` (electron-builder). 없으면 그 테스트는 skip 한다 —
 * `npm run pack` 이 필요하고, CI 가 아니면 항상 있진 않다.
 * ⚠️ dev 의 `node_modules/electron` 바이너리로 대신하면 **asar 를 한 번도 안 재게 된다.**
 */
function packagedApp() {
  const app = resolve(process.cwd(), 'release/mac-arm64/AutoFlowCut.app')
  if (!existsSync(app)) return null
  return {
    app,
    electron: join(app, 'Contents/MacOS/AutoFlowCut'),
    resources: join(app, 'Contents/Resources'),
    asar: join(app, 'Contents/Resources/app.asar'),
  }
}

const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(
    `${RESULT_DIR}/m0-13-raw.jsonl`,
    JSON.stringify({ runId: RUN_ID, label, codexBin: CODEX_BIN, codexVersion: CODEX_VERSION, ...data }) + '\n',
  )
}

const cleanups = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()() })

describe('M0-13 — PATH 에 node 없이 packaged Electron runtime 으로 adapter', () => {
  it('전제: CLEAN_PATH 에는 정말 node 가 없다', () => {
    // 이걸 먼저 못박지 않으면, PATH 에 node 가 남은 채로 "PASS" 했다고 오판한다.
    let found = null
    try {
      found = execFileSync('/usr/bin/which', ['node'], {
        env: { PATH: CLEAN_PATH }, encoding: 'utf-8',
      }).trim()
    } catch { /* which 가 실패 = 못 찾음 = 우리가 원하는 것 */ }
    record('M0-13 전제: CLEAN_PATH 에 node 없음', { cleanPath: CLEAN_PATH, whichNode: found })
    expect(found, `CLEAN_PATH 에 node 가 있다(${found}) — 이 조건에서 PASS 해도 아무것도 증명 못 한다`).toBeNull()
  })

  it('Electron-as-node 가 stdio MCP adapter 의 의존성(ESM + MCP SDK + zod)을 로드한다', () => {
    const electron = resolveElectronBinary()
    // fixture 와 **같은 방식**으로 import 되는지 본다 — repo 안에서 돌아야 node_modules 가 풀린다.
    const probe = join(process.cwd(), '.m0-13-probe.mjs')
    cleanups.push(async () => rmSync(probe, { force: true }))
    writeFileSync(probe, [
      "import { z } from 'zod'",
      "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'",
      "console.log(JSON.stringify({ isElectron: !!process.versions.electron,",
      "  node: process.versions.node, electron: process.versions.electron ?? null,",
      "  zod: typeof z.string === 'function', mcp: typeof McpServer === 'function',",
      "  pathHasNode: (process.env.PATH||'').split(':').some(d => d.includes('nvm')) }))",
    ].join('\n'))

    const out = execFileSync(electron, [probe], {
      env: { PATH: CLEAN_PATH, ELECTRON_RUN_AS_NODE: '1', HOME: process.env.HOME },
      encoding: 'utf-8',
    })
    const info = JSON.parse(out.trim().split('\n').pop())
    record('M0-13 Electron-as-node 의존성 로드', { electronBin: electron, ...info })
    console.log('\n  Electron-as-node:', JSON.stringify(info))

    expect(info.isElectron, 'Electron 바이너리가 아니다 — 엉뚱한 걸 쟀다').toBe(true)
    expect(info.pathHasNode, 'PATH 에 node 가 남아 있다').toBe(false)
    expect(info.zod, 'zod 를 못 불렀다').toBe(true)
    expect(info.mcp, 'MCP SDK 를 못 불렀다').toBe(true)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 **패키징에서만 죽는 함정** — dev 에선 절대 안 보인다
  //
  // Electron 의 asar 지원은 **`require()`(CJS) 만** 덮는다. **ESM 로더는 안 덮는다.**
  // 우리 adapter 도, 제품 코드베이스도 전부 **ESM** 이다.
  // → **adapter 와 그 의존성이 `app.asar` 안에 있으면 패키징 빌드에서 죽는다.**
  //
  // 실측 (패키징된 `.app`, `ELECTRON_RUN_AS_NODE=1`, PATH 에 node 없음):
  //   asar 안 CJS `require('zod')`                      → ✅ 된다
  //   asar 안 ESM `import('@modelcontextprotocol/…')`   → ❌ `Cannot find module`
  //   asar **밖** 실제 경로의 ESM adapter               → ✅ 된다
  //
  // 이 프로젝트는 같은 부류를 이미 밟았다 (minify 가 함수명을 뭉개서 dev 는 되고 패키징만 깨지던 Flow DOM 주입).
  // ══════════════════════════════════════════════════════════════════════════

  it('🔴 tripwire: `RunAsNode` fuse 를 끄면 Codex adapter 가 통째로 죽는다', async () => {
    const pkg = packagedApp()
    if (!pkg) { record('M0-13 RunAsNode fuse', { skipped: '패키징된 .app 이 없다' }); console.log('  (skip)'); return }

    // 이 아키텍처 **전체**가 `ELECTRON_RUN_AS_NODE=1` 위에 서 있다.
    // **`RunAsNode` fuse 끄기는 Electron 보안 체크리스트의 표준 항목**이다 — 누가 hardening 하는 순간
    // **패키징 빌드에서만 조용히 죽는다.** 문서 제약으로만 두면 아무도 안 지킨다. 여기서 터지게 한다.
    const { getCurrentFuseWire, FuseV1Options } = await import('@electron/fuses')
    const wire = await getCurrentFuseWire(pkg.electron)
    // wire 는 **문자 코드**로 저장된다: '0'(48)=DISABLE, '1'(49)=ENABLE, '2'(50)=REMOVED, 'r'(114)=INHERIT
    const NAMES = { 48: 'DISABLE', 49: 'ENABLE', 50: 'REMOVED', 114: 'INHERIT' }
    const raw = wire[FuseV1Options.RunAsNode]
    const state = NAMES[raw] ?? String(raw)

    record('M0-13 RunAsNode fuse', { app: pkg.app, fuseVersion: wire.version, runAsNode: state })
    console.log('\n  RunAsNode fuse:', state)

    expect(
      state,
      '🔴 `RunAsNode` fuse 가 켜져 있지 않다 — Codex adapter(`ELECTRON_RUN_AS_NODE=1`)가 패키징 빌드에서 죽는다. '
      + '보안 hardening 으로 이걸 껐다면 **별도 런타임 패키징 대안**이 필요하다 (스펙 D19).',
    ).toBe('ENABLE')
  })

  it('🔴 패키징: adapter 의존성(MCP SDK/zod)이 app.asar **안**에 있으면 ESM import 가 죽는다', () => {
    const pkg = packagedApp()
    if (!pkg) { record('M0-13 asar 계약', { skipped: '패키징된 .app 이 없다' }); console.log('  (skip)'); return }

    const script = [
      "import('node:path').then(async (p) => {",
      "  const { createRequire } = await import('node:module')",
      "  const req = createRequire(process.execPath)   // ⚠️ ESM 컨텍스트엔 `require` 가 없다",
      "  const asar = p.join(process.resourcesPath || '', 'app.asar')",
      "  const out = {}",
      "  try { const z = req(p.join(asar,'node_modules','zod')); out.asarCjsRequire = !!z } catch (e) { out.asarCjsRequire = false; out.cjsErr = String(e.message).slice(0,80) }",
      "  try { const m = await import('file://' + p.join(asar,'node_modules','@modelcontextprotocol','sdk','server','mcp.js'));",
      "        out.asarEsmImport = typeof m.McpServer === 'function' } catch (e) { out.asarEsmImport = false; out.esmErr = String(e.message).slice(0,120) }",
      "  console.log(JSON.stringify(out))",
      "})",
    ].join('\n')

    const out = execFileSync(pkg.electron, ['--input-type=module', '-e', script], {
      env: { PATH: CLEAN_PATH, ELECTRON_RUN_AS_NODE: '1', HOME: process.env.HOME },
      encoding: 'utf-8',
    })
    const info = JSON.parse(out.trim().split('\n').pop())
    record('M0-13 asar: CJS 는 되고 ESM 은 죽는다', { app: pkg.app, ...info })
    console.log('\n  asar CJS require:', info.asarCjsRequire, '| asar ESM import:', info.asarEsmImport, info.esmErr ? `(${info.esmErr})` : '')

    // 이 두 줄이 **계약**이다. Electron 이 언젠가 asar ESM 을 지원하면 여기가 터지고,
    // 그때 비로소 "adapter 를 asar 에 넣어도 된다" 를 재검토할 수 있다.
    expect(info.asarCjsRequire, 'asar 안 CJS require 가 깨졌다 — 전제가 바뀌었다').toBe(true)
    expect(
      info.asarEsmImport,
      '🎉 asar 안 ESM import 가 이제 된다 — Electron 이 지원을 추가했다. adapter 배치 전략을 재검토하라.',
    ).toBe(false)
  })

  it('🎯 패키징된 .app 의 Electron 으로 **asar 밖** ESM adapter 를 돌린다 (PATH 에 node 없음)', () => {
    const pkg = packagedApp()
    if (!pkg) { record('M0-13 패키징 .app ESM', { skipped: '패키징된 .app 이 없다' }); console.log('  (skip)'); return }

    // adapter 는 **asar 밖 실제 경로**에 있어야 한다 (repo 의 `extraResources`(mcp-server) 와 같은 패턴).
    const probe = join(process.cwd(), '.m0-13-packaged-probe.mjs')
    cleanups.push(async () => rmSync(probe, { force: true }))
    writeFileSync(probe, [
      "import { z } from 'zod'",
      "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'",
      "console.log(JSON.stringify({ isElectron: !!process.versions.electron, electron: process.versions.electron,",
      "  node: process.versions.node, zod: typeof z.string === 'function', mcp: typeof McpServer === 'function' }))",
    ].join('\n'))

    const out = execFileSync(pkg.electron, [probe], {
      env: { PATH: CLEAN_PATH, ELECTRON_RUN_AS_NODE: '1', HOME: process.env.HOME },
      encoding: 'utf-8',
    })
    const info = JSON.parse(out.trim().split('\n').pop())
    record('M0-13 패키징 .app + asar 밖 ESM adapter', { app: pkg.app, electronBin: pkg.electron, ...info })
    console.log('  패키징 Electron:', JSON.stringify(info))

    expect(info.isElectron).toBe(true)
    expect(info.zod, '패키징 Electron 이 zod 를 못 불렀다').toBe(true)
    expect(info.mcp, '패키징 Electron 이 MCP SDK 를 못 불렀다').toBe(true)
  })

  it('🎯 codex 가 **패키징된** Electron-as-node adapter 를 spawn 하고 tool call 이 완주한다 (PATH 에 node 없음)', async () => {
    // ⚠️ **패키징된 `.app` 의 바이너리를 쓴다.** dev 의 `node_modules/electron` 으로 재면
    //    criterion(*"packaged Electron runtime 으로 handshake/tool call"*)을 **합성으로 주장**하는 게 된다.
    const pkg = packagedApp()
    const electron = pkg ? pkg.electron : resolveElectronBinary()
    const usedPackaged = !!pkg
    if (!pkg) console.log('  ⚠️ 패키징된 .app 이 없다 → dev electron 으로 대체한다. **criterion 미충족이다.** `npm run pack` 먼저.')
    const workDir = mkdtempSync(join(tmpdir(), 'm0-13-'))
    cleanups.push(async () => rmSync(workDir, { recursive: true, force: true }))
    const markerPath = join(workDir, 'marker')

    const runtime = await prepareCodexRuntimeHome({ env: process.env })
    cleanups.push(runtime.cleanup)

    const opts = buildCodexClientOptions({
      env: runtime.env,
      runtimeProfile: 'orchestrator',
      mcpServers: {
        echo: {
          // ⚠️ **문자열 `node` 를 쓰지 않는다** (스펙 D19). 패키징 Electron 실행파일 **절대경로**다.
          command: electron,
          args: [FIXTURE],
          env: {
            // M0-11 이 per-server env 전달을 실측했다 — 그 경로로 넣는다.
            ELECTRON_RUN_AS_NODE: '1',
            ECHO_GATED_MARKER_FILE: markerPath,
          },
        },
      },
    })

    // 🔴 **app-server 의 PATH 에서 node 를 뺀다.** 이게 이 테스트의 전부다.
    //    (codex 자신은 절대경로로 spawn 하므로 PATH 가 없어도 뜬다.)
    const env = { ...opts.env, PATH: CLEAN_PATH }

    const child = spawn(CODEX_BIN, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env })
    cleanups.push(async () => { try { child.kill('SIGTERM') } catch {} })

    const stderr = []
    child.stderr.on('data', (d) => stderr.push(d.toString()))

    const r = await new Promise((res) => {
      let buf = ''
      let settled = false
      const toolCalls = []
      let inventory = null
      const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); res({ toolCalls, inventory, ...v }) } }
      const timer = setTimeout(() => finish({ timedOut: true }), 6 * 60 * 1000)
      const send = (m) => child.stdin.write(JSON.stringify(m) + '\n')

      child.stdout.on('data', (d) => {
        buf += d.toString()
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
          if (!line) continue
          let m; try { m = JSON.parse(line) } catch { continue }

          if (m.method) {
            if (m.method === 'mcpServer/elicitation/request') {
              const isNative = m.params?._meta?.codex_approval_kind === 'mcp_tool_call'
              send({ jsonrpc: '2.0', id: m.id, result: isNative
                ? { action: 'accept', content: {}, _meta: null }
                : { action: 'accept', content: { approve: true }, _meta: null } })
              continue
            }
            if (m.method === 'item/completed' && m.params?.item?.type === 'mcpToolCall') {
              const it = m.params.item
              toolCalls.push({ server: it.server, tool: it.tool, status: it.status, resultText: it.result?.content?.map((c) => c.text).join('') ?? null })
            }
            if (m.method === 'turn/completed') {
              finish({ timedOut: false, turnStatus: m.params?.turn?.status ?? null, turnError: m.params?.turn?.error ?? null })
            }
            continue
          }

          if (m.id === 0 && m.result) {
            send({ jsonrpc: '2.0', method: 'initialized', params: {} })
            send({ jsonrpc: '2.0', id: 1, method: 'thread/start',
              params: buildOrchestratorThreadParams({ workingDirectory: workDir, config: opts.config }) })
          }
          if (m.id === 1) {
            if (m.error) return finish({ threadError: m.error })
            const threadId = m.result?.threadId ?? m.result?.thread?.id
            send({ jsonrpc: '2.0', id: 3, method: 'mcpServerStatus/list', params: { threadId } })
            send({ jsonrpc: '2.0', id: 2, method: 'turn/start', params: {
              threadId,
              input: [{ type: 'text', text: 'Call the "echo" tool from the echo MCP server with text "m0-13". Then reply with the tool result.' }],
            } })
          }
          if (m.id === 3 && m.result) {
            inventory = (m.result.data ?? []).map((s) => ({ name: s.name, tools: Object.keys(s.tools ?? {}).sort() }))
          }
          if (m.id === 2 && m.error) finish({ turnError: m.error })
        }
      })

      send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
        clientInfo: { name: 'autoflowcut-m0-13', title: 'AutoFlowCut M0-13', version: '0.0.1' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      } })
    })

    const out = { electronBin: electron, usedPackaged, cleanPath: CLEAN_PATH, ...r, stderr: stderr.join('').slice(0, 800) }
    record('M0-13 codex + Electron-as-node adapter', out)
    console.log('\n===== M0-13 =====')
    console.log('  electron  :', electron, usedPackaged ? '(패키징 .app ✅)' : '(dev — criterion 미충족 ⚠️)')
    console.log('  PATH      :', CLEAN_PATH, '(node 없음)')
    console.log('  inventory :', JSON.stringify(r.inventory))
    console.log('  toolCalls :', JSON.stringify(r.toolCalls))
    console.log('  turn      :', r.turnStatus, r.turnError ? JSON.stringify(r.turnError) : '')
    if (r.stderr) console.log('  stderr    :', out.stderr.slice(0, 300))

    // ── handshake: adapter 가 떴고 툴이 노출됐다 ──
    expect(r.timedOut, 'PATH 에 node 없이 6분 안에 완주하지 못했다').toBe(false)
    expect(r.threadError ?? null).toBeNull()
    expect(r.inventory, 'MCP 인벤토리를 못 읽었다').toBeTruthy()
    expect(r.inventory).toEqual([{ name: 'echo', tools: ['echo', 'echo_gated'] }])

    // ── tool call: 완주했다 ──
    const echo = r.toolCalls.find((t) => t.tool === 'echo')
    expect(echo, `echo tool call 이 없다 — adapter 가 안 떴을 수 있다. stderr=${out.stderr.slice(0, 200)}`).toBeTruthy()
    expect(echo.status).toBe('completed')
    expect(echo.resultText).toContain('m0-13')
    expect(r.turnStatus).toBe('completed')

    // 🔴 criterion 은 **packaged Electron runtime** 이다. dev 바이너리로 통과해도 그건 합성이다.
    expect(usedPackaged, 'criterion 은 packaged Electron runtime 이다 — `npm run pack` 후 다시 재라').toBe(true)
  }, 10 * 60 * 1000)
})
