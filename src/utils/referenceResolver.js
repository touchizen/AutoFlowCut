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
 * @param {boolean} [opts.strictMime=false] - true면 data URL/header/signature로 MIME을 확정할 수 없을 때 null 반환
 * @returns {Promise<Array<{mimeType:string|null, data:string}>>}
 */
import { fileSystemAPI } from '../hooks/useFileSystem'
import { cleanBase64, detectImageType } from './urls'

const EXT_TO_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

function normalizeMimeType(mimeType) {
  return typeof mimeType === 'string' && mimeType.trim()
    ? mimeType.trim().toLowerCase()
    : null
}

function detectKnownImageMime(raw) {
  const dataUrlMime = typeof raw === 'string'
    ? raw.match(/^data:([^;]+);base64,/)?.[1]
    : null
  if (dataUrlMime) return normalizeMimeType(dataUrlMime)

  const clean = cleanBase64(raw)
  if (clean.startsWith('/9j/')) return 'image/jpeg'
  if (clean.startsWith('iVBOR')) return 'image/png'
  if (clean.startsWith('R0lGO')) return 'image/gif'
  if (clean.startsWith('UklGR')) return 'image/webp'
  return null
}

function resolveMimeType(raw, ref, strictMime) {
  const explicit = normalizeMimeType(ref?.mimeType)
  if (explicit) return explicit
  const detected = detectKnownImageMime(raw)
  if (detected) return detected
  if (strictMime) return null
  const ext = detectImageType(raw)
  return EXT_TO_MIME[ext] || 'image/png'
}

export async function resolveReferenceImages(refs, { projectName, fs = fileSystemAPI, strictMime = false } = {}) {
  if (!Array.isArray(refs) || refs.length === 0) return []

  const resolved = []
  for (const ref of refs) {
    if (!ref) continue

    let raw = null
    // 1) 메모리에 base64 가 있으면 우선 사용
    if (typeof ref.data === 'string' && ref.data) {
      raw = ref.data
    } else if (ref.filePath && fs?.readFileByPath) {
      // 2) 정확한 파일 경로가 있으면 우선 사용
      try {
        const res = await fs.readFileByPath(ref.filePath)
        if (res?.success && res.data) raw = res.data
      } catch (e) {
        console.warn(`[referenceResolver] reference '${ref.name || ref.filePath}' filePath read failed: ${e?.message || e}`)
      }
    }

    if (!raw && ref.name && projectName && fs?.readReference) {
      // 3) 프로젝트 references/{name} 에서 읽기
      try {
        const res = await fs.readReference(projectName, ref.name)
        if (res?.success && res.data) raw = res.data
      } catch (e) {
        // 해석 실패해도 생성은 계속하되, 조용히 묻지 말고 경고 — 캐릭터 일관성이
        // 말없이 저하되는 것을 막는다 (어떤 레퍼런스가 빠졌는지 로그로 확인 가능).
        console.warn(`[referenceResolver] reference '${ref.name}' read failed: ${e?.message || e}`)
      }
    }

    if (!raw) {
      console.warn(`[referenceResolver] reference '${ref.name || '?'}' could not be resolved — skipping (character consistency may degrade)`)
      continue
    }
    const data = cleanBase64(raw)
    if (!data) {
      console.warn(`[referenceResolver] reference '${ref.name || '?'}' produced empty base64 — skipping`)
      continue
    }
    resolved.push({ mimeType: resolveMimeType(raw, ref, strictMime), data })
  }

  return resolved
}
