/**
 * referenceResolver — 레퍼런스 객체 배열을 Gemini inline base64 로 변환.
 *
 * Flow 시절 레퍼런스는 mediaId 로 주입됐지만, 공식 API 는 inline base64
 * ({ mimeType, data }) 를 받는다. 레퍼런스 base64 는 메모리(ref.data)에 있거나
 * 디스크({work}/{project}/references/{name})에 저장돼 있으므로 여기서 해석한다.
 *
 * fileSystemAPI 는 주입 가능 → 단위 테스트.
 *
 * @param {Array<object>} refs - 선택된 레퍼런스 객체 (name / data / category 등)
 * @param {object} opts
 * @param {string} opts.projectName
 * @param {object} [opts.fs] - fileSystemAPI (기본: 실제 싱글톤)
 * @returns {Promise<Array<{mimeType:string, data:string}>>}
 */
import { fileSystemAPI } from '../hooks/useFileSystem'
import { cleanBase64, detectImageType } from './urls'

const EXT_TO_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

export async function resolveReferenceImages(refs, { projectName, fs = fileSystemAPI } = {}) {
  if (!Array.isArray(refs) || refs.length === 0) return []

  const resolved = []
  for (const ref of refs) {
    if (!ref) continue

    let raw = null
    // 1) 메모리에 base64 가 있으면 우선 사용
    if (typeof ref.data === 'string' && ref.data) {
      raw = ref.data
    } else if (ref.name && projectName && fs?.readReference) {
      // 2) 디스크에서 읽기
      try {
        const res = await fs.readReference(projectName, ref.name)
        if (res?.success && res.data) raw = res.data
      } catch {
        /* 해석 실패한 레퍼런스는 조용히 건너뜀 — 생성은 계속 */
      }
    }

    if (!raw) continue
    const data = cleanBase64(raw)
    if (!data) continue
    const ext = detectImageType(raw)
    resolved.push({ mimeType: EXT_TO_MIME[ext] || 'image/png', data })
  }

  return resolved
}
