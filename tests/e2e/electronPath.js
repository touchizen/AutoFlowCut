import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Electron 을 띄울 때 넘길 env.
 *
 * ⚠️ `{...process.env}` 를 그대로 넘기면 안 된다. 개발 셸(특히 VSCode 확장 호스트)에는
 * **`ELECTRON_RUN_AS_NODE=1` 이 이미 export 돼 있고**, 그러면 Electron 이 순수 node 로 떠서
 * `bad option: --remote-debugging-port` 로 죽는다. 실측으로 걸렸다.
 *
 * (같은 이유로 D23 은 Claude/Codex child 에도 ambient env 상속을 금지하고 allowlist 를 쓴다.)
 */
export function electronLaunchEnv(overrides = {}) {
  const env = { ...process.env, ...overrides }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/**
 * 개발용 Electron 실행 파일 경로.
 *
 * postinstall(`scripts/patch-electron-name.cjs`)이 `Electron.app` → `AutoFlowCut.app` 으로
 * 개명하고 바이너리 이름도 바꾼다. 그래서 `require('electron')` 가 돌려주는 기본 경로나
 * Playwright 의 자동 탐지에 기댈 수 없다 — 개명본을 먼저 찾고, 없으면 원본으로 폴백한다.
 */
export function resolveElectronExecutable(root = resolve(import.meta.dirname, '../..')) {
  const dist = resolve(root, 'node_modules/electron/dist')

  const candidates =
    process.platform === 'darwin'
      ? [
          resolve(dist, 'AutoFlowCut.app/Contents/MacOS/AutoFlowCut'),
          resolve(dist, 'Electron.app/Contents/MacOS/Electron'),
        ]
      : process.platform === 'win32'
        ? [resolve(dist, 'AutoFlowCut.exe'), resolve(dist, 'electron.exe')]
        : [resolve(dist, 'autoflowcut'), resolve(dist, 'electron')]

  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    throw new Error(
      `Electron 실행 파일을 찾지 못했다. 확인한 경로:\n${candidates.join('\n')}\n` +
        `postinstall 이 개명했을 수 있다 — scripts/patch-electron-name.cjs 참고.`
    )
  }
  return found
}
