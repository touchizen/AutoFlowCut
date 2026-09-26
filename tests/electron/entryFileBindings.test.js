// @vitest-environment node
/**
 * 진입 파일(electron/main.js · mcp-server/index.js)에 선언되지 않은 식별자가 없다 — self-render 병합 리뷰 B F2.
 *
 * 두 파일은 import 를 양쪽 브랜치에서 합쳤다. 합집합에서 이름 하나가 빠져도(예: main.js 의 dialog, mcp-server 의
 * preserveSceneRuntimeFields) 이 파일들을 실행하는 테스트가 없어 스위트가 초록이었다 — main.js 는 top-level 에서 쓰면
 * 앱이 부팅하다 ReferenceError 로 죽고, mcp-server 는 도구 호출이 실패하거나 catch 에 삼켜져 조용히 동작이 빠진다.
 * 파서로 읽어 "어느 스코프에도 선언되지 않았고 Node 전역도 아닌 식별자"를 찾는다.
 * 검출기가 실제로 잡는지는 양성 대조(import 에서 빠진 이름)로 먼저 확인한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'            // @vitejs/plugin-react → @babel/core 가 설치한다
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default ?? traverseModule

function undeclaredIdentifiers(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'importMeta', 'topLevelAwait'] })
  const found = new Set()
  traverse(ast, {
    ReferencedIdentifier(p) {
      if (p.isJSXIdentifier()) return
      const { name } = p.node
      if (p.scope.hasBinding(name, true)) return
      // 두 파일은 ESM(package.json type: module) — require·__dirname 같은 CJS 모듈 스코프 이름도 선언 없이 쓰면 안 된다
      if (name in globalThis) return
      found.add(name)
    },
  })
  return [...found].sort()
}

describe('진입 파일의 선언되지 않은 식별자', () => {
  it('검출기는 import 에서 빠진 이름을 잡고, import·지역 선언·Node 전역은 잡지 않는다(양성·음성 대조)', () => {
    const source = [
      "import { app } from 'electron'",
      'const local = 1',
      "app.on('ready', () => { dialog.showOpenDialog(local); require('fs'); process.exit(0); setTimeout(() => {}, 1) })",
    ].join('\n')
    expect(undeclaredIdentifiers(source)).toEqual(['dialog', 'require'])
  })

  it.each(['electron/main.js', 'mcp-server/index.js'])('%s', (rel) => {
    expect(undeclaredIdentifiers(readFileSync(rel, 'utf8'))).toEqual([])
  })
})
