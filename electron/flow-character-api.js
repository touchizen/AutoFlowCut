/**
 * electron/flow-character-api.js
 *
 * Flow 캐릭터 등록 API 헬퍼 (순수 함수, jsdom 불필요).
 *
 * 하이브리드 방식 — 순수 API 직접 호출로는 캐릭터 "생성"이 불가능(주입 fetch 는 reCAPTCHA
 * Enterprise 위험점수가 낮아 batchGenerateImages 가 영원히 400 INVALID_ARGUMENT).
 *   1) 생성은 Flow UI 트러스트 클릭으로 트리거 → 서버가 entity 를 만든다.
 *   2) batchGenerateImages 응답을 가로채 entityId/workflowId/mediaId 추출
 *      (parseCharacterGenerateResponse). entityId 는 응답 workflows[].parentEntityId 에 있어
 *      요청 body 없이 응답만으로 얻는다. 대표 이미지(primaryMediaId)도 UI 가 이미 지정한다.
 *   3) PATCH /v1/flow/entities 로 이름(멘션 토큰) 등록 (buildEntityRegisterBody, recaptcha 불필요).
 */

/** flow/entities PATCH body — 캐릭터 이름(멘션) + 이미지 레퍼런스 등록. */
export function buildEntityRegisterBody({ projectId, entityId, displayName, workflowId }) {
  return {
    entity: {
      projectId,
      entityId,
      entityInfo: {
        displayName,
        characterInfo: { imageReferences: [{ workflowId }, {}] },
      },
    },
    updateMask: 'entityInfo.displayName,entityInfo.characterInfo.imageReferences',
  }
}

/**
 * batchGenerateImages 응답에서 {entityId, workflowId, mediaId, fifeUrl} 추출.
 * - workflowId/mediaId/fifeUrl: media[0] 에서.
 * - entityId: media[0] 에 대응하는 workflow 의 parentEntityId.
 *   ⚠️ workflows[0] 를 그냥 쓰지 않는다 — 순서가 다르거나 workflow 가 여러 개면 어긋난다.
 *   media.workflowId === workflow.name (또는 metadata.primaryMediaId === media.name) 로 매칭하고,
 *   못 찾으면 workflows[0] 로 폴백.
 */
export function parseCharacterGenerateResponse(text) {
  let data
  try { data = typeof text === 'string' ? JSON.parse(text) : text } catch { return null }
  const m = data && Array.isArray(data.media) ? data.media[0] : null
  if (!m) return null
  const gen = m.image && m.image.generatedImage ? m.image.generatedImage : {}
  const mediaId = m.name || null
  const workflowId = m.workflowId || null
  const fifeUrl = gen.fifeUrl || null
  if (!mediaId && !workflowId) return null
  const workflows = Array.isArray(data.workflows) ? data.workflows : []
  const matched = workflows.find(w => w && (
    (workflowId && w.name === workflowId) ||
    (mediaId && w.metadata && w.metadata.primaryMediaId === mediaId)
  ))
  // R4-P1: 매칭 실패 시 workflows[0] 폴백은 workflow 가 정확히 1개일 때만 — 여러 개인데 매칭이
  //   안 되면 잘못된 parentEntityId 를 고를 위험이 있어 entityId 를 비운다(오등록 방지).
  const wf = matched || (workflows.length === 1 ? workflows[0] : null)
  const entityId = (wf && wf.parentEntityId) || null
  return { entityId, workflowId, mediaId, fifeUrl, seed: gen.seed }
}

/**
 * fifeUrl 이미지를 data:base64 로 다운로드 (generate-character/reroll/scene 공통).
 * sessionFetch 는 main 의 세션 fetch(쿠키 포함). 실패/누락 시 null 반환(호출부가 로깅).
 */
export async function downloadFifeAsBase64(sessionFetch, fifeUrl) {
  if (!fifeUrl || typeof sessionFetch !== 'function') return null
  try {
    const res = await sessionFetch(fifeUrl)
    if (res && res.ok) {
      const buf = await res.arrayBuffer()
      const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/png'
      return `data:${ct};base64,${Buffer.from(buf).toString('base64')}`
    }
  } catch { /* 호출부에서 로깅 */ }
  return null
}

