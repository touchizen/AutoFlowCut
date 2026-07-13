/**
 * M0-12 — Codex app-server `model/list` 실측.
 *
 * 스펙: "설치된 0.142.5의 `model/list`를 저장한다. **gpt-5.6 존재를 전제하지 않는다.**"
 * 실제 설치본은 **0.144.1** 이라 스펙 앵커가 이미 드리프트했다. 그래서 더더욱 실측이다.
 *
 * 부수적으로 이 스파이크가 M0-10/M0-11 이 쓸 app-server stdio JSON-RPC 경로를 처음 여는 셈이라,
 * handshake 가 되는지 자체가 결과다(FAIL 이면 Codex 오케스트레이터 옵션이 통째로 흔들린다).
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다. 실제 Codex 자격증명을 쓴다.
 */
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'

const RESULT_DIR = 'docs/superpowers/specs'
const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(`${RESULT_DIR}/m0-12-raw.jsonl`, JSON.stringify({ label, ...data }) + '\n')
}

/**
 * codex app-server 를 stdio 로 띄우고 JSON-RPC 요청 하나를 보낸 뒤 응답을 받는다.
 * 프로토콜 세부를 모르는 상태에서의 탐침이므로, **받은 것을 전부 raw 로 남긴다.**
 */
function appServerCall({ method, params = {}, timeoutMs = 60_000 }) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    const stdoutLines = []
    const stderrChunks = []
    let buf = ''
    let settled = false

    const finish = (extra) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      resolve({ stdoutLines, stderr: stderrChunks.join('').slice(0, 2000), ...extra })
    }

    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs)

    child.stdout.on('data', (d) => {
      buf += d.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        stdoutLines.push(line)
        try {
          const msg = JSON.parse(line)
          // 우리가 보낸 id 에 대한 응답이면 끝.
          if (msg.id === 1) finish({ response: msg })
        } catch { /* JSON 아닌 로그 라인 — 그대로 보관 */ }
      }
    })
    child.stderr.on('data', (d) => stderrChunks.push(d.toString()))
    child.on('error', (e) => finish({ spawnError: String(e.message || e) }))
    child.on('exit', (code) => finish({ exitCode: code }))

    // 1차 탐침에서 app-server 가 `Not initialized`(-32600) 로 거절했다 → handshake 가 필수다.
    // initialize(id:0) 를 먼저 보내고, 그 응답을 본 뒤 실제 method(id:1) 를 보낸다.
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { clientInfo: { name: 'autoflowcut-m0-spike', title: 'AutoFlowCut M0', version: '0.0.1' } },
    }) + '\n')
    // initialize 응답(또는 실패)을 본 직후 목표 method 를 보낸다.
    const onInit = (d) => {
      if (!String(d).includes('"id":0')) return
      child.stdout.off('data', onInit)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\n')
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n')
    }
    child.stdout.on('data', onInit)
  })
}

describe('M0-12 — Codex app-server model/list', () => {
  it('설치본 0.144.1 의 model/list 를 실측해 저장한다 (gpt-5.6 존재를 전제하지 않는다)', async () => {
    const r = await appServerCall({ method: 'model/list', params: {} })
    record('model/list (codex 0.144.1)', r)

    console.log('\n===== M0-12 codex app-server model/list =====')
    console.log('  timedOut   :', !!r.timedOut)
    console.log('  spawnError :', r.spawnError || 'none')
    console.log('  exitCode   :', r.exitCode ?? '(killed)')
    console.log('  stdout 첫 5줄:')
    for (const l of r.stdoutLines.slice(0, 5)) console.log('    ', l.slice(0, 220))
    if (r.response) console.log('  response   :', JSON.stringify(r.response).slice(0, 800))
    if (r.stderr) console.log('  stderr     :', r.stderr.slice(0, 400))

    // 이 스파이크는 판정이 아니라 기록이다 — 프로세스가 떴다는 것만 확인한다.
    expect(r.spawnError ?? null).toBeNull()
  }, 3 * 60 * 1000)
})
