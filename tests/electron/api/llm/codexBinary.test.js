// @vitest-environment node
//
// 우리가 codex 에 의존하는 방식은 하나뿐이다: `@openai/codex` 가 실어 오는 네이티브 바이너리를
// `app-server` / `login status` 하위명령으로 띄운다. (@openai/codex-sdk 는 트랜스포트 교체로 제거됐다.)
// 이 계약이 깨지면 story 의 codex 엔진이 통째로 죽으므로 패키지 레벨에서 고정한다.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveCodexExecutablePath } from '../../../../electron/api/llm/codexSdk.js'

describe('codex 바이너리 계약', () => {
  it('@openai/codex 가 직접 의존성이다 (전이 의존에 기대지 않는다)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.dependencies['@openai/codex']).toBeTruthy()
    expect(pkg.dependencies['@openai/codex-sdk']).toBeUndefined()
  })

  it('플랫폼 바이너리를 찾아낸다', () => {
    expect(fs.existsSync(resolveCodexExecutablePath())).toBe(true)
  })

  it('app-server 하위명령이 존재한다', () => {
    const out = execFileSync(resolveCodexExecutablePath(), ['app-server', '--help'], { encoding: 'utf8', timeout: 30_000 })
    expect(out).toMatch(/app-server/i)
  })

  it('지원하지 않는 플랫폼은 명확히 던진다', () => {
    expect(() => resolveCodexExecutablePath({ platform: 'sunos', arch: 'sparc' }))
      .toThrow(/Unsupported Codex platform/)
  })
})

// 🔴 **`app.asar` 는 디렉토리가 아니라 파일이다.**
//    Electron 은 `fs` 를 asar 투명 처리하지만 **`child_process.spawn` 은 안 한다.**
//    그래서 `require.resolve` 가 asar 안 경로를 주면:
//      - `existsSync` → **true** (가드가 통과한다)
//      - `spawn`      → **ENOTDIR** (패키징 앱에서만 죽는다)
//    실앱 실측: 패키징 앱에서 에이전트가 `spawn ENOTDIR` 로 죽었다. dev 에선 asar 가 없어서 안 보인다.
describe('asar unpack 매핑', () => {
  it('asar 안 경로는 app.asar.unpacked 로 바꾼다 — 안 그러면 spawn 이 ENOTDIR 로 죽는다', async () => {
    const { toUnpackedPath } = await import('../../../../electron/api/llm/codexSdk.js')

    expect(toUnpackedPath('/A/Contents/Resources/app.asar/node_modules/x/bin/codex'))
      .toBe('/A/Contents/Resources/app.asar.unpacked/node_modules/x/bin/codex')
  })

  it('이미 unpacked 이거나 asar 가 아니면 그대로 둔다 — 이중 치환하지 않는다', async () => {
    const { toUnpackedPath } = await import('../../../../electron/api/llm/codexSdk.js')

    const unpacked = '/A/Contents/Resources/app.asar.unpacked/node_modules/x/bin/codex'
    expect(toUnpackedPath(unpacked)).toBe(unpacked)
    expect(toUnpackedPath('/repo/node_modules/x/bin/codex')).toBe('/repo/node_modules/x/bin/codex')
  })
})

// 🔴 **제품 경로를 태우는 테스트.** `toUnpackedPath` 를 따로 검사하는 것만으로는
//    "resolveCodexExecutablePath 가 그걸 *실제로 쓰는가*" 를 증명하지 못한다 —
//    실측: 매핑 호출을 지운 뮤턴트가 **살아남았다.** shape 이 아니라 effect 를 본다.
describe('패키징(asar) 레이아웃에서의 실행 경로', () => {
  it('asar 안으로 해석돼도 spawn 가능한 unpacked 경로를 돌려준다', async () => {
    const { resolveCodexExecutablePath } = await import('../../../../electron/api/llm/codexSdk.js')
    const asarPkg = '/A.app/Contents/Resources/app.asar/node_modules/@openai/codex-darwin-arm64/package.json'

    const executable = resolveCodexExecutablePath({
      platform: 'darwin',
      arch: 'arm64',
      resolvePlatformPackageJson: () => asarPkg,
      existsSyncImpl: () => true,
    })

    expect(executable, 'asar 안 경로를 그대로 돌려줬다 — spawn 이 ENOTDIR 로 죽는다')
      .not.toMatch(/app\.asar[/\\]/)
    expect(executable).toContain('app.asar.unpacked')
  })

  it('존재 검사도 unpacked 경로에 대고 한다 — asar 경로는 existsSync 가 true 라 아무것도 못 잡는다', async () => {
    const { resolveCodexExecutablePath } = await import('../../../../electron/api/llm/codexSdk.js')
    const checked = []

    resolveCodexExecutablePath({
      platform: 'darwin',
      arch: 'arm64',
      resolvePlatformPackageJson: () => '/A.app/Contents/Resources/app.asar/node_modules/@openai/codex-darwin-arm64/package.json',
      existsSyncImpl: (p) => { checked.push(p); return true },
    })

    expect(checked[0]).toContain('app.asar.unpacked')
  })
})
