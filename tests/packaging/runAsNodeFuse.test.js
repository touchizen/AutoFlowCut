import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// Codex adapter 아키텍처 **전체**가 `ELECTRON_RUN_AS_NODE=1` 위에 서 있다 (스펙 D19):
// stdio MCP adapter 는 패키징된 Electron 실행파일을 node 처럼 재실행해서 뜬다.
//
// 그런데 **`RunAsNode` fuse 끄기는 Electron 보안 하드닝 체크리스트의 표준 항목**이다.
// 누가 그걸 끄는 순간 adapter 는 **패키징 빌드에서만 조용히 죽는다** (dev 는 멀쩡하다).
//
// 실측 (2026-07-14): Electron 36.9.5 의 darwin/win32/linux stock 바이너리는 전부
// RunAsNode = ENABLE 이고, 이 레포엔 fuse 설정이 **하나도 없다** → 세 플랫폼 모두 기본값을 그대로 싣는다.
// 즉 이 계약이 깨지는 유일한 경로는 **누군가 fuse 설정을 새로 추가하는 것**이다. 여기서 잡는다.
//
// (패키징된 `.app` 바이너리의 fuse wire 자체는 M0-13 스파이크가 실측으로 확인한다.
//  이 테스트는 그 스파이크가 못 도는 CI/플랫폼에서도 도는 **플랫폼 독립 가드**다.)

const rootDir = path.resolve(__dirname, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))

function scriptSources() {
  const dir = path.join(rootDir, 'scripts')
  return fs.readdirSync(dir)
    .filter((f) => /\.(c?js|mjs)$/.test(f))
    .map((f) => ({ file: `scripts/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf8') }))
}

describe('RunAsNode fuse 는 켜져 있어야 한다 (Codex adapter 의 생명줄)', () => {
  test('electron-builder 설정이 RunAsNode 를 끄지 않는다', () => {
    const fuses = packageJson.build?.electronFuses
    if (fuses === undefined) return // 설정 없음 = Electron 기본값(ENABLE) 그대로 = 우리가 원하는 것

    expect(
      fuses.runAsNode,
      '🔴 build.electronFuses.runAsNode 가 꺼졌다 — Codex stdio adapter 가 패키징 빌드에서만 죽는다 (스펙 D19). '
      + '보안 하드닝으로 이걸 꺼야 한다면 **별도 런타임 패키징 대안**이 선행돼야 한다.',
    ).not.toBe(false)
  })

  test('빌드 스크립트가 fuse 를 뒤집지 않는다', () => {
    const offenders = scriptSources()
      .filter(({ text }) => /flipFuses|@electron\/fuses/.test(text))
      .map(({ file }) => file)

    expect(
      offenders,
      `🔴 ${offenders.join(', ')} 가 fuse 를 조작한다 — RunAsNode 가 꺼지면 Codex adapter 가 패키징에서만 죽는다. `
      + '의도한 것이라면 이 테스트를 RunAsNode=ENABLE 어서션으로 바꿔라.',
    ).toEqual([])
  })
})
