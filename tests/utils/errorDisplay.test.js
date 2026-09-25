/**
 * resolveDisplayError unit tests
 *
 * Pinned contract: i18n-aware error message resolver shared by ErrorSection
 * and ResultsTable. Tests cover:
 *   - known errorKind → translated message
 *   - unknown errorKind → free-form error fallback (no raw key leakage)
 *   - errorKind takes priority over stale free-form error string
 *   - both empty → null
 *   - non-function t (defensive) → free-form error
 */

import { describe, it, expect } from 'vitest'
import { resolveDisplayError } from '../../src/utils/errorDisplay'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

const INTRODUCED_ERROR_KINDS = [
  'picker-not-opened',
  'character-tab-not-found',
  'search-input-not-found',
  'option-check-failed',
  'picker-closed-before-selection',
  'option-not-found',
  'dialog-not-closed',
  'chip-verification-failed',
  'text-injection-failed',
  'flow-agent-off-failed',
  'flow-agent-on-failed',
  'agent-image-result-timeout',
  'agent-video-result-timeout',
  'flow-page-unreadable',
  'flow-project-changed',
  'project-changed',
  'flow-project-open-failed',
  'character-composer-unavailable',
  'character-detail-composer-unavailable',
  'generate-button-unavailable',
  'generate-button-click-failed',
  'generation-response-timeout',
  'generation-response-invalid',
  'scene-generation-failed',
  'flow-access-token-unavailable',
  'character-file-input-unavailable',
  'character-file-injection-failed',
  'character-upload-timeout',
  'character-upload-response-invalid',
  'character-display-name-required',
  'flow-t2v-reference-images-unsupported',
  'story-empty-script',
  'story-sfx-library-unavailable',
  'character-generation-failed',
  'character-upload-failed',
]

// fake t() that mimics useI18n: returns the value at the dot-path or the key itself if missing
function makeT(strings) {
  return (key) => {
    const parts = key.split('.')
    let v = strings
    for (const p of parts) {
      v = v?.[p]
    }
    return v || key
  }
}

const T_EN = makeT({
  errorSection: {
    kind: {
      'image-missing': 'Image file not found — please regenerate',
    },
  },
})

describe('resolveDisplayError', () => {
  it('keeps the real English and Korean error-kind catalogs in exact parity', () => {
    expect(Object.keys(en.errorSection.kind).sort()).toEqual(Object.keys(ko.errorSection.kind).sort())
  })

  it.each([
    ['en', en],
    ['ko', ko],
  ])('resolves every introduced kind in the %s catalog', (_lang, catalog) => {
    const t = makeT(catalog)
    for (const kind of INTRODUCED_ERROR_KINDS) {
      const key = `errorSection.kind.${kind}`
      const resolved = resolveDisplayError(t, kind, 'diagnostic fallback')
      expect(catalog.errorSection.kind[kind], `${kind} is missing`).toBeTypeOf('string')
      expect(resolved).toBe(catalog.errorSection.kind[kind])
      expect(resolved).not.toBe(key)
      expect(resolved).not.toBe('diagnostic fallback')
    }
  })

  it.each([
    ['en', en],
    ['ko', ko],
  ])('uses a mode-neutral project-changed message in the %s catalog', (_lang, catalog) => {
    expect(catalog.errorSection.kind['project-changed']).not.toMatch(/flow/i)
  })

  it('translates known errorKind via t(`errorSection.kind.<kind>`)', () => {
    expect(resolveDisplayError(T_EN, 'image-missing', null)).toBe(
      'Image file not found — please regenerate',
    )
  })

  it('errorKind takes priority over stale free-form error string', () => {
    // Prior load saved Korean text in `error` along with the kind. The stale
    // string must not leak through — always re-translate via the kind.
    const stale = '이미지 파일을 찾을 수 없습니다 — 재생성이 필요합니다'
    expect(resolveDisplayError(T_EN, 'image-missing', stale)).toBe(
      'Image file not found — please regenerate',
    )
  })

  it('auth errorKind preserves free-form mode-specific auth guidance when present', () => {
    expect(resolveDisplayError(T_EN, 'auth', 'Auth expired — please re-login to Flow')).toBe(
      'Auth expired — please re-login to Flow',
    )
  })

  it('unknown errorKind falls back to free-form error (no raw key leakage)', () => {
    // useI18n's t() returns the key itself when the path is missing. Without
    // the guard, the user would see literal 'errorSection.kind.foo' in the UI.
    expect(resolveDisplayError(T_EN, 'foo', 'Generation timed out')).toBe(
      'Generation timed out',
    )
  })

  it('unknown errorKind + no free-form error → null (component should not render)', () => {
    expect(resolveDisplayError(T_EN, 'foo', null)).toBeNull()
    expect(resolveDisplayError(T_EN, 'foo', '')).toBeNull()
  })

  it('no errorKind, free-form error → returns the free-form error', () => {
    expect(resolveDisplayError(T_EN, null, 'Quota exceeded')).toBe('Quota exceeded')
  })

  it('no errorKind, no error → null', () => {
    expect(resolveDisplayError(T_EN, null, null)).toBeNull()
    expect(resolveDisplayError(T_EN, undefined, undefined)).toBeNull()
    expect(resolveDisplayError(T_EN, '', '')).toBeNull()
  })

  it('non-function t is tolerated (defensive — falls back to free-form error)', () => {
    // Should not throw if a caller passes a missing/invalid t (e.g. during early render).
    expect(resolveDisplayError(null, 'image-missing', 'fallback msg')).toBe('fallback msg')
    expect(resolveDisplayError(undefined, 'image-missing', null)).toBeNull()
  })

  it('errorKind is honored only when truthy (empty string treated as no kind)', () => {
    expect(resolveDisplayError(T_EN, '', 'free form')).toBe('free form')
  })
})

