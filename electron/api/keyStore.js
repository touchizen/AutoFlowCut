/**
 * keyStore.js — BYOK(사용자 Gemini API 키) 안전 저장소.
 *
 * Electron safeStorage(OS keychain 기반)로 암호화해 userData 폴더에 저장.
 * 평문 저장 금지(CLAUDE.md 보안) — 암호화 불가 환경에서는 저장 자체를 거부한다.
 *
 * 키는 main process 에만 존재한다. renderer 로는 절대 평문 키를 돌려주지 않고
 * 존재 여부(boolean)만 노출한다 (genai-api IPC 참고).
 *
 * safeStorage / filePath / fs 를 주입받는 팩토리 → 단위 테스트 가능.
 *
 * @param {object} deps
 * @param {Electron.SafeStorage} deps.safeStorage
 * @param {string} deps.filePath - 암호화 키를 저장할 파일 경로
 * @param {import('node:fs')} deps.fs - 동기 fs (existsSync/readFileSync/writeFileSync/unlinkSync)
 */
export function createKeyStore({ safeStorage, filePath, fs }) {
  function isEncryptionAvailable() {
    try {
      return !!safeStorage?.isEncryptionAvailable?.()
    } catch {
      return false
    }
  }

  /**
   * 키 저장 (암호화). 암호화 불가 환경에서는 거부 (평문 저장 안 함).
   * @returns {{success:boolean, error?:string}}
   */
  function setKey(plain) {
    if (!plain || typeof plain !== 'string') {
      return { success: false, error: 'Invalid API key' }
    }
    if (!isEncryptionAvailable()) {
      return { success: false, error: 'OS secure storage is unavailable; refusing to store key in plaintext' }
    }
    try {
      const encrypted = safeStorage.encryptString(plain)
      fs.writeFileSync(filePath, encrypted)
      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }

  /**
   * 저장된 키 복호화 반환. main process 내부 전용 (renderer 노출 금지).
   * @returns {string|null}
   */
  function getKey() {
    try {
      if (!fs.existsSync(filePath)) return null
      const buf = fs.readFileSync(filePath)
      if (!buf || buf.length === 0) return null
      if (!isEncryptionAvailable()) return null
      return safeStorage.decryptString(buf)
    } catch {
      return null
    }
  }

  /** 키 존재 여부 (renderer 에 노출 가능한 유일한 정보). */
  function hasKey() {
    try {
      if (!fs.existsSync(filePath)) return false
      const buf = fs.readFileSync(filePath)
      return !!buf && buf.length > 0
    } catch {
      return false
    }
  }

  /** 저장된 키 삭제. */
  function clearKey() {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return { success: true }
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }

  return { setKey, getKey, hasKey, clearKey, isEncryptionAvailable }
}
