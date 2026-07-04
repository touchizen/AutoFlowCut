/**
 * CapCut Cloud Exporter — Electron Desktop Edition
 *
 * Cloud Functions로 JSON 생성 후 Electron IPC로 디스크에 직접 쓰기.
 * 데스크톱 모드: 미디어는 복사하지 않고 pathMap 으로 절대경로만 치환 (media 폴더 없음).
 */

import { prepareCloudRequest } from './prepareCloudRequest';
import { callExportFunction } from './callExportFunction';

/**
 * sidecar SRT 로 legacy audioPackage.srtContent(narration-aligned)를 쓸지 여부.
 * story 프로젝트(storyAudio)면 옛 import MP3 의 SRT 가 자막으로 새지 않도록 무시하고
 * project.srtTrack(실측 pushScenes) 기반으로 생성한다. (M2a-4 Codex finding 2)
 */
export function shouldUsePackageSrt(options = {}) {
  const { audioPackage, storyAudio } = options;
  return !storyAudio && !!audioPackage?.srtContent;
}

/**
 * Cloud Functions를 호출하여 CapCut JSON 생성
 */
// GCF 응답 검증 — draftInfo/draftMetaInfo 는 아래에서 그대로 디스크에 쓰인다.
// nullish 뿐 아니라 빈 문자열·primitive·파싱 불가 JSON 문자열도 막아야 "undefined"/깨진
// draft 파일이 조용히 생성되는 걸 방지한다. (객체이거나, 파싱 가능한 비어있지 않은 JSON 문자열)
function isValidDraft(value) {
  let obj = value;
  if (typeof value === 'string') {
    if (value.length === 0) return false;
    try { obj = JSON.parse(value); } catch { return false; }
  }
  // draft_info / draft_meta_info 는 객체 — null·배열·primitive('5','true','null','[]') 거부.
  return obj != null && typeof obj === 'object' && !Array.isArray(obj);
}

function validateCapcutResponse(data) {
  if (!data || !isValidDraft(data.draftInfo) || !isValidDraft(data.draftMetaInfo)) {
    throw new Error('generateCapcutJson returned invalid draftInfo/draftMetaInfo');
  }
}

async function callGenerateCapcutJson(requestData) {
  const data = await callExportFunction('generateCapcutJson', requestData, {
    logLabel: 'CapCut Cloud',
    validate: validateCapcutResponse,
  });

  console.log('[CapCut Cloud] Received response:', {
    totalDuration: data.totalDuration,
    sceneCount: data.sceneCount
  });

  return data;
}

/**
 * CapCut 프로젝트를 디스크에 직접 쓰기 (Cloud Functions + Electron IPC)
 *
 * @param {Object} project - 프로젝트 데이터
 * @param {Object} options - 옵션
 * @returns {Promise<{ success: boolean, targetPath: string }>}
 */
