/**
 * Vrew Project Exporter
 *
 * Cloud Functions(generateVrewJson)를 통해 projectJson 생성(과금: quota/vrewExportCount).
 * 로컬에서는 mediaRefs 로 미디어 수집 + .vrew ZIP 패킹만 담당.
 * CapCut(capcut.js)/Premiere(premiere.js) 와 동일 패턴 — 생성 로직은 서버 전용(클라 노출 방지).
 */

import { exportVrewPackageCloud } from './vrewCloud'

export async function exportVrew(project, options = {}) {
  console.log('[Vrew] Using Cloud Functions (generateVrewJson) + local .vrew packer')
  return exportVrewPackageCloud(project, options)
}

export default {
  exportVrew,
}