// M1-9: errorParams — kind 별 고정 params 표(플랜 §3 공통 규칙). 번역문에 {…} 가 남으면 free-form error 로 폴백.
describe('resolveDisplayError — errorParams (M1-9)', () => {
  const tParams = (key, params = {}) => {
    const table = {
      'errorSection.kind.flow-resolution-not-offered': 'Flow does not offer {requested}.',
      'errorSection.kind.flow-image-model-mismatch': 'requested {requested}, panel {panel}',
      'errorSection.kind.flow-rpc-error': 'Flow request failed.',
    }
    const v = table[key]
    if (!v) return key
    return v.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m))
  }

  it('params 를 t(key, params) 로 넘겨 번역문에 값이 들어간다', () => {
    expect(resolveDisplayError(tParams, 'flow-resolution-not-offered', 'raw', { requested: '1080p' })).toBe('Flow does not offer 1080p.')
    expect(resolveDisplayError(tParams, 'flow-image-model-mismatch', 'raw', { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' })).toBe('requested Nano Banana Pro, panel Nano Banana 2')
  })

  it('{…} 가 남으면(params 누락) free-form error 로 폴백, error 도 없으면 null', () => {
    expect(resolveDisplayError(tParams, 'flow-resolution-not-offered', 'raw', {})).toBe('raw')
    expect(resolveDisplayError(tParams, 'flow-resolution-not-offered', 'raw')).toBe('raw')
    expect(resolveDisplayError(tParams, 'flow-resolution-not-offered', null, {})).toBeNull()
  })

  it('params 가 필요 없는 kind 는 4번째 인자와 무관', () => {
    expect(resolveDisplayError(tParams, 'flow-rpc-error', 'raw', undefined)).toBe('Flow request failed.')
    expect(resolveDisplayError(tParams, 'flow-rpc-error', 'raw', { requested: 'x' })).toBe('Flow request failed.')
  })

  it('실제 로케일(en/ko)에서 kind 별 params 표대로 값이 들어가고 플레이스홀더가 남지 않는다', () => {
    const mk = (locale) => (key, params = {}) => {
      const v = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), locale)
      if (typeof v !== 'string') return key
      return v.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m))
    }
    for (const locale of [en, ko]) {
      const t = mk(locale)
      const a = resolveDisplayError(t, 'flow-resolution-not-offered', 'raw', { requested: '1080p' })
      expect(a).toContain('1080p'); expect(a).not.toMatch(/\{\w+\}/)
      const b = resolveDisplayError(t, 'flow-image-model-mismatch', 'raw', { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' })
      expect(b).toContain('Nano Banana Pro'); expect(b).toContain('Nano Banana 2'); expect(b).not.toMatch(/\{\w+\}/)
      const c = resolveDisplayError(t, 'flow-video-settings-mismatch', 'raw', { expected: 'veo_3_1_t2v_fast', actual: 'abra_t2v_6s' })
      expect(c).toContain('veo_3_1_t2v_fast'); expect(c).toContain('abra_t2v_6s'); expect(c).not.toMatch(/\{\w+\}/)
      const d = resolveDisplayError(t, 'flow-batch-halted', 'raw', { cause: 'flow-video-settings-mismatch' })
      expect(d).toContain('flow-video-settings-mismatch'); expect(d).not.toMatch(/\{\w+\}/)
      for (const kind of ['flow-session-missing', 'flow-settings-not-applied', 'flow-upscale-unsupported', 'flow-aspect-mismatch', 'flow-video-count-mismatch', 'flow-video-fetch-failed', 'flow-submit-lost', 'flow-submit-not-sent', 'flow-capture-not-installed', 'flow-references-unsupported', 'flow-mention-chips-unsupported', 'flow-agent-mode-unsupported', 'flow-feature-unsupported', 'flow-rpc-error', 'flow-download-error']) {
        const m = resolveDisplayError(t, kind, 'raw', {})
        expect(m, kind).not.toBe('raw'); expect(m, kind).not.toMatch(/\{\w+\}/)
      }
    }
  })
})

