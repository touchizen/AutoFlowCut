/**
 * CSV 파싱/직렬화 모듈
 */

import fs from 'fs';
import { IMAGE_PROVIDER_IDS, VIDEO_PROVIDER_IDS } from './sceneGenerationSchema.js'

const GENERATION_COLUMN_PATHS = {
  image_provider: ['image', 'provider'],
  image_model: ['image', 'model'],
  t2v_provider: ['video', 't2v', 'provider'],
  t2v_model: ['video', 't2v', 'model'],
  i2v_provider: ['video', 'i2v', 'provider'],
  i2v_model: ['video', 'i2v', 'model'],
}
const GENERATION_INHERIT_SENTINEL = '__inherit__'
const IMAGE_PROVIDER_ID_SET = new Set(IMAGE_PROVIDER_IDS)
const VIDEO_PROVIDER_ID_SET = new Set(VIDEO_PROVIDER_IDS)

function generationFromRow(get, warnings, options = {}) {
  const hasColumn = options.hasColumn || (() => true)
  const existingGeneration = options.existingGeneration
  const stage = (providerColumn, modelColumn, providerIds, path, existing) => {
    const hasProviderColumn = hasColumn(providerColumn)
    const hasModelColumn = hasColumn(modelColumn)
    if (!hasProviderColumn && !hasModelColumn) return existing
    const provider = hasProviderColumn ? get(providerColumn) : (existing?.provider ?? '')
    const providerChanged = hasProviderColumn
      && !hasModelColumn
      && provider !== (existing?.provider ?? '')
    let model = hasModelColumn ? get(modelColumn) : (providerChanged ? '' : (existing?.model ?? ''))
    if (provider === GENERATION_INHERIT_SENTINEL) {
      if (hasModelColumn && model && Array.isArray(warnings)) {
        warnings.push(`Model '${model}' ignored because provider is __inherit__ at ${path}.`)
      }
      return null
    }
    const modelRejected = model === GENERATION_INHERIT_SENTINEL
    if (modelRejected) {
      if (Array.isArray(warnings)) warnings.push(`Rejected invalid model '${model}' at ${path}.`)
      model = ''
    }
    if (!provider && !model) return undefined
    if (provider && !providerIds.has(provider)) {
      if (Array.isArray(warnings)) warnings.push(`Rejected unknown provider '${provider}' at ${path}.`)
      if (modelRejected && existing && typeof existing === 'object') {
        const preserved = { ...existing }
        delete preserved.model
        return Object.keys(preserved).length > 0 ? preserved : undefined
      }
      return existing
    }
    return { ...(provider ? { provider } : {}), ...(model ? { model } : {}) }
  }
  const image = stage(
    'image_provider', 'image_model', IMAGE_PROVIDER_ID_SET, 'generation.image', existingGeneration?.image,
  )
  const t2v = stage(
    't2v_provider', 't2v_model', VIDEO_PROVIDER_ID_SET, 'generation.video.t2v', existingGeneration?.video?.t2v,
  )
  const i2v = stage(
    'i2v_provider', 'i2v_model', VIDEO_PROVIDER_ID_SET, 'generation.video.i2v', existingGeneration?.video?.i2v,
  )
  if (image === undefined && t2v === undefined && i2v === undefined) return undefined
  return {
    ...(image !== undefined ? { image } : {}),
    ...((t2v !== undefined || i2v !== undefined) ? {
      video: {
        ...(t2v !== undefined ? { t2v } : {}),
        ...(i2v !== undefined ? { i2v } : {}),
      },
    } : {}),
  }
}

export function nestSceneGenerationColumns(row = {}, options = {}) {
  const byLower = new Map(Object.entries(row).map(([key, value]) => [String(key).toLowerCase(), value]))
  const hasGenerationColumns = Object.keys(GENERATION_COLUMN_PATHS).some(key => byLower.has(key))
  if (!hasGenerationColumns) return row
  const generation = generationFromRow(
    key => String(byLower.get(key) ?? '').trim(),
    options?.warnings,
    {
      hasColumn: key => byLower.has(key),
      existingGeneration: row.generation,
    },
  )
  const nested = { ...row }
  if (generation === undefined) delete nested.generation
  else nested.generation = generation
  return nested
}

