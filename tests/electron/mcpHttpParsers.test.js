// @vitest-environment node
//
// M2-LIVE N3(A3/B2) — main 의 MCP HTTP 라우트가 쓰는 순수 판정 헬퍼(electron/mcp-http-parsers.js). main.js 는 부팅이 필요해 라우트 자체는
//   소스 핀으로만 묶고, **행동**은 여기서 묶는다: POST /api/update 의 update-settings 는 화이트리스트 밖 키·틀린 값이면 400 + 키 이름(값 없음),
//   다른 type 은 그대로 렌더러로 전달.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decideUpdateRequest } from '../../electron/mcp-http-parsers.js'

const MAIN = readFileSync(fileURLToPath(new URL('../../electron/main.js', import.meta.url)), 'utf8')
const DOCS = readFileSync(fileURLToPath(new URL('../../electron/api-docs.js', import.meta.url)), 'utf8')

describe('decideUpdateRequest — POST /api/update 본문 → {status, body, forward?}', () => {
  it('update-settings: 화이트리스트 안의 유효한 fields → 200 + forward(같은 type, 정리된 fields)', () => {
    const d = decideUpdateRequest(JSON.stringify({ type: 'update-settings', fields: { videoModelT2V: 'Omni Flash', videoResolution: '720p', videoBatchCount: 1 } }))
    expect(d).toEqual({ status: 200, body: { success: true }, forward: { type: 'update-settings', fields: { videoModelT2V: 'Omni Flash', videoResolution: '720p', videoBatchCount: 1 } } })
  })
  it.each([
    [{ projectName: 'B' }, ['projectName']],
    [{ mcpHttpEnabled: false }, ['mcpHttpEnabled']],
    [{ saveMode: 'none', videoResolution: '720p' }, ['saveMode']],
    [{ seedNo: 'abc' }, ['seedNo']],
    [{ videoResolution: '480p', flowAgentOn: true }, ['videoResolution', 'flowAgentOn']],
  ])('update-settings: %o → 400 + keys(이름만), forward 없음', (fields, keys) => {
    const d = decideUpdateRequest(JSON.stringify({ type: 'update-settings', fields }))
    expect(d).toEqual({ status: 400, body: { error: 'update-settings: unknown or invalid fields', keys } })
    expect(JSON.stringify(d)).not.toContain('abc')
    expect(JSON.stringify(d)).not.toContain('"B"')
  })
  it('update-settings: fields 가 객체가 아니면 400', () => {
    expect(decideUpdateRequest(JSON.stringify({ type: 'update-settings' })).status).toBe(400)
    expect(decideUpdateRequest(JSON.stringify({ type: 'update-settings', fields: 'x' })).status).toBe(400)
  })
  it('다른 type(update-scene 등)은 그대로 전달(200 + forward = 본문)', () => {
    const body = { type: 'update-scene', index: 2, fields: { videoT2VSelected: true } }
    expect(decideUpdateRequest(JSON.stringify(body))).toEqual({ status: 200, body: { success: true }, forward: body })
  })
  it('JSON 이 아니거나 객체가 아니면 400, forward 없음', () => {
    expect(decideUpdateRequest('{oops')).toMatchObject({ status: 400 })
    expect(decideUpdateRequest('[1]')).toMatchObject({ status: 400 })
    expect(decideUpdateRequest('{oops').forward).toBeUndefined()
  })
})

describe('main.js — POST /api/update 는 decideUpdateRequest 로 판정하고, api-docs 가 키를 문서화한다', () => {
  it('라우트가 decideUpdateRequest(body) 의 status/body 를 쓰고 forward 만 mcp-update 로 보낸다', () => {
    const b = MAIN.slice(MAIN.indexOf("pathname === '/api/update'"), MAIN.indexOf("pathname === '/api/generate-reference'"))
    expect(b).toMatch(/decideUpdateRequest\(body\)/)
    expect(b).toMatch(/send\('mcp-update',\s*\w+\.forward\)/)
    expect(b).toMatch(/writeHead\(\w+\.status\)/)
    expect(b).not.toMatch(/JSON\.parse\(body\)/)
    expect(MAIN).toMatch(/import \{[^}]*decideUpdateRequest[^}]*\} from '\.\/mcp-http-parsers\.js'/)
  })
  it('api-docs: update-settings 의 허용 키가 문서에 있다', () => {
    for (const k of ['videoModelT2V', 'videoModelF2V', 'imageModel', 'videoResolution', 'aspectRatio', 'defaultDuration', 'imageBatchCount', 'videoBatchCount', 'concurrency', 'videoConcurrency', 'seedNo', 'seedLocked', 'imageUpscale']) {
      expect(DOCS, k).toContain(k)
    }
    expect(DOCS).toMatch(/update-settings[^\n]*(화이트리스트|whitelist|허용 키)/)
  })
})
