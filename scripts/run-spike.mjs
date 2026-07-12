/**
 * 라이브 스파이크 러너 (M-1)
 *
 * `SPIKE=1 vitest ...` 인라인 대입은 POSIX 전용이라 Windows cmd.exe 에서 안 돈다.
 * cross-env 의존성을 새로 들이지 않고 node 로 환경을 세팅해 넘긴다.
 */
import { spawn } from 'node:child_process'

const child = spawn(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.spike.config.js', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, SPIKE: '1' },
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
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
