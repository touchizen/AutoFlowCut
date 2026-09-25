// @vitest-environment node
// M2 실기 준비: MCP HTTP `POST /api/start-scene-batch` 가 `mode`('video'|'image') 를 렌더러로 넘긴다.
//   렌더러(useMcpServer.__mcpStartBatch → MCP_BATCH_MODE_TAB) 는 이미 mode 를 탭 오버라이드로 쓰는데(startBatchMode 테스트),
//   main 의 라우트가 styleId·force 만 파싱해 mode 가 버려졌다 — 에이전트가 UI 탭과 무관하게 T2V 배치를 못 돌렸다.
//   라우트 하네스가 없어 소스 핀(다른 main.js 핀과 같은 방식).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MAIN = readFileSync(fileURLToPath(new URL('../../electron/main.js', import.meta.url)), 'utf8')
const DOCS = readFileSync(fileURLToPath(new URL('../../electron/api-docs.js', import.meta.url)), 'utf8')
const block = () => MAIN.slice(MAIN.indexOf("pathname === '/api/start-scene-batch'"), MAIN.indexOf("pathname === '/api/notify-qa'"))

describe('main.js — POST /api/start-scene-batch 는 mode 를 렌더러에 전달한다', () => {
  it('요청 본문의 mode 를 파싱해 mcp-update 페이로드에 싣는다', () => {
    const b = block()
    expect(b).toMatch(/parsed\.mode/)
    expect(b).toMatch(/send\('mcp-update',\s*\{[^}]*type:\s*'start-scene-batch'[^}]*mode/)
  })
  it('api-docs 의 start-scene-batch 스키마에 mode 가 있다', () => {
    const d = DOCS.slice(DOCS.indexOf("'/api/start-scene-batch'"), DOCS.indexOf("'/api/start-ref-batch'"))
    expect(d).toMatch(/mode:\s*\{\s*type:\s*'string'/)
  })
})
