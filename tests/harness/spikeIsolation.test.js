// @vitest-environment node
/**
 * M-1 슬라이스 1 — spike 격리
 *
 * `tests/spike/**` 는 라이브 스파이크(실제 CLI/네트워크/최대 60분)라 일반 `npm run test:run`
 * 과 CI 에서 반드시 제외돼야 한다. SPIKE=1 + 전용 config 로만 돈다.
 *
 * ⚠️ Vitest 4 는 `vitest.workspace.js` 를 제거했다(설치본 4.1.4). 격리는 메인 config 의
 * exclude + 별도 `vitest.spike.config.js` 로 한다.
 *
 * ⚠️ config 객체를 읽어 assert 하는 건 **동어반복**이다 — 격리가 실제로 깨져도 통과할 수 있다.
 * 그래서 여기서는 **진짜 CLI discovery** (`vitest list`)를 sentinel 파일로 돌려서 고정한다.
 *
 * ⚠️ node 환경 강제: config 를 import 하면 vite/esbuild 가 딸려오는데, jsdom 의
 * TextEncoder 는 진짜 Uint8Array 를 안 내놔서 esbuild 가 invariant 위반으로 죽는다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const SENTINEL = resolve(root, 'tests/spike/__isolation_sentinel__.test.js')

/**
 * vitest 의 실제 파일 수집 결과 (실행은 안 하고 목록만).
 * `tests/spike` 로 필터를 걸어 528개 전체를 훑지 않게 한다 — 우리가 묻는 건
 * "이 config 가 tests/spike 아래를 잡느냐" 하나뿐이다.
 */
function discover(config, env = {}) {
  try {
    return execFileSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'list', '-c', config, 'tests/spike'],
      { cwd: root, encoding: 'utf-8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (e) {
    // list 가 0건이면 vitest 가 비영 종료할 수 있다 — stdout 을 그대로 본다
    return `${e.stdout || ''}${e.stderr || ''}`
  }
}

beforeAll(() => {
  mkdirSync(resolve(root, 'tests/spike'), { recursive: true })
  // 일부러 `.spike.` 없이 이름을 붙인다 — 이런 파일이 두 suite 모두에서 조용히
  // 사라지면(=false green) 그것 자체가 결함이다.
  writeFileSync(SENTINEL, `import { it, expect } from 'vitest'\nit('isolation sentinel', () => expect(1).toBe(1))\n`)
})

afterAll(() => rmSync(SENTINEL, { force: true }))

describe('M-1: spike 격리', () => {
  it('일반 실행(test:run)은 tests/spike 를 수집하지 않는다', () => {
    const out = discover('vitest.config.js')
    expect(out).not.toContain('__isolation_sentinel__')
    expect(out).not.toContain('tests/spike/')
  })

  it('spike 실행은 그 파일을 수집한다 — `.spike.` 없이 이름 붙여도 사라지지 않는다', () => {
    const out = discover('vitest.spike.config.js', { SPIKE: '1' })
    expect(out).toContain('__isolation_sentinel__')
  })

  it('SPIKE=1 이 없으면 spike config 는 실행을 거부한다 (npm script 밖에서도)', () => {
    const out = discover('vitest.spike.config.js', { SPIKE: '' })
    expect(out).toContain('SPIKE=1')
    expect(out).not.toContain('__isolation_sentinel__')
  })

  it('spike timeout 이 75분보다 크다 (10분 approval + 60분 workflow + cleanup)', async () => {
    process.env.SPIKE = '1'  // config 가 top-level 에서 강제하므로 import 전에 필요
    const { default: config } = await import('../../vitest.spike.config.js')

    const SEVENTY_FIVE_MIN_MS = 75 * 60 * 1000
    expect(config.test.testTimeout).toBeGreaterThan(SEVENTY_FIVE_MIN_MS)
    expect(config.test.hookTimeout).toBeGreaterThan(SEVENTY_FIVE_MIN_MS)
  })

  it('test:spike 는 cross-platform runner 를 쓰고, test:run 은 spike 를 안 건드린다', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))

    // `SPIKE=1 vitest ...` 인라인 대입은 Windows cmd.exe 에서 안 돈다
    expect(pkg.scripts['test:spike']).toBe('node scripts/run-spike.mjs')
    expect(pkg.scripts['test:run']).not.toContain('spike')
  })
})
