// electron/reportResponseRouter.js
/**
 * flow:report-response 의 응답 라우팅 (순수 — main 의 모듈 state 는 ctx 로 주입).
 *
 * monkey-patch 가 forward 한 응답을 sync(pendingGeneration) / async(pendingGenerations) /
 * video(pendingVideoGeneration) 중 올바른 capture 로 보낸다. main.js 가 sender 검증 후 호출하고
 * state 접근자(get/set)를 ctx 로 넘긴다 — 그 덕에 routing 을 단위 테스트할 수 있다.
 *
 * @param {{url, body, status, requestBody?, reqStartedAt?}} payload
 * @param {{
 *   getPendingGeneration, setPendingGeneration, pendingGenerations,
 *   getPendingVideoGeneration, setPendingVideoGeneration
 * }} ctx
 */
import { routeBatchImageResponse } from './ipc/generationMatch.js'
import { createOwnedCollectionTimer, isStaleResponse, isVideoSubmitEndpoint } from './flow-generation-timeout.js'

// #R23-2: flow:report-response 의 발신 프레임 origin 검증.
//   sender webContents 일치만으론 부족하다 — 동일 view 가 다른(공격자) 페이지로
//   네비게이트되면 flow-preload 브리지(flowReportResponse)가 그대로 노출돼 임의 페이지가
//   생성 응답을 위조해 pending capture 를 attacker payload 로 resolve 할 수 있다.
//   합법 Flow 페이지는 https://labs.google origin 에서만 동작하므로 그 origin 으로 제한한다.
const FLOW_FRAME_ORIGIN = 'https://labs.google'

export function isFlowFrameOrigin(frameUrl) {
  if (typeof frameUrl !== 'string' || !frameUrl) return false
  try {
    return new URL(frameUrl).origin === FLOW_FRAME_ORIGIN
  } catch {
    return false
  }
}

export function routeReportResponse(payload, ctx) {
  const { url, body, status, requestBody, reqStartedAt, genTag } = payload || {}
  if (!url) return { ok: false }
  // #R31-4: 본문이 비어도 에러 status(>=400)면 계속 처리한다 — 안 그러면 빈 본문 401/403/429/5xx 가
  //   여기서 drop 되어 pending capture 가 timeout 까지 매달린다(인증/quota/서버 분류를 못 받음).
  //   성공인데 본문이 비면 라우팅할 게 없으니 기존대로 무시.
  if (!body && !(typeof status === 'number' && status >= 400)) return { ok: false }

  // ── batchGenerateImages → sync(pendingGeneration) vs async(pendingGenerations) ──
  if (url.includes('batchGenerateImages')) {
    // #R35: genTag 최우선 매칭 — 페이지가 요청 시점의 inject.genTag 를 응답에 실어 보내면, seed/promptKey
    //   와 무관하게 이 응답이 어느 async 생성(@멘션 씬)의 것인지 100% 확정된다. seed 는 사용자 값 그대로.
    //   #R35-fix(Codex R7[1]): genTag 가 "있는" 응답은 특정 async 씬 소유다. pending 에 없으면(이미
    //   collect/삭제된 늦은/중복 응답) 아래 promptKey/sync 라우팅으로 흘리지 않고 여기서 drop 한다
    //   (sync 가 남의 tagged 응답을 받는 것 방지). 폴백 라우팅은 genTag 가 "아예 없는" 응답에만 허용.
    if (genTag) {
      const g = ctx.pendingGenerations && ctx.pendingGenerations.get(genTag)
      if (!g) return { ok: true, stale: true }
      if (typeof reqStartedAt === 'number' && g.setAt && reqStartedAt < g.setAt) {
        return { ok: true, stale: true }
      }
      // #R35-fix(Codex R7[4]): 이미 완료된 gen 의 중복(늦은) 응답은 append 하지 않는다(초과 이미지 방지).
      if (g.completed) return { ok: true, duplicate: true }
      g.responses.push({ error: false, body, status })
      if (g.responses.length >= g.expectedCount) {
        g.completed = true
        if (g.collectionTimer) clearTimeout(g.collectionTimer)
      } else if (g.collectionTimer == null) {
        g.collectionTimer = setTimeout(() => {
          const gg = ctx.pendingGenerations.get(genTag)
          if (gg && !gg.completed) gg.completed = true
        }, 30000)
      }
      return { ok: true, matchedByGenTag: true }
    }
    const route = routeBatchImageResponse({
      hasSyncPending: !!ctx.getPendingGeneration(),
      syncSetAt: ctx.getPendingGeneration()?.setAt,
      pendingGenerations: ctx.pendingGenerations,
      requestBody,
      reqStartedAt,
    })

    if (route.target === 'sync') {
      const pg = ctx.getPendingGeneration()
      pg.responses.push({ error: false, body, status })
      if (pg.responses.length >= pg.expectedCount) {
        ctx.setPendingGeneration(null)
        if (pg.collectionTimer) clearTimeout(pg.collectionTimer)
        pg.resolve({ error: false, responses: pg.responses })
      } else {
        // 더 남음 — owner identity 가드 collection timer (stale timer 가 새 pending 오resolve 방지).
        if (pg.collectionTimer) clearTimeout(pg.collectionTimer)
        pg.collectionTimer = createOwnedCollectionTimer({
          owner: pg,
          getPending: ctx.getPendingGeneration,
          setPending: ctx.setPendingGeneration,
        })
      }
      return { ok: true }
    }

    if (route.target === 'async') {
      const matchId = route.matchId
      const g = ctx.pendingGenerations.get(matchId)
      // 매칭 gen 의 setAt 보다 먼저 시작된 요청의 응답은 이전 생성의 늦은 응답 → drop.
      if (typeof reqStartedAt === 'number' && g.setAt && reqStartedAt < g.setAt) {
        return { ok: true, stale: true }
      }
      g.responses.push({ error: false, body, status })
      if (g.responses.length >= g.expectedCount) {
        g.completed = true
        if (g.collectionTimer) clearTimeout(g.collectionTimer)
      } else {
        if (g.collectionTimer) clearTimeout(g.collectionTimer)
        g.collectionTimer = setTimeout(() => {
          if (ctx.pendingGenerations.has(matchId)) {
            const gg = ctx.pendingGenerations.get(matchId)
            if (!gg.completed) gg.completed = true
          }
        }, 30000)
      }
      return { ok: true }
    }
    // route.target === 'drop' — 아래로 흘려보냄
  }

  // ── 비디오 제출(T2V/I2V/I2V_END) → pendingVideoGeneration ──────────────────
  // R16/R17-P2: exact allowlist — UpsampleVideo(업스케일)/status 응답이 pending T2V/I2V 를 잘못
  //   resolve 하지 않게 isVideoSubmitEndpoint 로 좁힌다.
  const pv = ctx.getPendingVideoGeneration()
  if (pv && isVideoSubmitEndpoint(url)) {
    if (isStaleResponse(reqStartedAt, pv.setAt)) {
      return { ok: true, stale: true }
    }
    ctx.setPendingVideoGeneration(null)
    pv.resolve({ error: status >= 400, body, status })
    return { ok: true }
  }

  return { ok: false, reason: 'no pending capture' }
}
