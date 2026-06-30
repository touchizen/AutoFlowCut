/**
 * Export Request Builder — 공통 입력 준비기
 *
 * 프로젝트(씬/이미지/영상/자막/오디오)를 Cloud Functions 용 cloudRequest 메타데이터와
 * 로컬 미디어 파일 목록(mediaFiles/sfxFiles/audioFiles/pathMap)으로 변환한다.
 * CapCut / Premiere / Vrew 익스포터가 공유한다 (생성 로직은 각 GCF, 패킹은 각 로컬).
 */

import { srtTrackToEntries } from '../utils/srtTrack';
import { rawMediaExtension, isRawBase64Media } from './mediaSignatures';

/**
 * base64 데이터에서 이미지 크기 추출
 */
function getImageSizeFromBase64(base64Data) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      resolve(null); // 실패 시 null 반환
    };
    if (!base64Data.startsWith('data:')) {
      base64Data = `data:image/png;base64,${base64Data}`;
    }
    img.src = base64Data;
  });
}

/**
 * 파일 경로인지 체크 (pathMap/getFilename 내부 사용 + 테스트에서 import → export)
 */
export function isFilePath(data) {
  if (!data) return false;
  if (data.startsWith('data:')) return false;
  if (data.startsWith('http')) return false;
  if (isRawBase64Media(data)) return false;  // 원시 base64 미디어는 경로 아님 (공통 검출기)
  return data.includes('/') || data.includes('\\');
}

/**
 * 파일명 생성
 */
function getFilename(path, sceneId, type) {
  if (!path) return `${type}_${sceneId}.bin`;

  if (path.startsWith('data:')) {
    const mimeMatch = path.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const extMap = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav'
    };
    const ext = extMap[mime] || 'bin';
    return `${type}_${sceneId}.${ext}`;
  }

  // 원시 base64 미디어(이미지/비디오/오디오) — data: prefix 없이 와도 전체 페이로드가
  // 파일명이 되지 않도록 공통 검출기로 안전한 이름 부여. (isFilePath 와 동일 시그니처 집합)
  const rawExt = rawMediaExtension(path);
  if (rawExt) {
    return `${type}_${sceneId}.${rawExt}`;
  }

  if (isFilePath(path)) {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || `${type}_${sceneId}.bin`;
  }

  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || `${type}_${sceneId}.bin`;
}

/**
 * 프로젝트 데이터를 Cloud Functions용 포맷으로 변환
 */
