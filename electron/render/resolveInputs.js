// effectful: filename→절대경로 해석(컬렉션별 키), 존재 검증, narration 길이 probe. 스펙 §3.
import fs from 'fs'
import { probeDurationMs as realProbe } from '../story/audioProbe.js'

const defaultDeps = {
  existsSync: (p) => fs.existsSync(p),
  probeDurationMs: (p) => realProbe(p),
}

export async function resolveAndValidateInputs(prepared, deps = {}) {
  const { existsSync, probeDurationMs } = { ...defaultDeps, ...deps }
  const cr = prepared.cloudRequest || {}
  const images = new Map()
  const sfx = new Map()
  const audio = new Map()

  for (const m of (prepared.mediaFiles || [])) {
    if (m.type === 'video') continue                    // v1 미지원 (§4.9)
    if (!existsSync(m.path)) throw new Error(`render: missing image for ${m.sceneId} (${m.filename})`)
    images.set(m.sceneId, m.path)                        // 이미지 1/씬 → sceneId 키로 충분
  }
  for (const s of (prepared.sfxFiles || [])) {
    if (!existsSync(s.path)) throw new Error(`render: missing sfx for ${s.sceneId} (${s.filename})`)
    sfx.set(s.sceneId, s.path)
  }
  const seen = new Set()
  for (const a of (prepared.audioFiles || [])) {
    if (seen.has(a.filename)) throw new Error(`render: ambiguous audio filename ${a.filename}`)
    seen.add(a.filename)
    if (!existsSync(a.path)) throw new Error(`render: missing audio ${a.filename}`)
    audio.set(a.filename, a.path)
  }

  const durSec = cr.audioDurationSec
  const narrationDurationMs = async (filename) => {
    if (Number.isFinite(durSec) && durSec > 0) return Math.round(durSec * 1000)
    const p = audio.get(filename)
    const ms = await probeDurationMs(p)
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`render: cannot probe narration length ${filename}`)
    return ms
  }
  return { images, sfx, audio, narrationDurationMs }
}
