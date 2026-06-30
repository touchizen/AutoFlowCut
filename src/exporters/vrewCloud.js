/**
 * Vrew Cloud Exporter — Electron Desktop Edition
 *
 * Cloud Functions(generateVrewJson)로 Vrew projectJson + mediaRefs 를 생성하고(과금: quota/
 * vrewExportCount), 미디어 바이트는 로컬에서 패킹해 .vrew ZIP 으로 쓴다.
 * - 서버 전송: 메타데이터만 (미디어 바이트 X)
 * - 로컬 처리: mediaRefs 로 실제 미디어 수집 후 IPC(writeVrewProject)로 디스크 기록
 * CapCut(capcutCloud) / Premiere(premiereCloud) 와 동일 패턴. 생성 로직은 서버 전용(클라 노출 방지).
 */

import { callExportFunction } from './callExportFunction'
import { packAndWriteVrew } from './vrewPacker'

/**
 * GCF 응답 검증 — generator 가 out-of-process(GCF)로 빠졌으므로 신뢰 경계.
 * 패킹 전에 형태가 깨졌으면 모호한 TypeError 대신 명확한 에러로 실패시킨다.
 */
function validateVrewResponse(data) {
  if (!data || typeof data.projectJson !== 'object' || data.projectJson === null) {
    throw new Error('generateVrewJson returned invalid projectJson')
  }
  if (!Array.isArray(data.mediaRefs)) {
    throw new Error('generateVrewJson returned invalid mediaRefs')
  }
  for (const ref of data.mediaRefs) {
    if (!ref || !ref.mediaId || !ref.archivePath || !ref.filename) {
      throw new Error('generateVrewJson returned a media ref missing mediaId/archivePath/filename')
    }
    if (!ref.role) {
      throw new Error('generateVrewJson returned a media ref missing role')
    }
    // scene/overlay 는 동일 파일명 중복 시 sceneId 로 로컬 미디어를 구분(findPreparedMediaForRef).
    // sceneId 가 없으면 packer 가 조용히 matches[0] 로 잘못 바인딩할 수 있어 미리 막는다.
    if ((ref.role === 'scene' || ref.role === 'overlay') && !ref.sceneId) {
      throw new Error('generateVrewJson returned a scene/overlay media ref missing sceneId (cannot disambiguate duplicate filenames)')
    }
  }
}

/**
 * GCF generateVrewJson 호출 — { projectJson, mediaRefs, warnings, ... } 반환.
 */
async function callGenerateVrewJson(requestData) {
  return callExportFunction('generateVrewJson', requestData, {
    logLabel: 'Vrew Cloud',
    validate: validateVrewResponse,
  })
}

/**
 * Vrew 프로젝트(.vrew) 생성 — GCF 로 JSON 생성 후 로컬 미디어 패킹.
 */
export async function exportVrewPackageCloud(project, options = {}) {
  return packAndWriteVrew(project, options, (cloudRequest) => callGenerateVrewJson(cloudRequest))
}

export default {
  exportVrewPackageCloud,
}
