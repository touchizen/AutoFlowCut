/**
 * Parsers - 텍스트/CSV/SRT 파싱 유틸리티
 */

import { DEFAULTS } from '../config/defaults'

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
 * CSV 라인 파싱 (따옴표 처리)
 */
export function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  
  result.push(current.trim())
  return result
}

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
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return []
  
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  
  let currentTime = 0
  const scenes = []
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    if (!values.length) continue
    
    const row = {}
    headers.forEach((header, idx) => {
      row[header] = values[idx] || ''
    })
    
    const duration = parseFloat(row.duration) || defaultDuration
    const parsedStart = parseTimeToSeconds(row.start_time)
    const startTime = !isNaN(parsedStart) ? parsedStart : currentTime
    const parsedEnd = parseTimeToSeconds(row.end_time)
    const endTime = !isNaN(parsedEnd) ? parsedEnd : startTime + duration
    
    currentTime = endTime
    
    scenes.push({
      id: `scene_${i}`,
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
  }
  
  return scenes
}

/**
 * SRT에서 씬 파싱
 * @param {string} srtText - SRT 텍스트
 * @returns {Array} 씬 배열
 */
export function parseSRTToScenes(srtText) {
  const blocks = srtText.trim().split(/\n\n+/)
  const scenes = []
  
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    
    // 시간 라인 파싱: 00:00:00,000 --> 00:00:03,000
    const timeLine = lines[1]
    const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/)
    
    if (!timeMatch) continue
    
    const startTime = parseSRTTime(timeMatch[1])
    const endTime = parseSRTTime(timeMatch[2])
    
    // 자막 텍스트 (3번째 줄 이후)
    const subtitle = lines.slice(2).join('\n').trim()
    
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
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const maxLen = Math.max(existing.length, lines.length)
  let cursor = 0
  return Array.from({ length: maxLen }, (_, i) => {
    const ex = existing[i]
    const line = lines[i]
    if (ex && line !== undefined) {
      // 둘 다: 지정 필드만 갱신, 다른 필드 보존
      cursor = (typeof ex.endTime === 'number') ? ex.endTime : (cursor + (ex.duration || defaultDuration))
      return { ...ex, [fieldName]: line }
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
      id: `scene_${i + 1}`,
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
export function mergeSRTIntoScenes(existing, srtText) {
  const blocks = srtText.trim().split(/\n\n+/)
  const parsed = []

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue

    const timeLine = lines[1]
    const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/)
    if (!timeMatch) continue

    const startTime = parseSRTTime(timeMatch[1])
    const endTime = parseSRTTime(timeMatch[2])
    const subtitle = lines.slice(2).join('\n').trim()

    parsed.push({ startTime, endTime, duration: endTime - startTime, subtitle })
  }

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
      // 기존만 (SRT 더 짧음): 보존
      return ex
    }
    return {
      id: `scene_${i + 1}`,
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
export function mergeCSVIntoScenes(existing, csvText, defaultDuration = DEFAULTS.scene.duration) {
  const firstLine = csvText.trim().split('\n')[0]
  const headers = parseCSVLine(firstLine).map(h => h.trim().toLowerCase())

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
    return p
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
  const firstLine = trimmed.split('\n')[0]
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
  const lines = csvContent.trim().split('\n')
  if (lines.length < 1) return 'unknown'

  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())

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
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return null

  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
  const nameIdx = header.indexOf('name')
  const typeIdx = header.indexOf('type')
  // prompt 또는 description 컬럼 지원
  let promptIdx = header.indexOf('prompt')
  if (promptIdx === -1) promptIdx = header.indexOf('description')
  // image_path 또는 image 컬럼 지원
  let imagePathIdx = header.indexOf('image_path')
  if (imagePathIdx === -1) imagePathIdx = header.indexOf('image')

  if (nameIdx === -1) {
    console.warn('Reference CSV: name column required')
    return null
  }

  const refs = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = parseCSVLine(line)
    const name = values[nameIdx]?.trim()
    if (!name) continue

    const type = typeIdx !== -1 ? values[typeIdx]?.trim().toLowerCase() : 'character'
    const prompt = promptIdx !== -1 ? values[promptIdx]?.trim() : ''
    const imagePath = imagePathIdx !== -1 ? values[imagePathIdx]?.trim() : ''
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
