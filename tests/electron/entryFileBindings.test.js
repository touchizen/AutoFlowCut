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
import { execFileSync } from 'node:child_process'
import { parse } from '@babel/parser'            // @vitejs/plugin-react → @babel/core 가 설치한다
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default ?? traverseModule

// 리뷰 B R2 F1: 전역은 테스트 워커(globalThis)가 아니라 깨끗한 Node ESM 프로세스에서 받는다 — 워커에는 vitest 가 올린 describe·expect 와
//   vite define 상수(__BUILD_TARGET__ 등)가 있지만 main 번들(vite-plugin-electron 은 최상위 define 을 안 쓴다)과 mcp-server(순수 node)에는 없다.
const NODE_GLOBALS = new Set(JSON.parse(execFileSync(process.execPath, [
  '--input-type=module', '-e', 'process.stdout.write(JSON.stringify(Object.getOwnPropertyNames(globalThis)))',
], { encoding: 'utf8' })))

function undeclaredIdentifiers(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'importMeta', 'topLevelAwait'] })
  let unbound = []
  // 프로그램 스코프의 globals = 어느 스코프에도 바인딩 없는 이름 — 읽기(ReferencedIdentifier)뿐 아니라 선언 없는 대입의 좌변도 들어간다(ESM strict 에선 둘 다 ReferenceError).
  traverse(ast, { Program(p) { unbound = Object.keys(p.scope.globals) } })
  // 두 파일은 ESM(package.json type: module) — require·__dirname 같은 CJS 모듈 스코프 이름도 선언 없이 쓰면 안 된다
  return unbound.filter((name) => !NODE_GLOBALS.has(name)).sort()
}

describe('진입 파일의 선언되지 않은 식별자', () => {
  it('검출기는 import 에서 빠진 이름을 잡고, import·지역 선언·Node 전역은 잡지 않는다(양성·음성 대조)', () => {
    const source = [
      "import { app } from 'electron'",
      'const local = 1',
      "app.on('ready', () => { dialog.showOpenDialog(local); require('fs'); process.exit(0); setTimeout(() => {}, 1) })",
      // 리뷰 B R2 F1: 렌더러 빌드 상수(vitest define 으로 테스트 워커 전역에는 있다)와 선언 없는 대입도 잡아야 한다
      "const isAppx = __BUILD_TARGET__ === 'appx'",
      'lastSeenAt = Date.now()',
    ].join('\n')
    expect(undeclaredIdentifiers(source)).toEqual(['__BUILD_TARGET__', 'dialog', 'lastSeenAt', 'require'])
  })

  it.each(['electron/main.js', 'mcp-server/index.js'])('%s', (rel) => {
    expect(undeclaredIdentifiers(readFileSync(rel, 'utf8'))).toEqual([])
  })
})

// 리뷰 B R2 F2: DELETE /api/projects 의 Windows EPERM 폴백은 catch 에서 projectName·projectDir 를 읽는다. try 안에서 다시 선언하면
//   catch 는 블록 머리의 null 을 보고 폴백이 조용히 꺼진다(또는 deleted:null) — 이름은 선언돼 있으니 위 검사로는 안 보인다.
describe('main.js — DELETE /api/projects 폴백이 읽는 이름', () => {
  it('projectName·projectDir 는 블록 머리의 let 한 번만 선언되고, 폴백은 import 한 execSyncRaw 로 그 경로를 지운다', () => {
    const main = readFileSync('electron/main.js', 'utf8')
    const start = main.indexOf("if (req.method === 'DELETE' && pathname === '/api/projects') {")
    const block = main.slice(start, main.indexOf('// 404', start))
    expect(start).toBeGreaterThan(-1)
    expect(block.match(/\b(?:const|let|var)\s+projectDir\b/g)).toEqual(['let projectDir'])
    expect(block.match(/\b(?:const|let|var)\s+projectName\b/g)).toEqual(['let projectName'])
    expect(block).toContain('execSyncRaw(`rmdir /s /q "${projectDir}"`')
  })
})
