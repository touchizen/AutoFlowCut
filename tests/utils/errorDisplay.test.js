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
