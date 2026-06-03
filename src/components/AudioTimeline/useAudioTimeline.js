/**
 * useAudioTimeline - audioPackage / scenes / srtEntries → 트랙 데이터 정규화
 */

import { useMemo } from 'react'
import { parseTimeToSeconds } from '../../utils/parsers'
import { resolveVideoSrc } from '../../utils/videoSrc'
import { resolveImageSrc } from '../../utils/formatters'

const COLORS = {
  image: '#7E57C2',
  video: '#26C281',
  subtitle: '#FFD54F',
  narration: '#4FC3F7',
  voice: '#BA68C8',
  sfx: '#FFB74D',
}

/**
 * 씬의 시작/끝 시간을 ms 단위로 정규화.
 *
 * Scene 객체는 camelCase(`startTime`/`endTime`)와 snake_case(`start_time`/`end_time`)
 * 두 표기를 혼용하며, 값은 number(seconds) 또는 string(`"00:01:23,456"` 류 timecode)일 수 있다.
 * 이 헬퍼가 양쪽을 흡수해 항상 `{ startMs, endMs }` 또는 `null` 을 반환한다.
 *
 * @param {object} scene
 * @returns {{startMs: number, endMs: number} | null}
 */
export function getSceneTimeRangeMs(scene) {
  if (!scene) return null
  const startRaw = scene.startTime ?? scene.start_time
  const endRaw = scene.endTime ?? scene.end_time
  const startSec = typeof startRaw === 'number' ? startRaw : parseTimeToSeconds(startRaw)
  const endSec = typeof endRaw === 'number' ? endRaw : parseTimeToSeconds(endRaw)
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null
  return { startMs: startSec * 1000, endMs: endSec * 1000 }
}

/**
 * 씬 안에서 비디오가 차지할 구간을 계산.
 * i2v 우선, 없으면 t2v. duration은 초 단위(소수점 1자리)로 저장됨 — SceneList.jsx의
 * detectVideoDuration / handleVideoMetadata와 동일 단위 가정.
 *
 * Case A (scene_dur >= video_dur): 비디오를 씬의 뒤편에 정렬
 *   videoIn = sceneEnd - videoDur
 *   videoOut = sceneEnd
 *   앞쪽 패딩(scene_start → videoIn)에는 이미지 그대로 (PreviewPanel 기존 동작)
 *
 * Case B (scene_dur < video_dur): 비디오를 씬의 시작에 정렬, 꼬리 잘림
 *   videoIn = sceneStart
 *   videoOut = sceneEnd   (비디오 자연 길이가 아니라 씬 끝에서 컷)
 *
 * 반환 단위는 ms.
 * @param {object} scene - useScenes 정규화된 씬 객체
 * @param {number} sceneStartMs - 씬 시작 ms (이미 계산되어 있어야 함)
 * @param {number} sceneEndMs - 씬 끝 ms
 * @returns {{videoPath: string, videoIn: number, videoOut: number} | null}
 */
export function computeVideoClipPlacement(scene, sceneStartMs, sceneEndMs) {
  if (!scene) return null
  if (!Number.isFinite(sceneStartMs) || !Number.isFinite(sceneEndMs)) return null
  const sceneDurMs = sceneEndMs - sceneStartMs
  if (sceneDurMs <= 0) return null

  // i2v 우선
  const i2vPath = scene.videoI2VPath || scene.video_i2v_path || null
  const t2vPath = scene.videoT2VPath || scene.video_t2v_path || null
  const videoPath = i2vPath || t2vPath
  if (!videoPath) return null

  const videoDurSec = i2vPath
    ? (scene.videoI2VDuration ?? scene.video_i2v_duration ?? null)
    : (scene.videoT2VDuration ?? scene.video_t2v_duration ?? null)
  if (!Number.isFinite(videoDurSec) || videoDurSec <= 0) return null

  const videoDurMs = videoDurSec * 1000

  if (sceneDurMs >= videoDurMs) {
    // Case A — 씬이 같거나 더 김 → 비디오 뒤편
    return {
      videoPath,
      videoIn: sceneEndMs - videoDurMs,
      videoOut: sceneEndMs,
    }
  }
  // Case B — 씬이 더 짧음 → 비디오 앞부터, 씬 끝에서 컷
  return {
    videoPath,
    videoIn: sceneStartMs,
    videoOut: sceneEndMs,
  }
}

