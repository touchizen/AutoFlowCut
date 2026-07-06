import nodeFs from 'node:fs'
import path from 'node:path'

// app-global 성별 캐시. 프로젝트 무관. corrupt/missing → {} degrade.
export function createVoiceGenderCache({ filePath, fs = nodeFs }) {
  function get() {
    try {
      if (!fs.existsSync(filePath)) return {}
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {}
    } catch { return {} }
  }
  function tag({ provider, voiceId, gender, f0 = null, confidence = null, source }) {
    const data = get()
    data[`${provider}:${voiceId}`] = { gender, f0, confidence, source }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
    } catch { /* best-effort persist */ }
  }
  return { get, tag }
}