function valueForHeader(scene, header) {
  const path = GENERATION_COLUMN_PATHS[String(header).toLowerCase()]
  if (!path) return scene[header]
  let stage = scene.generation
  for (const segment of path.slice(0, -1)) stage = stage?.[segment]
  if (stage === null) {
    return path.at(-1) === 'provider' ? GENERATION_INHERIT_SENTINEL : ''
  }
  const value = stage?.[path.at(-1)]
  return value ?? scene[header]
}

/**
 * CSV 텍스트를 2차원 배열로 파싱 (RFC 4180 호환)
 * @param {string} text - CSV 텍스트
 * @returns {string[][]} 행 × 열 배열
 */
export function parseCSV(text) {
  const rows = [];
  let fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      fields.push(current);
      current = '';
      if (fields.length > 0) {
        rows.push(fields);
        fields = [];
      }
    } else {
      current += ch;
    }
  }
  // S1 review fix: 끝자리 개행 유무에 따른 빈 행 누락 버그 동기화 (renderer R23
  // 와 동일). 옛 `fields.some(f => f.length > 0)` 은 ',,' 만 있는 마지막 행을
  // drop 해서 '\n' 유무로 행 수가 달라짐. 새 가드: 다중 컬럼이거나 단일이라도
  // 내용 있으면 유효 행.
  fields.push(current);
  if (fields.length > 1 || (fields.length === 1 && fields[0].length > 0)) {
    rows.push(fields);
  }
  return rows;
}

/**
 * CSV 파일을 읽어서 헤더 + 씬 객체 배열로 반환
 * @param {string} csvPath - CSV 파일 경로
 * @returns {{ headers: string[], scenes: object[] }}
 */
export function loadCSV(csvPath) {
  let text = fs.readFileSync(csvPath, 'utf-8');
  // BOM 제거
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = parseCSV(text);
  if (rows.length === 0) return { headers: [], scenes: [] };
  const headers = rows[0];
  const scenes = rows.slice(1).map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] || '';
    });
    obj._rowIndex = idx + 1; // 1-based (scene number)
    return obj;
  });
  return { headers, scenes };
}

/**
 * CSV 필드 이스케이프 (쉼표, 따옴표, 줄바꿈 처리)
 * @param {*} val - 필드 값
 * @returns {string}
 */
export function escapeCSVField(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 새 형식 (scene 컬럼) CSV 인지 감지.
 * Renderer 의 isNewSceneCSVFormat 과 동일한 휴리스틱.
 *
 * @param {string[]} headers
 * @param {object[]} rows — loadCSV 의 scenes (row objects)
 * @returns {boolean}
 */
export function isNewSceneCSVFormat(headers, rows) {
  if (!Array.isArray(headers) || !Array.isArray(rows) || rows.length === 0) return false
  const lower = headers.map(h => h.toLowerCase())
  if (!lower.includes('scene')) return false
  const sceneVal = (rows[0]?.scene ?? rows[0]?.Scene ?? '').toString().trim()
  return /^\d+$/.test(sceneVal)
}

/**
 * CSV 시각 값(초 숫자 또는 "HH:MM:SS,mmm" / "MM:SS" 타임코드) → 초. 비었거나 못 읽으면 NaN.
 */
function parseCSVTime(raw) {
  if (raw === undefined || raw === null || raw === '') return NaN
  const num = Number(raw)
  if (!isNaN(num)) return num
  const str = String(raw).trim().replace(',', '.')
  const parts = str.split(':')
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
  }
  if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1])
  return NaN
}

