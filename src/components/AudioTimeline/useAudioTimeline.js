/**
 * useAudioTimeline - audioPackage / scenes / srtEntries → 트랙 데이터 정규화
 */

import { useMemo } from 'react'
import { parseTimeToSeconds } from '../../utils/parsers'

const COLORS = {
  image: '#7E57C2',
  subtitle: '#FFD54F',
  narration: '#4FC3F7',
  voice: '#BA68C8',
  sfx: '#FFB74D',
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

export function useAudioTimeline(audioPackage, scenes, srtEntries) {
  return useMemo(() => {
    if (!audioPackage) return null

    const folderPath = audioPackage.folderPath || ''
    const toRelPath = (p) => (p && folderPath) ? p.replace(folderPath + '/', '') : p

    // 총 길이 — narration 우선, 없으면 모든 클립 max end
    let totalDurationMs = audioPackage.media?.video?.durationMs || 0

    // ── Image 트랙 ──
    // scenes의 필드는 imagePath/startTime (camelCase) 또는 image_path/start_time (snake_case)
    // 양쪽 모두 지원
    const imageClips = (scenes || [])
      .map(s => {
        const imgPath = s.imagePath || s.image_path || s.filePath
        if (!imgPath) return null
        const startRaw = s.startTime ?? s.start_time
        const endRaw = s.endTime ?? s.end_time
        const startSec = typeof startRaw === 'number' ? startRaw : parseTimeToSeconds(startRaw)
        const endSec = typeof endRaw === 'number' ? endRaw : parseTimeToSeconds(endRaw)
        if (isNaN(startSec) || isNaN(endSec)) return null
        return {
          id: `img-${s.id}`,
          startMs: startSec * 1000,
          endMs: endSec * 1000,
          imagePath: imgPath,
          sceneRef: s,
          color: COLORS.image,
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
    const narrationClips = audioPackage.media?.video ? [{
      id: 'narration',
      startMs: 0,
      endMs: audioPackage.media.video.durationMs || 0,
      audioPath: audioPackage.media.video.path,
      filename: audioPackage.media.video.filename,
      color: COLORS.narration,
    }] : []

    // ── Voice 트랙 (그룹 + 캐릭터별 sub-track) ──
    const voiceSubTracks = (audioPackage.voices || []).map((v, vi) => {
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
    const sfxPromptMap = audioPackage.sfxPromptMap || null
    const lookupSfxMeta = (filename) => {
      if (!sfxPromptMap || !filename) return null
      const nameNoExt = filename.replace(/\.[^.]+$/, '')
      // 마지막 `_` 이후가 4자리 또는 6자리 숫자면 timecode → 제거
      const m = nameNoExt.match(/^(.+)_(\d{4}|\d{6})$/)
      const stem = m ? m[1] : nameNoExt
      return sfxPromptMap[stem] || null
    }

    const sfxSubTracks = (audioPackage.sfx || []).map((s, si) => {
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
    const allClips = [...imageClips, ...subtitleClips, ...narrationClips, ...voiceClipsAll, ...sfxClipsAll]
    const maxEnd = allClips.reduce((m, c) => Math.max(m, c.endMs || 0), 0)
    if (maxEnd > totalDurationMs) totalDurationMs = maxEnd
    if (!totalDurationMs) totalDurationMs = 60000 // 빈 패키지 fallback (1분)

    return {
      totalDurationMs,
      tracks: [
        { id: 'image',     name: 'Image',     color: COLORS.image,     variant: 'block', clips: imageClips },
        { id: 'subtitle',  name: '자막',       color: COLORS.subtitle,  variant: 'text',  clips: subtitleClips },
        { id: 'narration', name: 'Narration', color: COLORS.narration, variant: 'audio', clips: narrationClips },
        { id: 'voice',     name: 'Voice',     color: COLORS.voice,     variant: 'audio', expandable: true,
          clips: voiceClipsAll, subTracks: voiceSubTracks },
        { id: 'sfx',       name: 'SFX',       color: COLORS.sfx,       variant: 'audio', expandable: true,
          clips: sfxClipsAll, subTracks: sfxSubTracks },
      ],
    }
  }, [audioPackage, scenes, srtEntries])
}
