// 생성 이미지 저장. src 는 인증형 https(estuary)라 뷰 세션(persist:chatgpt) 쿠키가 필요하다
// → Node fetch 가 아니라 session.fetch (전례: electron/ipc/shared.js sessionFetch).
import path from 'node:path'
import { spikeDir } from './spike-chatgpt-storage.js'

export function extFromContentType(contentType, src = '') {
  const t = String(contentType || '').toLowerCase().split(';')[0].trim()
  if (t === 'image/png') return 'png'
  if (t === 'image/jpeg' || t === 'image/jpg') return 'jpg'
  if (t === 'image/webp') return 'webp'
  if (t === 'image/gif') return 'gif'
  if (t === 'image/avif') return 'avif'
  const m = String(src || '').match(/\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i)
  if (m) {
    const e = m[1].toLowerCase()
    return e === 'jpeg' ? 'jpg' : e
  }
  return 'png'
}

export async function saveImage(app, view, src, fs, deps = {}) {
  const { now = () => Date.now() } = deps
  const res = await view.webContents.session.fetch(src, { credentials: 'include' })
  if (!res || res.ok !== true) throw new Error(`[spike] image fetch failed: ${res ? res.status : 'no-response'}`)
  const contentType = res.headers?.get?.('content-type')
  if (!String(contentType || '').toLowerCase().trim().startsWith('image/')) {
    throw new Error(`[spike] image fetch returned non-image content-type: ${contentType || 'missing'}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = extFromContentType(contentType, src)
  const dir = spikeDir(app)
  fs.mkdirSync(dir, { recursive: true })   // 신규 디렉토리 — 없으면 ENOENT
  const p = path.join(dir, `generated-${now()}.${ext}`)
  fs.writeFileSync(p, buf)
  return p
}