/**
 * 시작·끝 시각 결정 — 읽히는 값이 있으면 그 값, 없으면 앞 씬 끝(cursor)에서 시작해 duration 만큼.
 * (bundleSceneCSVRows · layoutSceneRowTimes 공용)
 */
function resolveRowTimes(startRaw, endRaw, cursor, duration) {
  const parsedStart = parseCSVTime(startRaw)
  const parsedEnd = parseCSVTime(endRaw)
  const startTime = !isNaN(parsedStart) ? parsedStart : cursor
  const endTime = !isNaN(parsedEnd) ? parsedEnd : startTime + duration
  return { startTime, endTime }
}

/**
 * 옛 형식 CSV row 들(scene 열 없음)에 씬 시각을 붙인다 — 렌더러 parseCSVToScenes(가져오기 창)와 같은 규칙
 * (헤더 대소문자 무관, start_time/end_time 이 있으면 그 값, 없으면 앞 씬 끝에서 duration — 없으면 defaultDuration).
 * camelCase startTime/endTime(숫자)만 더하고 CSV 칸(start_time·end_time·duration)은 그대로 둔다 — save_csv 왕복이 바이트 그대로.
 * 앱으로 보낼 땐 stripCSVTimeColumns 로 시각 칸을 뺀다.
 *
 * @param {object[]} rows — loadCSV 가 반환한 row objects
 * @param {object} [options]
 * @param {number} [options.defaultDuration=3]
 * @returns {object[]}
 */
export function layoutSceneRowTimes(rows, options = {}) {
  if (!Array.isArray(rows)) return []
  const defaultDuration = options.defaultDuration ?? 3
  let cursor = 0
  return rows.map((r) => {
    const cell = (name) => {
      const key = Object.keys(r).find((k) => k.toLowerCase() === name)
      return key ? r[key] : undefined
    }
    const duration = parseFloat(cell('duration')) || defaultDuration
    const { startTime, endTime } = resolveRowTimes(cell('start_time'), cell('end_time'), cursor, duration)
    cursor = endTime
    return { ...r, startTime, endTime }
  })
}

/**
 * 앱(update-scenes)으로 보낼 씬에서 CSV 시각 칸(start_time/end_time, 대소문자 무관)을 뺀다.
 * 렌더러 normalizeScene 은 start_time 을 startTime 보다 먼저 읽는다 — 빈 칸이면 startTime 0(2026-10-20: 96씬이 전부 0~4초),
 * 값이 있어도 씬 삭제·이동 뒤 recalculateTimes 가 camelCase 만 고쳐 옛 시각으로 되돌아간다. 앱은 camelCase 만 보면 된다.
 *
 * @param {object[]} scenes
 * @returns {object[]}
 */
export function stripCSVTimeColumns(scenes) {
  return (scenes || []).map((s) => Object.fromEntries(
    Object.entries(s).filter(([k]) => !['start_time', 'end_time'].includes(k.toLowerCase()))))
}

/**
 * 새 형식 CSV row 들을 묶음 scenes + srtTrack 으로 변환.
 * Renderer 의 parseSceneCSVToTracks 와 동등한 로직 (R2 review fix —
 * MCP 경로도 같은 결과 emit 해서 ImportModal 과 일치).
 *
 * @param {object[]} rows — loadCSV 가 반환한 row objects (header → value)
 * @param {object} [options]
 * @param {number} [options.defaultDuration=3] — 시간 정보 없는 행에서 cursor 진행
 * @returns {{ scenes: object[], srtTrack: object[] }}
 */
