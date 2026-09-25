// @vitest-environment node
//
// M2-LIVE N3(A3/B2) — MCP `update-settings` 의 키 화이트리스트(main 의 /api/update 와 렌더러 useMcpServer 가 같은 상수를 쓴다).
//   전엔 fields 를 그대로 설정에 스프레드해 projectName(자동 저장이 다른 프로젝트 폴더로 간다)·mcpHttpEnabled(에이전트 채널이 죽는다)·
//   saveMode('none' — 과금은 계속되는데 저장이 멈춘다)·flowAgentOn 을 로컬의 아무 프로세스나(CORS *, 인증 없음) 바꿀 수 있었다.
import { describe, it, expect } from 'vitest'
import { MCP_SETTINGS_KEYS, validateMcpSettingsFields, pickMcpSettingsFields } from '../../src/utils/mcpSettingsWhitelist.js'

describe('validateMcpSettingsFields — 화이트리스트 + 값 모양', () => {
  it('키 목록은 브리프 그대로(정확히 이 13개)', () => {
    expect([...MCP_SETTINGS_KEYS].sort()).toEqual(['aspectRatio', 'concurrency', 'defaultDuration', 'imageBatchCount', 'imageModel', 'imageUpscale', 'seedLocked', 'seedNo', 'videoBatchCount', 'videoConcurrency', 'videoModelF2V', 'videoModelT2V', 'videoResolution'])
  })
  it('전부 유효한 fields 는 그대로(사본) 통과', () => {
    const fields = { videoModelT2V: 'Omni Flash', videoModelF2V: 'Veo 3.1 - Fast', imageModel: 'Nano Banana 2', videoResolution: '720p', aspectRatio: '9:16', defaultDuration: 6.5, imageBatchCount: 2, videoBatchCount: 1, concurrency: 3, videoConcurrency: 1, seedNo: 0, seedLocked: true, imageUpscale: '' }
    const r = validateMcpSettingsFields(fields)
    expect(r).toEqual({ ok: true, fields })
    expect(r.fields).not.toBe(fields)
  })
  it.each([
    ['projectName', 'B'], ['mcpHttpEnabled', false], ['mcpHttpPort', 1], ['saveMode', 'none'], ['flowAgentOn', true], ['__proto__x', 1], ['constructor', 'x'],
  ])('화이트리스트 밖의 키 %s → ok:false + badKeys 에 그 키(값은 없다)', (k, v) => {
    const r = validateMcpSettingsFields({ videoResolution: '720p', [k]: v })
    expect(r).toEqual({ ok: false, badKeys: [k] })
    expect(JSON.stringify(r.badKeys)).not.toContain(String(v))   // 값은 어디에도 실리지 않는다
  })
  it.each([
    ['videoModelT2V', ''], ['videoModelT2V', '   '], ['videoModelT2V', 'x'.repeat(65)], ['videoModelT2V', 3], ['imageModel', null],
    ['videoResolution', '480p'], ['videoResolution', 720], ['aspectRatio', '21:9'],
    ['defaultDuration', 0], ['defaultDuration', 61], ['defaultDuration', '6'], ['defaultDuration', NaN],
    ['imageBatchCount', 0], ['imageBatchCount', 5], ['imageBatchCount', 1.5], ['videoBatchCount', '1'],
    ['concurrency', 0], ['concurrency', 11], ['videoConcurrency', 2.5],
    ['seedNo', -1], ['seedNo', 'abc'], ['seedNo', 1.5], ['seedLocked', 'true'], ['imageUpscale', 'x'.repeat(17)], ['imageUpscale', 2],
  ])('값 모양이 틀린 %s=%s → badKeys 에 그 키', (k, v) => {
    expect(validateMcpSettingsFields({ [k]: v })).toEqual({ ok: false, badKeys: [k] })
  })
  it('경계값 통과: 64자 문자열 · 4k · 3:4 · duration 1/60 · count 1/4 · concurrency 1/10 · seedNo 0 · upscale 16자', () => {
    expect(validateMcpSettingsFields({ videoModelT2V: 'x'.repeat(64), videoResolution: '4k', aspectRatio: '3:4', defaultDuration: 1, imageBatchCount: 4, concurrency: 10, seedNo: 0, imageUpscale: 'y'.repeat(16) }).ok).toBe(true)
    expect(validateMcpSettingsFields({ defaultDuration: 60, videoBatchCount: 1, videoConcurrency: 1, seedLocked: false }).ok).toBe(true)
  })
  it('fields 가 객체가 아니면(없음·문자열·배열) ok:false', () => {
    for (const f of [undefined, null, 'x', 3, ['videoResolution']]) expect(validateMcpSettingsFields(f).ok).toBe(false)
  })
  it('나쁜 키가 여럿이면 전부 이름만 모아 준다', () => {
    expect(validateMcpSettingsFields({ projectName: 'B', seedNo: 'abc', videoResolution: '720p' })).toEqual({ ok: false, badKeys: ['projectName', 'seedNo'] })
  })
})

describe('pickMcpSettingsFields — 렌더러의 이중 방어(유효한 항목만 남긴다)', () => {
  it('화이트리스트 밖·모양 틀린 키를 버리고 유효한 것만', () => {
    expect(pickMcpSettingsFields({ videoModelT2V: 'Omni Flash', projectName: 'B', seedNo: 'abc', videoResolution: '720p' })).toEqual({ videoModelT2V: 'Omni Flash', videoResolution: '720p' })
  })
  it('객체가 아니면 null, 유효한 것이 없으면 {}', () => {
    expect(pickMcpSettingsFields('x')).toBeNull()
    expect(pickMcpSettingsFields(null)).toBeNull()
    expect(pickMcpSettingsFields({ projectName: 'B' })).toEqual({})
  })
})
