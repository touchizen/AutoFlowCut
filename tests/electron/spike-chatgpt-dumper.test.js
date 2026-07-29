import { describe, it, expect } from 'vitest'
import { CHATGPT_DUMPER } from '../../electron/spike-chatgpt-dumper.js'

describe('CHATGPT_DUMPER string contract', () => {
  it('is a non-empty single-eval expression that defines and immediately invokes', () => {
    expect(typeof CHATGPT_DUMPER).toBe('string')
    expect(CHATGPT_DUMPER.length).toBeGreaterThan(50)
    expect(CHATGPT_DUMPER).toContain('__autoflowcut_chatgpt_dump__')
    // define-if-absent + 즉시 호출(단일 eval): 함수 정의와 호출이 같은 문자열에 있어야
    expect(CHATGPT_DUMPER).toMatch(/__autoflowcut_chatgpt_dump__\s*\(/) // 호출부
  })
  it('uses the forwarded log prefix', () => {
    expect(CHATGPT_DUMPER).toContain('[autoflowcut CGPT DUMP]')
  })
  it('contains no Node/CDP tokens (runs in page context)', () => {
    expect(CHATGPT_DUMPER).not.toMatch(/\brequire\s*\(/)
    expect(CHATGPT_DUMPER).not.toMatch(/\bprocess\./)
    expect(CHATGPT_DUMPER).not.toMatch(/\bdebugger\b/)
  })
})