export function bundleSceneCSVRows(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { scenes: [], srtTrack: [] }
  }
  const defaultDuration = options.defaultDuration ?? 3
  const groups = []
  const groupByNumber = new Map()
  let cursor = 0

  for (const r of rows) {
    const get = (k) => (r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()] ?? '').toString().trim()
    const sceneNumStr = (r.scene ?? r.Scene ?? '').toString().trim()
    if (!/^\d+$/.test(sceneNumStr)) continue
    const sceneNum = parseInt(sceneNumStr, 10)

    const { startTime, endTime } = resolveRowTimes(get('start_time'), get('end_time'), cursor, defaultDuration)
    cursor = endTime

    const row = {
      sceneNum,
      subtitle: get('subtitle') || get('subtitle_ko') || '',
      startTime,
      endTime,
      prompt: get('prompt') || get('prompt_en') || '',
      prompt_ko: get('prompt_ko') || '',
      videoT2VPrompt: get('video_t2v_prompt') || get('video_prompt') || '',
      videoI2VPrompt: get('video_i2v_prompt') || '',
      characters: get('characters') || get('character') || '',
      scene_tag: get('scene_tag') || get('background') || '',
      style_tag: get('style_tag') || get('style') || '',
      shot_type: get('shot_type') || '',
      generation: generationFromRow(get, options.warnings),
    }
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
      if (!row.subtitle) continue
      const lineId = `sub_${srtTrack.length + 1}`
      srtTrack.push({ id: lineId, startTime: row.startTime, endTime: row.endTime, text: row.subtitle })
      srtLineIds.push(lineId)
    }
    const sceneId = `scene_${scenes.length + 1}`
    const groupStart = group.rows[0].startTime
    const groupEnd = group.rows[group.rows.length - 1].endTime
    scenes.push({
      id: sceneId,
      srtLineIds,
      _sceneNum: group.sceneNum,
      startTime: groupStart,
      endTime: groupEnd,
      duration: groupEnd - groupStart,
      prompt: first.prompt,
      prompt_ko: first.prompt_ko,
      videoT2VPrompt: first.videoT2VPrompt,
      videoI2VPrompt: first.videoI2VPrompt,
      subtitle: group.rows.map(r => r.subtitle).filter(Boolean).join('\n'),
      characters: first.characters,
      scene_tag: first.scene_tag,
      style_tag: first.style_tag,
      shot_type: first.shot_type,
      ...(first.generation !== undefined ? { generation: first.generation } : {}),
      status: 'pending',
      image: null,
    })
  }
  return { scenes, srtTrack }
}

/**
 * CSV 재로드가 생성 이미지 런타임 필드를 지우지 않도록 기존 씬에서 보존한다.
 * _sceneNum 매칭을 우선하고, legacy 데이터는 길이가 같을 때 index로 폴백한다.
 */
export function preserveSceneRuntimeFields(scenes, existingScenes) {
  const copyRuntime = (scene, existing) => {
    if (!existing) return scene
    const preserved = {}
    for (const field of ['mediaId', 'imagePath', 'image_size', 'generatedAt', 'upscaledAt', 'donePrompt']) {
      if (existing[field] !== undefined) preserved[field] = existing[field]
    }
    if (existing.status === 'done') preserved.status = 'done'
    return { ...scene, ...preserved }
  }

  const existingByNum = new Map()
  for (const existing of existingScenes || []) {
    if (existing._sceneNum != null) existingByNum.set(existing._sceneNum, existing)
  }

  if (existingByNum.size > 0) {
    return (scenes || []).map((scene) => copyRuntime(scene, existingByNum.get(scene._sceneNum)))
  }
  if ((existingScenes || []).length === (scenes || []).length) {
    return (scenes || []).map((scene, index) => copyRuntime(scene, existingScenes[index]))
  }
  return scenes
}

/**
 * 씬 배열을 CSV 파일로 저장
 * @param {string} csvPath - 저장 경로
 * @param {string[]} headers - 헤더 배열
 * @param {object[]} scenes - 씬 객체 배열
 */
export function saveCSV(csvPath, headers, scenes) {
  const lines = [headers.map(escapeCSVField).join(',')];
  for (const scene of scenes) {
    const row = headers.map(h => escapeCSVField(valueForHeader(scene, h) ?? ''));
    lines.push(row.join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf-8');
}