// HSL hue shift (sub-track 색상 변형용)
function shiftHue(hex, deg) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const s = max === min ? 0 : (max - min) / (l < 0.5 ? max + min : 2 - max - min)
  if (max !== min) {
    const d = max - min
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  const newH = ((h * 360 + deg) % 360 + 360) % 360 / 360
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r2 = hue2rgb(p, q, newH + 1/3)
  const g2 = hue2rgb(p, q, newH)
  const b2 = hue2rgb(p, q, newH - 1/3)
  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`
}

/**
 * 재생 대상 오디오 클립 수집 — audioPath 있는 클립만, startMs 오름차순.
 * disabledTrackIds 에 든 트랙(Mute)은 통째로 제외. 비주얼 트랙을 넣어도 audioPath 가
 * 없어 무해(harmless) — 호출자가 disabledTracks 전체를 그대로 넘겨도 됨.
 */
export function collectPlayableClips(tracks, disabledTrackIds = new Set()) {
  if (!tracks) return []
  return tracks
    .filter(t => !disabledTrackIds.has(t.id))
    .flatMap(t => t.clips || [])
    .filter(c => c.audioPath)
    .sort((a, b) => a.startMs - b.startMs)
}

export function useAudioTimeline(audioPackage, scenes, srtEntries) {
  return useMemo(() => {
    // audioPackage가 없어도 placeholder 트랙은 생성 (드롭 타겟 제공).
    // scenes/srtEntries만 있어도 image/subtitle 트랙은 표시.
    const pkg = audioPackage || {}
    const folderPath = pkg.folderPath || ''
    const toRelPath = (p) => (p && folderPath) ? p.replace(folderPath + '/', '') : p

    // 총 길이 — narration 우선, 없으면 모든 클립 max end
    let totalDurationMs = pkg.media?.video?.durationMs || 0

    // ── Image 트랙 ──
    // scenes의 필드는 imagePath/startTime (camelCase) 또는 image_path/start_time (snake_case)
    // 양쪽 모두 지원
    const imageClips = (scenes || [])
      .map(s => {
        const imgPath = s.imagePath || s.image_path || s.filePath
        // 생성 중인 씬은 이미지가 아직 없어도 placeholder 클립을 만들어 shimmer 를 보여준다.
        // status 만 신뢰 — useAutomation 이 시작 시 atomic 하게 'generating' 설정, 완료 시 'done'/'error'.
        // (generatingStartedAt && !generatingEndedAt 보조 판정은 이미지 완료 경로(imageFinalize)가
        //  generatingEndedAt 을 안 채워 완료 후에도 영구 true → shimmer 가 안 꺼지는 회귀를 만들었다.)
        const isGenerating = s.status === 'generating'
        if (!imgPath && !isGenerating) return null
        const range = getSceneTimeRangeMs(s)
        if (!range) return null
        return {
          id: `img-${s.id}`,
          startMs: range.startMs,
          endMs: range.endMs,
          imagePath: imgPath || null,
          // 캐시버스터 적용 src — Clip.jsx 가 raw file:// 대신 사용 (재생성 stale 회피)
          imgSrc: imgPath ? resolveImageSrc({ imagePath: imgPath, generatedAt: s.generatedAt, image: s.image }) : null,
          generating: isGenerating,
          placeholder: !imgPath,  // 이미지 없는 생성중 클립 → 빈 박스 + shimmer
          sceneRef: s,
          color: COLORS.image,
        }
      })
      .filter(Boolean)

    // ── Video 트랙 (T2V/I2V 생성 결과) ──
    // 씬에 비디오가 있고 duration 메타데이터가 감지된 경우만 클립 생성.
    // 배치는 computeVideoClipPlacement로 Case A/B 분기.
    const videoClips = (scenes || [])
      .map(s => {
        const range = getSceneTimeRangeMs(s)
        if (!range) return null
        const placement = computeVideoClipPlacement(s, range.startMs, range.endMs)
        if (!placement) return null
        // 비디오 자체 generatedAt 우선(이미지 재생성과 분리). i2v 우선(placement 도 i2v 우선).
        const videoVersion = s.videoI2VGeneratedAt ?? s.videoT2VGeneratedAt ?? s.generatedAt
        const videoSrc = resolveVideoSrc(null, placement.videoPath, { version: videoVersion })
        if (!videoSrc) return null
        return {
          id: `vid-${s.id}`,
          startMs: placement.videoIn,
          endMs: placement.videoOut,
          videoPath: placement.videoPath,
          // 단일 정규화 지점 — useVideoPosters / AudioTimeline poster 주입 검증 /
          // PreviewPanel <video src> 가 모두 이 값을 그대로 사용.
          videoSrc,
          sceneRef: s,
          color: COLORS.video,
          role: 'video',
        }
      })
      .filter(Boolean)

    // ── 자막 트랙 ──
    const subtitleClips = (srtEntries || []).map((e, i) => ({
      id: `sub-${i}`,
      startMs: (e.startMs ?? e.start * 1000) || 0,
      endMs: (e.endMs ?? e.end * 1000) || 0,
      label: e.text || '',
      color: COLORS.subtitle,
    }))

    // ── Narration 트랙 ──
    const narrationClips = pkg.media?.video ? [{
      id: 'narration',
      startMs: 0,
      endMs: pkg.media.video.durationMs || 0,
      audioPath: pkg.media.video.path,
      filename: pkg.media.video.filename,
      color: COLORS.narration,
    }] : []

    // ── Voice 트랙 (그룹 + 캐릭터별 sub-track) ──
    const voiceSubTracks = (pkg.voices || []).map((v, vi) => {
      const color = shiftHue(COLORS.voice, vi * 30)
      const clips = (v.files || [])
        .filter(f => f.timecodeMs != null)
        .map(f => ({
          id: `voice-${v.character}-${f.filename}`,
          startMs: f.timecodeMs,
          endMs: f.timecodeMs + (f.durationMs || 3000),
          audioPath: f.path,
          relPath: toRelPath(f.path),
          filename: f.filename,
          character: v.character,
          color,
          type: 'voice',
          draggable: true,
        }))
      return { id: `voice-${v.character}`, name: v.character, color, clips }
    }).filter(t => t.clips.length > 0)

    // 통합 Voice 클립 (접힘 모드용)
    const voiceClipsAll = voiceSubTracks.flatMap(t => t.clips)

    // ── SFX 트랙 (그룹 + 카테고리별 sub-track) ──
    // sfxPromptMap: { [filenameStem]: { cueNo, partName, anchor, placement, offsetSec, prompt, durationSec } }
    // 디스크 파일명 `<stem>_<MMSS>.mp3` → 마지막 `_<NNNN>` 또는 `_<NNNNNN>` 분리하여 stem 추출 후 매핑
    const sfxPromptMap = pkg.sfxPromptMap || null
    const lookupSfxMeta = (filename) => {
      if (!sfxPromptMap || !filename) return null
      const nameNoExt = filename.replace(/\.[^.]+$/, '')
      // 마지막 `_` 이후가 4자리 또는 6자리 숫자면 timecode → 제거
      const m = nameNoExt.match(/^(.+)_(\d{4}|\d{6})$/)
      const stem = m ? m[1] : nameNoExt
      return sfxPromptMap[stem] || null
    }

    const sfxSubTracks = (pkg.sfx || []).map((s, si) => {
      const color = shiftHue(COLORS.sfx, si * 20)
      const clips = (s.files || [])
        .filter(f => f.timecodeMs != null)
        .map(f => ({
          id: `sfx-${s.category}-${f.filename}`,
          startMs: f.timecodeMs,
          endMs: f.timecodeMs + (f.durationMs || 3000),
          audioPath: f.path,
          relPath: toRelPath(f.path),
          filename: f.filename,
          category: s.category,
          color,
          type: 'sfx',
          draggable: true,
          sfxMeta: lookupSfxMeta(f.filename),
        }))
      return { id: `sfx-${s.category}`, name: s.category, color, clips }
    }).filter(t => t.clips.length > 0)

    const sfxClipsAll = sfxSubTracks.flatMap(t => t.clips)

    // 총 길이 보강 — narration 없거나 부족할 경우
    const allClips = [...imageClips, ...videoClips, ...subtitleClips, ...narrationClips, ...voiceClipsAll, ...sfxClipsAll]
    const maxEnd = allClips.reduce((m, c) => Math.max(m, c.endMs || 0), 0)
    if (maxEnd > totalDurationMs) totalDurationMs = maxEnd
    if (!totalDurationMs) totalDurationMs = 60000 // 빈 패키지 fallback (1분)

    // 트랙 구성 — Narration/SFX는 placeholder로 항상 표시 (드롭 타겟).
    // Video/Image/Subtitle/Voice는 데이터 있을 때만 (드롭 받지 않음).
    //
    // 트랙 순서 (위→아래) = 비주얼 z-order (위 트랙이 위 레이어):
    //   Video > Image > 자막 > Narration > Voice > SFX
    // PreviewPanel이 비디오를 이미지 위에 오버레이하는 동작과 일치 —
    // 사용자가 "비디오가 image 위에 깔린다"는 인지를 트랙 배치에서도 확인.
    // 일반 NLE(Premiere/CapCut/DaVinci) 컨벤션과 동일.
    const tracks = []
    if (videoClips.length > 0) {
      tracks.push({ id: 'video', name: 'Video', color: COLORS.video, variant: 'block', clips: videoClips, role: 'video' })
    }
    if (imageClips.length > 0) {
      tracks.push({ id: 'image', name: 'Image', color: COLORS.image, variant: 'block', clips: imageClips, role: 'image' })
    }
    if (subtitleClips.length > 0) {
      tracks.push({ id: 'subtitle', name: '자막', color: COLORS.subtitle, variant: 'text', clips: subtitleClips, role: 'subtitle' })
    }
    tracks.push({
      id: 'narration', name: 'Narration', color: COLORS.narration, variant: 'audio',
      clips: narrationClips, role: 'narration', acceptsDrop: 'audio',
    })
    if (voiceSubTracks.length > 0) {
      tracks.push({
        id: 'voice', name: 'Voice', color: COLORS.voice, variant: 'audio', expandable: true,
        clips: voiceClipsAll, subTracks: voiceSubTracks, role: 'voice',
      })
    }
    tracks.push({
      id: 'sfx', name: 'SFX', color: COLORS.sfx, variant: 'audio', expandable: true,
      clips: sfxClipsAll, subTracks: sfxSubTracks, role: 'sfx', acceptsDrop: 'audio',
    })

    return { totalDurationMs, tracks }
  }, [audioPackage, scenes, srtEntries])
}
