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

export const FLOW_PAGE_INJECTION = /* js */ `
(function() {
  if (window.__autoflowcut_fetch_patched__) return
  window.__autoflowcut_fetch_patched__ = true

  const _fetch = window.fetch

  // URL keyword constants (partial match — avoids full URL coupling)
  const URL_BATCH_IMG        = 'batchGenerateImages'
  const URL_VIDEO_T2V        = 'batchAsyncGenerateVideoText'
  const URL_VIDEO_I2V        = 'batchAsyncGenerateVideoStartImage'
  const URL_VIDEO_I2V_END    = 'batchAsyncGenerateVideoStartAndEndImage'
  const URL_VIDEO_UPSAMPLE   = 'batchAsyncGenerateVideoUpsampleVideo'
  const URL_VIDEO_STATUS     = 'batchCheckAsyncVideoGenerationStatus'

  // Pending inject values written by main process via executeJavaScript.
  // All fields default to null (= no modification).
  window.__autoflowcut_inject__ = {
    seed: null,        // number | null — injected into every request in the batch
    aspectRatio: null, // string | null — IMAGE_ASPECT_RATIO_* enum value
    references: null,  // array | null  — referenceImages for batchGenerateImages
    i2v: null,         // object | null — { startImageMediaId, endImageMediaId?, i2vUrl, i2vStartEndUrl }
  }

  // ─── injectImageBatchBody ──────────────────────────────────────
  // Returns true if body was modified.
  function injectImageBatchBody(body, inject) {
    if (!Array.isArray(body.requests)) return false
    let modified = false
    for (const req of body.requests) {
      if (inject.seed != null)       { req.seed = inject.seed;                        modified = true }
      if (inject.aspectRatio)        { req.imageAspectRatio = inject.aspectRatio;     modified = true }
      if (inject.references)         { req.referenceImages  = inject.references;      modified = true }
    }
    return modified
  }

  // ─── injectI2VBody ────────────────────────────────────────────
  // T2V → I2V model key conversion map (same as CDP path in main.js).
  // Returns true if body was modified.
  function injectI2VBody(body, i2v) {
    const T2V_TO_I2V_MAP = {
      'veo_3_1_t2v_fast_ultra_relaxed':          'veo_3_1_i2v_s_fast_fl',
      'veo_3_1_t2v_fast':                        'veo_3_1_i2v_s_fast_fl',
      'veo_3_1_t2v_fast_portrait_ultra_relaxed': 'veo_3_1_i2v_s_fast',
      'veo_3_1_t2v_fast_portrait':               'veo_3_1_i2v_s_fast',
      'veo_3_1_t2v_quality_ultra_relaxed':       'veo_3_1_i2v_quality',
      'veo_3_1_t2v_quality':                     'veo_3_1_i2v_quality',
    }
    const defaultCrop = { top: 0, left: 0, bottom: 1, right: 1 }
    const hasEnd = !!i2v.endImageMediaId

    if (!Array.isArray(body.requests)) return false
    for (const req of body.requests) {
      const origModel   = req.videoModelKey
      req.videoModelKey = T2V_TO_I2V_MAP[origModel] || 'veo_3_1_i2v_s_fast_fl'
      req.startImage    = { mediaId: i2v.startImageMediaId, cropCoordinates: defaultCrop }
      if (hasEnd) req.endImage = { mediaId: i2v.endImageMediaId, cropCoordinates: defaultCrop }
    }
    return true
  }

  // ─── reportResponse ───────────────────────────────────────────
  // Forwards captured response to main process via preload-exposed IPC.
  // requestBody: the outgoing request body string — main uses it to correlate
  // the response to the generation that triggered it (prompt-based matching).
  function reportResponse(url, body, status, requestBody) {
    try {
      window.electronAPI?.flowReportResponse?.({ url, body, status, requestBody })
    } catch (e) {
      console.warn('[Flow Inject] reportResponse failed:', e.message)
    }
  }

  // ─── Patched fetch ────────────────────────────────────────────
  window.fetch = async function(input, init) {
    let url      = typeof input === 'string' ? input : (input?.url || '')
    let _input   = input
    let _init    = init || {}
    const inject = window.__autoflowcut_inject__ || {}

    // === REQUEST MODIFICATION ===
    try {
      if (_init.body && typeof _init.body === 'string') {

        // Image batch: seed / aspectRatio / references
        if (url.includes(URL_BATCH_IMG) && (inject.seed != null || inject.aspectRatio || inject.references)) {
          const body    = JSON.parse(_init.body)
          const changed = injectImageBatchBody(body, inject)
          if (changed) {
            _init = { ..._init, body: JSON.stringify(body) }
            console.log('[Flow Inject] batchGenerateImages modified', {
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
          const body    = JSON.parse(_init.body)
          const changed = injectI2VBody(body, inject.i2v)
          if (changed) {
            // Also apply seed if specified
            if (inject.seed != null && Array.isArray(body.requests)) {
              for (const req of body.requests) req.seed = inject.seed
            }
            _init = { ..._init, body: JSON.stringify(body) }

            // Redirect to correct I2V endpoint if needed
            const targetUrl = inject.i2v.endImageMediaId
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

        // T2V seed-only injection (when i2v is null but seed is set)
        } else if (
          inject.seed != null && !inject.i2v && (
            url.includes(URL_VIDEO_T2V) ||
            url.includes(URL_VIDEO_I2V) ||
            url.includes(URL_VIDEO_I2V_END)
          )
        ) {
          const body = JSON.parse(_init.body)
          if (Array.isArray(body.requests)) {
            for (const req of body.requests) req.seed = inject.seed
            _init = { ..._init, body: JSON.stringify(body) }
            console.log('[Flow Inject] video seed injected:', inject.seed)
          }
        }
      }
    } catch (e) {
      console.warn('[Flow Inject] body modification error:', e.message)
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
        url.includes(URL_VIDEO_UPSAMPLE)||
        url.includes(URL_VIDEO_STATUS)
      )) {
        const cloned = res.clone()
        const reqBody = typeof _init.body === 'string' ? _init.body : null
        cloned.text()
          .then(body => reportResponse(url, body, res.status, reqBody))
          .catch(() => {})
      }
    } catch (e) {
      console.warn('[Flow Inject] response capture error:', e.message)
    }

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
})()
`
