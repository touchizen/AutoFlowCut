// @vitest-environment node
// M2 실기 준비: MCP HTTP `POST /api/start-scene-batch` 가 `mode`('video'|'image') 를 렌더러로 넘긴다.
//   렌더러(useMcpServer.__mcpStartBatch → MCP_BATCH_MODE_TAB) 는 mode 를 탭 오버라이드로 쓴다(startBatchMode 테스트).
// M2-LIVE N7(A5/A6/B7): 옛 핀은 텍스트(`parsed.mode` 가 소스에 있다)라 `mode = typeof parsed.mode === 'string' ? null : null` 뮤턴트도 통과했고, 라우트는 모르는 값
//   ('Video'·'v2v'·'constructor')을 그대로 넘겨 렌더러가 현재 UI 탭으로 조용히 떨어졌다(이미지 탭이면 영상 씬 대신 **이미지 배치**가 과금된다). 본문 파싱을 순수 헬퍼
//   parseStartSceneBatchBody 로 빼서 행동을 묶고(mode 는 없거나 'video'|'image' 만, 아니면 400), 라우트는 그 헬퍼를 쓴다는 소스 핀만 남긴다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseStartSceneBatchBody } from '../../electron/mcp-http-parsers.js'

const MAIN = readFileSync(fileURLToPath(new URL('../../electron/main.js', import.meta.url)), 'utf8')
const DOCS = readFileSync(fileURLToPath(new URL('../../electron/api-docs.js', import.meta.url)), 'utf8')
const block = () => MAIN.slice(MAIN.indexOf("pathname === '/api/start-scene-batch'"), MAIN.indexOf("pathname === '/api/notify-qa'"))

describe('parseStartSceneBatchBody — POST /api/start-scene-batch 본문 → mcp-update 페이로드 (M2-LIVE N7)', () => {
  it("mode:'video' / 'image' 는 페이로드에 실린다(styleId·force 와 함께)", () => {
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: 'none', mode: 'video' }))).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: 'none', force: false, mode: 'video' } })
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: 'preset:x', force: true, mode: 'image' }))).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: 'preset:x', force: true, mode: 'image' } })
  })
  it('mode 생략·null → 페이로드에 mode 키 없음(현재 UI 탭 — 옛 호출자 호환); 본문 없음·깨진 JSON 도 옛 기본값 그대로', () => {
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: 'auto' }))).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: 'auto', force: false } })
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: 'auto', mode: null }))).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: 'auto', force: false } })
    expect(parseStartSceneBatchBody('')).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: null, force: false } })
    expect(parseStartSceneBatchBody('{oops')).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: null, force: false } })
  })
  it.each(['Video', 'v2v', 't2v', 'constructor', '__proto__', 'toString', '', 3, true])('mode=%s (모르는 값) → ok:false + 400 문구, 페이로드 없음', (mode) => {
    const r = parseStartSceneBatchBody(JSON.stringify({ styleId: 'none', mode }))
    expect(r).toEqual({ ok: false, error: "mode must be 'video' or 'image'" })
  })
})

describe('main.js — POST /api/start-scene-batch 는 parseStartSceneBatchBody 로 판정한다 (소스 핀)', () => {
  it('라우트가 parseStartSceneBatchBody(body) 를 쓰고, ok 가 아니면 400 + error, ok 면 payload 를 mcp-update 로 보낸다', () => {
    const b = block()
    expect(b).toMatch(/parseStartSceneBatchBody\(body\)/)
    expect(b).toMatch(/writeHead\(400\)/)
    expect(b).toMatch(/send\('mcp-update',\s*\w+\.payload\)/)
    expect(b).not.toMatch(/JSON\.parse\(body\)/)
    expect(MAIN).toMatch(/import \{[^}]*parseStartSceneBatchBody[^}]*\} from '\.\/mcp-http-parsers\.js'/)
  })
  it('api-docs 의 start-scene-batch 스키마에 mode(enum video|image) 가 있다', () => {
    const d = DOCS.slice(DOCS.indexOf("'/api/start-scene-batch'"), DOCS.indexOf("'/api/start-ref-batch'"))
    expect(d).toMatch(/mode:\s*\{\s*type:\s*'string',\s*enum:\s*\['video',\s*'image'\]/)
  })
})