export async function prepareCloudRequest(project, options = {}) {
  const {
    scaleMode = 'fill',  // 'fill' | 'fit' | 'none'
    kenBurns = false,
    kenBurnsMode = 'random',
    kenBurnsCycle = 5,
    kenBurnsScaleMin = 1.0,  // 스케일 최소값 (1.0 = 100%)
    kenBurnsScaleMax = 1.3, // 스케일 최대값 (1.3 = 130%)
    subtitleOption = 'both',
    subtitleFontSize = 8,
    capcutProjectNumber = '',
    audioPackage = null
  } = options;

  const scenes = project.scenes || [];
  const format = project.format || 'landscape';

  // 씬 메타데이터 준비 — 이미지 트랙(기본) + 영상 트랙(선택) 분리
  const cloudScenes = [];
  const cloudVideoOverlays = []; // 영상 오버레이 (씬 뒤쪽 배치)
  const mediaFiles = []; // 로컬에서 처리할 미디어 파일 정보

  let cumulativeTime = 0; // 씬 시작 시간 누적 (ms)

  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    const sceneId = scene.id || `scene_${index + 1}`;
    let imageSize = scene.upscaled_size || scene.image_size;
    const sceneDuration = scene.image_duration || 3;

    // 이미지 (항상 존재)
    const imagePath = scene.image_path || scene.media_path;
    const fallback = scene.image_fallback;

    if (!imagePath && !fallback) { cumulativeTime += sceneDuration * 1000; continue; }

    const imageFilename = getFilename(imagePath, sceneId, 'image');

    // image_size가 없으면 실제 이미지 파일에서 크기 추출
    if (!imageSize && imagePath) {
      try {
        imageSize = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = imagePath.startsWith('/') ? `file://${imagePath}` : imagePath;
        });
        if (imageSize) {
          console.log(`[Export Media] Image size from file: ${imageSize.width}x${imageSize.height} (${sceneId})`);
        }
      } catch (e) { /* ignore */ }
    }
    // fallback: base64에서 추출
    if (!imageSize && fallback) {
      imageSize = await getImageSizeFromBase64(fallback);
      if (imageSize) {
        console.log(`[Export Media] Extracted size from base64: ${imageSize.width}x${imageSize.height}`);
      }
    }
    const imgWidth = imageSize?.width || 1024;
    const imgHeight = imageSize?.height || 1024;

    cloudScenes.push({
      id: sceneId,
      type: 'image',
      filename: imageFilename,
      width: imgWidth,
      height: imgHeight,
      duration: sceneDuration,
      subtitleKo: scene.subtitle_ko || null,
      subtitleEn: scene.subtitle_en || null
    });

    mediaFiles.push({
      sceneId,
      type: 'image',
      filename: imageFilename,
      path: imagePath,
      fallback
    });

    // 영상 오버레이 (하이브리드: 씬당 0~2개. i2v=trackIndex 1 앞(위 트랙) / t2v=0 뒤).
    // 영상이 짧으면 씬 뒤쪽 배치, 길면 처음부터 씬 길이만큼 자름. GCF 가 trackIndex 별로
    // 트랙을 분리(없으면 0 → 단일 트랙 하위호환).
    const sceneVideos = scene.videos || [];
    for (const v of sceneVideos) {
      const videoPath = v.path;
      const videoDuration = v.duration || 0;
      if (!videoPath || videoDuration <= 0) continue;

      // i2v·t2v 동시 export 시 파일명 충돌 방지 — data URL 분기는 sceneId 기반이므로 source 포함.
      const videoFilename = getFilename(videoPath, `${sceneId}_${v.source}`, 'video');
      const clipDuration = Math.min(videoDuration, sceneDuration); // 씬 길이 초과 시 자름
      const videoStartMs = videoDuration < sceneDuration
        ? cumulativeTime + (sceneDuration - videoDuration) * 1000  // 짧으면 뒤쪽
        : cumulativeTime;  // 길면 처음부터

      cloudVideoOverlays.push({
        sceneId,
        filename: videoFilename,
        width: imgWidth,
        height: imgHeight,
        durationMs: clipDuration * 1000,
        startMs: videoStartMs,
        trackIndex: v.source === 'i2v' ? 1 : 0,  // i2v 앞(위) / t2v 뒤(아래)
      });

      mediaFiles.push({
        sceneId,
        type: 'video',
        filename: videoFilename,
        path: videoPath,
        fallback: null,
      });
    }

    cumulativeTime += sceneDuration * 1000;
  }

  // SFX 메타데이터 준비
  const cloudSfxItems = [];
  const sfxFiles = [];

  scenes.forEach((scene, index) => {
    const sceneId = scene.id || `scene_${index + 1}`;
    if (scene.sfx_path) {
      const filename = getFilename(scene.sfx_path, sceneId, 'sfx');
      cloudSfxItems.push({
        sceneId,
        filename,
        duration: scene.sfx_duration || 3
      });
      sfxFiles.push({
        sceneId,
        filename,
        path: scene.sfx_path
      });
    }
  });

  // mediaPathBase — 항상 'media'로 고정 (데스크톱 모드: 클라이언트에서 절대경로로 치환)
  const mediaPathBase = 'media';

  // OS 감지 (Windows vs macOS)
  const detectedOS = (() => {
    try {
      if (navigator.userAgentData?.platform) return navigator.userAgentData.platform;
      if (/Win/.test(navigator.userAgent)) return 'Windows';
      return 'macOS';
    } catch { return 'macOS'; }
  })();

  // 오디오 패키지 메타데이터 준비
  const cloudAudioTracks = [];
  const audioFiles = [];

  if (audioPackage) {
    // 원본 오디오 (나레이션 트랙)
    if (audioPackage.media?.video) {
      const mediaFilename = audioPackage.media.video.filename;
      cloudAudioTracks.push({
        type: 'narration',
        filename: mediaFilename,
        path: audioPackage.media.video.path
      });
      audioFiles.push({
        type: 'narration',
        filename: mediaFilename,
        path: audioPackage.media.video.path
      });
    }

    // 인물 음성 (대사 트랙)
    for (const character of (audioPackage.voices || [])) {
      for (const file of character.files) {
        const voiceFilename = `voice_${character.character}_${file.filename}`;
        cloudAudioTracks.push({
          type: 'voice',
          character: character.character,
          filename: voiceFilename,
          timecodeMs: file.timecodeMs,
          durationMs: file.durationMs || 3000,
          seq: file.seq
        });
        audioFiles.push({
          type: 'voice',
          filename: voiceFilename,
          path: file.path
        });
      }
    }

    // SFX 파일 — 타임코드가 있는 파일만 미디어 등록 + 트랙 배치
    for (const sfxCat of (audioPackage.sfx || [])) {
      for (const file of sfxCat.files) {
        if (file.timecodeMs == null) continue; // 타임코드 없는 템플릿 제외
        const sfxFilename = `sfx_${sfxCat.category}_${file.filename}`;
        audioFiles.push({
          type: 'sfx',
          filename: sfxFilename,
          path: file.path
        });

        cloudAudioTracks.push({
          type: 'sfx_timed',
          filename: sfxFilename,
          timecodeMs: file.timecodeMs,
          durationMs: file.durationMs || 3000,
          category: sfxCat.category
        });
      }
    }
  }

  // filename → absolutePath 매핑 생성 (데스크톱 모드: 절대경로 치환용)
  const pathMap = {};
  for (const m of mediaFiles) {
    if (m.path && isFilePath(m.path)) pathMap[m.filename] = m.path;
  }
  for (const s of sfxFiles) {
    if (s.path && isFilePath(s.path)) pathMap[s.filename] = s.path;
  }
  for (const a of audioFiles) {
    if (a.path && isFilePath(a.path)) pathMap[a.filename] = a.path;
  }

  return {
    cloudRequest: {
      projectName: project.name || 'Untitled',
      os: detectedOS,
      format,
      titleKo: project.thumbnail_titles?.korean || project.title_ko || null,
      titleEn: project.thumbnail_titles?.english || project.title_en || null,
      scaleMode,  // 'fill' | 'fit' | 'none'
      kenBurns: {
        enabled: kenBurns,
        mode: kenBurnsMode,
        cycle: kenBurnsCycle,
        scaleMin: kenBurnsScaleMin,
        scaleMax: kenBurnsScaleMax
      },
      subtitleOption,
      subtitleFontSize,
      // 우선순위: audioPackage.srtEntries (narration MP3 align)
      //   → project.rawSrtTrack 변환 (prune/rebase 전 원본 — 사용자 import SRT 의
      //     원본 timing 그대로. orphan scene 가 참조하던 라인도 보존)
      //   → project.srtTrack 폴백 (옛 caller 호환, rawSrtTrack 없으면 prune 된 트랙 사용)
      //   → null (GCF 가 scene 단위 cumulative fallback)
      // 사용자 원칙: SRT/MP3 가 source of truth, GCF 자막 segment 가 SRT timing
      // 그대로 박혀야 함. pruneSrtTrackToScenes 가 validScenes 의 used 라인만
      // 남기는 동작이 8~10번 자막 (이미지 없는 orphan scene 의 라인) 을 죽이는
      // 문제 회피.
      srtEntries: (Array.isArray(audioPackage?.srtEntries) && audioPackage.srtEntries.length > 0)
        ? audioPackage.srtEntries
        : (srtTrackToEntries(project.rawSrtTrack || project.srtTrack) || null),
      audioDurationSec: audioPackage?.media?.video?.durationMs
        ? audioPackage.media.video.durationMs / 1000
        : null,
      scenes: cloudScenes,
      videoOverlays: cloudVideoOverlays.length > 0 ? cloudVideoOverlays : null,
      sfxItems: cloudSfxItems,
      audioTracks: cloudAudioTracks.length > 0 ? cloudAudioTracks : null,
      mediaPathBase
    },
    mediaFiles,
    sfxFiles,
    audioFiles,
    pathMap
  };
}

export default {
  prepareCloudRequest,
  isFilePath,
};
