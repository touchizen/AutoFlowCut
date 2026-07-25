/**
 * Flow page injection script (window.fetch monkey-patch).
 *
 * Replaces CDP Fetch.enable / Fetch.requestPaused / Network.getResponseBody
 * with a page-level fetch wrapper that:
 *   A) Modifies outgoing batchGenerateImages / batchAsyncGenerateVideo* request bodies
 *      using values set in window.__autoflowcut_inject__ (written from main via executeJavaScript).
 *   B) Clones response bodies and forwards them to main via IPC
 *      (window.electronAPI.flowReportResponse → ipcRenderer.invoke → ipcMain.handle).
 *
 * Anti-detection:
 *   - fetch.toString() spoofed to return native-code string.
 *   - Guard flag prevents double-patching on SPA navigate.
 *
 * IMPORTANT: This file exports a plain JS string. The string is executed
 * inside the Flow page context via webContents.executeJavaScript(), NOT in
 * the Electron main process — no Node.js APIs available inside the string.
 */

import { isOmniFlashModel } from './video-model-rules.js'

// ─── i2v 모델키 변환 (순수 — 단위테스트 보유, 템플릿에 serialize 주입) ───
//   t2v videoModelKey → i2v videoModelKey. OmniFlash(abra)는 _t2v_→_i2v_ 스왑(길이 접미사 유지),
//   Veo 는 명시 맵, 그 외는 veo i2v fast 폴백. 자기완결적이어야 함(toString 직렬화 → 페이지 컨텍스트).
export function toI2VModelKey(t2vKey) {
  var VEO_MAP = {
    'veo_3_1_t2v_fast_ultra_relaxed':          'veo_3_1_i2v_s_fast_fl',
    'veo_3_1_t2v_fast':                        'veo_3_1_i2v_s_fast_fl',
    'veo_3_1_t2v_fast_portrait_ultra_relaxed': 'veo_3_1_i2v_s_fast',
    'veo_3_1_t2v_fast_portrait':               'veo_3_1_i2v_s_fast',
    'veo_3_1_t2v_quality_ultra_relaxed':       'veo_3_1_i2v_quality',
    'veo_3_1_t2v_quality':                     'veo_3_1_i2v_quality',
  }
  if (/^abra/i.test(t2vKey || '')) return String(t2vKey).replace('_t2v_', '_i2v_')
  return VEO_MAP[t2vKey] || 'veo_3_1_i2v_s_fast_fl'
}

// OmniFlash(abra) 전용 — videoModelKey 의 _Ns 길이 접미사를 목표 길이로 교체(씬 길이 최적화).
//   Veo 등 접미사 없는 키는 그대로(8초 고정). duration 이 유효한 수가 아니면 그대로.
export function applyOmniDuration(modelKey, durationSec) {
  if (!/^abra/i.test(modelKey || '')) return modelKey
  var d = Math.round(Number(durationSec))
  if (!Number.isFinite(d) || d <= 0) return modelKey
  return String(modelKey).replace(/_\d+s$/, '_' + d + 's')
}

// isOmniFlashModel 은 electron/video-model-rules.js(공유 규칙)에서 가져온다 — IPC(video.js)와
//   판별을 일치시키고, 아래 FLOW_PAGE_INJECTION 이 `${isOmniFlashModel.toString()}` 로 직렬화한다.

// OmniFlash 강제 videoModelKey — Flow 패널 적용이 깨져도(panel_not_found) 주입이 모델키를
//   직접 박아 OmniFlash 로 생성하게 한다. mode='t2v'|'i2v'|'r2v', 길이는 _Ns 접미사(기본 8).
//   #R36-ref: r2v = @멘션 reference-to-video(캐릭터 entity). t2v 키를 강제하면 엔드포인트/키 불일치가
//     되므로 r2v 요청엔 r2v 키를 박는다.
export function omniFlashKey(mode, durationSec) {
  var d = Math.round(Number(durationSec))
  if (!Number.isFinite(d) || d <= 0) d = 8
  var m = mode === 'i2v' ? 'i2v' : mode === 'r2v' ? 'r2v' : 't2v'
  return 'abra_' + m + '_' + d + 's'
}

