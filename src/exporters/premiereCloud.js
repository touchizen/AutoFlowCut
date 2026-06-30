/**
 * Premiere Cloud Exporter — Electron Desktop Edition
 *
 * Cloud Functions(generatePremiereJson)를 통해 Premiere XML 생성하고
 * Electron IPC로 .prproj(gzip XML)을 디스크에 직접 쓰기.
 *
 * CapCut 익스포터(capcutCloud.js)를 미러링한다:
 * - cloudRequest 준비는 prepareCloudRequest를 그대로 재사용 (scenes/videoOverlays/
 *   sfxItems/audioTracks/srtEntries/format/scaleMode/kenBurns/subtitleOption/mediaPathBase
 *   동일). appId만 추가로 전송.
 * - GCF는 RAW Premiere XML 문자열을 반환한다 (gzip 아님). 미디어 경로는 escape-free
 *   토큰 __AFC_MEDIA_<n>__ 로 박혀 있고, mediaRefs[{ token, filename }]가 토큰→원본
 *   미디어 파일명 매핑을 제공한다.
 * - 클라이언트는 각 토큰을 XML-escape된 절대 미디어 경로로 치환한 뒤, 결과 XML을
 *   gzip하여 <name>.prproj로 쓴다 (.prproj == gzipped XML).
 */

import { prepareCloudRequest } from './prepareCloudRequest';
import { callExportFunction } from './callExportFunction';

/**
 * XML 텍스트 노드용 이스케이프 (& < > → 엔티티).
 * 절대 미디어 경로가 XML 텍스트로 들어가므로 반드시 escape.
 */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Cloud Functions를 호출하여 Premiere XML 생성
 */
// GCF 응답 검증 — premiereXml 이 없으면 아래 토큰 치환이 undefined 에서 터지거나 빈
// .prproj 가 쓰인다. mediaRefs 는 없으면 [] 로 허용하되, 있으면 배열이어야 한다.
function validatePremiereResponse(data) {
  if (!data || typeof data.premiereXml !== 'string') {
    throw new Error('generatePremiereJson returned invalid premiereXml');
  }
  if (data.mediaRefs != null && !Array.isArray(data.mediaRefs)) {
    throw new Error('generatePremiereJson returned invalid mediaRefs');
  }
}

async function callGeneratePremiereJson(requestData) {
  const data = await callExportFunction('generatePremiereJson', requestData, {
    logLabel: 'Premiere Cloud',
    validate: validatePremiereResponse,
  });

  console.log('[Premiere Cloud] Received response:', {
    totalDuration: data.totalDuration,
    sceneCount: data.sceneCount,
    mediaRefs: Array.isArray(data.mediaRefs) ? data.mediaRefs.length : 0
  });

  return data;
}

/**
 * Premiere 프로젝트(.prproj)를 디스크에 직접 쓰기 (Cloud Functions + Electron IPC)
 *
 * @param {Object} project - 프로젝트 데이터
 * @param {Object} options - 옵션 (capcutProjectNumber = 출력 폴더 경로)
 * @returns {Promise<{ success: boolean, targetPath: string }>}
 */
export async function exportPremierePackageCloud(project, options = {}) {
  const { capcutProjectNumber } = options;
  const name = project.name || 'untitled';

  if (!capcutProjectNumber) {
    throw new Error('Premiere project folder path is required.');
  }

  // .prproj 는 폴더가 아니라 단일 파일 — 선택된 폴더 안에 <name>.prproj 로 쓴다.
  const targetFolder = capcutProjectNumber;
  const targetPath = `${targetFolder}/${name}.prproj`;

  console.log('[Premiere Cloud] Target path:', targetPath);

  // 1. Cloud Functions용 요청 데이터 준비 (CapCut과 동일한 cloudRequest 재사용)
  const { cloudRequest, pathMap } = await prepareCloudRequest(project, options);

  // 2. Cloud Functions 호출하여 Premiere XML 생성
  const response = await callGeneratePremiereJson(cloudRequest);
  let premiereXml = response.premiereXml;
  const mediaRefs = response.mediaRefs || [];

  if (typeof premiereXml !== 'string' || !premiereXml) {
    throw new Error('generatePremiereJson returned empty premiereXml');
  }

  // 3. macOS: 캐시에 없는 파일 로드 시 볼륨 경로 필요 (e.g., /Volumes/Macintosh HD)
  const volumeResult = await window.electronAPI.getVolumePath();
  const volumePrefix = volumeResult?.volumePath || '';
  const toVolumePath = (p) => {
    if (!volumePrefix || p.startsWith('/Volumes/')) return p;
    return `${volumePrefix}${p}`;
  };

  // 4. 토큰 → XML-escape된 절대 미디어 경로 치환
  //    pathMap 의 key 는 bare filename (예: image_scene_1.png). mediaRefs[].filename 은
  //    'media/<filename>' 또는 bare filename 일 수 있으므로 media/ prefix 를 벗겨 lookup.
  let substituted = 0;
  let missing = 0;
  for (const ref of mediaRefs) {
    if (!ref || !ref.token) continue;
    const bareFilename = ref.filename ? ref.filename.replace(/^media\//, '') : '';
    const absolutePath = pathMap[bareFilename];
    if (!absolutePath) {
      console.warn(`[Premiere Cloud] No path for mediaRef filename="${ref.filename}" token="${ref.token}"`);
      missing++;
      continue;
    }
    const fullPath = toVolumePath(absolutePath);
    const escapedAbsPath = escapeXml(fullPath);
    premiereXml = premiereXml.split(ref.token).join(escapedAbsPath);
    substituted++;
  }
  console.log(`[Premiere Cloud] Substituted ${substituted} media tokens (${missing} missing)`);

  // 토큰 누출 방지 — 모든 __AFC_MEDIA_*__ 가 치환됐는지 검증.
  if (/__AFC_MEDIA_\d+__/.test(premiereXml)) {
    const leftover = (premiereXml.match(/__AFC_MEDIA_\d+__/g) || []).slice(0, 5);
    throw new Error(`Unsubstituted media tokens remain in Premiere XML: ${leftover.join(', ')}`);
  }

  // 5. Electron IPC를 통해 gzip XML 을 .prproj 로 디스크에 쓰기
  console.log('[Premiere Cloud] Writing .prproj (gzipped XML) to disk via IPC...');
  const result = await window.electronAPI.writePremiereProject({
    targetPath,
    premiereXml
  });

  if (!result?.success) {
    throw new Error(result?.error || 'Failed to write Premiere project');
  }

  console.log('[Premiere Cloud] Project written successfully to:', result.targetPath || targetPath);

  return result;
}

export default {
  exportPremierePackageCloud
};
