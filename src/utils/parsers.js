/**
 * Parsers - 텍스트/CSV/SRT 파싱 유틸리티
 */

import { DEFAULTS } from '../config/defaults'
import { parseCSVTextToRows } from './csvParser'

// ============================================================
// 기본 유틸
// ============================================================

/**
 * 시간 문자열을 초 단위 숫자로 변환
 * 지원 포맷: "HH:MM:SS.mmm", "HH:MM:SS,mmm", "MM:SS.mmm", "MM:SS", 또는 숫자(초)
 */
export function parseTimeToSeconds(timeStr) {
  if (timeStr === undefined || timeStr === null || timeStr === '') return NaN
  const num = Number(timeStr)
  if (!isNaN(num)) return num
  const str = String(timeStr).trim().replace(',', '.')
  const parts = str.split(':')
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1])
  }
  return NaN
}

/**
 * R14 review fix: parseCSVLine removed. 옛 line-split + 단순 quote toggle 파서는
 * escaped quote (""→"), multiline field, CRLF 처리 안 됨. 모든 src 진입점은
 * parseCSVTextToRows (csvParser.js) 를 사용한다. 외부 caller 가 있다면 그쪽도
 * 마이그레이션 필요.
 */

/**
 * SRT 시간 파싱 (00:00:00,000 -> 초)
 */
export function parseSRTTime(timeStr) {
  const [time, ms] = timeStr.replace(',', '.').split('.')
  const [hours, minutes, seconds] = time.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds + (parseInt(ms) / 1000)
}

// ============================================================
// 씬 파싱
// ============================================================

/**
 * 텍스트에서 씬 파싱 (줄바꿈 구분)
 * @param {string} text - 입력 텍스트
 * @param {number} defaultDuration - 기본 duration (초)
 * @returns {Array} 씬 배열
 */
export function parseTextToScenes(text, defaultDuration = DEFAULTS.scene.duration) {
  const lines = text.trim().split('\n').filter(line => line.trim())
  let currentTime = 0
  
  return lines.map((line, index) => {
    const startTime = currentTime
    const endTime = currentTime + defaultDuration
    currentTime = endTime
    
    return {
      id: `scene_${index + 1}`,
      startTime,
      endTime,
      duration: defaultDuration,
      prompt: line.trim(),
      videoT2VPrompt: '',
      videoI2VPrompt: '',
      subtitle: '',
      characters: '',
      scene_tag: '',
      style_tag: '',
      status: 'pending',
      image: null
    }
  })
}

/**
 * CSV에서 씬 파싱
 * @param {string} csvText - CSV 텍스트
 * @param {number} defaultDuration - 기본 duration
 * @returns {Array} 씬 배열
 */
export function parseCSVToScenes(csvText, defaultDuration = DEFAULTS.scene.duration) {
  // R10 review fix: shared RFC parser (escaped quote / multiline / CRLF 안전)
  const { headers: rawHeaders, rows } = parseCSVTextToRows(csvText)
  if (rows.length === 0) return []
  const headerLower = rawHeaders.map(h => h.toLowerCase())

  let currentTime = 0
  const scenes = []

  rows.forEach((textRow, i) => {
    // lowercased key lookup (옛 동작 보존)
    const row = {}
    rawHeaders.forEach((h, idx) => {
      row[headerLower[idx]] = textRow[h] || ''
    })

    const duration = parseFloat(row.duration) || defaultDuration
    const parsedStart = parseTimeToSeconds(row.start_time)
    const startTime = !isNaN(parsedStart) ? parsedStart : currentTime
    const parsedEnd = parseTimeToSeconds(row.end_time)
    const endTime = !isNaN(parsedEnd) ? parsedEnd : startTime + duration

    currentTime = endTime

    scenes.push({
      id: `scene_${i + 1}`,
      startTime,
      endTime,
      duration: endTime - startTime,
      prompt: row.prompt || row.prompt_en || '',
      prompt_ko: row.prompt_ko || '',
      videoT2VPrompt: row.video_t2v_prompt || row.video_prompt || '',
      videoI2VPrompt: row.video_i2v_prompt || '',
      subtitle: row.subtitle || row.subtitle_ko || '',
      subtitle_en: row.subtitle_en || '',
      characters: row.characters || row.character || '',
      scene_tag: row.scene_tag || row.scene || row.background || '',
      style_tag: row.style_tag || row.style || '',
      status: 'pending',
      image: null
    })
  })

  return scenes
}

/** SRT 타임코드 라인: 00:00:00,000 --> 00:00:03,000 (쉼표/마침표 둘 다 허용) */
const SRT_TIME_RE = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/

