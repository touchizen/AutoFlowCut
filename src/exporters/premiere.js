/**
 * Premiere Pro Project Exporter
 *
 * Cloud Functions(generatePremiereJson)를 통해 Premiere XML 생성.
 * 로컬에서는 토큰→절대경로 치환 + gzip + .prproj 쓰기를 담당.
 *
 * Premiere 자막은 XML 안에 embed 되므로 SRT sidecar 는 생성하지 않는다
 * (CapCut 과 달리 별도 SRT 파일 불필요).
 */

import { exportPremierePackageCloud } from './premiereCloud';

/**
 * Premiere 프로젝트(.prproj) 생성
 *
 * @param {Object} project - 프로젝트 데이터
 * @param {Object} options - 옵션
 * @returns {Promise<{ success: boolean, targetPath: string }>}
 */
export async function exportPremiere(project, options = {}) {
  console.log('[Premiere] Using Cloud Functions for XML generation');
  return exportPremierePackageCloud(project, options);
}

export default {
  exportPremiere
};