/**
 * reroll 400 응답이 "stale entity(현재 프로젝트에 없음)" 인지 판정(순수).
 *   관찰된 stale 시그니처: status INVALID_ARGUMENT. content-policy/validation 류 400(다른 status)
 *   은 stale 이 아니므로 self-heal(새 character 생성) 대상에서 제외 — generic 실패로 처리.
 */
export function isStaleEntityErrorBody(body) {
  if (!body) return false
  let data = body
  if (typeof body === 'string') { try { data = JSON.parse(body) } catch { return false } }
  // R5-P1: error.status 를 정확히 본다 — message/details 에 INVALID_ARGUMENT 가 우연히 들어가도
  //   self-heal(새 캐릭터 생성)로 오작동하지 않게(문자열 포함 검사 X).
  const status = data && data.error && data.error.status
  return status === 'INVALID_ARGUMENT'
}

/**
 * #R37: PATCH /flow/entities 응답이 "entity 가 없다(stale)" 인지 판정(순수).
 *
 * ⚠️ isStaleEntityErrorBody 를 그대로 쓰면 안 된다 — 그건 **reroll(batchGenerateImages) 400**
 *   전용이고 INVALID_ARGUMENT 만 본다. 이 PATCH 는 다르다: 위 A2 주석의 캡처 규약대로
 *   "없는 id 면 404 + NOT_FOUND body" 다. INVALID_ARGUMENT 만 보면 사용자가 Flow 라이브러리에서
 *   캐릭터를 지웠을 때(중복 정리 시 실제로 일어난다) stale 로 안 잡혀 업로드 self-heal 이 막히고
 *   ref 가 영구히 복구 불능이 된다.
 *
 * ⚠️ INVALID_ARGUMENT 는 stale 로 보지 않는다. 그건 "entity 는 멀쩡한데 workflowId/이름/body 가
 *   잘못됐다" 일 수도 있다. 오판의 대가가 비대칭이다:
 *     - stale 인데 아니라고 하면 → 에러 토스트(복구 가능)
 *     - stale 이 아닌데 stale 이라고 하면 → 업로드 폴백 → **새 entity 생성 = 고치려던 그 버그**
 *   그래서 "없는 id" 의 구조화된 시그니처(HTTP 404 + error.status NOT_FOUND)만 인정한다.
 *   bare 404 는 API base/route 가 틀린 경우와 구분할 수 없어 stale 로 보지 않는다 — 그 경우 업로드
 *   폴백의 대가는 새 entity 생성이라, 복구를 멈추고 에러를 보여주는 쪽이 안전하다.
 *
 * @param {{status?: number, text?: string|object}} res - flowPageFetch 응답
 * @returns {boolean}
 */
export function isStaleRegistrationResponse(res) {
  if (!res) return false
  let data = res.text
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { data = null } }
  const errStatus = data && data.error && data.error.status
  return res.status === 404 && errStatus === 'NOT_FOUND'
}

// 멘션 옵션/칩 매칭 규칙은 electron/flow-mention-dom.js 로 옮겼다.
//   여기 있던 pickMentionOptionLabel / chipMatchesMentionName 는 in-page 로직의 "미러"였는데
//   아무도 import 하지 않는 죽은 코드였다 — 테스트만 초록불이고 앱은 안 고쳐지는 상태를 만들었다.
//   (실제 버그: 통짜 textContent 비교가 한글 타입 라벨 '캐릭터' 에 묶여 영어 Flow 에서 100% 실패.)

/** generate-character IPC 의 최종 반환 객체 빌더(순수) — 렌더러 generateImageDOM 과 동일한 images 형태. */
export function buildCharacterResult(parsed, base64Image, { displayName = null, registered = false, nameApplied = false } = {}) {
  return {
    success: true,
    images: base64Image ? [{ base64: base64Image, mediaId: parsed.mediaId }] : [],
    entityId: parsed.entityId,
    workflowId: parsed.workflowId,
    mediaId: parsed.mediaId,
    fifeUrl: parsed.fifeUrl,
    displayName,
    registered,
    // SPA 스토어에 이름을 반영했는가. false 면 호출측이 refreshFlowComposer 로 폴백해야 한다.
    nameApplied,
  }
}

