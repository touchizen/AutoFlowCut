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
  const videos = project.videos || [];

  // Phase 5: project.srtTrack 가 있으면 직접 출력 (원본 자막 타이밍 보존).
  // srtTrack 라인은 단일 언어 (text 필드만) — lang 인자 무시.
  if (Array.isArray(project.srtTrack) && project.srtTrack.length > 0) {
    let srt = '';
    let idx = 1;
    for (const line of project.srtTrack) {
      const text = (line.text || '').trim();
      if (!text) { idx++; continue; }
      const startMs = Math.round((Number(line.startTime) || 0) * 1000);
      const endMs = Math.round((Number(line.endTime) || 0) * 1000);
      srt += `${idx}\n`;
      srt += `${formatSRTTime(startMs)} --> ${formatSRTTime(endMs)}\n`;
      srt += `${text}\n\n`;
      idx++;
    }
    return srt.trim();
  }

  // 비디오가 커버하는 씬 매핑.
  // scene_id (= framePair.ownerSceneId — owner-binding canonical) 우선,
  // 없으면 legacy from_scene (= startSceneId, mutable) 폴백.
  // 사용자가 start 이미지 dropdown 만 바꿔도 비디오는 owner 씬에 묶여야 자막
  // 타이밍이 정확한 씬에 attach 됨.
  const videoMap = {};
  videos.forEach(video => {
    if (!video.video_path) return;
    const sceneKey = video.scene_id ?? video.from_scene;
    if (sceneKey) videoMap[sceneKey] = video;
  });

  let srtContent = '';
  let index = 1;
  let currentTimeMs = 0;

  // 배열 순서 그대로 사용 — stable-ID 모델에서는 scene.id 가 위치를 반영하지 않는다.
  // 사용자가 moveScene 으로 [scene_2, scene_3, scene_1] 순서로 바꿔도 SRT 가 ID 정렬
  // 하면 자막 타이밍이 시각 순서와 어긋남 (CapCut export 는 array 순서 사용 → 불일치).
  // scenes 배열 순서 = 타임라인 순서.
  for (const scene of scenes) {
    const subtitle = lang === 'ko' ? scene.subtitle_ko : scene.subtitle_en;

    // 자막이 없으면 스킵
    if (!subtitle || !subtitle.trim()) {
      // duration만 더하고 넘어감
      const video = videoMap[scene.id];
      const durationMs = video
        ? (video.duration || 5) * 1000
        : (scene.image_duration || 3) * 1000;
      currentTimeMs += durationMs;
      continue;
    }

    const video = videoMap[scene.id];
    const durationMs = video
      ? (video.duration || 5) * 1000
      : (scene.image_duration || 3) * 1000;

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