// M3-13(계획서 docs/plans/2026-09-25-flow-M3-references-plan.md D14): 레퍼런스 kind 의 표시 — {model}·{max} 는 값으로 채워지고(리터럴 토큰이 남으면 안 된다),
//   params 없는 kind 는 문구 그대로(free-form 폴백 아님), flow-references-unsupported 는 고친 문구.
describe('resolveDisplayError — M3 레퍼런스 kind (실제 로케일)', () => {
  const mk = (locale) => (key, params = {}) => {
    const v = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), locale)
    if (typeof v !== 'string') return key
    return v.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m))
  }

  it.each([['en', en], ['ko', ko]])('%s: flow-references-model-unsupported {model} → 모델명이 들어가고 {model} 토큰은 남지 않는다; too-many {max:3} → 3', (_lang, locale) => {
    const t = mk(locale)
    const m = resolveDisplayError(t, 'flow-references-model-unsupported', 'raw', { model: 'Veo 3.1 - Quality' })
    expect(m).toContain('Veo 3.1 - Quality')
    expect(m).not.toContain('{model}')
    expect(m).not.toBe('raw')
    const x = resolveDisplayError(t, 'flow-references-too-many', 'raw', { max: 3 })
    expect(x).toContain('3')
    expect(x).not.toContain('{max}')
    expect(x).not.toBe('raw')
    // params 가 빠지면 토큰을 노출하지 않고 free-form 으로 폴백
    expect(resolveDisplayError(t, 'flow-references-model-unsupported', 'raw', {})).toBe('raw')
  })

  it.each([['en', en], ['ko', ko]])('%s: params 없는 레퍼런스 kind 4개는 로케일 문구 그대로', (_lang, locale) => {
    const t = mk(locale)
    for (const kind of ['flow-reference-attach-failed', 'flow-reference-source-missing', 'flow-reference-clipboard-busy', 'flow-references-mismatch']) {
      expect(resolveDisplayError(t, kind, 'raw', {}), kind).toBe(locale.errorSection.kind[kind])
    }
  })

  it('flow-references-unsupported 는 고친 문구 — 레퍼런스·@멘션 전체 미지원이라 하지 않는다', () => {
    expect(resolveDisplayError(mk(en), 'flow-references-unsupported', 'raw', {})).toBe("Flow mode can't use a style image when generating a reference card, or upload a reference on its own. Try again without the style image.")
    expect(resolveDisplayError(mk(ko), 'flow-references-unsupported', 'raw', {})).toBe('Flow 모드에서는 레퍼런스 카드를 만들 때 스타일 이미지를 쓰거나 레퍼런스를 따로 업로드할 수 없습니다. 스타일 이미지 없이 다시 시도해주세요.')
  })
})
