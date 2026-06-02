/**
 * Electron IPC Handler — Google GenAI(BYOK) operations.
 *
 * Flow 역공학 IPC(flow-api / video)를 대체하는 공식 API 호출 경로.
 * 이 모듈은 (1) BYOK 키 관리 (2) 이미지/비디오 생성 IPC 를 담당한다.
 *
 * 보안: 사용자 API 키는 keyStore(암호화)에만 존재. renderer 로는 존재 여부만
 * 노출하고 평문 키는 절대 반환하지 않는다. 생성 호출 시 main 이 keyStore 에서
 * 키를 꺼내 직접 Google API 로 보낸다 — 키가 renderer 를 거치지 않는다.
 */
import {
  validateApiKey,
  generateImage as genImage,
  submitVideo,
  checkVideoOperation,
  fetchVideoBase64,
} from '../api/genai.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {object} deps
 * @param {ReturnType<import('../api/keyStore.js').createKeyStore>} deps.keyStore
 * @param {Function} [deps.fetchImpl] - 주입용 fetch (테스트). 없으면 엔진이 global fetch 사용.
 */
export function registerGenaiIPC(ipcMain, deps) {
  const { keyStore, fetchImpl } = deps
  // 엔진에 넘길 deps. fetchImpl 없으면 {} → 엔진이 기본 global fetch 사용.
  const engineDeps = fetchImpl ? { fetchImpl } : {}

  // --- 키 관리 ---------------------------------------------------------------

  // 키 존재 여부 + 암호화 가용성. 평문 키는 반환 안 함.
  ipcMain.handle('genai:get-key-status', () => ({
    hasKey: keyStore.hasKey(),
    encryptionAvailable: keyStore.isEncryptionAvailable(),
  }))

  // 키 저장 (암호화).
  ipcMain.handle('genai:set-key', async (_e, { apiKey } = {}) => keyStore.setKey(apiKey))

  // 키 삭제.
  ipcMain.handle('genai:clear-key', () => keyStore.clearKey())

  // 키 유효성 검증. apiKey 가 주어지면 그 후보를, 없으면 저장된 키를 검증.
  // 생성 quota 를 소비하지 않는 가벼운 호출.
  ipcMain.handle('genai:validate-key', async (_e, { apiKey } = {}) => {
    const key = apiKey || keyStore.getKey()
    if (!key) return { valid: false, error: 'No API key' }
    return validateApiKey({ apiKey: key }, engineDeps)
  })

  // --- 생성 (이미지) ---------------------------------------------------------
  //
  // 출력 계약은 기존 flow:generate-image 와 동일하게 유지:
  //   { success, images: [{ base64, mimeType, dataUrl }], error }
  // 단, 키는 renderer 에서 받지 않고 main 의 keyStore 에서 꺼낸다.
  ipcMain.handle('genai:generate-image', async (_e, params = {}) => {
    const apiKey = keyStore.getKey()
    if (!apiKey) return { success: false, error: 'No API key' }
    const { prompt, referenceImages = [], aspectRatio, model } = params
    return genImage({ apiKey, prompt, referenceImages, aspectRatio, model }, engineDeps)
  })

  // --- 생성 (비디오) ---------------------------------------------------------
  //
  // 앱의 async 3-phase 파이프라인과 매칭: 제출 → 상태폴링 → 다운로드 분리.

  // 제출 (T2V / I2V). image 가 있으면 I2V.
  ipcMain.handle('genai:generate-video', async (_e, params = {}) => {
    const apiKey = keyStore.getKey()
    if (!apiKey) return { success: false, error: 'No API key' }
    const { prompt, image = null, aspectRatio, durationSeconds, model } = params
    const res = await submitVideo({ apiKey, prompt, image, aspectRatio, durationSeconds, model }, engineDeps)
    // 기존 contract 와 호환되게 operationName → generationId 로도 노출
    if (res.success) return { success: true, generationId: res.operationName, operationName: res.operationName }
    return res
  })

  // 상태 폴링 (operationName 배열). 기존 checkVideoStatus 의 statuses[] 형태로 매핑.
  ipcMain.handle('genai:check-video-status', async (_e, { generationIds = [] } = {}) => {
    const apiKey = keyStore.getKey()
    if (!apiKey) return { success: false, error: 'No API key' }

    const statuses = await Promise.all(
      generationIds.map(async (operationName) => {
        const r = await checkVideoOperation({ apiKey, operationName }, engineDeps)
        if (!r.success) return { generationId: operationName, status: 'failed', error: r.error }
        if (!r.done) return { generationId: operationName, status: 'pending' }
        return { generationId: operationName, status: 'completed', videoUri: r.videoUri }
      })
    )
    return { success: true, statuses }
  })

  // 완료된 비디오 다운로드 (videoUri → base64).
  ipcMain.handle('genai:download-video', async (_e, { videoUri } = {}) => {
    const apiKey = keyStore.getKey()
    if (!apiKey) return { success: false, error: 'No API key' }
    return fetchVideoBase64({ apiKey, videoUri }, engineDeps)
  })
}