export async function exportCapcutPackageCloud(project, options = {}) {
  const { capcutProjectNumber } = options;
  const name = project.name || 'untitled';

  if (!capcutProjectNumber) {
    throw new Error('CapCut project folder path is required.');
  }

  const targetPath = capcutProjectNumber;

  console.log('[CapCut Cloud] Target path:', targetPath);

  // 1. Cloud Functions용 요청 데이터 준비
  const { cloudRequest, pathMap } = await prepareCloudRequest(project, options);

  // 2. Cloud Functions 호출하여 JSON 생성
  let { draftInfo, draftMetaInfo } = await callGenerateCapcutJson(cloudRequest);

  // 3. 데스크톱 모드: 미디어 복사 없이 절대경로 치환
  //    GCF가 생성한 JSON 내 "mediaPathBase/filename" → 실제 절대경로로 교체
  const mediaBase = cloudRequest.mediaPathBase;
  let draftInfoStr = typeof draftInfo === 'string' ? draftInfo : JSON.stringify(draftInfo);
  let draftMetaStr = typeof draftMetaInfo === 'string' ? draftMetaInfo : JSON.stringify(draftMetaInfo);

  // macOS: CapCut은 캐시에 없는 파일을 로드할 때 볼륨 경로 필요 (e.g., /Volumes/Macintosh HD)
  const volumeResult = await window.electronAPI.getVolumePath();
  const volumePrefix = volumeResult?.volumePath || '';
  const toVolumePath = (p) => {
    if (!volumePrefix || p.startsWith('/Volumes/')) return p;
    return `${volumePrefix}${p}`;
  };

  for (const [filename, absolutePath] of Object.entries(pathMap)) {
    const relativePath = `${mediaBase}/${filename}`;
    const fullPath = toVolumePath(absolutePath);
    // JSON 문자열 내부이므로 백슬래시를 이스케이프해야 함 (Windows 경로)
    const jsonSafePath = fullPath.replace(/\\/g, '\\\\');
    draftInfoStr = draftInfoStr.split(relativePath).join(jsonSafePath);
    draftMetaStr = draftMetaStr.split(relativePath).join(jsonSafePath);
  }
  console.log(`[CapCut Cloud] Replaced ${Object.keys(pathMap).length} media paths with absolute paths`);

  // 4. SRT 자막 파일 → 작업폴더에 저장 후 절대경로로 JSON 치환
  const { subtitleOption = 'both', audioPackage } = options;
  const { generateSRT } = await import('./capcut.js');
  const srtFiles = [];

  // Review fix C5/C20: audioPackage.srtContent 가 있으면 narration-aligned 정밀
  // timing 우선 (옛 동작 복원). Phase 7 마이그레이션이 srtTrack 을 항상 채우는
  // 바람에 Phase 12 의 "비어있을 때만 fallback" 정책이 사실상 안 fire 했고,
  // scene 시간 기반 srtTrack 이 narration SRT 를 덮어쓰는 회귀가 있었음.
  if (subtitleOption === 'ko' || subtitleOption === 'both') {
    let srtKo;
    if (shouldUsePackageSrt(options)) {
      srtKo = audioPackage.srtContent;
      console.log('[CapCut Cloud] Using narration SRT from audio package (priority)');
    } else {
      srtKo = generateSRT(project, 'ko');
      if (srtKo) console.log('[CapCut Cloud] Generated SRT from project.srtTrack');
    }
    if (srtKo) {
      srtFiles.push({ filename: `${name}_subtitle_ko.srt`, content: srtKo });
    }
  }
  if (subtitleOption === 'en' || subtitleOption === 'both') {
    const srtEn = generateSRT(project, 'en');
    if (srtEn) {
      srtFiles.push({ filename: `${name}_subtitle_en.srt`, content: srtEn });
      console.log('[CapCut Cloud] Collected SRT file: en');
    }
  }

  // SRT를 프로젝트 폴더에 저장하고 절대경로를 pathMap에 추가
  if (srtFiles.length > 0) {
    // SRT sidecar 쓰기 실패를 조용히 넘기면 draft 에 media/<name>_subtitle.srt 토큰이
    // 안 풀린 채 "성공" 보고된다 → fail-fast.
    const workFolder = localStorage.getItem('workFolderPath');
    if (!workFolder) {
      throw new Error('Subtitle export requires a work folder, but workFolderPath is not set.');
    }
    const projectFolder = `${workFolder}/${name}`;
    for (const srt of srtFiles) {
      const srtAbsPath = await window.electronAPI.writeSrtToWorkFolder({
        workFolder: projectFolder, filename: srt.filename, content: srt.content
      });
      if (!srtAbsPath?.success) {
        throw new Error(`Failed to write subtitle file ${srt.filename}: ${srtAbsPath?.error || 'unknown error'}`);
      }
      // JSON 내 SRT 상대경로도 절대경로로 치환 (백슬래시 이스케이프)
      const srtRelative = `${mediaBase}/${srt.filename}`;
      const srtFullPath = toVolumePath(srtAbsPath.filePath);
      const srtJsonSafePath = srtFullPath.replace(/\\/g, '\\\\');
      draftInfoStr = draftInfoStr.split(srtRelative).join(srtJsonSafePath);
      draftMetaStr = draftMetaStr.split(srtRelative).join(srtJsonSafePath);
      // draft_meta_info의 file_Path도 치환
      draftMetaStr = draftMetaStr.split(`./media/${srt.filename}`).join(srtJsonSafePath);
      console.log(`[CapCut Cloud] SRT saved: ${srtAbsPath.filePath}`);
    }
  }

  // 5. Electron IPC를 통해 JSON만 디스크에 쓰기 (media 폴더 없음)
  console.log('[CapCut Cloud] Writing JSON-only project to disk via IPC...');
  const result = await window.electronAPI.writeCapcutProject({
    targetPath,
    draftInfo: draftInfoStr,
    draftMetaInfo: draftMetaStr
  });

  console.log('[CapCut Cloud] Project written successfully to:', targetPath);

  return result;
}

export default {
  exportCapcutPackageCloud
};
