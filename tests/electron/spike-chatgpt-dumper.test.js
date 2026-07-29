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
  it('captures composer-scoped buttons and all data-testid buttons (no sidebar truncation)', () => {
    // 컴포저 영역 스코프 + data-testid 전량 — 전역 slice(사이드바 truncation) 사용 금지
    expect(CHATGPT_DUMPER).toContain('composerButtons')
    expect(CHATGPT_DUMPER).toContain('testidButtons')
    expect(CHATGPT_DUMPER).toContain("querySelector('#prompt-textarea')")
    expect(CHATGPT_DUMPER).not.toContain('button:has(svg)')  // 잘리는 전역 fallback 제거
    expect(CHATGPT_DUMPER).not.toContain('button svg')
  })
  it('caps result image candidates at 16', () => {
    expect(CHATGPT_DUMPER).toMatch(/images:\s*pick\([^\n]+,\s*16\)/)
  })
  it('contains no Node/CDP tokens (runs in page context)', () => {
    expect(CHATGPT_DUMPER).not.toMatch(/\brequire\s*\(/)
    expect(CHATGPT_DUMPER).not.toMatch(/\bprocess\./)
    expect(CHATGPT_DUMPER).not.toMatch(/\bdebugger\b/)
  })
})
