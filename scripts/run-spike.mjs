/**
 * 라이브 스파이크 러너 (M-1)
 *
 * `SPIKE=1 vitest ...` 인라인 대입은 POSIX 전용이라 Windows cmd.exe 에서 안 돈다.
 * cross-env 의존성을 새로 들이지 않고 node 로 환경을 세팅해 넘긴다.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'

const RUN_ID = `${Date.now().toString(36)}-${process.pid}`

/**
 * ⚠️ **종료 코드를 raw 에 남긴다.** 안 그러면 저장된 raw 만으로는 "이 invocation 이 성공적으로 끝났는가" 를
 * 증명할 수 없다 — 마지막 테스트의 `afterEach` 가 verdict 를 쓴 **뒤에** worker/afterAll/runner 가 죽어도
 * verdict 행들은 멀쩡해 보인다.
 */
const recordCompletion = (data) => {
  try {
    mkdirSync('docs/superpowers/specs', { recursive: true })
    appendFileSync(
      'docs/superpowers/specs/m0-8-9-raw.jsonl',
      JSON.stringify({ runId: RUN_ID, label: '__run_completed__', ...data }) + '\n',
    )
  } catch { /* raw 를 못 써도 러너는 죽지 않는다 */ }
}

const child = spawn(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.spike.config.js', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    // ⚠️ 한 invocation 을 하나의 id 로 묶는다. 파일마다 id 를 만들면 raw 에서 "이 줄들이 같은 run 인가" 를
    //    증명할 수 없고, 죽은 run 의 fork worker 가 끼어들어도 못 알아챈다 (실제로 밟았다).
    env: { ...process.env, SPIKE: '1', SPIKE_RUN_ID: RUN_ID },
  }
)

// 부모가 죽으면 child 도 죽여야 한다 — spike 는 60~90분짜리 CLI child 를 물고 있어서,
// supervisor 가 runner PID 만 종료하면 고아 프로세스가 남는다.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => child.kill(sig))
}

child.on('error', (err) => {
  console.error('[run-spike] vitest 를 띄우지 못했다:', err.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  recordCompletion({ exitCode: code ?? null, signal: signal ?? null })
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
