// @vitest-environment node
/**
 * 렌더러 소스가 **파싱되는가**, 그리고 App 의 정적 import 그래프가 **해석되는가**.
 *
 * 유닛 테스트는 App.jsx 를 대부분 import 하지 않는다(무거워서 소스 문자열로만 읽는 테스트가 있다).
 * 그래서 `const x` 중복 선언이 6889개 초록불 아래에서 살아남아, 앱을 띄우는 순간
 * `Identifier 'projectLoadingRef' has already been declared` 로 죽었다 — 실제로 겪은 사고다.
 *
 * ⚠️ 이 테스트가 잡는 것은 **구문·중복선언·스코프**와 **없는 모듈/이름을 import 하는 것**까지다.
 *   Hook 순서 위반, 런타임 오류, 실제 번들 산출물은 못 잡는다 — 그건 실행/빌드가 잡는다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync, buildSync } from 'esbuild'

// pathname 을 그대로 쓰면 경로에 공백이 있을 때 %20 이 그대로 fs 에 넘어간다.
const SRC = fileURLToPath(new URL('../../src', import.meta.url))
const APP = join(SRC, 'App.jsx')

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if (['.js', '.jsx'].includes(extname(name))) out.push(p)
  }
  return out
}

describe('renderer sources', () => {
  it('src 아래 모든 js/jsx 가 파싱된다', () => {
    const files = collect(SRC)
    expect(files.length).toBeGreaterThan(50)
    const failures = []
    for (const file of files) {
      try {
        transformSync(readFileSync(file, 'utf8'), { loader: 'jsx', jsx: 'automatic' })
      } catch (e) {
        failures.push(`${file.replace(SRC, 'src')}: ${e.message.split('\n')[0]}`)
      }
    }
    expect(failures).toEqual([])
  })

  // 없는 파일/없는 export 를 import 하는 것은 파싱만으로는 안 잡힌다 — 그래프를 한 번 해석한다.
  it('App 의 import 그래프가 해석된다', () => {
    expect(() => buildSync({
      entryPoints: [APP],
      bundle: true,
      write: false,
      format: 'esm',
      loader: { '.js': 'jsx', '.jsx': 'jsx', '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
      // /assets/* 는 Vite 의 publicDir 로 서빙되는 절대 경로라 번들러가 풀 대상이 아니다.
      external: ['react', 'react-dom', 'react-dom/client', 'electron', 'firebase', 'firebase/*', '@sentry/*', '/assets/*'],
      logLevel: 'silent',
    })).not.toThrow()
  })
})
