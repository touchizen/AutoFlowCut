/**
 * Flow DOM Client - Electron Desktop 버전
 *
 * Chrome Extension의 chrome.scripting.executeScript 대신
 * Electron의 WebContentsView + IPC를 통해 DOM 조작
 *
 * 흐름:
 * 1) 프로젝트 초기화 (Flow 베이스 URL → Enter tool 클릭 → 프로젝트 URL 대기)
 * 2) 화면비 설정 (aspect_ratio 콤보박스 → 비율 선택)
 * 3) flow:generate-image IPC 호출 (Slate.js 프롬프트 인젝션 + CDP 네트워크 캡처)
 */

import { DEFAULTS } from '../config/defaults'

const FLOW_BASE_URL = 'https://labs.google/fx/tools/flow'

// 배치 내 프로젝트 추적
let currentProjectUrl = null
let stopRequested = false

/**
 * 현재 URL이 Flow 프로젝트 안인지 확인
 */
function isFlowProjectUrl(url) {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname
    return pathname.includes('/tools/flow/') && pathname !== '/tools/flow/' && pathname.length > '/tools/flow/'.length
  } catch (e) {
    return false
  }
}

/**
 * 프로젝트 초기화: 이미 프로젝트가 있으면 재사용, 없으면 생성
 *
 * 핵심: main.js의 did-finish-load에서 이미 프로젝트를 생성했을 수 있으므로
 * 절대로 랜딩페이지로 네비게이션하지 않음! (기존 프로젝트 파괴 방지)
 */
async function ensureFlowProject(forceNew = false) {
  // 이미 프로젝트가 생성된 배치이면 스킵
  if (!forceNew && currentProjectUrl) {
    console.log('[DOM] Reusing project from this batch:', currentProjectUrl)
    return
  }

  // 항상 현재 URL 확인 (forceNew 여부 관계없이)
  const urlResult = await window.electronAPI.domGetUrl()
  if (urlResult?.success && isFlowProjectUrl(urlResult.url)) {
    console.log('[DOM] Already in Flow project:', urlResult.url)
    currentProjectUrl = urlResult.url
    return
  }

  // 프로젝트가 없는 경우에만 생성 시도
  console.log('[DOM] No project in current URL, creating new project...')

  // did-finish-load에서 이미 프로젝트가 생성되었을 수 있으므로 잠시 대기
  for (let wait = 0; wait < 10; wait++) {
    if (stopRequested) return
    await new Promise(r => setTimeout(r, 1000))
    const checkUrl = await window.electronAPI.domGetUrl()
    if (checkUrl?.success && isFlowProjectUrl(checkUrl.url)) {
      console.log('[DOM] Project appeared during wait:', checkUrl.url)
      currentProjectUrl = checkUrl.url
      return
    }
  }

  // 10초 기다려도 프로젝트가 없으면 → Enter tool 클릭 시도 (네비게이션 없이!)
  console.log('[DOM] Still no project after waiting, clicking Enter tool button...')
  const clickResult = await window.electronAPI.domClickEnterTool({
    selectors: DEFAULTS.selectors
  })

  if (!clickResult?.success) {
    console.warn('[DOM] Enter tool click failed:', clickResult?.error)
    // 마지막 수단: Flow 베이스로 이동 후 재시도
    console.log('[DOM] Last resort: navigating to Flow base...')
    await window.electronAPI.domNavigate({ url: FLOW_BASE_URL })
    for (let i = 0; i < 6; i++) {
      if (stopRequested) return
      await new Promise(r => setTimeout(r, 1000))
    }
    const retryClick = await window.electronAPI.domClickEnterTool({
      selectors: DEFAULTS.selectors
    })
    if (!retryClick?.success) {
      console.warn('[DOM] Enter tool retry also failed:', retryClick?.error)
      return
    }
  }

  console.log('[DOM] Enter tool clicked, waiting for project URL...')

  // 프로젝트 URL 대기 (최대 20초)
  const startTime = Date.now()
  while (Date.now() - startTime < 20000) {
    if (stopRequested) return
    await new Promise(r => setTimeout(r, 500))
    const res = await window.electronAPI.domGetUrl()
    if (res?.success && isFlowProjectUrl(res.url)) {
      currentProjectUrl = res.url
      console.log('[DOM] Project URL detected:', res.url)
      // 프로젝트 생성 후 잠시 대기 (UI 렌더링)
      await new Promise(r => setTimeout(r, 2000))
      return
    }
  }

  console.warn('[DOM] Timeout waiting for project URL, continuing anyway...')
  await new Promise(r => setTimeout(r, 2000))
}