/** flow/entities PATCH body — 이미지 레퍼런스만 갱신 (reroll 전용, displayName 미포함). */
export function buildEntityImageBody({ projectId, entityId, workflowId }) {
  return {
    entity: { projectId, entityId, entityInfo: { characterInfo: { imageReferences: [{ workflowId }, {}] } } },
    updateMask: 'entityInfo.characterInfo.imageReferences',
  }
}

/** flow/entities PATCH body — 이름(displayName)만 갱신 (A1c rename 동기화). */
export function buildEntityRenameBody({ projectId, entityId, displayName }) {
  return {
    entity: { projectId, entityId, entityInfo: { displayName } },
    updateMask: 'entityInfo.displayName',
  }
}

/**
 * A2: 이미지 업로드 요청 body — POST /v1/flow/uploadImage (character entity 생성용).
 *   캡처(2026-06-25, 헤더+full body): 일반 media 업로드와 달리 character 는 mediaGenerationContext.
 *   entityContext.{entityId(클라 생성 UUID), characterSlot.imageReferenceIndex:0} 를 함께 보낸다.
 *   서버가 그 entityId 로 character entity 를 만들고 응답 workflow.parentEntityId 로 echo 한다.
 *   (이게 빠지면 그냥 "모든 미디어" media 만 되고 entity 가 안 생긴다.)
 */
export function buildUploadImageBody({ projectId, base64, entityId, mimeType = 'image/jpeg', fileName = null }) {
  const body = {
    clientContext: { projectId, tool: 'PINHOLE' },
    imageBytes: base64,
    isUserUploaded: true,
    isHidden: false,
    mimeType: mimeType || 'image/jpeg',
  }
  if (fileName) body.fileName = fileName
  if (entityId) {
    body.mediaGenerationContext = { entityContext: { entityId, characterSlot: { imageReferenceIndex: 0 } } }
  }
  return body
}

/**
 * A2: 현재 Flow URL 의 base(+locale)를 보존하며 주어진 projectId 의 /characters URL 을 만든다.
 *   projectId 지정 시 그 프로젝트로 강제(= bound project) — Flow 탭이 다른 프로젝트에 있어도 entity 가
 *   엉뚱한 프로젝트에 생기는 것 방지. 미지정이면 현재 URL 의 project 를 사용.
 *   못 만들면 null(호출부가 abort).
 */
export function buildCharactersUrl(currentUrl, projectId = null) {
  const u = currentUrl || ''
  if (projectId) {
    // base(+locale)만 있으면 project 세그먼트가 없어도(홈/landing) bound projectId 로 URL 구성한다(P2).
    const base = (u.match(/^(https?:\/\/[^/]+\/fx(?:\/[a-z]{2})?\/tools\/flow)\b/) || [])[1]
    if (base) return base + '/project/' + projectId + '/characters'
    const m2 = u.match(/^(.*)\/project\/[0-9a-fA-F-]{36}/)
    if (m2) return m2[1] + '/project/' + projectId + '/characters'
    // 최후 폴백: Flow 가 아직 안 떴어도(빈 URL 등) 앱 고정 base 로 진입 가능하게.
    return 'https://labs.google/fx/tools/flow/project/' + projectId + '/characters'
  }
  const m = u.match(/^(.*\/project\/[0-9a-fA-F-]{36})/)
  return m ? m[1] + '/characters' : null
}

/**
 * A2: 업로드 응답 파싱 → { mediaId, workflowId, entityId }.
 *   캡처: { media:{ name(=mediaId), workflowId, ... }, workflow:{ name, parentEntityId } }.
 *   ⚠️ uploadImage 가 entity 를 **자동 생성**하고 그 id 를 workflow.parentEntityId 로 준다.
 *   PATCH /flow/entities 는 기존 entity 만 수정(없는 id 면 404)이므로 그 entityId 를 그대로 써야 한다
 *   (client UUID 를 새로 만들면 NOT_FOUND). imageReferences[{workflowId}] 등록엔 workflowId 도 필요.
 */
export function parseUploadImageResponse(text) {
  let data
  try { data = typeof text === 'string' ? JSON.parse(text) : text } catch { return null }
  const media = data && data.media
  if (!media || !media.name) return null
  const wf = data.workflow || {}
  const workflowId = media.workflowId || wf.name || null
  return { mediaId: media.name, workflowId, entityId: wf.parentEntityId || null }
}
