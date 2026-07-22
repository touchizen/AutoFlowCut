// @vitest-environment node
/**
 * 렌더러 소스가 **실제로 컴파일되는가**.
 *
 * 유닛 테스트는 App.jsx 를 대부분 import 하지 않는다(무거워서 소스 문자열로만 읽는 테스트가 있다).
 * 그래서 `const x` 중복 선언 같은 오류가 6889개 초록불 아래에서 살아남아, 앱을 띄우는 순간
 * `Identifier 'projectLoadingRef' has already been declared` 로 죽었다 — 실제로 겪은 사고다.
 *
 * 파서를 한 번 태우는 것만으로 그 계급(구문/중복선언/스코프)을 잡는다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { transformSync } from 'esbuild'

const SRC = new URL('../../src', import.meta.url).pathname

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if (['.js', '.jsx'].includes(extname(name))) out.push(p)
  }
  return out
}

describe('renderer sources compile', () => {
  const files = collect(SRC)

  it('src 아래 모든 js/jsx 가 파싱된다', () => {
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
})
