// M1-9 / R1#10 / R2#11 / R2-2#7: flow.google.com 재작업의 로케일 키 — 세션 확인 토스트 + errorSection.kind.*.
//   kind 목록은 손으로 적지 않고 **코드가 만드는 kind** 에서 뽑는다(errorKind: '…' · kindResult('…') 는 접두 무관,
//   kind: 'flow-…' · settleGen 의 error/errorKind 는 flow- 접두) — 새 kind 를 코드에 넣고 문구를 빠뜨리면 여기서 빨개진다.
//   스캔 범위엔 렌더러로 그대로 통과되는 main 의 kind 생산자(shared.js 의 projectCheck · video.js · flow-api.js · character.js)도 든다.
//   kind 별 params 는 플랜 §3 공통 규칙의 고정표: flow-resolution-not-offered {requested} · flow-image-model-mismatch
//   {requested, panel} · flow-video-settings-mismatch {expected, actual} · flow-batch-halted {cause} · 나머지 {} —
//   문구의 {…} 는 그 표의 params 만 쓴다(그 외 플레이스홀더가 있으면 렌더에 그대로 새어 나온다).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

const PARAMS = {
  'flow-resolution-not-offered': ['requested'],
  'flow-image-model-mismatch': ['requested', 'panel'],
  'flow-video-settings-mismatch': ['expected', 'actual'],
  'flow-batch-halted': ['cause'],
  // M3(D14): 레퍼런스 영상 — 모델 라벨 · 상한
  'flow-references-model-unsupported': ['model'],
  'flow-references-too-many': ['max'],
}
/** 플랜이 정한 kind(코드가 아직 안 만드는 M2 kind 포함) — 코드에서 뽑은 것과 합집합. */
const PLANNED = [
  'flow-session-missing', 'flow-settings-not-applied', 'flow-resolution-not-offered', 'flow-image-model-mismatch',
  'flow-upscale-unsupported', 'flow-aspect-mismatch', 'flow-video-settings-mismatch', 'flow-video-count-mismatch',
  'flow-video-fetch-failed', 'flow-submit-lost', 'flow-submit-not-sent', 'flow-capture-not-installed',
  'flow-references-unsupported', 'flow-mention-chips-unsupported', 'flow-agent-mode-unsupported',
  'flow-feature-unsupported', 'flow-rpc-error', 'flow-batch-halted', 'flow-download-error',
]
/** kind 를 만드는 모듈(main + 렌더러). */
const SOURCES = [
  'electron/flow-rpc-router.js', 'electron/flow-rpc-protocol.js', 'electron/flow-composer-settings.js', 'electron/ipc/flow-angular.js',
  'src/engine/engineFlow.js', 'src/utils/imageProcessing.js', 'src/hooks/useAutomation.js', 'src/hooks/useVideoAutomation.js', 'src/hooks/useSceneGeneration.js', 'src/hooks/useReferenceGeneration.js',
  'electron/ipc/shared.js', 'electron/ipc/video.js', 'electron/ipc/flow-api.js', 'electron/ipc/character.js',
]
const PATTERNS = [/errorKind:\s*'([a-z0-9-]+)'/g, /kindResult\('([a-z0-9-]+)'/g, /\bkind:\s*'(flow-[a-z0-9-]+)'/g, /error:\s*'(flow-[a-z0-9-]+)'/g, /\b(?:send|loadend):\s*'(flow-[a-z0-9-]+)'/g]

export function kindsProducedByCode() {
  const found = new Set()
  for (const rel of SOURCES) {
    const src = readFileSync(fileURLToPath(new URL('../../' + rel, import.meta.url)), 'utf8')
    for (const re of PATTERNS) for (const m of src.matchAll(re)) found.add(m[1])
  }
  return found
}

const KINDS = [...new Set([...PLANNED, ...kindsProducedByCode()])].sort()
const placeholders = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()   // 같은 param 을 두 번 써도 된다

describe('코드가 만드는 kind 를 정말 뽑았나(스캔 자체의 검증)', () => {
  it('라우터·핸들러의 kind 가 목록에 있다 — flow-rpc-multi-batch · flow-generation-cleared · flow-submit-lost · flow-aspect-mismatch', () => {
    const found = kindsProducedByCode()
    for (const k of ['flow-rpc-multi-batch', 'flow-generation-cleared', 'flow-submit-lost', 'flow-submit-not-sent', 'flow-aspect-mismatch', 'flow-capture-not-installed', 'flow-image-model-mismatch', 'flow-upscale-unsupported',
      // R2-2#7: flow- 접두가 아닌 핸들러 kind 와 projectCheck 통과 kind 도 잡는다
      'text-injection-failed', 'generate-button-unavailable', 'generate-button-click-failed', 'flow-agent-off-failed', 'flow-project-open-failed', 'flow-page-unreadable', 'flow-project-changed']) {
      expect(found.has(k), k).toBe(true)
    }
    expect(KINDS.length).toBeGreaterThanOrEqual(PLANNED.length + 2)
  })
})

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

// M2-R1 F10(A10): download-entitlement 는 이미지(imageFinalize)와 영상이 같이 쓰는 kind — 문구가 매체를 말하면 이미지 씬에 "영상" 안내가 뜬다.
describe('errorSection.kind.download-entitlement 는 매체 중립', () => {
  it('ko: "영상/비디오" 없음, 정본 문구', () => {
    expect(ko.errorSection.kind['download-entitlement']).toBe('다운로드 권한이 없어 이 결과를 저장하지 않았습니다. Pro로 업그레이드한 뒤 Retry로 다시 받을 수 있습니다.')
    expect(ko.errorSection.kind['download-entitlement']).not.toMatch(/영상|비디오|이미지/)
  })
  it('en: no "video"/"image", canonical wording', () => {
    expect(en.errorSection.kind['download-entitlement']).toBe('Download not allowed — this result was not saved. Upgrade to Pro, then use Retry to download it.')
    expect(en.errorSection.kind['download-entitlement']).not.toMatch(/\b(video|image)\b/i)
  })
})
