import { defineConfig } from 'vitest/config'

/**
 * 라이브 스파이크 전용 config (M-1, 스펙 §3 M-1)
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다. 일반 `npm run test:run` 과 CI 에서는
 * 메인 config 의 exclude 가 tests/spike/** 를 빼므로 절대 실행되지 않는다.
 *
 * 왜 별도 파일인가: Vitest 4 는 `vitest.workspace.js` 를 제거했다(설치본 4.1.10).
 *
 * timeout: 10분 approval hold + 60분 workflow + cleanup 을 한 테스트가 덮어야 하므로
 * 75분보다 크게 둔다(M0-9 의 10분 elicitation hold, M0-10 의 60분 workflow).
 */
const NINETY_MIN_MS = 90 * 60 * 1000

export default defineConfig({
  test: {
    globals: true,
    // 실제 CLI/MCP 프로세스를 spawn 한다 — jsdom 이 아니라 node
    environment: 'node',
    include: ['tests/spike/**/*.spike.test.js'],
    testTimeout: NINETY_MIN_MS,
    hookTimeout: NINETY_MIN_MS,
    // 스파이크는 실제 자격증명/프로세스를 쓴다 — 병렬 실행 금지(서로 간섭)
    fileParallelism: false,
    pool: 'forks',
  },
})
