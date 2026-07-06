import { STORY_TTS_PROVIDERS } from '../../src/config/storyTtsProviders.js'

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
 * @param {(args: {provider: string, voiceId: string, language: string}) => Promise<object>} [deps.previewVoice] - 성우 미리듣기 오디오
 * @param {(args: {provider: string, voiceId: string, gender: string, f0: ?number, confidence: ?number, source: string}) => void} [deps.tagVoiceGender] - 성별 수동/f0 태깅
 */
export function registerTtsIPC(ipcMain, { keyStore, safeStorage, listVoices, previewVoice, tagVoiceGender }) {
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
      maxSharedPages: p.maxSharedPages,
    })
  })

  // 성우 미리듣기 오디오(base64). provider/voiceId 검증 후 previewVoice에 위임.
  ipcMain.handle('tts:preview-voice', async (_e, payload) => {
    const p = payload || {}
    if (!STORY_TTS_PROVIDERS.includes(p.provider)) return { error: 'bad-provider' }
    if (!p.voiceId || typeof p.voiceId !== 'string' || p.voiceId.length > 128) return { error: 'bad-voice' }
    const language = p.language === 'en' ? 'en' : 'ko'
    return previewVoice({ provider: p.provider, voiceId: p.voiceId, language })
  })

  // 성우 성별 태깅(f0 추정치 또는 사용자 수동 지정). app-global 캐시에 저장.
  ipcMain.handle('tts:tag-voice-gender', async (_e, payload) => {
    const p = payload || {}
    if (!STORY_TTS_PROVIDERS.includes(p.provider)) return { ok: false }
    if (!p.voiceId || typeof p.voiceId !== 'string' || p.voiceId.length > 128) return { ok: false }
    if (!['male', 'female'].includes(p.gender)) return { ok: false }
    if (!['f0', 'manual'].includes(p.source)) return { ok: false }
    tagVoiceGender({ provider: p.provider, voiceId: p.voiceId, gender: p.gender, f0: p.f0 ?? null, confidence: p.confidence ?? null, source: p.source })
    return { ok: true }
  })
}
