/**
 * CapCut Cloud Exporter — Electron Desktop Edition
 *
 * Cloud Functions를 통해 JSON 생성하고 Electron IPC로 디스크에 직접 쓰기
 * - 서버 전송: 메타데이터만 (~100KB)
 * - 로컬 처리: 미디어 파일을 수집 후 IPC로 디스크 기록
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { fileSystemAPI } from '../hooks/useFileSystem';

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
 * base64 시그니처로 이미지 확장자 감지
 */
function detectImageExtension(base64Data) {
  if (!base64Data) return 'png';
  const clean = base64Data.replace(/^data:[^;]+;base64,/, '');
  if (clean.startsWith('/9j/')) return 'jpg';
  if (clean.startsWith('iVBOR')) return 'png';
  if (clean.startsWith('R0lGOD')) return 'gif';
  if (clean.startsWith('UklGR')) return 'webp';
  return 'png';
}

/**
 * 파일 경로인지 체크
 */
function isFilePath(data) {
  if (!data) return false;
  if (data.startsWith('data:')) return false;
  if (data.startsWith('http')) return false;
  if (data.startsWith('/9j/') || data.startsWith('iVBOR') ||
      data.startsWith('AAAA') || data.startsWith('//u') || data.startsWith('SUQ')) {
    return false;
  }
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

  if (path.startsWith('/9j/') || path.startsWith('iVBOR') ||
      path.startsWith('R0lGOD') || path.startsWith('UklGR')) {
    const ext = detectImageExtension(path);
    return `${type}_${sceneId}.${ext}`;
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
async function prepareCloudRequest(project, options = {}) {
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

    // image_size가 없으면 base64에서 추출 시도
    if (!imageSize && fallback) {
      console.log(`[CapCut Cloud] Extracting image size for ${sceneId} from base64...`);
      imageSize = await getImageSizeFromBase64(fallback);
      if (imageSize) {
        console.log(`[CapCut Cloud] Extracted size: ${imageSize.width}x${imageSize.height}`);
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

    // 영상 오버레이 (있으면, 씬 뒤쪽에 배치)
    const videoPath = scene.video_path;
    const videoDuration = scene.video_duration || 0;
    if (videoPath && videoDuration > 0 && videoDuration < sceneDuration) {
      const videoFilename = getFilename(videoPath, sceneId, 'video');
      const videoStartMs = cumulativeTime + (sceneDuration - videoDuration) * 1000;

      cloudVideoOverlays.push({
        sceneId,
        filename: videoFilename,
        width: imgWidth,  // 영상도 동일 캔버스
        height: imgHeight,
        durationMs: videoDuration * 1000,
        startMs: videoStartMs
      });

      mediaFiles.push({
        sceneId,
        type: 'video',
        filename: videoFilename,
        path: videoPath,
        fallback: null
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

  // mediaPathBase 설정
  let mediaPathBase = 'media';
  if (capcutProjectNumber) {
    const cleanPath = capcutProjectNumber.replace(/[/\\]+$/, '');
    mediaPathBase = `${cleanPath}/media`;
  }

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
      srtEntries: audioPackage?.srtEntries || null,
      scenes: cloudScenes,
      videoOverlays: cloudVideoOverlays.length > 0 ? cloudVideoOverlays : undefined,
      sfxItems: cloudSfxItems,
      audioTracks: cloudAudioTracks.length > 0 ? cloudAudioTracks : undefined,
      mediaPathBase
    },
    mediaFiles,
    sfxFiles,
    audioFiles
  };
}

/**
 * Cloud Functions를 호출하여 CapCut JSON 생성
 */
async function callGenerateCapcutJson(requestData) {
  const functions = getFunctions();

  // 함수 환경 (test/prod) - 환경변수로 제어
  const FUNCTION_SUFFIX = import.meta.env.VITE_FUNCTION_ENV === 'prod' ? '_prod' : '_test';
  const generateCapcutJson = httpsCallable(functions, `generateCapcutJson${FUNCTION_SUFFIX}`);

  console.log(`[CapCut Cloud] Calling generateCapcutJson${FUNCTION_SUFFIX} with`, requestData.scenes.length, 'scenes');

  const result = await generateCapcutJson(requestData);

  console.log('[CapCut Cloud] Received response:', {
    totalDuration: result.data.totalDuration,
    sceneCount: result.data.sceneCount
  });

  return result.data;
}

/**
 * 미디어 파일을 base64 데이터 배열로 수집
 *
 * @param {Array} mediaFiles - 이미지/비디오 미디어 파일 정보
 * @param {Array} sfxFiles - SFX 파일 정보
 * @param {Array} audioFiles - 오디오 트랙 파일 정보 (음성, SFX 등)
 * @returns {Promise<Array<{ filename: string, base64Data: string }>>}
 */
async function collectMediaFiles(mediaFiles, sfxFiles, audioFiles = []) {
  const collected = [];

  // 이미지/비디오 수집
  for (const media of mediaFiles) {
    if (media.path) {
      let base64Data = null;

      console.log('[CapCut Cloud] Processing media:', media.sceneId);

      if (media.path.startsWith('data:')) {
        base64Data = media.path.split(',')[1];
      } else if (isFilePath(media.path)) {
        // 파일 시스템에서 읽기
        try {
          const result = await fileSystemAPI.readFileByPath(media.path);
          if (result.success && result.data) {
            base64Data = result.data.startsWith('data:')
              ? result.data.split(',')[1]
              : result.data;
          }
        } catch (e) {
          console.warn(`[CapCut Cloud] File read failed: ${media.path}`, e);
        }

        // 실패 시 권한 요청 후 재시도
        if (!base64Data) {
          try {
            const permission = await fileSystemAPI.ensurePermission();
            if (permission.hasPermission) {
              const retryResult = await fileSystemAPI.readFileByPath(media.path);
              if (retryResult.success && retryResult.data) {
                base64Data = retryResult.data.startsWith('data:')
                  ? retryResult.data.split(',')[1]
                  : retryResult.data;
              }
            }
          } catch (e) {
            console.warn('[CapCut Cloud] Permission request failed:', e);
          }
        }

        // fallback 사용
        if (!base64Data && media.fallback) {
          console.log('[CapCut Cloud] Using fallback for:', media.sceneId);
          base64Data = media.fallback.startsWith('data:')
            ? media.fallback.split(',')[1]
            : media.fallback;
        }
      } else if (media.path.startsWith('/9j/') || media.path.startsWith('iVBOR') ||
                 media.path.startsWith('AAAA') || media.path.startsWith('//u')) {
        base64Data = media.path;
      }

      if (base64Data) {
        collected.push({ filename: media.filename, base64Data });
      }
    }
  }

  // SFX 수집
  for (const sfx of sfxFiles) {
    if (sfx.path) {
      let base64Data = null;

      if (sfx.path.startsWith('data:')) {
        base64Data = sfx.path.split(',')[1];
      } else if (isFilePath(sfx.path)) {
        try {
          const result = await fileSystemAPI.readFileByPath(sfx.path);
          if (result.success && result.data) {
            base64Data = result.data;
          }
        } catch (e) {
          console.warn(`[CapCut Cloud] Failed to read sfx file: ${sfx.path}`, e);
        }
      } else if (sfx.path.startsWith('//u') || sfx.path.startsWith('SUQ')) {
        base64Data = sfx.path;
      }

      if (base64Data) {
        collected.push({ filename: sfx.filename, base64Data });
      }
    }
  }

  // 오디오 트랙 파일 수집 (절대 경로 → readFileAbsolute)
  for (const audio of audioFiles) {
    if (audio.path) {
      let base64Data = null;

      console.log('[CapCut Cloud] Processing audio:', audio.filename);

      try {
        const result = await window.electronAPI.readFileAbsolute({ filePath: audio.path });
        if (result.success && result.data) {
          base64Data = result.data.startsWith('data:')
            ? result.data.split(',')[1]
            : result.data;
        }
      } catch (e) {
        console.warn(`[CapCut Cloud] Audio file read failed: ${audio.path}`, e);
      }

      if (base64Data) {
        collected.push({ filename: audio.filename, base64Data });
      }
    }
  }

  return collected;
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
  const { cloudRequest, mediaFiles, sfxFiles, audioFiles } = await prepareCloudRequest(project, options);

  // 2. Cloud Functions 호출하여 JSON 생성
  const { draftInfo, draftMetaInfo } = await callGenerateCapcutJson(cloudRequest);

  // 3. 미디어 파일을 base64 데이터로 수집 (오디오 포함)
  console.log('[CapCut Cloud] Collecting media files...');
  const collectedMediaFiles = await collectMediaFiles(mediaFiles, sfxFiles, audioFiles);
  console.log(`[CapCut Cloud] Collected ${collectedMediaFiles.length} media files (incl. ${audioFiles.length} audio)`);

  // 4. SRT 자막 파일 수집
  const { subtitleOption = 'both', audioPackage } = options;
  const { generateSRT } = await import('./capcut.js');
  const srtFiles = [];

  // 원본 SRT가 있으면 그대로 사용 (나레이션 sync 유지)
  if (audioPackage?.srtContent && (subtitleOption === 'ko' || subtitleOption === 'both')) {
    srtFiles.push({ filename: `${name}_subtitle_ko.srt`, content: audioPackage.srtContent });
    console.log('[CapCut Cloud] Using original SRT from audio package');
  } else if (subtitleOption === 'ko' || subtitleOption === 'both') {
    const srtKo = generateSRT(project, 'ko');
    if (srtKo) {
      srtFiles.push({ filename: `${name}_subtitle_ko.srt`, content: srtKo });
      console.log('[CapCut Cloud] Collected SRT file: ko (generated)');
    }
  }
  if (subtitleOption === 'en' || subtitleOption === 'both') {
    const srtEn = generateSRT(project, 'en');
    if (srtEn) {
      srtFiles.push({ filename: `${name}_subtitle_en.srt`, content: srtEn });
      console.log('[CapCut Cloud] Collected SRT file: en');
    }
  }

  // 5. Electron IPC를 통해 디스크에 직접 쓰기
  console.log('[CapCut Cloud] Writing project to disk via IPC...');
  const result = await window.electronAPI.writeCapcutProject({
    targetPath,
    draftInfo,
    draftMetaInfo,
    mediaFiles: collectedMediaFiles,
    srtFiles
  });

  console.log('[CapCut Cloud] Project written successfully to:', targetPath);

  return result;
}

export default {
  exportCapcutPackageCloud
};