/**
 * SRT 텍스트를 파싱 가능한 형태로 정규화한다.
 *   - CRLF(\r\n) / CR(\r) → LF: **Windows 에서 만든 SRT 는 CRLF 다.** 블록 구분자가 "\r\n\r\n" 이라
 *     /\n\n+/ 로는 한 번도 안 걸려서, 파일 전체가 블록 하나가 된다(= 씬 1개로 임포트되던 버그).
 *   - BOM 제거: 첫 블록의 인덱스 줄이 "﻿1" 이 되어 깨진다.
 */
export function normalizeSrtText(srtText) {
  return String(srtText || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

/**
 * SRT 를 블록 단위로 쪼개, 각 블록에서 {startTime, endTime, text} 를 뽑는다(순수).
 * 인덱스 줄은 있어도 되고 없어도 된다 — 타임코드 줄을 **찾아서** 기준으로 삼는다(도구마다 다르다).
 */
export function parseSRTBlocks(srtText) {
  const out = []
  for (const block of normalizeSrtText(srtText).trim().split(/\n\s*\n+/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const timeIdx = lines.findIndex((l) => SRT_TIME_RE.test(l))
    if (timeIdx === -1) continue

    const [, start, end] = lines[timeIdx].match(SRT_TIME_RE)
    const text = lines.slice(timeIdx + 1).join('\n').trim()
    out.push({ startTime: parseSRTTime(start), endTime: parseSRTTime(end), text })
  }
  return out
}

/**
 * SRT에서 씬 파싱
 * @param {string} srtText - SRT 텍스트
 * @returns {Array} 씬 배열
 */
export function parseSRTToScenes(srtText) {
  const scenes = []

  for (const { startTime, endTime, text: subtitle } of parseSRTBlocks(srtText)) {

    scenes.push({
      id: `scene_${scenes.length + 1}`,
      startTime,
      endTime,
      duration: endTime - startTime,
      // SRT는 자막 전용 — 이미지 prompt 는 비워둠 (SceneList 자막 / ResultsTable prompt 책임 분리)
      prompt: '',
      videoT2VPrompt: '',
      videoI2VPrompt: '',
      subtitle,
      characters: '',
      scene_tag: '',
      style_tag: '',
      status: 'pending',
      image: null
    })
  }
  
  return scenes
}

/**
 * 새 형식 CSV (scene 컬럼) 감지. Phase 3.
 *
 * 새 형식 식별 기준:
 *   - 헤더에 'scene' 컬럼 존재
 *   - 첫 데이터 행의 scene 값이 정수
 *
 * 옛 CSV 의 `scene` 가 `scene_tag` alias (예: scene=courtyard) 인 케이스는
 * 정수 검사로 걸러진다.
 *
 * @param {string} csvText
 * @returns {boolean}
 */
export function isNewSceneCSVFormat(csvText) {
  if (!csvText || !String(csvText).trim()) return false
  // R7 review fix: RFC parser 사용 (escaped quote / multiline / CRLF 안전)
  const { headers, rows } = parseCSVTextToRows(csvText)
  if (rows.length === 0) return false
  const sceneHeader = headers.find(h => h.toLowerCase() === 'scene')
  if (!sceneHeader) return false
  const sceneVal = (rows[0][sceneHeader] || '').trim()
  return /^\d+$/.test(sceneVal)
}

/**
 * 새 형식 CSV (scene 컬럼) → { srtTrack, scenes } 변환. Phase 3.
 *
 * 규칙:
 *   - 같은 scene 번호 행들이 1개 씬으로 묶임
 *   - 씬 속성 (prompt, prompt_ko, characters, scene_tag, style_tag, shot_type) 은 그룹 첫 행만
 *   - subtitle / start_time / end_time 은 행마다
 *
 * @param {string} csvText
 * @param {object} [options]
 * @param {() => string} [options.allocateSceneId] — 씬 ID 할당 함수
 * @param {number} [options.defaultDuration] — 시간 정보 없을 때 cursor 진행
 * @returns {{ srtTrack: Array, scenes: Array }}
 */
export function parseSceneCSVToTracks(csvText, options = {}) {
  if (!csvText || !String(csvText).trim()) return { srtTrack: [], scenes: [] }
  // R7 review fix: RFC parser (escaped quote / multiline / CRLF 안전)
  const { headers: rawHeaders, rows: parsedTextRows } = parseCSVTextToRows(csvText)
  if (parsedTextRows.length === 0) return { srtTrack: [], scenes: [] }

  const defaultDuration = options.defaultDuration ?? DEFAULTS.scene.duration
  // 헤더 → lowercase 이름 매핑 (값 lookup 용)
  const headerByLower = new Map()
  for (const h of rawHeaders) headerByLower.set(h.toLowerCase(), h)
  if (!headerByLower.has('scene')) return { srtTrack: [], scenes: [] }

  // 행들을 scene 번호 별로 그룹화 (등장 순서 보존)
  const groups = []
  const groupByNumber = new Map()
  let cursor = 0

  const parsedRows = []
  for (const textRow of parsedTextRows) {
    const sceneNumStr = (textRow[headerByLower.get('scene')] || '').trim()
    if (!/^\d+$/.test(sceneNumStr)) continue
    const sceneNum = parseInt(sceneNumStr, 10)

    const getCol = (name) => {
      const key = headerByLower.get(name)
      return key ? (textRow[key] || '').trim() : ''
    }
    const startRaw = getCol('start_time')
    const endRaw = getCol('end_time')
    const parsedStart = parseTimeToSeconds(startRaw)
    const startTime = !isNaN(parsedStart) ? parsedStart : cursor
    const parsedEnd = parseTimeToSeconds(endRaw)
    const endTime = !isNaN(parsedEnd) ? parsedEnd : startTime + defaultDuration
    cursor = endTime

    const row = {
      sceneNum,
      subtitle: getCol('subtitle') || getCol('subtitle_ko') || '',
      startTime,
      endTime,
      prompt: getCol('prompt') || getCol('prompt_en') || '',
      prompt_ko: getCol('prompt_ko') || '',
      videoT2VPrompt: getCol('video_t2v_prompt') || getCol('video_prompt') || '',
      videoI2VPrompt: getCol('video_i2v_prompt') || '',
      characters: getCol('characters') || getCol('character') || '',
      scene_tag: getCol('scene_tag') || getCol('background') || '',
      style_tag: getCol('style_tag') || getCol('style') || '',
      shot_type: getCol('shot_type') || '',
    }
    parsedRows.push(row)

    if (!groupByNumber.has(sceneNum)) {
      const g = { sceneNum, rows: [] }
      groupByNumber.set(sceneNum, g)
      groups.push(g)
    }
    groupByNumber.get(sceneNum).rows.push(row)
  }

  const srtTrack = []
  const scenes = []
  for (const group of groups) {
    const first = group.rows[0]
    const srtLineIds = []
    for (const row of group.rows) {
      // C12 review fix: 빈 subtitle 행은 srtTrack 에 push 안 함 (ghost line 방지).
      // 그 행의 prompt/시간 같은 속성은 그룹 첫 행 컨텍스트로만 쓰이고, srtTrack
      // 라인은 안 만들어 export 출력에서도 빠진다.
      if (!row.subtitle || !String(row.subtitle).trim()) continue
      const lineId = `sub_${srtTrack.length + 1}`
      srtTrack.push({
        id: lineId,
        startTime: row.startTime,
        endTime: row.endTime,
        text: row.subtitle,
      })
      srtLineIds.push(lineId)
    }
    const sceneId = options.allocateSceneId
      ? options.allocateSceneId()
      : `scene_${scenes.length + 1}`
    const groupStart = group.rows[0].startTime
    const groupEnd = group.rows[group.rows.length - 1].endTime
    scenes.push({
      id: sceneId,
      srtLineIds,
      // R5 review fix: CSV 의 scene 번호를 stable key 로 보존. parseFromCSV 재import
      // 시 sceneNum 매칭 → reorder/insert 에도 image/status 가 올바른 prompt 따라감.
      _sceneNum: group.sceneNum,
      startTime: groupStart,
      endTime: groupEnd,
      duration: groupEnd - groupStart,
      // 씬 속성은 그룹 첫 행에서만
      prompt: first.prompt,
      prompt_ko: first.prompt_ko,
      videoT2VPrompt: first.videoT2VPrompt,
      videoI2VPrompt: first.videoI2VPrompt,
      // 후방 호환 subtitle: 그룹의 모든 자막 join (Phase 6 까지)
      subtitle: group.rows.map(r => r.subtitle).filter(Boolean).join('\n'),
      characters: first.characters,
      scene_tag: first.scene_tag,
      style_tag: first.style_tag,
      shot_type: first.shot_type,
      status: 'pending',
      image: null,
    })
  }

  return { srtTrack, scenes }
}

/**
 * SRT → { srtTrack, scenes } 분리 모델 변환 (Phase 2).
 *
 * 라인마다 srtTrack 항목 1개 + 씬 1개 (1:1 매핑). 씬은 srtLineIds=[그 라인 id] 를 갖고,
 * subtitle 필드도 후방 호환을 위해 채움 (Phase 6 까지). prompt/image 는 빈 값.
 *
 * @param {string} srtText
 * @param {object} [options]
 * @param {() => string} [options.allocateSceneId] — 씬 ID 할당 함수 (없으면 `scene_N`)
 * @returns {{ srtTrack: Array, scenes: Array }} (빈 SRT → 둘 다 빈 배열)
 */
export function parseSRTToTrack(srtText, options = {}) {
  if (!srtText || !String(srtText).trim()) return { srtTrack: [], scenes: [] }
  const srtTrack = []
  const scenes = []

  for (const { startTime, endTime, text } of parseSRTBlocks(srtText)) {
    const lineId = `sub_${srtTrack.length + 1}`
    srtTrack.push({ id: lineId, startTime, endTime, text })

    const sceneId = options.allocateSceneId
      ? options.allocateSceneId()
      : `scene_${scenes.length + 1}`
    scenes.push({
      id: sceneId,
      srtLineIds: [lineId],
      startTime,
      endTime,
      duration: endTime - startTime,
      prompt: '',
      videoT2VPrompt: '',
      videoI2VPrompt: '',
      subtitle: text,
      characters: '',
      scene_tag: '',
      style_tag: '',
      status: 'pending',
      image: null,
    })
  }

  return { srtTrack, scenes }
}

/**
 * CSV 비디오 모드용 헤더 변환 — `prompt` / `prompt_en` 을 `video_t2v_prompt` 로 rename.
 *
 * 비디오 모드에서 CSV 에 video_*_prompt 컬럼이 없으면 image prompt 컬럼 (prompt, prompt_en)
 * 을 비디오 프롬프트로 라우팅한다. 이미 video_*_prompt 가 있으면 (사용자 명시 의도 우선) 변경 X.
 * prompt_ko 는 별도 필드라 건드리지 않는다.
 *
 * 행 위치는 보존되므로 행-단위 매칭이 깨지지 않는다.
 *
 * @param {string} csvText
 * @returns {string} 헤더만 변경된 CSV 텍스트
 */
export function csvPromptToVideoT2V(csvText) {
  const firstLineEnd = csvText.indexOf('\n')
  if (firstLineEnd < 0) {
    // 단일 줄 (헤더만)
    return csvPromptHeaderToVideoT2V(csvText)
  }
  const headerLine = csvText.slice(0, firstLineEnd)
  const rest = csvText.slice(firstLineEnd)
  return csvPromptHeaderToVideoT2V(headerLine) + rest
}

function csvPromptHeaderToVideoT2V(headerLine) {
  const headers = headerLine.split(',').map(h => h)
  const trimmedLower = headers.map(h => h.trim().toLowerCase())
  const hasVideoCol = trimmedLower.some(h => h === 'video_t2v_prompt' || h === 'video_prompt' || h === 'video_i2v_prompt')
  if (hasVideoCol) return headerLine
  // 첫 번째 prompt 또는 prompt_en 만 video_t2v_prompt 로 변경
  const idx = trimmedLower.findIndex(h => h === 'prompt' || h === 'prompt_en')
  if (idx < 0) return headerLine
  const newHeaders = headers.slice()
  newHeaders[idx] = 'video_t2v_prompt'
  return newHeaders.join(',')
}

// ============================================================
// 머지 파서 — 기존 씬과 병합 (한 가져오기가 다른 필드를 덮어쓰지 않게)
//
// 예: SRT 가져오기로 subtitle/duration 설정 → 이어서 .txt 가져오기로 prompt만 갱신
//     이 때 subtitle/duration이 보존돼야 한다. setScenes(prev => mergeXxx(prev, ...)) 패턴.
// ============================================================

/**
 * 텍스트 → 기존 씬에 한 필드만 머지.
 * - 입력 줄 수 = 기존 씬 수: 각 씬의 지정 필드만 갱신, 다른 필드 보존
 * - 입력 줄 수 > 기존: 부족분 새 씬 추가 (해당 필드만 채워짐, 나머지 prompt 필드는 빈 칸)
 * - 입력 줄 수 < 기존: 초과 씬 보존 (max 길이 정책)
 *
 * @param {Array} existing
 * @param {string} text
 * @param {number} defaultDuration
 * @param {object} [options]
 * @param {'prompt'|'videoT2VPrompt'|'videoI2VPrompt'} [options.fieldName='prompt']
 *   text 탭은 'prompt' (이미지), video-text 탭은 'videoT2VPrompt', frame-to-video는 'videoI2VPrompt'.
 */
export function mergeTextIntoScenes(existing, text, defaultDuration = DEFAULTS.scene.duration, options = {}) {
  const fieldName = options.fieldName || 'prompt'
  // truncateToIncoming — PromptInput 직접 편집용. incoming 길이 = 최종 길이.
  //   true  : PromptInput onChange (입력창의 텍스트가 = 최종 상태. 줄을 지우면 씬도 줄어든다.
  //           빈 줄은 *그 위치의 prompt 를 비운다* — 갭 있는 비디오 트랙을 편집할 때 필요)
  //   false : .txt / .srt / .csv import (외부 파일의 빈 줄은 보통 의도된 데이터가 아니라 filter)
  const truncate = options.truncateToIncoming === true
  let split = text.split('\n').map(l => l.trim())
  // 마지막 trailing 빈 줄들은 의도 없음 — 제거 (PromptInput 끝의 \n 등)
  while (split.length > 0 && split[split.length - 1] === '') split.pop()
  const lines = truncate ? split : split.filter(Boolean)

  // Issue #2: 이미 생성 완료(이미지 보유)된 씬의 이미지 프롬프트가 실제로 바뀌면 재생성 대상이
  //   되도록 status 를 pending 으로 되돌린다. updateScene(모달/인라인 편집)과 동일 규칙을 벌크
  //   편집(PromptInput/.txt import) 경로에도 적용. 이미지 프롬프트(fieldName==='prompt')에만 해당.
  //   done→편집(pending)→정확히 원래 프롬프트로 원복하면 done 으로 되돌린다. 벌크 경로가 이 복원
  //   분기를 빠뜨려(직전 값과 다르면 무조건 pending) 원복이 pending 에 고착되던 실측 버그를 고친다.
  //   진행 중(generating)인 씬은 finalize 가 곧 done 을 쓰므로 건드리지 않는다(updateScene 과 동일 가드).
  const mergeField = (ex, value) => {
    const merged = { ...ex, [fieldName]: value }
    if (fieldName === 'prompt' && value !== ex.prompt && (ex.image || ex.imagePath) && ex.status !== 'generating') {
      let baseline = ex.donePrompt
      let hasBaseline = typeof baseline === 'string'
      // donePrompt 도입 전 완료된 legacy 씬은 편집 직전 prompt 가 생성 기준 — 첫 편집 때 한 번만 캡처.
      if (!hasBaseline && ex.status === 'done') {
        baseline = ex.prompt
        hasBaseline = true
        merged.donePrompt = baseline
      }
      if (hasBaseline && value === baseline) {
        merged.status = 'done'
        merged.error = null
        merged.errorKind = null
      } else {
        merged.status = 'pending'
      }
    }
    return merged
  }

  // 완전 빈 입력 가드 — 해당 필드를 모든 기존 씬에서 클리어.
  // 씬 자체를 삭제하지 않는다. 완전히 빈 trailing 씬 정리는 useScenes 의
  // trimTrailingEmptyScenes 에서 별도 처리한다 (max-driver 모델).
  // mergeField 로 클리어 — Done 씬의 이미지 프롬프트를 비우는 것도 "변경"이므로 status 리셋(리뷰 R2).
  if (lines.length === 0) {
    return existing.map(s => mergeField(s, ''))
  }

  // truncateToIncoming 모드: PromptInput 직접 편집 — 모든 fieldName 에 동일한 max-preserve 시맨틱.
  // max-driver 모델: scenes.length = max(image lines, video lines, SRT blocks).
  //   - fieldName X 의 lines.length < existing.length → X 를 tail 씬에서 클리어, 씬 자체는 보존.
  //   - fieldName X 의 lines.length > existing.length → 새 씬 추가 (X 필드만 채움).
  // 새 씬 시간은 누적 (cursor) 계산 — 0~defaultDuration 일괄 박지 않음 (Export 타임라인 보호).
  // trailing empty 씬 정리는 useScenes 의 trimTrailingEmptyScenes 에서 별도 처리.
  if (truncate) {
    const maxLen = Math.max(existing.length, lines.length)
    let cursor = 0
    return Array.from({ length: maxLen }, (_, i) => {
      if (i < existing.length) {
        const ex = existing[i]
        cursor = (typeof ex.endTime === 'number') ? ex.endTime : (cursor + (ex.duration || defaultDuration))
        // lines[i] 가 있으면 그 값, 없으면 해당 필드 클리어 (씬 자체는 보존)
        return mergeField(ex, i < lines.length ? lines[i] : '')
      }
      // i >= existing.length: 새 씬 — 지정 필드만 채우고 나머지는 빈 칸
      const startTime = cursor
      const endTime = cursor + defaultDuration
      cursor = endTime
      return {
        id: options.allocateId ? options.allocateId() : `scene_${i + 1}`,
        startTime, endTime, duration: defaultDuration,
        prompt: fieldName === 'prompt' ? lines[i] : '',
        videoT2VPrompt: fieldName === 'videoT2VPrompt' ? lines[i] : '',
        videoI2VPrompt: fieldName === 'videoI2VPrompt' ? lines[i] : '',
        subtitle: '', characters: '', scene_tag: '', style_tag: '',
        status: 'pending', image: null,
      }
    })
  }

  const maxLen = Math.max(existing.length, lines.length)
  let cursor = 0
  return Array.from({ length: maxLen }, (_, i) => {
    const ex = existing[i]
    const line = lines[i]
    if (ex && line !== undefined) {
      // 둘 다: 지정 필드만 갱신, 다른 필드 보존
      cursor = (typeof ex.endTime === 'number') ? ex.endTime : (cursor + (ex.duration || defaultDuration))
      return mergeField(ex, line)
    }
    if (ex) {
      // 기존만 (incoming이 더 짧음): 통째 보존
      cursor = (typeof ex.endTime === 'number') ? ex.endTime : (cursor + (ex.duration || defaultDuration))
      return ex
    }
    // 새 씬 (incoming이 더 김): 해당 필드만 채우고 나머지 prompt 필드는 빈 칸
    const startTime = cursor
    const endTime = cursor + defaultDuration
    cursor = endTime
    return {
      id: options.allocateId ? options.allocateId() : `scene_${i + 1}`,
      startTime,
      endTime,
      duration: defaultDuration,
      prompt: fieldName === 'prompt' ? line : '',
      videoT2VPrompt: fieldName === 'videoT2VPrompt' ? line : '',
      videoI2VPrompt: fieldName === 'videoI2VPrompt' ? line : '',
      subtitle: '',
      characters: '',
      scene_tag: '',
      style_tag: '',
      status: 'pending',
      image: null,
    }
  })
}

/**
 * SRT → 기존 씬에 subtitle/시간 머지. prompt는 기존 보존 (단 기존이 빈 칸이면 자막).
 * - 입력 블록 수 ↔ 기존 씬 수 정책은 mergeTextIntoScenes와 동일 (입력이 길이 결정)
 */
export function mergeSRTIntoScenes(existing, srtText, options = {}) {
  const parsed = parseSRTBlocks(srtText).map(({ startTime, endTime, text }) => ({
    startTime,
    endTime,
    duration: endTime - startTime,
    subtitle: text,
  }))

  const maxLen = Math.max(existing.length, parsed.length)
  return Array.from({ length: maxLen }, (_, i) => {
    const ex = existing[i]
    const p = parsed[i]
    if (ex && p) {
      // SRT 는 자막/시간 갱신 — prompt 는 기존 그대로 (자막을 prompt 로 복사하지 않음).
      // SceneList(자막) / ResultsTable(prompt) 책임 분리 디자인에 맞춤.
      return {
        ...ex,
        startTime: p.startTime,
        endTime: p.endTime,
        duration: p.duration,
        subtitle: p.subtitle,
      }
    }
    if (ex) {
      // SRT 가 더 짧음 → 초과 위치는 subtitle CLEAR (max-driver 모델: "SRT N" 은 현재
      // SRT 컬럼 길이 N 을 의미). 다른 컬럼(prompt/video/image/F→V)은 보존 — 그게 있으면
      // sceneTrim 이 씬 자체는 살림. 옛 subtitle 잔존하면 reimport 후에도 scene count/export 가
      // stale 자막으로 부풀려짐.
      return { ...ex, subtitle: '' }
    }
    return {
      id: options.allocateId ? options.allocateId() : `scene_${i + 1}`,
      startTime: p.startTime,
      endTime: p.endTime,
      duration: p.duration,
      // SRT 새 씬: 자막만, prompt 는 비워둠
      prompt: '',
      videoT2VPrompt: '',
      videoI2VPrompt: '',
      subtitle: p.subtitle,
      characters: '',
      scene_tag: '',
      style_tag: '',
      status: 'pending',
      image: null,
    }
  })
}

/**
 * CSV → 기존 씬에 머지. CSV에 명시된 컬럼만 덮어쓰고, CSV에 없는 컬럼의 기존 값은 보존.
 * (parseCSVToScenes는 누락 컬럼을 기본값으로 채우기 때문에 결과만으로 머지하면 의도와 다르게
 *  기본값이 기존 값을 덮어쓴다. 그래서 헤더를 보고 "CSV가 제공한 필드"만 적용한다.)
 */
export function mergeCSVIntoScenes(existing, csvText, defaultDuration = DEFAULTS.scene.duration, options = {}) {
  // R10 review fix: shared RFC parser. parseCSVToScenes 가 같은 parser 쓰니 여기서도
  // headers 만 추출해 providedFields 계산.
  const { headers: rawHeaders } = parseCSVTextToRows(csvText)
  const headers = rawHeaders.map(h => h.toLowerCase())

  // CSV 헤더 → scene 필드 매핑 (parseCSVToScenes와 동일한 별칭 규칙)
  const aliases = {
    prompt: ['prompt', 'prompt_en'],
    prompt_ko: ['prompt_ko'],
    videoT2VPrompt: ['video_t2v_prompt', 'video_prompt'],
    videoI2VPrompt: ['video_i2v_prompt'],
    subtitle: ['subtitle', 'subtitle_ko'],
    subtitle_en: ['subtitle_en'],
    characters: ['characters', 'character'],
    scene_tag: ['scene_tag', 'scene', 'background'],
    style_tag: ['style_tag', 'style'],
    duration: ['duration'],
    startTime: ['start_time'],
    endTime: ['end_time'],
  }

  const providedFields = new Set()
  for (const [field, fieldAliases] of Object.entries(aliases)) {
    if (fieldAliases.some(a => headers.includes(a))) {
      providedFields.add(field)
    }
  }

  const parsed = parseCSVToScenes(csvText, defaultDuration)
  const maxLen = Math.max(existing.length, parsed.length)
  return Array.from({ length: maxLen }, (_, i) => {
    const ex = existing[i]
    const p = parsed[i]
    if (ex && p) {
      const merged = { ...ex }
      for (const field of providedFields) {
        const value = p[field]
        if (value !== '' && value !== null && value !== undefined) {
          merged[field] = value
        }
      }
      return merged
    }
    if (ex) {
      // 기존만 (CSV 더 짧음): 보존
      return ex
    }
    // 새 씬 (CSV가 더 김): allocateId 가 있으면 안정적 ID 사용
    return options.allocateId ? { ...p, id: options.allocateId() } : p
  })
}

// ============================================================
// 파일 타입 감지
// ============================================================

/**
 * 파일 내용을 분석하여 타입 판별
 * @param {string} content - 파일 내용
 * @returns {'text' | 'csv' | 'srt' | 'reference' | 'unknown'} 파일 타입
 */
export function detectFileType(content) {
  const trimmed = content.trim()
  if (!trimmed) return 'unknown'

  // SRT 감지: 타임코드 패턴 (00:00:00,000 --> 00:00:03,000)
  const srtPattern = /\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/
  if (srtPattern.test(trimmed)) {
    return 'srt'
  }

  // CSV 감지: 첫 줄에 콤마가 있거나, 단일 컬럼이라도 알려진 CSV 헤더면 CSV.
  // 단일 컬럼 헤더 예: 'video_t2v_prompt\nv1\nv2' — 콤마는 없지만 video CSV 로 처리해야 한다.
  // S4 review fix: 전체 split('\n') 대신 indexOf 로 첫 행 substring 만 — 대용량
  // 파일 메모리 할당 회피.
  const firstLineEnd = trimmed.indexOf('\n')
  const firstLine = firstLineEnd >= 0 ? trimmed.substring(0, firstLineEnd) : trimmed
  if (firstLine.includes(',')) {
    const csvType = detectCSVType(content)
    if (csvType === 'reference') return 'reference'
    if (csvType === 'scene') return 'csv'
    if (csvType === 'unknown' && firstLine.split(',').length >= 2) {
      return 'csv'
    }
  } else {
    // 단일 컬럼 CSV 가능성: 첫 줄이 알려진 scene CSV 헤더 이름이면 CSV 로 처리
    const singleCol = firstLine.trim().toLowerCase()
    const knownSceneHeaders = new Set([
      'prompt', 'prompt_en', 'prompt_ko',
      'video_t2v_prompt', 'video_prompt', 'video_i2v_prompt',
      'subtitle', 'subtitle_ko', 'subtitle_en',
      'characters', 'character',
      'scene_tag', 'scene', 'background',
      'style_tag', 'style',
      'duration',
    ])
    if (knownSceneHeaders.has(singleCol)) {
      return 'csv'
    }
  }

  // 그 외는 일반 텍스트
  return 'text'
}

/**
 * CSV 헤더를 분석하여 씬 CSV인지 레퍼런스 CSV인지 판별
 * @param {string} csvContent - CSV 텍스트
 * @returns {'scene' | 'reference' | 'unknown'} CSV 타입
 */
export function detectCSVType(csvContent) {
  // R10 + S5 review fix: shared RFC parser. detection 은 헤더만 필요하므로
  // 전체 CSV 가 아닌 첫 줄 substring 만 파서에 전달 (대용량 CSV 의 row 인스턴스화
  // 비용 회피).
  if (!csvContent) return 'unknown'
  const firstLineEnd = csvContent.indexOf('\n')
  const headerOnly = firstLineEnd >= 0 ? csvContent.substring(0, firstLineEnd) : csvContent
  const { headers: rawHeaders } = parseCSVTextToRows(headerOnly)
  if (rawHeaders.length === 0) return 'unknown'
  const header = rawHeaders.map(h => h.toLowerCase())

  // 레퍼런스 CSV 특성: name 컬럼 필수, type 컬럼 있음, prompt 컬럼 없거나 선택적
  // 씬 CSV 특성: prompt 컬럼 필수, subtitle/characters/scene_tag/style_tag/duration 등

  const hasName = header.includes('name')
  const hasType = header.includes('type')
  const hasPrompt = header.includes('prompt') || header.includes('prompt_en') || header.includes('prompt_ko')
  const hasVideoPrompt = header.includes('video_t2v_prompt') || header.includes('video_prompt') || header.includes('video_i2v_prompt')
  const hasSubtitle = header.includes('subtitle') || header.includes('subtitle_ko') || header.includes('subtitle_en')
  const hasCharacters = header.includes('characters') || header.includes('character')
  const hasSceneTag = header.includes('scene_tag') || header.includes('scene') || header.includes('background')
  const hasStyleTag = header.includes('style_tag') || header.includes('style')
  const hasDuration = header.includes('duration')

  // 레퍼런스 CSV: name + type 있고, 씬 관련 컬럼(subtitle, characters, scene_tag, duration) 없음
  if (hasName && hasType && !hasSubtitle && !hasCharacters && !hasDuration) {
    return 'reference'
  }

  // 씬 CSV: prompt(또는 video_*_prompt) 있고, 씬 관련 컬럼 중 하나라도 있음
  if ((hasPrompt || hasVideoPrompt) && (hasSubtitle || hasCharacters || hasSceneTag || hasStyleTag || hasDuration)) {
    return 'scene'
  }

  // prompt 또는 video_*_prompt 만 있는 경우 씬으로 간주
  if ((hasPrompt || hasVideoPrompt) && !hasName) {
    return 'scene'
  }

  // name만 있고 type도 있으면 레퍼런스
  if (hasName && hasType) {
    return 'reference'
  }

  return 'unknown'
}

// ============================================================
// 레퍼런스 파싱
// ============================================================

const TYPE_TO_CATEGORY = {
  'character': 'MEDIA_CATEGORY_SUBJECT',
  'scene': 'MEDIA_CATEGORY_SCENE',
  'background': 'MEDIA_CATEGORY_SCENE',  // background도 scene으로 매핑
  'style': 'MEDIA_CATEGORY_STYLE'
}

/**
 * CSV에서 레퍼런스 파싱
 * @param {string} csvContent - CSV 텍스트
 * @returns {Array|null} 레퍼런스 배열 또는 null
 */
export function parseReferencesCSV(csvContent) {
  // R10 review fix: shared RFC parser
  const { headers: rawHeaders, rows } = parseCSVTextToRows(csvContent)
  if (rows.length === 0) return null

  const headerLower = rawHeaders.map(h => h.toLowerCase())
  const headerByLower = new Map()
  rawHeaders.forEach((h, i) => headerByLower.set(headerLower[i], h))

  const nameKey = headerByLower.get('name')
  if (!nameKey) {
    console.warn('Reference CSV: name column required')
    return null
  }
  const typeKey = headerByLower.get('type')
  const promptKey = headerByLower.get('prompt') || headerByLower.get('description')
  const imagePathKey = headerByLower.get('image_path') || headerByLower.get('image')

  const refs = []

  for (const row of rows) {
    const name = (row[nameKey] || '').trim()
    if (!name) continue

    const type = typeKey ? (row[typeKey] || '').trim().toLowerCase() : 'character'
    const prompt = promptKey ? (row[promptKey] || '').trim() : ''
    const imagePath = imagePathKey ? (row[imagePathKey] || '').trim() : ''
    const category = TYPE_TO_CATEGORY[type] || 'MEDIA_CATEGORY_SUBJECT'

    // type value 매핑 (background -> scene)
    const typeValue = (type === 'scene' || type === 'background') ? 'scene'
      : type === 'style' ? 'style'
      : 'character'

    refs.push({
      name,
      type: typeValue,
      category,
      prompt,
      imagePath  // 이미지 경로 추가
    })
  }

  return refs.length > 0 ? refs : null
}

/**
 * 기존 레퍼런스와 새 레퍼런스 병합
 * @param {Array} existing - 기존 레퍼런스 배열
 * @param {Array} newRefs - 새 레퍼런스 배열
 * @param {boolean} updateExisting - 중복 시 업데이트 여부
 * @returns {Array} 병합된 레퍼런스 배열
 */
export function mergeReferences(existing, newRefs, updateExisting = true) {
  const updated = [...existing]

  for (const newRef of newRefs) {
    const existingIdx = updated.findIndex(r => r.name === newRef.name)

    if (existingIdx !== -1) {
      if (updateExisting) {
        // 기존 레퍼런스 업데이트 (mediaId 유지, 새 이미지가 있으면 덮어쓰기)
        updated[existingIdx] = {
          ...updated[existingIdx],
          type: newRef.type,
          category: newRef.category,
          prompt: newRef.prompt,
          imagePath: newRef.imagePath || updated[existingIdx].imagePath,
          // 새 레퍼런스에 이미지 데이터가 있으면 사용
          data: newRef.data || updated[existingIdx].data
        }
      }
      // updateExisting이 false면 건너뜀
    } else {
      // 새 레퍼런스 추가
      updated.push({
        id: Date.now() + updated.length,
        name: newRef.name,
        type: newRef.type,
        category: newRef.category,
        prompt: newRef.prompt,
        imagePath: newRef.imagePath || '',
        data: newRef.data || null,  // CSV에서 로드한 이미지 데이터
        mediaId: null,
        caption: ''
      })
    }
  }

  return updated
}

/**
 * 중복 레퍼런스 이름 찾기
 * @param {Array} existing - 기존 레퍼런스 배열
 * @param {Array} newRefs - 새 레퍼런스 배열
 * @returns {Array} 중복 이름 배열
 */
export function findDuplicateReferenceNames(existing, newRefs) {
  return newRefs
    .filter(newRef => existing.some(r => r.name === newRef.name))
    .map(r => r.name)
}
