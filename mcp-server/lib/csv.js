/**
 * CSV 파싱/직렬화 모듈
 */

import fs from 'fs';

const GENERATION_COLUMN_PATHS = {
  image_provider: ['image', 'provider'],
  image_model: ['image', 'model'],
  t2v_provider: ['video', 't2v', 'provider'],
  t2v_model: ['video', 't2v', 'model'],
  i2v_provider: ['video', 'i2v', 'provider'],
  i2v_model: ['video', 'i2v', 'model'],
}
const GENERATION_INHERIT_SENTINEL = '__inherit__'

function generationFromRow(get) {
  const stage = (providerColumn, modelColumn) => {
    const provider = get(providerColumn)
    const model = get(modelColumn)
    if (provider === GENERATION_INHERIT_SENTINEL) return null
    if (!provider && !model) return undefined
    return { ...(provider ? { provider } : {}), ...(model ? { model } : {}) }
  }
  const image = stage('image_provider', 'image_model')
  const t2v = stage('t2v_provider', 't2v_model')
  const i2v = stage('i2v_provider', 'i2v_model')
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

export function nestSceneGenerationColumns(row = {}) {
  const byLower = new Map(Object.entries(row).map(([key, value]) => [String(key).toLowerCase(), value]))
  const generation = generationFromRow(key => String(byLower.get(key) ?? '').trim())
  return generation === undefined ? row : { ...row, generation }
}

function valueForHeader(scene, header) {
  const path = GENERATION_COLUMN_PATHS[String(header).toLowerCase()]
  if (!path) return scene[header]
  let value = scene.generation
  for (const segment of path) value = value?.[segment]
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
  const parseTime = (raw) => {
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

  for (const r of rows) {
    const get = (k) => (r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()] ?? '').toString().trim()
    const sceneNumStr = (r.scene ?? r.Scene ?? '').toString().trim()
    if (!/^\d+$/.test(sceneNumStr)) continue
    const sceneNum = parseInt(sceneNumStr, 10)

    const startRaw = get('start_time')
    const endRaw = get('end_time')
    const parsedStart = parseTime(startRaw)
    const startTime = !isNaN(parsedStart) ? parsedStart : cursor
    const parsedEnd = parseTime(endRaw)
    const endTime = !isNaN(parsedEnd) ? parsedEnd : startTime + defaultDuration
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
      generation: generationFromRow(get),
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
