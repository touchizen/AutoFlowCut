/**
 * video-cdp-dispatch — CDP Fetch 분기 우선순위 단위 테스트
 *
 * 가장 중요한 회귀 가드: seed가 잠긴 상태에서 I2V를 돌릴 때
 * t2v-seed 케이스가 i2v 케이스를 가로채면 안 된다.
 *
 * 회귀 컨텍스트:
 *   54b3293 (2026-04-25) "feat(video): seed support for T2V and F2V (I2V)"
 *   에서 t2v-seed 케이스를 추가하면서 i2v 케이스를 가로채는 버그가 들어감.
 *   증상: Frame-to-Video에서 seed 잠긴 채 돌리면 startImage/endImage가
 *   주입되지 않고 plain T2V 요청으로 나가, Veo가 키프레임 무시하고
 *   photoreal 영상 생성. 사용자: "Disney 2D 이미지인데 실사가 나온다."
 */

import { describe, it, expect } from 'vitest'
import { selectCdpCase } from '../../electron/video-cdp-dispatch.js'

const T2V_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText'
const I2V_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage'
const I2V_SE_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage'
const IMAGE_URL = 'https://aisandbox-pa.googleapis.com/v1/images:batchGenerateImages'
const STATUS_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus'

describe('selectCdpCase — 분기 우선순위', () => {
  describe('image-batch (이미지 생성 요청)', () => {
    it('batchGenerateImages URL이면 image-batch (state 무관)', () => {
      // 이미지 케이스는 URL만 보고 매치. 내부에서 refs/seed 가용한 만큼 주입.
      expect(selectCdpCase({ reqUrl: IMAGE_URL })).toBe('image-batch')
    })

    it('batchGenerateImages + seed/i2v 모두 set이라도 image-batch 우선', () => {
      expect(
        selectCdpCase({
          reqUrl: IMAGE_URL,
          pendingSeedValue: 12345,
          pendingI2VInjection: { startImageMediaId: 'x' },
        })
      ).toBe('image-batch')
    })
  })

  describe('i2v (Frame-to-Video 키프레임 주입)', () => {
    it('outgoing URL이 T2V여도 pendingI2VInjection 있으면 i2v 매치', () => {
      // ⭐ 가장 중요한 케이스 — Flow UI는 I2V 모드에서도 T2V URL로 보냄
      expect(
        selectCdpCase({
          reqUrl: T2V_URL,
          pendingI2VInjection: { startImageMediaId: 'abc', endImageMediaId: 'def' },
        })
      ).toBe('i2v')
    })

    it('I2V endpoint URL + pendingI2VInjection이면 i2v', () => {
      expect(
        selectCdpCase({
          reqUrl: I2V_URL,
          pendingI2VInjection: { startImageMediaId: 'abc' },
        })
      ).toBe('i2v')
    })

    it('I2V start+end endpoint URL + pendingI2VInjection이면 i2v', () => {
      expect(
        selectCdpCase({
          reqUrl: I2V_SE_URL,
          pendingI2VInjection: { startImageMediaId: 'a', endImageMediaId: 'b' },
        })
      ).toBe('i2v')
    })

    it('비디오 URL인데 pendingI2VInjection 없으면 i2v 아님', () => {
      expect(
        selectCdpCase({
          reqUrl: T2V_URL,
          pendingI2VInjection: null,
        })
      ).toBe('pass-through')
    })
  })

  describe('🚨 회귀 가드 — seed 잠긴 I2V 모드', () => {
    it('seed + I2V injection 둘 다 있으면 i2v가 우선 (t2v-seed가 가로채면 안 됨)', () => {
      // 사용자 시나리오: Seed 414766 잠긴 채 Frame-to-Video 실행.
      // 이전 버그 (54b3293): 이 케이스에서 't2v-seed'가 매치돼 키프레임이 날아갔음.
      const result = selectCdpCase({
        reqUrl: T2V_URL,
        pendingSeedValue: 414766,
        pendingI2VInjection: { startImageMediaId: 'e5ae79f0', endImageMediaId: '229804a1' },
      })
      expect(result).toBe('i2v')
    })

    it('seed=0 (truthy 아님) + I2V injection 있으면 i2v 우선', () => {
      // seed가 0이어도 의미 있는 값(== null이 아님). I2V는 여전히 우선.
      const result = selectCdpCase({
        reqUrl: T2V_URL,
        pendingSeedValue: 0,
        pendingI2VInjection: { startImageMediaId: 'a' },
      })
      expect(result).toBe('i2v')
    })

    it('seed null + I2V injection 있으면 i2v', () => {
      const result = selectCdpCase({
        reqUrl: T2V_URL,
        pendingSeedValue: null,
        pendingI2VInjection: { startImageMediaId: 'a' },
      })
      expect(result).toBe('i2v')
    })

    it('OPTIONS preflight + seed + I2V injection → 여전히 i2v (preflight도 i2v 케이스에서 처리)', () => {
      // i2v 케이스 내부에서 OPTIONS는 mutation 없이 통과시키므로,
      // 분기 단계에서는 i2v로 잡혀야 한다 (분기 후 OPTIONS 처리는 case body의 역할).
      expect(
        selectCdpCase({
          reqUrl: T2V_URL,
          reqMethod: 'OPTIONS',
          pendingSeedValue: 414766,
          pendingI2VInjection: { startImageMediaId: 'a' },
        })
      ).toBe('i2v')
    })
  })

  describe('t2v-seed (Video 탭에서 seed만 잠금)', () => {
    it('T2V URL + seed + I2V injection 없음 → t2v-seed', () => {
      expect(
        selectCdpCase({
          reqUrl: T2V_URL,
          pendingSeedValue: 12345,
          pendingI2VInjection: null,
        })
      ).toBe('t2v-seed')
    })

    it('OPTIONS preflight는 t2v-seed 매치 안 함 (pass-through)', () => {
      expect(
        selectCdpCase({
          reqUrl: T2V_URL,
          reqMethod: 'OPTIONS',
          pendingSeedValue: 12345,
        })
      ).toBe('pass-through')
    })

    it('seed가 null이면 pass-through (Flow 자동 랜덤 유지)', () => {
      expect(
        selectCdpCase({ reqUrl: T2V_URL, pendingSeedValue: null })
      ).toBe('pass-through')
    })

    it('seed가 undefined면 pass-through', () => {
      expect(
        selectCdpCase({ reqUrl: T2V_URL, pendingSeedValue: undefined })
      ).toBe('pass-through')
    })

    it('seed=0도 유효한 값이라 t2v-seed (== null만 제외)', () => {
      // 사용자가 seed 0으로 잠근 케이스. != null 체크라 0도 통과.
      expect(
        selectCdpCase({ reqUrl: T2V_URL, pendingSeedValue: 0 })
      ).toBe('t2v-seed')
    })

    it('I2V endpoint URL이지만 I2V injection 없으면 t2v-seed로 매치 안 됨', () => {
      // I2V endpoint URL은 batchAsyncGenerateVideoText 부분 문자열을 포함하지 않음.
      expect(
        selectCdpCase({
          reqUrl: I2V_URL,
          pendingSeedValue: 12345,
        })
      ).toBe('pass-through')
    })
  })

  describe('pass-through (관심 없는 요청)', () => {
    it('상태 폴링 URL은 pass-through', () => {
      expect(
        selectCdpCase({
          reqUrl: STATUS_URL,
          pendingSeedValue: 12345,
          pendingI2VInjection: { startImageMediaId: 'x' },
        })
      ).toBe('pass-through')
    })

    it('완전 무관 URL은 pass-through', () => {
      expect(
        selectCdpCase({
          reqUrl: 'https://example.com/api/foo',
          pendingI2VInjection: { startImageMediaId: 'x' },
        })
      ).toBe('pass-through')
    })

    it('reqUrl 빈 문자열이면 pass-through', () => {
      expect(selectCdpCase({ reqUrl: '' })).toBe('pass-through')
    })

    it('reqUrl undefined면 pass-through', () => {
      expect(selectCdpCase({ reqUrl: undefined })).toBe('pass-through')
    })
  })

  describe('우선순위 매트릭스 (조합)', () => {
    // 상태 변수 조합으로 매트릭스 검증
    const scenarios = [
      // [seed, i2v, url, expected]
      [null, null, IMAGE_URL, 'image-batch'],
      [100, null, IMAGE_URL, 'image-batch'],
      [100, { startImageMediaId: 'a' }, IMAGE_URL, 'image-batch'],   // image URL이면 무조건 image-batch
      [null, { startImageMediaId: 'a' }, T2V_URL, 'i2v'],
      [100, { startImageMediaId: 'a' }, T2V_URL, 'i2v'],             // ⭐ seed 있어도 i2v 우선
      [414766, { startImageMediaId: 'e5ae79f0' }, T2V_URL, 'i2v'],   // ⭐ 실제 사용자 시나리오
      [100, null, T2V_URL, 't2v-seed'],
      [null, null, T2V_URL, 'pass-through'],
      [100, null, STATUS_URL, 'pass-through'],
      [null, { startImageMediaId: 'a' }, STATUS_URL, 'pass-through'], // 비디오 URL 아니면 i2v 안 됨
    ]

    scenarios.forEach(([seed, i2v, url, expected]) => {
      const urlLabel = url.split('/').pop()
      it(`seed=${seed ?? 'N'} i2v=${i2v ? 'Y' : 'N'} url=${urlLabel} → ${expected}`, () => {
        expect(
          selectCdpCase({
            reqUrl: url,
            pendingSeedValue: seed,
            pendingI2VInjection: i2v,
          })
        ).toBe(expected)
      })
    })
  })
})