/**
 * 새 배치 시작 시 호출 - 새 프로젝트 생성을 강제
 */
export function resetDOMSession() {
  currentProjectUrl = null
  stopRequested = false
}

/**
 * DOM 모드 중단 요청 - 폴링 루프를 즉시 종료
 */
export function requestStopDOM() {
  stopRequested = true
}

/**
 * DOM 방식으로 이미지 생성 (메인 엔트리)
 *
 * 기존: sendPrompt(IPC) → waitForImage(blob 폴링) — blob URL을 못 찾아서 실패
 * 변경: flow:generate-image IPC 호출 — CDP 네트워크 캡처로 API 응답 직접 파싱
 *
 * flow:generate-image는 내부적으로:
 * 1) Slate.js 에디터에 프롬프트 인젝션
 * 2) Generate 버튼 trusted click
 * 3) CDP로 batchGenerateImages 응답 캡처
 * 4) base64 이미지 추출 또는 mediaId → fetch
 */
/**
 * 비동기 제출 — 프롬프트만 제출하고 즉시 반환 (fire-and-forget)
 * @returns {{ success, generationId }} generationId로 나중에 결과 조회
 */
export async function submitGenerationDOM(prompt, referenceImages = [], { batchCount } = {}) {
  try {
    await ensureFlowProject(false)
    if (stopRequested) return { success: false, error: 'Stopped by user' }

    console.log('[DOM] Calling flow:generate-image (asyncMode) for prompt:', prompt?.substring(0, 40))
    const result = await window.electronAPI.generateImage({
      prompt,
      aspectRatio: null,
      token: null,
      model: null,
      projectId: null,
      seed: null,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      batchCount: batchCount || undefined,
      asyncMode: true
    })

    console.log('[DOM] Async submit result:', result?.success, 'generationId:', result?.generationId)
    return result
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 비동기 결과 조회 — generationId로 생성 완료 여부 확인
 */
export async function checkGeneration(generationId) {
  try {
    return await window.electronAPI.checkGeneration({ generationId })
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 비동기 결과 수집 — 완료된 생성의 이미지 파싱 + 반환
 */
export async function collectGeneration(generationId, token) {
  try {
    return await window.electronAPI.collectGeneration({ generationId, token })
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 비동기 생성 일괄 정리 (배치 종료 시)
 */
export async function clearGenerations() {
  try {
    return await window.electronAPI.clearGenerations()
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * DOM 방식으로 이미지 생성 (동기 — 기존 메인 엔트리)
 */
export async function generateImageDOM(prompt, referenceImages = [], { batchCount } = {}) {
  try {
    // 프로젝트 초기화: 현재 URL 확인 후 필요시 생성
    await ensureFlowProject(false)

    if (stopRequested) return { success: false, error: 'Stopped by user' }

    // flow:generate-image IPC 호출
    // CDP 네트워크 캡처로 이미지를 직접 가져옴 (blob 폴링 불필요)
    // token: null → main.js에서 자동 추출
    // referenceImages → CDP Fetch 인터셉션으로 batchGenerateImages 요청에 주입
    console.log('[DOM] Calling flow:generate-image IPC for prompt:', prompt?.substring(0, 40),
      referenceImages.length > 0 ? `(+${referenceImages.length} refs)` : '')
    const GENERATE_TIMEOUT_MS = 180000 // 3분 타임아웃
    const result = await Promise.race([
      window.electronAPI.generateImage({
        prompt,
        aspectRatio: null,  // DOM mode에서는 UI 드롭다운으로 이미 설정됨
        token: null,        // main.js에서 Flow 페이지의 세션으로 자동 추출
        model: null,
        projectId: null,
        seed: null,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        batchCount: batchCount || undefined
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Generation timeout (180s)')), GENERATE_TIMEOUT_MS))
    ])

    console.log('[DOM] flow:generate-image result:', result?.success,
      'images:', result?.images?.length || 0,
      result?.error ? 'error: ' + result.error.substring(0, 50) : '')
    return result

  } catch (error) {
    return { success: false, error: error.message }
  }
}
