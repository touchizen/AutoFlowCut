/**
 * M-1 슬라이스 3 `[P]` — 빌드된 Electron 을 **명시 executablePath** 로 띄운다.
 *
 * 선행: `npm run build` (main 이 dist-electron/main.js).
 * 이 하네스 위에 D24a-13(실제 PNG/JPEG import → reopen) 같은 [P] 슬라이스가 붙는다.
 */
import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveElectronExecutable, electronLaunchEnv } from './electronPath.js'

const root = resolve(import.meta.dirname, '../..')

test('빌드된 Electron 이 명시 executablePath 로 뜨고 창을 연다', async () => {
  // [P] 는 빌드 선행이 필요하다 — 없으면 조용히 통과시키지 않고 명시적으로 실패한다.
  expect(
    existsSync(resolve(root, 'dist-electron/main.js')),
    'dist-electron/main.js 가 없다 — `npm run build` 를 먼저 돌려라'
  ).toBe(true)

  const app = await electron.launch({
    executablePath: resolveElectronExecutable(root),
    args: [root],
    env: electronLaunchEnv({ NODE_ENV: 'test', E2E: '1' }),
  })

  const window = await app.firstWindow()
  await expect.poll(() => window.title()).toBeTruthy()

  await app.close()
})
