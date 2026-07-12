import { defineConfig } from 'vitest/config'

/**
 * 라이브 스파이크 전용 config (M-1, 스펙 §3 M-1)
 *
 * `npm run test:spike` 로만 돈다. 일반 `npm run test:run` 과 CI 에서는 메인 config 의
 * exclude 가 tests/spike/** 를 빼므로 절대 실행되지 않는다.
 *
 * 왜 별도 파일인가: Vitest 4 는 `vitest.workspace.js` 를 제거했다(설치본 4.1.4).
 *
 * timeout: 10분 approval hold + 60분 workflow + cleanup 을 한 테스트가 덮어야 하므로
 * 75분보다 크게 둔다(M0-9 의 10분 elicitation hold, M0-10 의 60분 workflow).
 */
const NINETY_MIN_MS = 90 * 60 * 1000

// SPIKE=1 강제. npm script 가 값을 세팅하는 것만으로는 계약이 아니다 —
// config 경로만 알면(`vitest -c vitest.spike.config.js`) 실자격증명·장시간 실행이
// 사고로 돌아간다. 여기서 막아야 진짜 guard 다.
if (process.env.SPIKE !== '1') {
  throw new Error(
    'vitest.spike.config.js 는 SPIKE=1 에서만 실행된다. `npm run test:spike` 를 써라.\n' +
      '(라이브 스파이크는 실제 CLI 자격증명·네트워크를 쓰고 최대 60분 돈다.)'
  )
}

export default defineConfig({
  test: {
    globals: true,
    // 실제 CLI/MCP 프로세스를 spawn 한다 — jsdom 이 아니라 node
    environment: 'node',
    // ⚠️ `*.spike.test.js` 로 좁히면, 실수로 `foo.test.js` 라 이름 붙인 spike 는
    // 메인(제외됨)에서도 여기(미포함)에서도 안 돌아 조용히 사라진다 = false green.
    // 디렉터리 자체가 격리 경계이므로 tests/spike 아래 모든 test 를 잡는다.
    include: ['tests/spike/**/*.test.js'],
    testTimeout: NINETY_MIN_MS,
    hookTimeout: NINETY_MIN_MS,
    // 스파이크는 실제 자격증명/프로세스를 쓴다 — 병렬 실행 금지(서로 간섭)
    fileParallelism: false,
    pool: 'forks',
  },
})
