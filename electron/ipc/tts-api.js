/**
 * Electron IPC — TTS provider 키 관리(멀티) + 성우 목록 (스펙 §6, M2a-3b).
 *
 * 보안: provider별 API 키는 keyStoreMulti(암호화)에만 존재. renderer로는 존재 여부만
 * 노출하고 평문 키는 절대 반환하지 않는다(genai-api.js 패턴 동일).
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} deps
 * @param {ReturnType<import('../api/keyStoreMulti.js').createMultiKeyStore>} deps.keyStore
 * @param {Electron.SafeStorage} deps.safeStorage
 * @param {(provider: string, options?: object) => Promise<Array>|Array} deps.listVoices - provider → 성우 목록
 */
export function registerTtsIPC(ipcMain, { keyStore, safeStorage, listVoices }) {
  // payload는 null/비객체일 수 있다(Codex LOW) — 구조분해 전 객체로 정규화한다.
  // 키 존재 여부 + 암호화 가용성. 평문 키는 반환 안 함.
  ipcMain.handle('keys:status', (_e, payload) => {
    const { provider } = payload || {}
    return {
      provider,
      hasKey: keyStore.hasKey(provider),
      encryptionAvailable: safeStorage?.isEncryptionAvailable?.() ?? false,
    }
  })

  // 키 저장(암호화). keyStoreMulti가 allowlist 밖 provider는 {success:false}로 거부.
  ipcMain.handle('keys:set', async (_e, payload) => {
    const { provider, apiKey } = payload || {}
    return keyStore.setKey(provider, apiKey)
  })

  // 키 삭제.
  ipcMain.handle('keys:delete', (_e, payload) => keyStore.clearKey((payload || {}).provider))

  // provider 성우 목록 [{ id, name, language, previewUrl, traits, source }].
  ipcMain.handle('tts:list-voices', async (_e, payload) => {
    const p = payload || {}
    return listVoices(p.provider || 'typecast', {
      query: p.query,
      language: p.language,
      includeShared: p.includeShared,
      page: p.page,
      limit: p.limit,
    })
  })
}
