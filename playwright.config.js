import { defineConfig } from '@playwright/test'

/**
 * Playwright Electron 하네스 (M-1, 스펙 §3 M-1)
 *
 * packaging smoke([C])와는 분리한다. 여기는 **빌드된 dist-electron 을 개발 Electron 바이너리로**
 * 띄우는 [P] 경로다.
 *
 * ⚠️ `main` 이 `dist-electron/main.js` 라 [P] 슬라이스는 **빌드 선행**이 필요하다.
 * ⚠️ postinstall(`scripts/patch-electron-name.cjs`)이 Electron 바이너리를 `AutoFlowCut.app` 으로
 *    개명하므로 Playwright 의 자동 탐지가 안 먹는다 → `executablePath` 를 명시해야 한다
 *    (`tests/e2e/electronPath.js`).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
})
