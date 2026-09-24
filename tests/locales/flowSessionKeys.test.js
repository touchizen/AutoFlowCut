// M1-9: flow.google.com 재작업이 도입한 로케일 키 — 세션 확인 토스트 + errorSection.kind.* 18개.
//   kind 별 params 는 플랜 §3 공통 규칙의 고정표: flow-resolution-not-offered {requested} · flow-image-model-mismatch
//   {requested, panel} · flow-video-settings-mismatch {expected, actual} · flow-batch-halted {cause} · 나머지 {} —
//   문구의 {…} 는 그 표의 params 만 쓴다(그 외 플레이스홀더가 있으면 렌더에 그대로 새어 나온다).
import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

const PARAMS = {
  'flow-resolution-not-offered': ['requested'],
  'flow-image-model-mismatch': ['requested', 'panel'],
  'flow-video-settings-mismatch': ['expected', 'actual'],
  'flow-batch-halted': ['cause'],
}
const KINDS = [
  'flow-session-missing', 'flow-settings-not-applied', 'flow-resolution-not-offered', 'flow-image-model-mismatch',
  'flow-upscale-unsupported', 'flow-aspect-mismatch', 'flow-video-settings-mismatch', 'flow-video-count-mismatch',
  'flow-video-fetch-failed', 'flow-submit-lost', 'flow-submit-not-sent', 'flow-capture-not-installed',
  'flow-references-unsupported', 'flow-mention-chips-unsupported', 'flow-agent-mode-unsupported',
  'flow-feature-unsupported', 'flow-rpc-error', 'flow-batch-halted', 'flow-download-error',
]
const placeholders = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()   // 같은 param 을 두 번 써도 된다

describe.each([['en', en], ['ko', ko]])('%s — flow.google.com 재작업 로케일 키', (_lang, locale) => {
  it('toast.flowSessionCheckFailed 는 {reason} 을 쓴다', () => {
    expect(locale.toast.flowSessionCheckFailed).toBeTruthy()
    expect(placeholders(locale.toast.flowSessionCheckFailed)).toEqual(['reason'])
  })

  it.each(KINDS)('errorSection.kind.%s 가 있고 플레이스홀더는 고정표대로', (kind) => {
    const text = locale.errorSection.kind[kind]
    expect(text, kind).toBeTruthy()
    expect(placeholders(text)).toEqual((PARAMS[kind] || []).slice().sort())
  })
})
