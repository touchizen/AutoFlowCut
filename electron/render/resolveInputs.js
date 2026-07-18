// effectful: filename→절대경로 해석(컬렉션별 키), 존재 검증, narration 길이 probe. 스펙 §3.
import fs from 'fs'
import { writeFile, unlink } from 'fs/promises'
import os from 'os'
import path from 'path'
import { probeDurationMs as realProbe } from '../story/audioProbe.js'

// 파일명 안전화 — 한 곳에서만 정의(중복 방지).
const sanitizeName = (s) => String(s).replace(/\W+/g, '_')

// data: URL 또는 raw base64 문자열을 임시 파일로 decode(main 소유). 파일 경로/http 는 null.
function pickDataSpec(value) {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('data:')) return value
  if (value.startsWith('http://') || value.startsWith('https://')) return null
  // 파일 경로는 구분자로 "시작"한다(절대/상대/윈도우 드라이브). base64 는 '/' 를 중간에 포함할 수
  // 있으므로 "아무데나 /" 로 배제하면 유효 base64(예: 중간에 '/' 있는 PNG)를 놓친다 — 시작만 본다.
  if (value.startsWith('/') || value.startsWith('.') || value.startsWith('~') || value.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(value)) return null
  if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.replace(/\s/g, '').length > 64) return value
  return null
}

async function defaultDecodeDataUrl(spec, name) {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(spec)
  const ext = m ? m[1].replace(/[^a-z0-9]/gi, '') || 'png' : 'png'
  const b64 = m ? m[2] : spec
  const buf = Buffer.from(b64, 'base64')
  const out = path.join(os.tmpdir(), `render_${name}.${ext}`)
  await writeFile(out, buf)
  return out
}

const defaultDeps = {
  existsSync: (p) => fs.existsSync(p),
  probeDurationMs: (p) => realProbe(p),
  decodeDataUrl: defaultDecodeDataUrl,
}

export async function resolveAndValidateInputs(prepared, deps = {}) {
  const { existsSync, probeDurationMs, decodeDataUrl } = { ...defaultDeps, ...deps }
  const jobPrefix = deps.jobId ? `${sanitizeName(deps.jobId)}_` : ''
  const cr = prepared.cloudRequest || {}
  const images = new Map()
  const sfx = new Map()
  const audio = new Map()
  const tempFiles = []

  try {
  for (const m of (prepared.mediaFiles || [])) {
    if (m.type === 'video') continue                    // v1 미지원 (§4.9)
    // 1) 실제 파일 경로면 존재 확인
    if (typeof m.path === 'string' && !m.path.startsWith('data:') && existsSync(m.path)) {
      images.set(m.sceneId, m.path)                      // 이미지 1/씬 → sceneId 키로 충분
      continue
    }
    // 2) data:/base64 (path 또는 fallback) → 임시 파일 decode (다른 exporter 와 동일한 fallback 지원)
    const dataSpec = pickDataSpec(m.path) || pickDataSpec(m.fallback) || pickDataSpec(m.image)
    if (dataSpec) {
      const safe = sanitizeName(m.sceneId || 'scene')
      const tmp = await decodeDataUrl(dataSpec, `${jobPrefix}${safe}_${sanitizeName(m.filename || 'img')}`)
      images.set(m.sceneId, tmp)
      tempFiles.push(tmp)
      continue
    }
    throw new Error(`render: missing image for ${m.sceneId} (${m.filename})`)
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
  return { images, sfx, audio, narrationDurationMs, tempFiles }
  } catch (err) {
    // 부분 decode 후 이후 입력에서 throw 하면 tempFiles 가 호출자(ipc)에게 반환되지 않아
    // 고아가 된다 — 여기서 트랜잭션 정리 후 rethrow.
    for (const f of tempFiles) {
      try { await unlink(f) }
      catch (e) { if (e?.code !== 'ENOENT') console.warn(`[render] decode temp cleanup failed: ${f} (${e?.code || e?.message})`) }
    }
    throw err
  }
}
