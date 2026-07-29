/**
 * CapCut Desktop JSON Exporter
 *
 * Cloud Functions를 통해 JSON 생성
 * 로컬에서는 SRT 생성 및 미디어 패키징만 담당
 */

// Cloud Functions 버전 import
import { exportCapcutPackageCloud } from './capcutCloud';

/**
 * CapCut 프로젝트 ZIP 생성
 *
 * @param {Object} project - 프로젝트 데이터
 * @param {Object} options - 옵션
 * @returns {Promise<Blob>} ZIP Blob
 */
export async function exportCapcut(project, options = {}) {
  console.log('[CapCut] Using Cloud Functions for JSON generation');
  return exportCapcutPackageCloud(project, options);
}

/**
 * SRT 자막 파일 생성
 * @param {Object} project - 프로젝트 데이터
 * @param {string} lang - 'ko' | 'en'
 * @returns {string} SRT 포맷 문자열
 */
export function generateSRT(project, lang = 'ko') {
  const scenes = project.scenes || [];

  // Phase 5 + C1 review fix: srtTrack 은 단일 언어 (보통 ko narration). lang='ko'
  // 만 srtTrack 사용. lang='en' 요청은 scene.subtitle_en 폴백 (옛 동작) — 그렇지
  // 않으면 EN 자막 파일에 KO 텍스트가 들어감.
  // C2 review fix: 빈 텍스트 라인은 idx 도 안 증가 → 출력 SRT 가 1..N 순차 유지.
  if (lang === 'ko' && Array.isArray(project.srtTrack) && project.srtTrack.length > 0) {
    let srt = '';
    let idx = 1;
    for (const line of project.srtTrack) {
      const text = (line.text || '').trim();
      if (!text) continue;
      const startMs = Math.round((Number(line.startTime) || 0) * 1000);
      const endMs = Math.round((Number(line.endTime) || 0) * 1000);
      srt += `${idx}\n`;
      srt += `${formatSRTTime(startMs)} --> ${formatSRTTime(endMs)}\n`;
      srt += `${text}\n\n`;
      idx++;
    }
    return srt.trim();
  }

  let srtContent = '';
  let index = 1;
  let currentTimeMs = 0;

  // 배열 순서 그대로 사용 — stable-ID 모델에서는 scene.id 가 위치를 반영하지 않는다.
  // 사용자가 moveScene 으로 [scene_2, scene_3, scene_1] 순서로 바꿔도 SRT 가 ID 정렬
  // 하면 자막 타이밍이 시각 순서와 어긋남 (CapCut export 는 array 순서 사용 → 불일치).
  // scenes 배열 순서 = 타임라인 순서.
  //
  // 누적은 항상 image_duration(=슬롯)이다. 예전에는 영상이 있는 씬만
  // `video.duration || 5` 로 대체했는데, 슬롯이 타임라인의 유일한 기준이라
  // 영상 씬을 지날 때마다 자막이 이미지와 어긋났다. 두 분기(자막 없는 씬 skip /
  // 주 분기)가 각각 전진하므로 둘 다 슬롯을 쓴다.
  for (const scene of scenes) {
    const subtitle = lang === 'ko' ? scene.subtitle_ko : scene.subtitle_en;
    const durationMs = (scene.image_duration || 3) * 1000;

    // 자막이 없으면 스킵 — duration 만 더하고 넘어감
    if (!subtitle || !subtitle.trim()) {
      currentTimeMs += durationMs;
      continue;
    }

    const startTime = formatSRTTime(currentTimeMs);
    const endTime = formatSRTTime(currentTimeMs + durationMs);

    srtContent += `${index}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${subtitle.trim()}\n\n`;

    index++;
    currentTimeMs += durationMs;
  }

  return srtContent.trim();
}

/**
 * SRT 시간 포맷 변환 (ms -> 00:00:00,000)
 */
function formatSRTTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/**
 * 자막 파일 다운로드 (Electron: 네이티브 저장 다이얼로그)
 */
export async function downloadSRT(project, lang = 'ko') {
  const srtContent = generateSRT(project, lang);
  const filename = `${project.name || 'project'}_subtitle_${lang}.srt`;

  if (window.electronAPI?.saveSrtFile) {
    await window.electronAPI.saveSrtFile({ filename, content: srtContent });
  } else {
    // Fallback: browser download
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return filename;
}

export default {
  exportCapcut,
  generateSRT,
  downloadSRT
};
