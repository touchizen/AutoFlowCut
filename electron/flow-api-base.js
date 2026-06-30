// electron/flow-api-base.js
//
// #R33: Flow 생성 API 호스트(aisandbox-pa.googleapis.com)는 region/계정별로 다를 수 있다.
//   하드코딩하면 다른 region 사용자의 직접 호출(uploadImage / entities PATCH / video i2v·status·
//   upscale)이 깨진다. 이미지/T2V "생성 트리거"는 Flow 페이지가 스스로 요청하므로 이미 올바른
//   호스트를 쓰지만, 우리가 main/page 컨텍스트에서 직접 만드는 요청은 호스트를 알아야 한다.
//
//   해법: 페이지가 실제로 보낸 googleapis 요청의 origin 을 캡처해 재사용한다(하드코딩은 fallback).
//   캡처는 (a) flow:report-response 의 url, (b) page-injection 이 stash 한 window 변수에서 얻는다.
//
// 순수 함수 — 단위 테스트(tests/electron/flowApiBase.test.js) 보유.

/**
 * url 이 Flow 생성 API(googleapis/aisandbox) 요청이면 그 origin 을, 아니면 null 을 반환한다.
 * @param {string} url
 * @returns {string|null} 예) 'https://aisandbox-pa.googleapis.com'
 */
export function captureApiOrigin(url) {
  if (!url || typeof url !== 'string') return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // #R33-fix: Flow 생성 API 호스트만 캡처한다 — aisandbox 토큰을 가진 googleapis 호스트로 한정.
    //   storage/www/fonts.googleapis.com 같은 비-Flow origin 을 잡으면 video i2v/status/upscale·
    //   이미지 업로드가 잘못된 host 로 나가 깨진다. aisandbox-pa.googleapis.com(관측) + region 변형
    //   (eu-aisandbox-pa…, content-aisandbox-pa…)만 허용.
    if (/aisandbox/i.test(u.hostname) && /(^|\.)googleapis\.com$/i.test(u.hostname)) {
      return u.origin
    }
  } catch { /* invalid URL */ }
  return null
}

/**
 * 캡처한 origin 이 있으면 `${origin}/v1`, 없으면 fallback(하드코딩 기본)을 반환한다.
 * @param {string|null} origin
 * @param {string} fallbackBase - 예) 'https://aisandbox-pa.googleapis.com/v1'
 * @returns {string}
 */
export function resolveApiBase(origin, fallbackBase) {
  if (origin && typeof origin === 'string') {
    try {
      const u = new URL(origin)
      if (u.protocol === 'https:' || u.protocol === 'http:') return `${u.origin}/v1`
    } catch { /* fall through */ }
  }
  return fallbackBase
}
