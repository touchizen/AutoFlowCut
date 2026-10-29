// @vitest-environment node
// 2026-10-30 I2V — MCP 도구: app_set_frame_pairs(→ POST /api/update {type:'set-frame-pairs'}) · app_start_scene_batch 의 mode(image|video|i2v).
//   전엔 MCP 에 모드 스위치가 없어 에이전트가 HTTP 를 직접 불렀다(afc.py). 실패(409 busy · 422 no-image)는 isError 로 드러난다.
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { handleSetFramePairsTool, handleStartSceneBatchTool } from '../../mcp-server/lib/toolResponses.js'

const source = fs.readFileSync(new URL('../../mcp-server/index.js', import.meta.url), 'utf8')
const schemaOf = (tool) => { const s = source.indexOf(`name: '${tool}'`); expect(s).toBeGreaterThan(-1); const e = source.indexOf("name: '", s + 10); return source.slice(s, e === -1 ? source.length : e) }

describe('app_set_frame_pairs', () => {
  it('스키마: indexes(정수 배열, 0부터) + promptSource enum', () => {
    const b = schemaOf('app_set_frame_pairs')
    expect(b).toMatch(/indexes: \{ type: 'array', items: \{ type: 'integer'/)
    expect(b).toMatch(/promptSource: \{ type: 'string', enum: \['video', 'image', 'none'\]/)
    expect(b).toMatch(/required: \['indexes'\]/)
  })
  it('본문 {type, indexes, promptSource?} 로 /api/update — 성공은 rows 를 보여 준다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 200, data: { success: true, rows: [{ index: 3, sceneId: 'scene_4', id: 'fp_1' }] } })
    const r = await handleSetFramePairsTool({ indexes: [3] }, fetcher)
    expect(fetcher).toHaveBeenCalledWith(3210, 'POST', '/api/update', { type: 'set-frame-pairs', indexes: [3] })
    expect(r.isError).toBeUndefined()
    expect(r.content[0].text).toContain('fp_1')
    await handleSetFramePairsTool({ port: 4000, indexes: [0, 2], promptSource: 'image' }, fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(4000, 'POST', '/api/update', { type: 'set-frame-pairs', indexes: [0, 2], promptSource: 'image' })
  })
  it.each([[409, 'busy'], [422, 'no-image']])('%s %s → isError + 사유', async (status, error) => {
    const fetcher = vi.fn().mockResolvedValue({ status, data: { success: false, error, indexes: [1] } })
    const r = await handleSetFramePairsTool({ indexes: [1] }, fetcher)
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain(error)
  })
  it('needs-recovery 의 pairIds(주인 없는 갤러리 행)도 보여 준다 (Codex 5차 P3)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 422, data: { success: false, error: 'needs-recovery', indexes: [], pairIds: ['fp_7'] } })
    const r = await handleSetFramePairsTool({ indexes: [0] }, fetcher)
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('fp_7')
  })
  it('index.js 가 이 핸들러로 보낸다', () => {
    expect(source).toMatch(/case 'app_set_frame_pairs': \{\s*return handleSetFramePairsTool\(args, appFetch\)/)
  })
})

describe('app_start_scene_batch — mode', () => {
  it("스키마: mode enum ['image', 'video', 'i2v']", () => {
    expect(schemaOf('app_start_scene_batch')).toMatch(/mode: \{ type: 'string', enum: \['image', 'video', 'i2v'\]/)
  })
  it('mode·styleId·force 를 실어 보낸다 · 아무것도 없으면 본문 null(옛 호출 호환) · 400 은 isError', async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 200, data: { success: true } })
    await handleStartSceneBatchTool({ mode: 'i2v', styleId: 'none' }, fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(3210, 'POST', '/api/start-scene-batch', { styleId: 'none', mode: 'i2v' })
    await handleStartSceneBatchTool({}, fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(3210, 'POST', '/api/start-scene-batch', null)
    const bad = vi.fn().mockResolvedValue({ status: 400, data: { error: "mode must be 'video', 'image' or 'i2v'" } })
    expect((await handleStartSceneBatchTool({ mode: 'f2v' }, bad)).isError).toBe(true)
  })
  it("force 설명: i2v 는 force 를 안 보고 선택된 I2V 행을 완료여도 다시 만든다 (Fable 최종 리뷰 1)", () => {
    expect(schemaOf('app_start_scene_batch')).toMatch(/force: \{ type: 'boolean', description: '[^']*i2v[^']*완료[^']*app_set_frame_pairs/)
  })
  it('index.js 가 이 핸들러로 보낸다', () => {
    expect(source).toMatch(/case 'app_start_scene_batch': \{\s*return handleStartSceneBatchTool\(args, appFetch\)/)
  })
})
