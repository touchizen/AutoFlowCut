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

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
