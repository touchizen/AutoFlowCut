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