export const FLOW_PAGE_INJECTION = /* js */ `
(function() {
  if (window.__autoflowcut_fetch_patched__) return
  window.__autoflowcut_fetch_patched__ = true

  // 직렬화된 순수 헬퍼 — IIFE **안**에 선언해야 한다. main 이 SPA 네비게이션마다 같은 페이지
  //   컨텍스트에서 이 스크립트를 재실행하므로, top-level const 로 두면 2회차 실행이 redeclaration
  //   SyntaxError 로 위 가드(__autoflowcut_fetch_patched__) 도달 전에 터진다(idempotency 깨짐).
  const toI2VModelKey = ${toI2VModelKey.toString()};
  const applyOmniDuration = ${applyOmniDuration.toString()};
  const isOmniFlashModel = ${isOmniFlashModel.toString()};
  const omniFlashKey = ${omniFlashKey.toString()};

  const _fetch = window.fetch

  // URL keyword constants (partial match — avoids full URL coupling)
  const URL_BATCH_IMG        = 'batchGenerateImages'
  const URL_VIDEO_T2V        = 'batchAsyncGenerateVideoText'
  const URL_VIDEO_I2V        = 'batchAsyncGenerateVideoStartImage'
  const URL_VIDEO_I2V_END    = 'batchAsyncGenerateVideoStartAndEndImage'
  const URL_VIDEO_REF        = 'batchAsyncGenerateVideoReferenceImages'  // #R36-ref: @멘션 R2V
  const URL_VIDEO_UPSAMPLE   = 'batchAsyncGenerateVideoUpsampleVideo'
  const URL_VIDEO_STATUS     = 'batchCheckAsyncVideoGenerationStatus'

  // Pending inject values written by main process via executeJavaScript.
  // All fields default to null (= no modification).
  // #R13-5: 기본값을 "기존 값 위에" 머지한다 — main 이 패치 준비 전에 이미 inject 를 써두었다면
  //   그 값을 reset 으로 잃지 않게(누락 키만 null 로 채움).
  window.__autoflowcut_inject__ = Object.assign(
    {
      seed: null,        // number | null — injected into every request in the batch
      aspectRatio: null, // string | null — IMAGE_ASPECT_RATIO_* enum value (image requests)
      videoAspectRatio: null, // string | null — VIDEO_ASPECT_RATIO_* enum (video requests[].aspectRatio)
      references: null,  // array | null  — referenceImages for batchGenerateImages
      i2v: null,         // object | null — { startImageMediaId, endImageMediaId?, i2vUrl, i2vStartEndUrl, duration? }
      duration: null,    // number | null — OmniFlash t2v 길이 접미사 최적화(_Ns). i2v 는 i2v.duration 사용.
    },
    window.__autoflowcut_inject__ || {}
  )

  // ─── injectImageBatchBody ──────────────────────────────────────
  // Returns true if body was modified.
  //
  // Reference images MUST go into imageInputs[] with shape
  //   { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: <mediaId> }
  // — Google's batchGenerateImages protobuf rejects a flat 'referenceImages'
  // field with HTTP 400 INVALID_ARGUMENT / "Unknown name 'referenceImages'
  // … Cannot find field". Pinned by tests/electron/flow-page-injection.test.js
  // and (for the response-side parser) tests/electron/ipc/generationMatch.test.js.
  function injectImageBatchBody(body, inject) {
    if (!Array.isArray(body.requests)) return false
    let modified = false
    for (const req of body.requests) {
      if (inject.seed != null)       { req.seed = inject.seed;                        modified = true }
      if (inject.aspectRatio)        { req.imageAspectRatio = inject.aspectRatio;     modified = true }
      if (inject.references && inject.references.length > 0) {
        if (!req.imageInputs) req.imageInputs = []
        for (const ref of inject.references) {
          if (!ref?.mediaId) continue
          req.imageInputs.push({
            imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE',
            name: ref.mediaId,
          })
        }
        modified = true
      }
    }
    return modified
  }

  // ─── injectI2VBody ────────────────────────────────────────────
  // T2V → I2V 모델키 변환(toI2VModelKey) + startImage 주입. OmniFlash(abra)는 _t2v_→_i2v_ 스왑 +
  //   길이 접미사 최적화(applyOmniDuration) + 종료프레임 미지원(endImage 생략, 라이브 확인 2026-06-27).
  //   { changed, usesEndImage } 반환 — usesEndImage 는 body 에 실제로 endImage 가 들어갔는지.
  //   호출부가 이 값으로 엔드포인트(StartImage vs StartAndEnd)를 정해 body 와 어긋나지 않게 한다
  //   (raw endImageMediaId 로 정하면 abra 가 endImage 를 생략해도 StartAndEnd 로 가 400 INVALID_ARGUMENT).
  function injectI2VBody(body, i2v) {
    const defaultCrop = { top: 0, left: 0, bottom: 1, right: 1 }
    const dur = i2v && i2v.duration
    // 앱이 OmniFlash 를 골랐으면 Flow 가 뭘 보냈든(패널 적용 깨짐) abra i2v 키로 강제. 그 외엔 Flow
    //   가 보낸 t2v 키를 i2v 로 변환(toI2VModelKey) + 길이 최적화.
    const forceOmni = isOmniFlashModel(i2v && i2v.videoModel)

    if (!Array.isArray(body.requests)) return { changed: false, usesEndImage: false }
    let usesEndImage = false
    for (const req of body.requests) {
      const finalKey = forceOmni
        ? omniFlashKey('i2v', dur)
        : applyOmniDuration(toI2VModelKey(req.videoModelKey), dur)
      const isAbra = /^abra/i.test(finalKey || '')
      req.videoModelKey = finalKey
      req.startImage    = { mediaId: i2v.startImageMediaId, cropCoordinates: defaultCrop }
      // OmniFlash(abra) i2v 는 종료프레임 미지원 → endImage 주입 안 함. Veo 만 end 지원.
      if (i2v.endImageMediaId && !isAbra) {
        req.endImage = { mediaId: i2v.endImageMediaId, cropCoordinates: defaultCrop }
        usesEndImage = true
      }
    }
    return { changed: true, usesEndImage }
  }

  // ─── reportResponse ───────────────────────────────────────────
  // Forwards captured response to main process via preload-exposed IPC.
  // requestBody: the outgoing request body string — main uses it to correlate
  // the response to the generation that triggered it (prompt-based matching).
  function reportResponse(url, body, status, requestBody, reqStartedAt, genTag) {
    try {
      const p = window.electronAPI?.flowReportResponse?.({ url, body, status, requestBody, reqStartedAt, genTag })
      // #R7-11: invoke 는 Promise — reject 시 unhandled rejection 이 페이지에 뜨지 않게 흡수.
      if (p && typeof p.catch === 'function') p.catch((e) => console.warn('[Flow Inject] reportResponse rejected:', e?.message))
    } catch (e) {
      console.warn('[Flow Inject] reportResponse failed:', e.message)
    }
  }

  // ─── Patched fetch ────────────────────────────────────────────
  window.fetch = async function(input, init) {
    let url      = typeof input === 'string' ? input : (input?.url || '')
    // #R33: 페이지가 보낸 생성 API(googleapis) 요청의 origin 을 stash 한다 — main 이 이 값으로
    //   직접 호출(uploadImage/entities/video i2v·status·upscale) 호스트를 region 에 맞춘다.
    // #R33-fix: aisandbox googleapis 호스트만 stash — storage/www/fonts.googleapis.com 같은 비-Flow
    //   origin 을 잡으면 직접호출(upload/entities/video status·i2v·upscale)이 잘못된 host 로 나간다.
    try { const _h = new URL(url, location.href); if (/aisandbox/i.test(_h.hostname) && /(^|\.)googleapis\.com$/i.test(_h.hostname)) window.__autoflowcut_api_origin__ = _h.origin } catch (_e) {}
    let _input   = input
    let _init    = init || {}
    const inject = window.__autoflowcut_inject__ || {}
    const _reqStartedAt = Date.now() / 1000  // stale 응답 필터용(main: pendingGeneration.setAt 와 비교)
    // #R14-2: 주입이 "요청"됐는지 + 처리 중 "에러"가 났는지 추적. 요청됐는데 에러로 적용 못 하면
    //   잘못된 파라미터(누락된 ref/seed/aspect/i2v)로 생성되지 않게 fail-closed 한다.
    let injectionRequested = false
    let injectionApplied = false
    let injectionError = false

    // === REQUEST MODIFICATION ===
    try {
      if (_init.body && typeof _init.body === 'string') {

        // Image batch: seed / aspectRatio / references
        if (url.includes(URL_BATCH_IMG) && (inject.seed != null || inject.aspectRatio || inject.references)) {
          injectionRequested = true
          const body    = JSON.parse(_init.body)
          const changed = injectImageBatchBody(body, inject)
          if (changed) {
            injectionApplied = true
            _init = { ..._init, body: JSON.stringify(body) }
            console.log("[Flow Inject] batchGenerateImages modified", {
              seed: inject.seed, aspectRatio: inject.aspectRatio, refs: inject.references?.length || 0,
            })
          }

        // Video I2V: model conversion + startImage/endImage + optional seed
        } else if (
          inject.i2v && (
            url.includes(URL_VIDEO_T2V) ||
            url.includes(URL_VIDEO_I2V) ||
            url.includes(URL_VIDEO_I2V_END)
          )
        ) {
          injectionRequested = true
          const body    = JSON.parse(_init.body)
          const { changed, usesEndImage } = injectI2VBody(body, inject.i2v)
          if (changed) {
            injectionApplied = true
            // Also apply seed + 화면비(설정>씬) if specified — I2V 요청 requests[].aspectRatio 직접 주입
            //   (DOM 세터가 Flow 패널 개편으로 비디오에 안 걸리므로. T2V/R2V 분기 미러.)
            if (Array.isArray(body.requests)) {
              for (const req of body.requests) {
                if (inject.seed != null) req.seed = inject.seed
                if (inject.videoAspectRatio) req.aspectRatio = inject.videoAspectRatio
              }
            }
            _init = { ..._init, body: JSON.stringify(body) }

            // Redirect to correct I2V endpoint — body 에 endImage 가 실제로 들어갔을 때만
            //   StartAndEnd 로. raw endImageMediaId 로 정하면 abra(endImage 생략)가 StartAndEnd 로 가
            //   body/엔드포인트 불일치 → 400 INVALID_ARGUMENT.
            const targetUrl = usesEndImage
              ? inject.i2v.i2vStartEndUrl
              : inject.i2v.i2vUrl
            if (targetUrl && url !== targetUrl) {
              console.log('[Flow Inject] i2v redirect:', url.split('/v1/').pop(), '→', targetUrl.split('/v1/').pop())
              // Don't early-return — re-target so the main fetch+capture path applies the new URL.
              _input = targetUrl
              url = targetUrl
            } else {
              console.log('[Flow Inject] i2v body modified (same endpoint)')
            }
          }

        // T2V injection (i2v 아님): seed + OmniFlash 길이 접미사 최적화(applyOmniDuration).
        //   duration 만 있어도 동작하게 조건에 inject.duration 포함.
        //   #R36-ref: @멘션 R2V(ReferenceImages) 도 여기서 처리 — 별도 엔드포인트라 이게 없으면 duration
        //     주입이 스킵돼 Flow 기본 abra_r2v_8s(8초) 로 나간다. r2v 는 t2v 가 아닌 r2v 키를 강제한다.
        } else if (
          (inject.seed != null || inject.duration != null || inject.videoAspectRatio) && !inject.i2v && (
            url.includes(URL_VIDEO_T2V) ||
            url.includes(URL_VIDEO_I2V) ||
            url.includes(URL_VIDEO_I2V_END) ||
            url.includes(URL_VIDEO_REF)
          )
        ) {
          injectionRequested = true
          const body = JSON.parse(_init.body)
          if (Array.isArray(body.requests)) {
            injectionApplied = true
            const isRef = url.includes(URL_VIDEO_REF)  // @멘션 reference-to-video
            const forceOmni = isOmniFlashModel(inject.videoModel)  // 앱이 OmniFlash 면 abra 키 강제
            for (const req of body.requests) {
              if (inject.seed != null) req.seed = inject.seed
              // 화면비(설정>씬) — Flow 설정 패널이 통합 UI 로 바뀌어 DOM 세터가 비디오에 안 걸리므로
              //   요청 body 에 직접 주입한다(이미지 imageAspectRatio 미러). 없으면 미수정(Flow 기본값).
              if (inject.videoAspectRatio) req.aspectRatio = inject.videoAspectRatio
              req.videoModelKey = forceOmni
                ? omniFlashKey(isRef ? 'r2v' : 't2v', inject.duration)
                : applyOmniDuration(req.videoModelKey, inject.duration)  // OmniFlash 만 효과, 그 외 no-op
            }
            _init = { ..._init, body: JSON.stringify(body) }
  // 페이지 스크립트의 로그다. main 이 '[Flow Page]' 접두로 포워딩하고, beforeBreadcrumb 이 그
  //   접두의 breadcrumb 을 통째로 버린다(페이지 = 사용자 콘텐츠). safe-log: Sentry 로 나가지 않는다.
            console.log('[Flow Inject] video', isRef ? 'r2v' : 't2v', ':', body.requests[0] && body.requests[0].videoModelKey, 'seed', inject.seed, 'dur', inject.duration)
          }
        }
      }
    } catch (e) {
      console.warn('[Flow Inject] body modification error:', e.message)
      injectionError = true
    }

    // #R14-2/#R15-4: 주입이 요청됐는데 실제로 적용되지 않았으면(에러 OR 예상치 못한 body 형태로
    //   no-op) fail-closed — 원본(미주입) 요청을 보내면 잘못된 seed/aspect/ref/i2v 로 생성돼 quota 를
    //   태우고 결과가 조용히 틀어진다. generation 요청은 항상 주입이 적용되어야 한다.
    if (injectionRequested && !injectionApplied) {
      console.error('[Flow Inject] requested injection not applied — blocking request (fail-closed)', { injectionError })
      throw new Error('Flow injection failed — request blocked to avoid wrong-parameter generation')
    }

    // === EXECUTE original fetch ===
    const res = await _fetch.call(this, _input, _init)

    // === RESPONSE CAPTURE ===
    try {
      if (typeof url === 'string' && (
        url.includes(URL_BATCH_IMG)     ||
        url.includes(URL_VIDEO_T2V)     ||
        url.includes(URL_VIDEO_I2V)     ||
        url.includes(URL_VIDEO_I2V_END) ||
        url.includes(URL_VIDEO_REF)     ||  // #R36-ref: @멘션 R2V 응답도 캡처해야 generationId 회수됨
        url.includes(URL_VIDEO_UPSAMPLE)||
        url.includes(URL_VIDEO_STATUS)
      )) {
        const cloned = res.clone()
        const reqBody = typeof _init.body === 'string' ? _init.body : null
        // #R35: 이 요청을 arm 한 inject 의 genTag(요청 시점 캡처된 로컬 inject 객체 — set/clear 는 객체를
        //   교체하므로 응답 시점까지 이 값이 유지된다)를 응답 보고에 실어 정확한 async 생성에 correlate.
        const _genTag = inject && inject.genTag ? inject.genTag : null
        cloned.text()
          .then(body => reportResponse(url, body, res.status, reqBody, _reqStartedAt, _genTag))
          .catch(() => {})
      }
    } catch (e) {
      console.warn('[Flow Inject] response capture error:', e.message)
    }

    // === NET CAPTURE (진단) — 캐릭터/장면 API 역공학용. Flow API 도메인의 non-GET 요청
    //     {method,url,status,reqBody,respBody} 를 window.__autoflowcut_net__ 에 누적한다.
    //     Cmd/Ctrl+Shift+N 으로 /tmp 에 덤프(main). 생성 동작과 독립 — 기존 로직 안 건드림. ===
    try {
      const _m = ((_init && _init.method) || 'GET').toUpperCase()
      // entity 생성/예약 호출이 GET 이거나 다른 google 도메인일 수 있어, 진단 동안 GET 포함 +
      // googleapis 전체를 캡처한다(노이즈 늘지만 누락 방지). 원인 확인 후 non-GET+aisandbox 로 좁힐 것.
      if (_m !== 'HEAD' && typeof url === 'string' && url.indexOf('google') !== -1) {
        if (!window.__autoflowcut_net__) window.__autoflowcut_net__ = []
        // 대용량 base64 필드(imageBytes 등)를 placeholder 로 치환 — 그래야 그 "뒤" 필드(entityId/surface
        //   등)까지 보존돼 진단 가능(이전엔 60000자 slice 로 imageBytes 중간에서 잘려 뒷부분 유실).
        let _rb = typeof _init.body === 'string' ? _init.body : null
        if (_rb) {
          _rb = _rb.replace(/("(?:imageBytes|imageBase64|data|bytesBase64Encoded)":")[^"]{200,}(")/g, '$1<elided>$2').slice(0, 8000)
        }
        // 요청 헤더 기록 — character 컨텍스트가 헤더로 갈 수 있어 진단에 필요.
        let _rh = null
        try {
          const _h = _init && _init.headers
          if (_h) {
            if (typeof _h.forEach === 'function') { _rh = {}; _h.forEach(function (v, k) { _rh[k] = v }) }
            else _rh = _h
          }
        } catch (_) {}
        res.clone().text().then(function(_resp) {
          window.__autoflowcut_net__.push({ method: _m, url: url, status: res.status, reqHeaders: _rh, reqBody: _rb, respBody: (_resp || '').slice(0, 60000) })
          while (window.__autoflowcut_net__.length > 300) window.__autoflowcut_net__.shift()
        }).catch(function() {})
      }
    } catch (_) {}

    return res
  }

  // ─── Anti-detection: spoof fetch.toString() ───────────────────
  try {
    Object.defineProperty(window.fetch, 'toString', {
      value: function() { return 'function fetch() { [native code] }' },
      configurable: true,
    })
    Object.defineProperty(window.fetch, 'name', { value: 'fetch', configurable: true })
  } catch (_) {}

  console.log('[Flow Inject] window.fetch monkey-patched (autoflowcut)')

  // === reCAPTCHA action 캡처 (진단) — Flow 가 grecaptcha.enterprise.execute 에 쓰는 action 을
  //     페이지 초기부터 후킹해 잡는다(콘솔 래핑은 토큰 선생성/모듈 내부참조 때문에 늦어 못 잡음).
  //     [Flow Inject] 접두사라 main 이 터미널로 포워딩한다. ===
  ;(function af_wrapRecaptcha() {
    try {
      var g = window.grecaptcha
      if (g && g.enterprise && typeof g.enterprise.execute === 'function' && !g.enterprise.__af_wrapped) {
        var _e = g.enterprise.execute
        g.enterprise.execute = function(key, o) {
          try {
            ;(window.__af_recaptcha__ = window.__af_recaptcha__ || []).push({ action: o && o.action, ts: Date.now() })
            console.log('[Flow Inject] reCAPTCHA action:', o && o.action)
          } catch (_) {}
          return _e.apply(this, arguments)
        }
        g.enterprise.__af_wrapped = true
        console.log('[Flow Inject] grecaptcha.enterprise.execute wrapped')
      }
    } catch (_) {}
    // #R11-13: 래핑 완료 시 폴링 중단(영구 1s setTimeout 누적 방지). grecaptcha 미로드 대비 최대 60회 바운드.
    try { if (window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.__af_wrapped) return } catch (_) {}
    window.__af_recap_tries__ = (window.__af_recap_tries__ || 0) + 1
    if (window.__af_recap_tries__ > 60) return
    setTimeout(af_wrapRecaptcha, 1000)
  })()
})()
`
