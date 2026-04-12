/**
 * CSV 파싱/직렬화 모듈
 */

import fs from 'fs';

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
  // last field
  fields.push(current);
  if (fields.some(f => f.length > 0)) {
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
 * 씬 배열을 CSV 파일로 저장
 * @param {string} csvPath - 저장 경로
 * @param {string[]} headers - 헤더 배열
 * @param {object[]} scenes - 씬 객체 배열
 */
export function saveCSV(csvPath, headers, scenes) {
  const lines = [headers.map(escapeCSVField).join(',')];
  for (const scene of scenes) {
    const row = headers.map(h => escapeCSVField(scene[h] || ''));
    lines.push(row.join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf-8');
}
