/**
 * mediaMeta — 미디어 리소스의 seed/생성시각을 history metadata JSON 에서 backfill.
 *
 * 신규 생성은 imageFinalize / useVideoAutomation 가 직접 state 에 박아주지만,
 * 구버전 데이터는 그 필드가 비어있다. 상세 모달이 열릴 때 가장 최근 history
 * 메타데이터 JSON 을 한 번 읽어 보강한다.
 *
 * 형식 (filesystem.js fs:save-resource 가 쓰는 메타):
 *   { prompt, mediaId, model, timestamp, seed?, ... }
 */

import { fileSystemAPI } from '../hooks/useFileSystem'

/**
 * 가장 최근 history metadata JSON 한 건을 읽어 { seed, generatedAt, model } 반환.
 * 실패하거나 데이터 없으면 빈 객체.
 *
 * @param {string} projectName
 * @param {string} resourceType - 'scenes' | 'references' | 'videos'
 * @param {string} baseName     - history 검색 기준 (sceneId / videoSaveId 등)
 */
export async function fetchLatestHistoryMeta(projectName, resourceType, baseName) {
  if (!projectName || !resourceType || !baseName) return {}
  try {
    const histResult = await fileSystemAPI.getHistory(projectName, resourceType, baseName)
    if (!histResult?.success || !histResult.histories?.length) return {}

    // metadata-only API 사용 — readHistoryFile 은 비디오 본문(수십 MB)까지 base64 로 읽음.
    // backfill 은 seed/timestamp/model 만 필요하므로 .json 사이드카만 읽어 부담 회피.
    for (const hist of histResult.histories) {
      const metaResult = await fileSystemAPI.readHistoryMetadata(projectName, resourceType, hist.filename)
      const meta = metaResult?.metadata
      if (meta && (meta.seed != null || meta.timestamp != null || meta.model != null)) {
        return {
          seed: meta.seed ?? null,
          generatedAt: typeof meta.timestamp === 'number' ? meta.timestamp : null,
          model: meta.model ?? null
        }
      }
    }
    return {}
  } catch (e) {
    console.warn('[mediaMeta] backfill failed:', e?.message || e)
    return {}
  }
}

/**
 * base64 비디오의 대략 파일 크기를 사람이 읽는 형식으로 변환.
 * (VideoDetailModal 의 인라인 로직을 함수로 추출 — MediaMetaBar 에 재사용)
 */
export function estimateBase64FileSize(base64) {
  if (!base64 || typeof base64 !== 'string') return null
  const clean = base64.replace(/^data:[^;]+;base64,/, '')
  const bytes = Math.round(clean.length * 0.75)
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * 모델 식별자에서 사람이 읽기 좋은 { name, version } 추출.
 *
 * 'flow'                           → { name: 'flow', version: null }
 * 'veo_3_1_t2v_fast_ultra_relaxed' → { name: 'veo / t2v fast ultra relaxed', version: '3.1' }
 * 'kling-v1.6-pro'                 → { name: 'kling pro', version: '1.6' }
 * 'unknown-model-name'             → { name: 'unknown model name', version: null }
 *
 * 패턴 매칭 실패 시 원본 그대로 name 으로 사용 — 항상 비-null 반환 (input falsy 제외).
 */
export function parseModelLabel(model) {
  if (!model || typeof model !== 'string') return null
  const raw = model.trim()
  if (!raw) return null

  // veo_3_1_t2v_*
  const veoMatch = raw.match(/^veo[-_]?(\d+)[-_]?(\d+)?[-_]?(.*)$/i)
  if (veoMatch) {
    const major = veoMatch[1]
    const minor = veoMatch[2]
    const rest = (veoMatch[3] || '').replace(/[-_]+/g, ' ').trim()
    return {
      name: rest ? `veo / ${rest}` : 'veo',
      version: minor ? `${major}.${minor}` : major
    }
  }
  // kling-v1.6-pro
  const klingMatch = raw.match(/^kling[-_]v?(\d+(?:\.\d+)*)[-_]?(.*)$/i)
  if (klingMatch) {
    const version = klingMatch[1]
    const rest = (klingMatch[2] || '').replace(/[-_]+/g, ' ').trim()
    return { name: rest ? `kling ${rest}` : 'kling', version }
  }
  // generic: name-v1.0 / name_1_0
  const generic = raw.match(/^(.+?)[-_]v?(\d+(?:[._]\d+)*)$/i)
  if (generic) {
    return {
      name: generic[1].replace(/[-_]+/g, ' '),
      version: generic[2].replace(/_/g, '.')
    }
  }
  return { name: raw, version: null }
}
