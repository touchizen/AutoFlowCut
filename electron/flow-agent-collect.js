/**
 * electron/flow-agent-collect.js
 *
 * Agent ON(flowCreationAgent:streamChat) 생성 결과 공용 수집기.
 *
 * Agent ON 은 batchGenerateImages 요청을 안 보내고 결과를 DOM <img>
 * (media.getMediaUrlRedirect?name=UUID) 로만 렌더한다 → intercept 로 못 받는다.
 * 그래서 "제출 전 스냅샷에 없던 새 결과 이미지"를 DOM 폴링으로 찾아 src 를 그대로
 * fetch(쿠키 포함, redirect 추적)해 base64 로 받는다.
 *
 * 이미지 생성 경로 전부(flow:generate-image / flow:generate-scene)가 이 한 곳을 쓴다 —
 * Agent ON 수집을 경로마다 복붙하다 갈라지는 걸 막는다. (비디오는 <video> 라 별도.)
 *
 * 순수성: DOM/네트워크는 주입된 콜백(scan/sessionFetch/sleep)으로만 접근 → 단위 테스트 가능.
 */

/** 스냅샷 결과에 없는 "새" 생성 이미지만 골라낸다(순수). */
export function pickFreshImages(scanned, existingMediaIds) {
  const seen = new Set(existingMediaIds || [])
  return (scanned || []).filter(i => i && i.mediaId && i.src && !seen.has(i.mediaId))
}

/**
 * @param {object} opts
 * @param {() => Promise<Array<{mediaId:string,src:string}>>} opts.scan - GENERATED_IMG_PROBE 실행
 * @param {(src:string) => Promise<{ok:boolean,arrayBuffer:Function,headers:{get:Function}}>} opts.sessionFetch
 * @param {(ms:number) => Promise<void>} opts.sleep
 * @param {string[]} opts.existingMediaIds - 제출 전 스냅샷(이미 떠 있던 이미지 = 캐릭터 등 제외)
 * @param {number} [opts.want=1] - 모을 결과 수(배치)
 * @param {number} [opts.pollMs=2000]
 * @param {number} [opts.maxWaitMs=180000]
 * @param {string} [opts.logPrefix]
 * @param {(msg:string)=>void} [opts.warn]
 * @returns {Promise<{success:boolean, images?:Array<{base64:string,mediaId:string}>, error?:string}>}
 */
export async function collectAgentDomImages({
  scan, sessionFetch, sleep, existingMediaIds = [], want = 1,
  pollMs = 2000, maxWaitMs = 180000, logPrefix = '[Flow Agent]', warn = () => {},
  markCollected = () => {},
}) {
  const need = Math.max(1, want)
  let waited = 0
  while (waited < maxWaitMs) {
    await sleep(pollMs)
    waited += pollMs
    let scanned = []
    try { scanned = await scan() } catch { /* 폴링 — 일시 실패 무시 */ }
    if (!Array.isArray(scanned)) continue
    const fresh = pickFreshImages(scanned, existingMediaIds)
    if (fresh.length < need) continue
    const out = []
    for (const { mediaId, src } of fresh.slice(0, need)) {
      try {
        const res = await sessionFetch(src)
        if (!res || !res.ok) throw new Error(`media fetch HTTP ${res && res.status}`)
        const buffer = await res.arrayBuffer()
        const base64Raw = Buffer.from(buffer).toString('base64')
        const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/png'
        out.push({ base64: `data:${contentType};base64,${base64Raw}`, mediaId })
        try { markCollected(mediaId) } catch { /* de-dup 등록 실패는 무시 */ }
      } catch (e) {
        warn(`${logPrefix} image fetch failed: ${e && e.message}`)
      }
    }
    if (out.length > 0) return { success: true, images: out }
  }
  return { success: false, error: 'Agent 생성 결과 이미지를 찾지 못했습니다 (timeout).' }
}

/**
 * Agent ON 비디오 결과 공용 수집기.
 *
 * 비디오 결과는 <video src=media...?name=UUID> 로 이미 "완성된" 채 렌더된다(이미지가
 * <img> 인 것과 동일 URL 형태, 태그만 다름). 이미지와 달리 base64 를 직접 받지 않고
 * fresh mediaId 만 골라 반환한다 — 다운로드는 렌더러의 기존 generationId→
 * check-video-status→download 파이프가 이어받기 때문(video 통화 = generationId).
 * 그래서 sessionFetch 가 필요없다. 폴링/스냅샷 제외/공유 de-dup 은 이미지와 동일.
 *
 * @param {object} opts
 * @param {() => Promise<Array<{mediaId:string,src:string}>>} opts.scan - GENERATED_VIDEO_PROBE 실행
 * @param {(ms:number) => Promise<void>} opts.sleep
 * @param {string[]} opts.existingMediaIds - 제출 전 스냅샷(이미 떠 있던 비디오 제외)
 * @param {number} [opts.want=1]
 * @param {number} [opts.pollMs=2000]
 * @param {number} [opts.maxWaitMs=360000] - Agent ON 비디오는 3~5분 걸릴 수 있어 길게.
 * @param {(mid:string)=>void} [opts.markCollected]
 * @returns {Promise<{success:boolean, videos?:Array<{mediaId:string,src:string}>, error?:string}>}
 */
export async function collectAgentDomVideos({
  scan, sleep, existingMediaIds = [], want = 1,
  pollMs = 2000, maxWaitMs = 360000, markCollected = () => {},
}) {
  const need = Math.max(1, want)
  let waited = 0
  while (waited < maxWaitMs) {
    await sleep(pollMs)
    waited += pollMs
    let scanned = []
    try { scanned = await scan() } catch { /* 폴링 — 일시 실패 무시 */ }
    if (!Array.isArray(scanned)) continue
    const fresh = pickFreshImages(scanned, existingMediaIds)
    if (fresh.length < need) continue
    const out = fresh.slice(0, need).map(({ mediaId, src }) => {
      try { markCollected(mediaId) } catch { /* de-dup 등록 실패는 무시 */ }
      return { mediaId, src }
    })
    return { success: true, videos: out }
  }
  return { success: false, error: 'Agent 생성 결과 비디오를 찾지 못했습니다 (timeout).' }
}
