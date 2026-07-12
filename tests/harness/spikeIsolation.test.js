// @vitest-environment node
/**
 * M-1 슬라이스 1 — spike 격리
 *
 * ⚠️ node 환경 강제: config 를 import 하면 vite/esbuild 가 딸려오는데, jsdom 의
 * TextEncoder 는 진짜 Uint8Array 를 안 내놔서 esbuild 가 invariant 위반으로 죽는다.
 *
 * `tests/spike/**` 는 라이브 스파이크(실제 CLI/네트워크/최대 60분)라 일반 `npm run test:run`
 * 과 CI 에서 반드시 제외돼야 한다. SPIKE=1 + 전용 config 로만 돈다.
 *
 * ⚠️ Vitest 4 는 `vitest.workspace.js` 를 제거했다(설치본 4.1.10). 격리는 메인 config 의
 * exclude + 별도 `vitest.spike.config.js` 로 한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')

describe('M-1: spike 격리', () => {
  it('메인 vitest config 가 tests/spike/** 를 exclude 한다', async () => {
    const mod = await import('../../vitest.config.js')
    const config = mod.default

    expect(config.test.exclude).toBeDefined()
    expect(config.test.exclude).toContain('tests/spike/**')
  })

  it('전용 spike config 가 존재하고 tests/spike 만 include 한다', async () => {
    expect(existsSync(resolve(root, 'vitest.spike.config.js'))).toBe(true)

    const mod = await import('../../vitest.spike.config.js')
    const config = mod.default

    expect(config.test.include).toEqual(['tests/spike/**/*.spike.test.js'])
    // 스파이크는 실제 프로세스를 띄운다 — jsdom 아님
    expect(config.test.environment).toBe('node')
  })

  it('spike timeout 이 75분보다 크다 (10분 approval + 60분 workflow + cleanup)', async () => {
    const mod = await import('../../vitest.spike.config.js')
    const config = mod.default

    const SEVENTY_FIVE_MIN_MS = 75 * 60 * 1000
    expect(config.test.testTimeout).toBeGreaterThan(SEVENTY_FIVE_MIN_MS)
    expect(config.test.hookTimeout).toBeGreaterThan(SEVENTY_FIVE_MIN_MS)
  })

  it('package.json 에 test:spike 스크립트가 있고 SPIKE=1 을 켠다', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))

    expect(pkg.scripts['test:spike']).toBeDefined()
    expect(pkg.scripts['test:spike']).toContain('SPIKE=1')
    expect(pkg.scripts['test:spike']).toContain('vitest.spike.config.js')

    // 일반 test:run 은 spike config 를 쓰지 않는다
    expect(pkg.scripts['test:run']).not.toContain('spike')
  })
})
