/**
 * M3b 2R 리뷰 Finding2/Finding5 — App.jsx의 reloadTtsVoicesForProvider 핵심 로직(REPLACE 시맨틱 +
 * elevenlabs 전용 list 파라미터)을 순수 함수로 뽑아 실제로 실행해 검증한다(소스 문자열 grep 아님).
 */
import { describe, expect, it } from 'vitest'
import { ttsListVoicesReloadParams, replaceTtsVoicesForProvider } from '../../src/utils/ttsVoiceReload.js'

describe('ttsListVoicesReloadParams', () => {
  it('elevenlabs는 shared voice 포함 + maxSharedPages 10', () => {
    expect(ttsListVoicesReloadParams('elevenlabs')).toEqual({
      provider: 'elevenlabs',
      includeShared: true,
      limit: 100,
      maxSharedPages: 10,
    })
  })

  it('다른 provider는 shared 미포함 + maxSharedPages 1', () => {
    expect(ttsListVoicesReloadParams('typecast')).toEqual({
      provider: 'typecast',
      includeShared: false,
      limit: 100,
      maxSharedPages: 1,
    })
    expect(ttsListVoicesReloadParams('gemini')).toEqual({
      provider: 'gemini',
      includeShared: false,
      limit: 100,
      maxSharedPages: 1,
    })
  })
})

describe('replaceTtsVoicesForProvider — Finding2: 계정 교체 후에도 stale voice가 안 남아야 한다', () => {
  it('대상 provider의 기존 voice를 전부 지우고 새 목록으로 교체한다 (merge/upsert 아님)', () => {
    const prev = [
      { provider: 'elevenlabs', id: 'old-1', name: 'Old One' },
      { provider: 'elevenlabs', id: 'old-2', name: 'Old Two' },
    ]
    // 새 계정에는 old-1, old-2가 더 이상 없고 new-1만 있다 — merge라면 old-1/old-2가 살아남는다.
    const fetched = [{ id: 'new-1', name: 'New One' }]

    const result = replaceTtsVoicesForProvider(prev, 'elevenlabs', fetched)

    expect(result).toEqual([{ provider: 'elevenlabs', id: 'new-1', name: 'New One' }])
  })

  it('다른 provider의 voice는 손대지 않는다', () => {
    const prev = [
      { provider: 'elevenlabs', id: 'e-1', name: 'Eleven' },
      { provider: 'typecast', id: 't-1', name: 'Typecast One' },
    ]
    const fetched = [{ id: 'e-2', name: 'Eleven Two' }]

    const result = replaceTtsVoicesForProvider(prev, 'elevenlabs', fetched)

    expect(result).toEqual([
      { provider: 'typecast', id: 't-1', name: 'Typecast One' },
      { provider: 'elevenlabs', id: 'e-2', name: 'Eleven Two' },
    ])
  })

  it('fetched voice에 provider 태그를 붙인다(호출부가 안 붙여도 됨)', () => {
    const result = replaceTtsVoicesForProvider([], 'typecast', [{ id: 't-1' }])
    expect(result).toEqual([{ provider: 'typecast', id: 't-1' }])
  })

  it('fetchedVoices가 비거나 없으면 해당 provider 슬라이스가 그냥 사라진다(빈 계정)', () => {
    const prev = [{ provider: 'elevenlabs', id: 'old-1' }, { provider: 'typecast', id: 't-1' }]
    expect(replaceTtsVoicesForProvider(prev, 'elevenlabs', [])).toEqual([{ provider: 'typecast', id: 't-1' }])
    expect(replaceTtsVoicesForProvider(prev, 'elevenlabs', undefined)).toEqual([{ provider: 'typecast', id: 't-1' }])
  })
})
