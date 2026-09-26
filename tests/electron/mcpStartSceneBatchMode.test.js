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
  it('mode 생략·null → 페이로드에 mode 키 없음(현재 UI 탭 — 옛 호출자 호환); 본문 없음(빈 문자열·공백)은 옛 기본값 그대로', () => {
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: 'auto' }))).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: 'auto', force: false } })
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: 'auto', mode: null }))).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: 'auto', force: false } })
    expect(parseStartSceneBatchBody('')).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: null, force: false } })
    expect(parseStartSceneBatchBody('  \n')).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: null, force: false } })
    expect(parseStartSceneBatchBody(undefined)).toEqual({ ok: true, payload: { type: 'start-scene-batch', styleId: null, force: false } })
  })

  // M2-CLOSE O4(A4): 옛 파서는 mode 에만 엄격했다 — 비어 있지 않은데 파싱이 안 되는 본문(`{"mode":"video",}`)은 조용히 기본값(현재 UI 탭·force false)으로 배치를 시작했고,
  //   `force: !!parsed.force` 는 "false"·"0" 을 true 로 만들어 완료된 씬 전부(과금된 영상 포함)를 재생성했다. 이제 셋 다 400.
  it.each(['{"mode":"video",}', '{oops', 'null', '[1]', '"x"', '3', 'true'])('비어 있지 않은데 객체로 파싱되지 않는 본문 %s → ok:false "invalid JSON body" (M2-CLOSE O4)', (raw) => {
    expect(parseStartSceneBatchBody(raw)).toEqual({ ok: false, error: 'invalid JSON body' })
  })
  it('force 는 없거나 boolean 만 — true/false 는 그대로, 없으면 false (M2-CLOSE O4)', () => {
    expect(parseStartSceneBatchBody(JSON.stringify({ force: true })).payload.force).toBe(true)
    expect(parseStartSceneBatchBody(JSON.stringify({ force: false })).payload.force).toBe(false)
    expect(parseStartSceneBatchBody('{}').payload.force).toBe(false)
  })
  it.each(['false', '0', 'true', 0, 1, null, [], {}])('force=%j (boolean 아님) → ok:false "force must be a boolean" (M2-CLOSE O4)', (force) => {
    expect(parseStartSceneBatchBody(JSON.stringify({ mode: 'video', force }))).toEqual({ ok: false, error: 'force must be a boolean' })
  })
  it('styleId 는 없거나 null 이거나 ≤128 문자열만 — 빈 문자열은 옛대로 null (M2-CLOSE O4)', () => {
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: 'x'.repeat(128) })).payload.styleId).toBe('x'.repeat(128))
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: null })).payload.styleId).toBeNull()
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId: '' })).payload.styleId).toBeNull()
  })
  it.each(['x'.repeat(129), 5, true, ['preset:x'], { id: 'x' }])('styleId=%j (문자열 아님 또는 129자 이상) → ok:false "styleId must be a string of at most 128 characters" (M2-CLOSE O4)', (styleId) => {
    expect(parseStartSceneBatchBody(JSON.stringify({ styleId }))).toEqual({ ok: false, error: 'styleId must be a string of at most 128 characters' })
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
  it('api-docs 의 start-scene-batch 스키마에 mode(enum video|image) 가 있고, styleId 는 maxLength 128, force 는 boolean 이다', () => {
    const d = DOCS.slice(DOCS.indexOf("'/api/start-scene-batch'"), DOCS.indexOf("'/api/start-ref-batch'"))
    expect(d).toMatch(/mode:\s*\{\s*type:\s*'string',\s*enum:\s*\['video',\s*'image'\]/)
    expect(d).toMatch(/styleId:\s*\{\s*type:\s*'string',\s*maxLength:\s*128/)   // M2-CLOSE O4
    expect(d).toMatch(/force:\s*\{\s*type:\s*'boolean'/)
  })
})
