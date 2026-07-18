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
import { createDispatcher } from '../api/providers/dispatcher.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {object} deps
 * @param {ReturnType<import('../api/keyStore.js').createKeyStore>} deps.genaiKeyStore
 * @param {ReturnType<import('../api/keyStoreMulti.js').createMultiKeyStore>} deps.multiKeyStore
 * @param {Function} [deps.fetchImpl] - 주입용 fetch (테스트). 없으면 엔진이 global fetch 사용.
 */
export function registerGenaiIPC(ipcMain, { genaiKeyStore, multiKeyStore, fetchImpl }) {
  // 엔진에 넘길 deps. fetchImpl 없으면 {} → 엔진이 기본 global fetch 사용.
  const engineDeps = fetchImpl ? { fetchImpl } : {}
  const dispatcher = createDispatcher({ genaiKeyStore, multiKeyStore, engineDeps })

  // --- 키 관리 ---------------------------------------------------------------

  // 키 존재 여부 + 암호화 가용성. 평문 키는 반환 안 함.
  ipcMain.handle('genai:get-key-status', () => dispatcher.getKeyStatus())

  // 키 저장 (암호화).
  ipcMain.handle('genai:set-key', (_e, params) => dispatcher.setKey(params))

  // 키 삭제.
  ipcMain.handle('genai:clear-key', (_e, params) => dispatcher.clearKey(params || {}))

  // 키 유효성 검증. apiKey 가 주어지면 그 후보를, 없으면 저장된 키를 검증.
  // 생성 quota 를 소비하지 않는 가벼운 호출.
  ipcMain.handle('genai:validate-key', (_e, params) => dispatcher.validateKey(params || {}))

  // 사용 가능한 모델 목록(raw). 모델 선택 드롭다운을 라이브 /models 로 채우는 데 사용.
  // 생성 quota 미소비. 카테고리 분류는 renderer(categorizeApiModels) 담당.
  ipcMain.handle('genai:list-models', (_e, params) => dispatcher.listModels(params || {}))

  // --- 생성 (이미지) ---------------------------------------------------------
  //
  // 출력 계약은 기존 flow:generate-image 와 동일하게 유지:
  //   { success, images: [{ base64, mimeType, dataUrl }], error }
  // 단, 키는 renderer 에서 받지 않고 main 의 keyStore 에서 꺼낸다.
  ipcMain.handle('genai:generate-image', (_e, params) => dispatcher.generateImage(params || {}))

  // --- 생성 (비디오) ---------------------------------------------------------
  //
  // 앱의 async 3-phase 파이프라인과 매칭: 제출 → 상태폴링 → 다운로드 분리.

  // 제출 (T2V / I2V). image 가 있으면 I2V.
  ipcMain.handle('genai:generate-video', (_e, params) => dispatcher.submitVideo(params || {}))

  // 상태 폴링 (operationName 배열). 기존 checkVideoStatus 의 statuses[] 형태로 매핑.
  ipcMain.handle('genai:check-video-status', (_e, params) => dispatcher.checkVideoStatus(params || {}))

  // 완료된 비디오 다운로드 (videoUri → base64).
  ipcMain.handle('genai:download-video', (_e, params) => dispatcher.downloadVideo(params || {}))
}
