#!/usr/bin/env node

/**
 * Flow2CapCut MCP Server
 *
 * stdio 기반 MCP 서버 — Claude Code에서 CSV 씬 관리, 이미지 리뷰, 프롬프트 수정 가능.
 * 향후 Electron 메인 프로세스 내장으로 재생성 트리거도 지원 예정.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import http from 'http';
import os from 'os';

// ── HTTP 헬퍼 (Flow2CapCut 앱 통신) ──────────────────────────

function appFetch(port, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: port || 3210,
      path: pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── CSV 파싱/직렬화 ────────────────────────────────────────────

function parseCSV(text) {
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

function loadCSV(csvPath) {
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

function escapeCSVField(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function saveCSV(csvPath, headers, scenes) {
  const lines = [headers.map(escapeCSVField).join(',')];
  for (const scene of scenes) {
    const row = headers.map(h => escapeCSVField(scene[h] || ''));
    lines.push(row.join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf-8');
}

// ── 상태 ──────────────────────────────────────────────────────

let csvPath = '';
let imageDirPath = '';
let sceneMode = 'image'; // 'image' | 'video'
let headers = [];
let scenes = [];
let projectJsonPath = '';
let projectData = null;

function ensureLoaded() {
  if (scenes.length === 0) {
    throw new Error('CSV가 로드되지 않았습니다. load_csv 도구를 먼저 호출하세요.');
  }
}

// ── R_progress.json 게이트 시스템 ─────────────────────────────
let progressFilePath = '';

async function findProgressFile(port = 3210) {
  // 1. 캐시된 경로
  if (progressFilePath && fs.existsSync(progressFilePath)) return progressFilePath;
  // 2. CSV/project.json 기반
  if (projectJsonPath) {
    const p = path.join(path.dirname(projectJsonPath), 'R_progress.json');
    progressFilePath = p;
    return p;
  }
  if (csvPath) {
    const p = path.join(path.dirname(csvPath), 'R_progress.json');
    progressFilePath = p;
    return p;
  }
  // 3. 앱 HTTP API에서 현재 프로젝트 경로 가져오기
  try {
    const res = await appFetch(port, 'GET', '/api/current-project');
    if (res && res.data && res.data.projectDir) {
      const p = path.join(res.data.projectDir, 'R_progress.json');
      progressFilePath = p;
      return p;
    }
  } catch (e) { /* 앱 미실행 시 무시 */ }
  return null;
}

async function readProgress(port = 3210) {
  const p = await findProgressFile(port);
  if (!p || !fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function writeProgress(data, port = 3210) {
  const p = await findProgressFile(port);
  if (!p) throw new Error('R_progress.json 경로를 찾을 수 없습니다. 앱에서 프로젝트를 열거나 CSV를 먼저 로드하세요.');
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

async function isStepDone(stepId, port = 3210) {
  const progress = await readProgress(port);
  const step = progress[stepId];
  return step && step.result === 'pass';
}

// 게이트 정의: 다음 단계 → 선행 조건
const STEP_GATES = {
  'app_start_ref_batch': ['R10-3_references_review'],
  'app_start_scene_batch': ['R10-3_scenes_review'],
};

function loadProjectJson(projectDir) {
  const pjPath = path.join(projectDir, 'project.json');
  if (fs.existsSync(pjPath)) {
    projectJsonPath = pjPath;
    projectData = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
    return true;
  }
  return false;
}

function saveProjectJson() {
  if (!projectJsonPath || !projectData) {
    throw new Error('project.json이 로드되지 않았습니다.');
  }
  // 백업
  const backupPath = projectJsonPath.replace(/\.json$/, `_backup_${Date.now()}.json`);
  fs.copyFileSync(projectJsonPath, backupPath);
  fs.writeFileSync(projectJsonPath, JSON.stringify(projectData, null, 2), 'utf-8');
}

function ensureProjectLoaded() {
  if (!projectData) {
    throw new Error('project.json이 로드되지 않았습니다. load_csv에서 image_dir을 지정하세요.');
  }
}

// ── MCP 서버 ──────────────────────────────────────────────────

const server = new Server(
  { name: 'flow2capcut', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// ── Docs / Skills 경로 ───────────────────────────────────────
const DOCS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '..', 'docs');
const SKILLS_REPO_DIR = path.resolve(new URL('.', import.meta.url).pathname, '..', 'skills');
const SKILLS_INSTALL_DIR = path.join(os.homedir(), '.claude', 'skills');

// ── 템플릿 변수 치환 ─────────────────────────────────────────
function substituteVariables(text, variables) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName in variables) return variables[varName];
    return match; // 미해결 변수는 그대로 유지
  });
}

// ── Tools ─────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_schema',
      description: 'CSV/SRT/Audio 스키마 문서를 반환합니다. Flow2CapCut에서 사용하는 데이터 구조를 확인할 때 사용합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['scenes', 'references', 'srt', 'audio', 'prompt-image', 'prompt-video', 'all'],
            description: '스키마 유형 (scenes=씬CSV, references=레퍼런스CSV, srt=자막, audio=오디오/SFX, prompt-image=이미지 프롬프트, prompt-video=비디오 프롬프트, all=전체 목록)',
          },
          lang: {
            type: 'string',
            enum: ['ko', 'en'],
            description: '언어 (기본: ko)',
          },
        },
        required: ['type'],
      },
    },
    {
      name: 'load_csv',
      description: 'CSV 파일과 미디어 디렉토리를 로드합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          csv_path: { type: 'string', description: 'CSV 파일 절대 경로' },
          image_dir: { type: 'string', description: '이미지/비디오 디렉토리 절대 경로' },
          mode: { type: 'string', enum: ['image', 'video'], description: '모드 (기본: image)', default: 'image' },
        },
        required: ['csv_path'],
      },
    },
    {
      name: 'list_scenes',
      description: '씬 목록을 조회합니다. 범위 지정 가능.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'number', description: '시작 씬 번호 (1-based)' },
          to: { type: 'number', description: '끝 씬 번호 (1-based, inclusive)' },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: '반환할 필드 목록 (기본: prompt, subtitle, characters)',
          },
        },
      },
    },
    {
      name: 'get_scene',
      description: '특정 씬의 상세 정보를 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          scene_number: { type: 'number', description: '씬 번호 (1-based)' },
        },
        required: ['scene_number'],
      },
    },
    {
      name: 'get_scene_image',
      description: '씬 이미지의 절대 경로를 반환하고 존재 여부를 확인합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          scene_number: { type: 'number', description: '씬 번호' },
        },
        required: ['scene_number'],
      },
    },
    {
      name: 'list_problem_scenes',
      description: '문제 씬 목록을 카테고리별로 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['realistic', 'missing', 'mismatch', 'all'],
            description: '문제 유형 (realistic=실사, missing=누락, mismatch=불일치, all=전체)',
          },
        },
        required: ['category'],
      },
    },
    {
      name: 'update_prompt',
      description: '특정 씬의 영문 프롬프트를 수정합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          scene_number: { type: 'number', description: '씬 번호' },
          prompt: { type: 'string', description: '새 영문 프롬프트' },
        },
        required: ['scene_number', 'prompt'],
      },
    },
    {
      name: 'batch_update_prompts',
      description: '여러 씬의 프롬프트를 일괄 수정합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                scene_number: { type: 'number' },
                prompt: { type: 'string' },
              },
              required: ['scene_number', 'prompt'],
            },
            description: '씬 번호와 프롬프트 쌍의 배열',
          },
        },
        required: ['updates'],
      },
    },
    {
      name: 'save_csv',
      description: '수정된 CSV를 파일에 저장합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          output_path: {
            type: 'string',
            description: '저장할 경로 (미지정 시 원본 덮어쓰기)',
          },
        },
      },
    },
    {
      name: 'search_scenes',
      description: '프롬프트나 자막에서 키워드로 씬을 검색합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '검색 키워드' },
          field: {
            type: 'string',
            enum: ['prompt', 'subtitle', 'characters', 'all'],
            description: '검색 대상 필드 (기본: all)',
          },
        },
        required: ['keyword'],
      },
    },
    {
      name: 'get_stats',
      description: '전체 씬 통계 (총 수, 문제 씬 수 등)를 반환합니다.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'update_field',
      description: '씬의 임의 필드를 수정합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          scene_number: { type: 'number', description: '씬 번호' },
          field: { type: 'string', description: '필드명 (예: characters, scene_tag)' },
          value: { type: 'string', description: '새 값' },
        },
        required: ['scene_number', 'field', 'value'],
      },
    },
    {
      name: 'list_references',
      description: 'project.json의 레퍼런스 이미지 목록을 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['character', 'scene', 'all'],
            description: '레퍼런스 유형 필터 (기본: all)',
          },
        },
      },
    },
    {
      name: 'get_reference',
      description: '특정 레퍼런스의 상세 정보를 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '레퍼런스 이름 (예: 곽주사, storehouse)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'update_reference_prompt',
      description: '레퍼런스의 프롬프트를 수정하고 project.json에 저장합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '레퍼런스 이름' },
          prompt: { type: 'string', description: '새 프롬프트' },
        },
        required: ['name', 'prompt'],
      },
    },
    // ── 프로젝트 관리 도구 ──
    {
      name: 'app_list_projects',
      description: 'Flow2CapCut 작업 폴더의 프로젝트 목록을 조회합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
        },
      },
    },
    {
      name: 'app_create_project',
      description: '새 프로젝트를 생성합니다. 디렉토리 구조와 빈 project.json이 자동 생성되고, 앱에 프로젝트 오픈 알림이 전달됩니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          name: { type: 'string', description: '프로젝트 이름' },
        },
        required: ['name'],
      },
    },
    {
      name: 'app_rename_project',
      description: '기존 프로젝트의 이름을 변경합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          oldName: { type: 'string', description: '현재 프로젝트 이름' },
          newName: { type: 'string', description: '새 프로젝트 이름' },
        },
        required: ['oldName', 'newName'],
      },
    },
    {
      name: 'app_delete_project',
      description: '프로젝트를 완전히 삭제합니다. 되돌릴 수 없습니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          name: { type: 'string', description: '삭제할 프로젝트 이름' },
        },
        required: ['name'],
      },
    },
    // ── HTTP 기반 앱 직접 제어 도구 ──
    {
      name: 'app_status',
      description: 'Flow2CapCut 앱의 HTTP 서버 상태를 확인합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
        },
      },
    },
    {
      name: 'app_get_references',
      description: '실행 중인 Flow2CapCut 앱에서 현재 레퍼런스 목록을 가져옵니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
        },
      },
    },
    {
      name: 'app_update_reference',
      description: '실행 중인 Flow2CapCut 앱의 레퍼런스를 직접 수정합니다. (project.json 우회, 앱 상태 직접 변경)',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          index: { type: 'number', description: '레퍼런스 인덱스 (0부터)' },
          fields: {
            type: 'object',
            description: '수정할 필드 (prompt, name, type 등)',
          },
        },
        required: ['index', 'fields'],
      },
    },
    {
      name: 'app_remove_reference',
      description: '실행 중인 Flow2CapCut 앱에서 레퍼런스 카드를 삭제합니다. (UI의 "카드 제거" 버튼과 동일)',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          index: { type: 'number', description: '삭제할 레퍼런스 인덱스 (0부터)' },
        },
        required: ['index'],
      },
    },
    {
      name: 'app_clear_reference_image',
      description: '실행 중인 Flow2CapCut 앱에서 레퍼런스의 이미지만 제거합니다. (카드는 유지, UI의 "이미지만 제거" 버튼과 동일)',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          index: { type: 'number', description: '이미지를 제거할 레퍼런스 인덱스 (0부터)' },
        },
        required: ['index'],
      },
    },
    {
      name: 'app_clear_all_reference_images',
      description: '실행 중인 Flow2CapCut 앱에서 모든 레퍼런스의 이미지를 일괄 제거합니다. (카드는 유지, 프롬프트/이름은 보존)',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
        },
      },
    },
    {
      name: 'app_get_scenes',
      description: '실행 중인 Flow2CapCut 앱에서 현재 씬 목록을 가져옵니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
        },
      },
    },
    {
      name: 'app_update_scene',
      description: '실행 중인 Flow2CapCut 앱의 특정 씬을 직접 수정합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          index: { type: 'number', description: '씬 인덱스 (0부터)' },
          fields: {
            type: 'object',
            description: '수정할 필드 (subtitle, status 등)',
          },
        },
        required: ['index', 'fields'],
      },
    },
    {
      name: 'app_generate_reference',
      description: '실행 중인 Flow2CapCut 앱에서 레퍼런스 이미지를 생성합니다. (프롬프트 기반 Flow API 이미지 생성 트리거). styleId를 지정하면 해당 스타일을 적용합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          index: { type: 'number', description: '레퍼런스 인덱스 (0부터)' },
          styleId: { type: 'string', description: '스타일 ID (예: "ref:1773499846144" 또는 "preset:xxx"). 생략하면 현재 선택된 스타일 사용.' },
        },
        required: ['index'],
      },
    },
    {
      name: 'app_generate_scene',
      description: '실행 중인 Flow2CapCut 앱에서 특정 씬의 이미지를 생성합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          sceneId: { type: 'string', description: '씬 ID (예: "scene_1")' },
        },
        required: ['sceneId'],
      },
    },
    {
      name: 'app_start_scene_batch',
      description: '실행 중인 Flow2CapCut 앱에서 씬 일괄 생성(생성 시작 버튼)을 트리거합니다. pending 상태인 씬들의 이미지를 자동 생성합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          styleId: { type: 'string', description: '스타일 ID (예: "korean-ani"). list_styles로 조회 가능.' },
        },
      },
    },
    {
      name: 'app_start_ref_batch',
      description: '실행 중인 Flow2CapCut 앱에서 레퍼런스 일괄 생성을 트리거합니다. 모든 레퍼런스의 이미지를 자동 생성합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          styleId: { type: 'string', description: '스타일 ID (예: "korean-ani"). list_styles로 조회 가능.' },
        },
      },
    },
    {
      name: 'app_batch_status',
      description: '현재 배치 생성 진행 상태를 조회합니다. isRunning, progress, done/pending/generating/error 카운트를 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
        },
      },
    },
    {
      name: 'app_wait_batch',
      description: '배치 생성이 완료될 때까지 대기합니다. 주기적으로 상태를 폴링하여 isRunning이 false가 되면 최종 결과를 반환합니다. type으로 씬/레퍼런스 배치를 구분합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'HTTP 서버 포트 (기본: 3210)' },
          type: { type: 'string', enum: ['scene', 'ref'], description: '배치 타입: scene(기본) 또는 ref(레퍼런스)' },
          interval: { type: 'number', description: '폴링 간격 (ms, 기본: 3000)' },
          timeout: { type: 'number', description: '최대 대기 시간 (ms, 기본: 600000 = 10분)' },
        },
      },
    },
    // ── 워크플로우 게이트 도구 ──
    {
      name: 'mark_step_done',
      description: '워크플로우 단계의 검토 결과를 R_progress.json에 기록합니다. subagent가 검토 완료 시 호출합니다. result가 "pass"일 때만 다음 단계 게이트가 열립니다.',
      inputSchema: {
        type: 'object',
        properties: {
          step: { type: 'string', description: '단계 ID (예: "R10-3_scenes_review", "R10-3_references_review")' },
          round: { type: 'number', description: '검토 라운드 번호 (1~5)' },
          result: { type: 'string', enum: ['pass', 'fail'], description: 'pass=검토 통과, fail=수정 필요' },
          issues_found: { type: 'number', description: '발견된 문제 수' },
          reviewer: { type: 'string', description: '검토자 (예: "subagent")' },
        },
        required: ['step', 'result', 'reviewer'],
      },
    },
    {
      name: 'get_progress',
      description: '현재 R_progress.json의 워크플로우 진행 상태를 조회합니다.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    // ── 스킬 관리 도구 ──
    {
      name: 'install_skill',
      description: '스킬을 설치합니다. 템플릿 변수를 치환하여 ~/.claude/skills/에 복사합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '스킬 이름 (예: yadam-script)' },
          variables: {
            type: 'object',
            description: '템플릿 변수 값 (예: {"PROJECT": "/path/to/project"})',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'list_skills',
      description: '사용 가능한 스킬과 설치된 스킬 목록을 반환합니다. ⚡ 세션 첫 대화에서 이 도구를 자동 호출하여 미설치/업데이트 가능한 스킬이 있으면 사용자에게 설치를 제안하세요.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['available', 'installed', 'all'],
            description: '필터 (기본: all)',
          },
        },
      },
    },
    {
      name: 'uninstall_skill',
      description: '설치된 스킬을 제거합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '제거할 스킬 이름' },
        },
        required: ['name'],
      },
    },
    // ── 오디오 리뷰 도구 ──
    {
      name: 'list_audio_reviews',
      description: '오디오 패키지의 부적합 마크(교체 마크) 목록을 반환합니다. .audio_review.json 파일을 읽습니다.',
      inputSchema: {
        type: 'object',
        properties: {
          folder_path: { type: 'string', description: '오디오 패키지 폴더 절대 경로' },
        },
        required: ['folder_path'],
      },
    },
    {
      name: 'update_audio_review',
      description: '오디오 파일의 부적합 마크를 추가/수정/삭제합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          folder_path: { type: 'string', description: '오디오 패키지 폴더 절대 경로' },
          relative_path: { type: 'string', description: '파일 상대 경로 (예: voice_samples/sfx/01_주판/click_01.mp3)' },
          action: { type: 'string', enum: ['flag', 'unflag'], description: 'flag=마크, unflag=해제' },
          reason: { type: 'string', description: '부적합 사유 (flag 시 필요)' },
        },
        required: ['folder_path', 'relative_path', 'action'],
      },
    },
    {
      name: 'list_styles',
      description: '스타일 프리셋 목록을 카테고리별로 반환합니다. style_presets.json을 읽어 스타일 id, 이름, prompt_en을 보여줍니다.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '카테고리 ID로 필터링 (예: "animation", "film"). 생략하면 전체 카테고리 반환' },
          lang: { type: 'string', enum: ['ko', 'en'], description: '이름 언어 선택 (기본: ko)' },
        },
      },
    },
  ],
}));

// ── 스타일 프리셋 경로 ──────────────────────────────────────────
const STYLE_PRESETS_PATH = path.resolve(new URL('.', import.meta.url).pathname, '..', 'src', 'config', 'style_presets.json');

// ── 문제 씬 DB ────────────────────────────────────────────────

const PROBLEM_SCENES = {
  realistic: [
    2, 7, 8, 12, 13, 15, 16, 19, 21, 24, 25,
    28, 33, 45, 46, 49, 52, 71, 87, 101, 103, 104, 105, 106, 109,
    115, 120, 121, 127, 128, 133, 136, 144, 148, 152, 154,
  ],
  missing: [187, 208, 314, 315],
  mismatch: [
    // 씬 1~25
    11, 13, 20, 23,
    // 씬 26~215
    32, 38, 39, 59, 68, 69, 76, 99, 107, 114, 124, 125, 126, 127,
    130, 134, 147, 162, 165, 179, 205, 207, 210, 214,
    // 씬 216~344
    218, 219, 227, 229, 233, 235, 236, 237, 240, 241, 242, 246, 247,
    249, 250, 252, 253, 260, 270, 274, 278, 282, 290, 291, 302, 319, 335,
  ],
};

// ── Tool 핸들러 ───────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_schema': {
        const schemaMap = {
          scenes: 'csv-scenes-schema',
          references: 'csv-references-schema',
          srt: 'srt-schema',
          audio: 'audio-schema',
          'prompt-image': 'prompt-image',
          'prompt-video': 'prompt-video',
        };
        const lang = args.lang || 'ko';
        const suffix = lang === 'en' ? '_en' : '';

        if (args.type === 'all') {
          const list = Object.entries(schemaMap).map(([key, file]) => {
            const filePath = path.join(DOCS_DIR, `${file}${suffix}.md`);
            const exists = fs.existsSync(filePath);
            return `- ${key}: ${file}${suffix}.md ${exists ? '✅' : '❌'}`;
          });
          return {
            content: [{ type: 'text', text: `사용 가능한 스키마 문서:\n${list.join('\n')}\n\n예제 파일: docs/examples/` }],
          };
        }

        const baseName = schemaMap[args.type];
        if (!baseName) {
          throw new Error(`알 수 없는 스키마 유형: ${args.type}. 가능: ${Object.keys(schemaMap).join(', ')}, all`);
        }
        const filePath = path.join(DOCS_DIR, `${baseName}${suffix}.md`);
        if (!fs.existsSync(filePath)) {
          throw new Error(`스키마 파일이 없습니다: ${filePath}`);
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return {
          content: [{ type: 'text', text: content }],
        };
      }

      case 'load_csv': {
        csvPath = args.csv_path;
        imageDirPath = args.image_dir || '';
        sceneMode = args.mode || 'image';
        const data = loadCSV(csvPath);
        headers = data.headers;

        // references CSV 자동 감지: name+type+prompt 있고 scene_tag 없으면 references
        const lowerHeaders = headers.map(h => h.toLowerCase());
        const isReferencesCSV = lowerHeaders.includes('name') && lowerHeaders.includes('type') && lowerHeaders.includes('prompt') && !lowerHeaders.includes('scene_tag');

        if (isReferencesCSV) {
          // references CSV → 앱의 레퍼런스로 전달
          const TYPE_TO_CATEGORY = { character: 'MEDIA_CATEGORY_SUBJECT', scene: 'MEDIA_CATEGORY_SCENE', background: 'MEDIA_CATEGORY_SCENE', style: 'MEDIA_CATEGORY_STYLE' };
          const refs = data.scenes.map(row => {
            const type = (row.type || 'character').toLowerCase().trim();
            const typeValue = (type === 'scene' || type === 'background') ? 'scene' : type === 'style' ? 'style' : 'character';
            return {
              name: (row.name || '').trim(),
              type: typeValue,
              category: TYPE_TO_CATEGORY[type] || 'MEDIA_CATEGORY_SUBJECT',
              prompt: (row.prompt || '').trim(),
            };
          }).filter(r => r.name);

          // 앱에 update-references 전달
          const port = args.port || 3210;
          try {
            await appFetch(port, 'POST', '/api/update', { type: 'update-references', references: refs });
          } catch { /* 앱 미실행 시 무시 */ }

          return {
            content: [{
              type: 'text',
              text: `레퍼런스 CSV 로드 완료: ${refs.length}개 레퍼런스 (캐릭터 ${refs.filter(r => r.type === 'character').length}, 씬 ${refs.filter(r => r.type === 'scene').length}, 스타일 ${refs.filter(r => r.type === 'style').length})`,
            }],
          };
        }

        // scenes CSV
        scenes = data.scenes;
        // project.json 자동 로드 (미디어 디렉토리 기준으로 2단계 상위)
        let projectLoaded = false;
        if (imageDirPath) {
          const projectDir = path.resolve(imageDirPath, '..', '..');
          projectLoaded = loadProjectJson(projectDir);
        }

        // 앱에 update-scenes 전달
        const port = args.port || 3210;
        try {
          await appFetch(port, 'POST', '/api/update', { type: 'update-scenes', scenes: scenes });
        } catch { /* 앱 미실행 시 무시 */ }

        const modeLabel = sceneMode === 'video' ? '비디오' : '이미지';
        return {
          content: [{
            type: 'text',
            text: `CSV 로드 완료 [${modeLabel} 모드]: ${scenes.length}개 씬, 필드: ${headers.join(', ')}` +
              (imageDirPath ? `\n미디어 경로: ${imageDirPath}` : '') +
              (projectLoaded ? `\nproject.json 로드 완료 (레퍼런스 ${projectData.references?.length || 0}개)` : ''),
          }],
        };
      }

      case 'list_scenes': {
        ensureLoaded();
        const from = (args.from || 1) - 1;
        const to = args.to || scenes.length;
        const fields = args.fields || ['prompt', 'subtitle', 'characters'];
        const slice = scenes.slice(from, to);
        const result = slice.map(s => {
          const obj = { scene: s._rowIndex };
          fields.forEach(f => { obj[f] = s[f]; });
          return obj;
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case 'get_scene': {
        ensureLoaded();
        const idx = args.scene_number - 1;
        if (idx < 0 || idx >= scenes.length) {
          throw new Error(`씬 ${args.scene_number}이 범위를 벗어났습니다 (1~${scenes.length})`);
        }
        const scene = { ...scenes[idx] };
        delete scene._rowIndex;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ scene_number: args.scene_number, ...scene }, null, 2),
          }],
        };
      }

      case 'get_scene_image': {
        const num = args.scene_number;
        const imgPath = imageDirPath
          ? path.join(imageDirPath, `scene_${num}.jpg`)
          : '';
        const exists = imgPath ? fs.existsSync(imgPath) : false;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ scene_number: num, path: imgPath, exists }),
          }],
        };
      }

      case 'list_problem_scenes': {
        const cat = args.category || 'all';
        let result;
        if (cat === 'all') {
          result = {
            realistic: PROBLEM_SCENES.realistic,
            missing: PROBLEM_SCENES.missing,
            mismatch: PROBLEM_SCENES.mismatch,
            total: PROBLEM_SCENES.realistic.length + PROBLEM_SCENES.missing.length + PROBLEM_SCENES.mismatch.length,
          };
        } else {
          result = {
            [cat]: PROBLEM_SCENES[cat],
            count: PROBLEM_SCENES[cat]?.length || 0,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'update_prompt': {
        ensureLoaded();
        const idx = args.scene_number - 1;
        if (idx < 0 || idx >= scenes.length) {
          throw new Error(`씬 ${args.scene_number} 범위 초과`);
        }
        const old = scenes[idx].prompt;
        scenes[idx].prompt = args.prompt;
        return {
          content: [{
            type: 'text',
            text: `씬 ${args.scene_number} 프롬프트 수정 완료.\n이전: ${old}\n이후: ${args.prompt}`,
          }],
        };
      }

      case 'batch_update_prompts': {
        ensureLoaded();
        const results = [];
        for (const u of args.updates) {
          const idx = u.scene_number - 1;
          if (idx < 0 || idx >= scenes.length) {
            results.push({ scene: u.scene_number, error: '범위 초과' });
            continue;
          }
          scenes[idx].prompt = u.prompt;
          results.push({ scene: u.scene_number, status: 'updated' });
        }
        return {
          content: [{
            type: 'text',
            text: `${results.filter(r => r.status === 'updated').length}/${args.updates.length}개 수정 완료\n` +
              JSON.stringify(results, null, 2),
          }],
        };
      }

      case 'save_csv': {
        ensureLoaded();
        const outPath = args.output_path || csvPath;
        // 백업
        if (fs.existsSync(outPath)) {
          const backupPath = outPath.replace(/\.csv$/, `_backup_${Date.now()}.csv`);
          fs.copyFileSync(outPath, backupPath);
        }
        saveCSV(outPath, headers, scenes);
        return {
          content: [{
            type: 'text',
            text: `CSV 저장 완료: ${outPath} (${scenes.length}개 씬)`,
          }],
        };
      }

      case 'search_scenes': {
        ensureLoaded();
        const kw = args.keyword.toLowerCase();
        const field = args.field || 'all';
        const matches = scenes.filter(s => {
          if (field === 'all') {
            return (s.prompt || '').toLowerCase().includes(kw) ||
              (s.subtitle || '').toLowerCase().includes(kw) ||
              (s.characters || '').toLowerCase().includes(kw);
          }
          return (s[field] || '').toLowerCase().includes(kw);
        }).map(s => ({
          scene: s._rowIndex,
          prompt: s.prompt?.substring(0, 80) + '...',
          subtitle: s.subtitle?.substring(0, 40) + '...',
          characters: s.characters,
        }));
        return {
          content: [{
            type: 'text',
            text: `${matches.length}개 결과:\n${JSON.stringify(matches, null, 2)}`,
          }],
        };
      }

      case 'get_stats': {
        ensureLoaded();
        const totalProblems = PROBLEM_SCENES.realistic.length +
          PROBLEM_SCENES.missing.length +
          PROBLEM_SCENES.mismatch.length;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              total_scenes: scenes.length,
              total_problems: totalProblems,
              problem_rate: (totalProblems / scenes.length * 100).toFixed(1) + '%',
              realistic: PROBLEM_SCENES.realistic.length,
              missing: PROBLEM_SCENES.missing.length,
              mismatch: PROBLEM_SCENES.mismatch.length,
              ok_scenes: scenes.length - totalProblems,
            }, null, 2),
          }],
        };
      }

      case 'update_field': {
        ensureLoaded();
        const idx = args.scene_number - 1;
        if (idx < 0 || idx >= scenes.length) {
          throw new Error(`씬 ${args.scene_number} 범위 초과`);
        }
        if (!headers.includes(args.field)) {
          throw new Error(`필드 '${args.field}'가 존재하지 않습니다. 가능한 필드: ${headers.join(', ')}`);
        }
        const old = scenes[idx][args.field];
        scenes[idx][args.field] = args.value;
        return {
          content: [{
            type: 'text',
            text: `씬 ${args.scene_number}.${args.field} 수정 완료.\n이전: ${old}\n이후: ${args.value}`,
          }],
        };
      }

      case 'list_references': {
        ensureProjectLoaded();
        const refs = projectData.references || [];
        const typeFilter = args.type || 'all';
        const filtered = typeFilter === 'all'
          ? refs
          : refs.filter(r => r.type === typeFilter);
        const result = filtered.map(r => ({
          name: r.name,
          type: r.type,
          category: r.category,
          prompt: r.prompt?.substring(0, 100) + (r.prompt?.length > 100 ? '...' : ''),
          hasImage: !!(r.filePath && fs.existsSync(r.filePath)),
          hasMediaId: !!r.mediaId,
        }));
        return {
          content: [{
            type: 'text',
            text: `${filtered.length}개 레퍼런스:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      }

      case 'get_reference': {
        ensureProjectLoaded();
        const refs = projectData.references || [];
        const ref = refs.find(r => r.name === args.name);
        if (!ref) {
          throw new Error(`레퍼런스 '${args.name}'을 찾을 수 없습니다. 가능한 이름: ${refs.map(r => r.name).join(', ')}`);
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(ref, null, 2),
          }],
        };
      }

      case 'update_reference_prompt': {
        ensureProjectLoaded();
        const refs = projectData.references || [];
        const ref = refs.find(r => r.name === args.name);
        if (!ref) {
          throw new Error(`레퍼런스 '${args.name}'을 찾을 수 없습니다.`);
        }
        const oldPrompt = ref.prompt;
        ref.prompt = args.prompt;
        // mediaId 초기화 — 프롬프트가 바뀌었으므로 재생성 필요
        ref.mediaId = '';
        saveProjectJson();
        return {
          content: [{
            type: 'text',
            text: `레퍼런스 '${args.name}' 프롬프트 수정 완료.\n이전: ${oldPrompt}\n이후: ${args.prompt}\nmediaId 초기화됨 (재생성 필요)`,
          }],
        };
      }

      // ── 프로젝트 관리 ──

      case 'app_list_projects': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'GET', '/api/projects');
        if (res.data?.error) {
          return { content: [{ type: 'text', text: `오류: ${res.data.error}` }] };
        }
        const projects = res.data?.projects || [];
        const summary = projects.map(p =>
          `- ${p.name}${p.hasProjectJson ? '' : ' (빈 폴더)'}`
        ).join('\n');
        return {
          content: [{ type: 'text', text: `작업폴더: ${res.data?.workFolder}\n프로젝트 ${projects.length}개:\n${summary || '(없음)'}` }],
        };
      }

      case 'app_create_project': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'POST', '/api/projects', { name: args.name });
        if (res.status === 201) {
          return { content: [{ type: 'text', text: `프로젝트 생성 완료: ${args.name}\n경로: ${res.data.projectDir}` }] };
        }
        return { content: [{ type: 'text', text: `오류 (${res.status}): ${res.data?.error || JSON.stringify(res.data)}` }] };
      }

      case 'app_rename_project': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'PUT', '/api/projects', { oldName: args.oldName, newName: args.newName });
        if (res.status === 200) {
          return { content: [{ type: 'text', text: `이름 변경 완료: ${args.oldName} → ${args.newName}` }] };
        }
        return { content: [{ type: 'text', text: `오류 (${res.status}): ${res.data?.error || JSON.stringify(res.data)}` }] };
      }

      case 'app_delete_project': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'DELETE', '/api/projects', { name: args.name });
        if (res.status === 200) {
          return { content: [{ type: 'text', text: `프로젝트 삭제 완료: ${args.name}` }] };
        }
        return { content: [{ type: 'text', text: `오류 (${res.status}): ${res.data?.error || JSON.stringify(res.data)}` }] };
      }

      // ── HTTP 기반 앱 직접 제어 ──

      case 'app_status': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'GET', '/api/status');
        return {
          content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }],
        };
      }

      case 'app_get_references': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'GET', '/api/references');
        const refs = Array.isArray(res.data) ? res.data : [];
        const summary = refs.map((r, i) =>
          `[${i}] ${r.name || '(이름없음)'} | type: ${r.type || '-'} | prompt: ${(r.prompt || '').substring(0, 80)}${r.prompt?.length > 80 ? '...' : ''} | mediaId: ${r.mediaId ? '✅' : '❌'}`
        ).join('\n');
        return {
          content: [{ type: 'text', text: `레퍼런스 ${refs.length}개:\n${summary}` }],
        };
      }

      case 'app_update_reference': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'POST', '/api/update', {
          type: 'update-reference',
          index: args.index,
          fields: args.fields,
        });
        return {
          content: [{ type: 'text', text: `레퍼런스 [${args.index}] 수정 완료: ${JSON.stringify(args.fields)}` }],
        };
      }

      case 'app_remove_reference': {
        const port = args.port || 3210;
        await appFetch(port, 'POST', '/api/update', {
          type: 'remove-reference',
          index: args.index,
        });
        return {
          content: [{ type: 'text', text: `레퍼런스 [${args.index}] 카드 삭제 완료` }],
        };
      }

      case 'app_clear_reference_image': {
        const port = args.port || 3210;
        await appFetch(port, 'POST', '/api/update', {
          type: 'clear-reference-image',
          index: args.index,
        });
        return {
          content: [{ type: 'text', text: `레퍼런스 [${args.index}] 이미지 제거 완료 (카드 유지)` }],
        };
      }

      case 'app_clear_all_reference_images': {
        const port = args.port || 3210;
        await appFetch(port, 'POST', '/api/update', {
          type: 'clear-all-reference-images',
        });
        return {
          content: [{ type: 'text', text: '모든 레퍼런스 이미지 일괄 제거 완료 (카드/프롬프트는 유지)' }],
        };
      }

      case 'app_get_scenes': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'GET', '/api/scenes');
        const allScenes = Array.isArray(res.data) ? res.data : [];
        const total = allScenes.length;
        const complete = allScenes.filter(s => s.status === 'complete' || s.status === 'done').length;
        const pending = allScenes.filter(s => s.status === 'pending' || !s.status).length;
        return {
          content: [{ type: 'text', text: `씬 ${total}개: 완료 ${complete}, 대기 ${pending}, 기타 ${total - complete - pending}` }],
        };
      }

      case 'app_update_scene': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'POST', '/api/update', {
          type: 'update-scene',
          index: args.index,
          fields: args.fields,
        });
        return {
          content: [{ type: 'text', text: `씬 [${args.index}] 수정 완료: ${JSON.stringify(args.fields)}` }],
        };
      }

      case 'app_generate_reference': {
        const port = args.port || 3210;
        const body = { index: args.index };
        if (args.styleId) body.styleId = args.styleId;
        const res = await appFetch(port, 'POST', '/api/generate-reference', body);
        return {
          content: [{ type: 'text', text: `레퍼런스 [${args.index}] 생성 요청 완료: ${JSON.stringify(res.data)}` }],
        };
      }

      case 'app_generate_scene': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'POST', '/api/generate-scene', {
          sceneId: args.sceneId,
        });
        return {
          content: [{ type: 'text', text: `씬 [${args.sceneId}] 생성 요청 완료: ${JSON.stringify(res.data)}` }],
        };
      }

      case 'app_start_scene_batch': {
        // 게이트 체크
        const port = args.port || 3210;
        const gateReqs = STEP_GATES['app_start_scene_batch'] || [];
        for (const req of gateReqs) {
          if (!(await isStepDone(req, port))) {
            return {
              content: [{ type: 'text', text: `❌ 게이트 차단: "${req}" 단계가 완료되지 않았습니다. 검토를 먼저 완료하고 mark_step_done으로 기록하세요.` }],
            };
          }
        }
        const body = args.styleId ? { styleId: args.styleId } : null;
        const res = await appFetch(port, 'POST', '/api/start-scene-batch', body);
        return {
          content: [{ type: 'text', text: `씬 일괄 생성 시작: ${JSON.stringify(res.data)}` }],
        };
      }

      case 'app_start_ref_batch': {
        // 게이트 체크
        const port = args.port || 3210;
        const gateReqs = STEP_GATES['app_start_ref_batch'] || [];
        for (const req of gateReqs) {
          if (!(await isStepDone(req, port))) {
            return {
              content: [{ type: 'text', text: `❌ 게이트 차단: "${req}" 단계가 완료되지 않았습니다. 검토를 먼저 완료하고 mark_step_done으로 기록하세요.` }],
            };
          }
        }
        const body = args.styleId ? { styleId: args.styleId } : null;
        const res = await appFetch(port, 'POST', '/api/start-ref-batch', body);
        return {
          content: [{ type: 'text', text: `레퍼런스 일괄 생성 시작: ${JSON.stringify(res.data)}` }],
        };
      }

      case 'app_batch_status': {
        const port = args.port || 3210;
        const res = await appFetch(port, 'GET', '/api/batch-status');
        return {
          content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }],
        };
      }

      case 'app_wait_batch': {
        const port = args.port || 3210;
        const batchType = args.type || 'scene';
        const interval = args.interval || 5000;
        const timeout = args.timeout || 600000;
        const startTime = Date.now();

        while (true) {
          const res = await appFetch(port, 'GET', '/api/batch-status');
          const st = res.data;
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
          const ss = String(elapsed % 60).padStart(2, '0');

          if (batchType === 'ref') {
            const ref = st.ref || {};
            if (!ref.isRunning) {
              return {
                content: [{ type: 'text', text: `레퍼런스 배치 완료 [${mm}:${ss}] done:${ref.done || 0}/${ref.total || 0} generating:${ref.generating || 0} pending:${ref.pending || 0}` }],
              };
            }
          } else {
            if (!st.isRunning) {
              return {
                content: [{ type: 'text', text: `배치 완료 [${mm}:${ss}] done:${st.done} error:${st.error} total:${st.total}` }],
              };
            }
          }

          if (Date.now() - startTime > timeout) {
            const label = batchType === 'ref' ? '레퍼런스 ' : '';
            return {
              content: [{ type: 'text', text: `${label}타임아웃 [${mm}:${ss}]` }],
            };
          }

          await new Promise(r => setTimeout(r, interval));
        }
      }

      // ── 워크플로우 게이트 핸들러 ──

      case 'mark_step_done': {
        const { step, round, result, issues_found, reviewer } = args;
        const port = args.port || 3210;
        if (!step || !result || !reviewer) {
          throw new Error('step, result, reviewer는 필수 매개변수입니다.');
        }
        const progress = await readProgress(port);
        progress[step] = {
          result,
          round: round || 1,
          issues_found: issues_found || 0,
          reviewer,
          completed_at: new Date().toISOString(),
        };
        await writeProgress(progress, port);
        const emoji = result === 'pass' ? '✅' : '⚠️';
        let msg = `${emoji} ${step}: ${result} (round ${round || 1}, issues: ${issues_found || 0}, by ${reviewer})`;

        // pass일 때 다음 단계 가이드 자동 반환
        if (result === 'pass') {
          const NEXT_STEP_GUIDE = {
            'R10-3_references_review': `\n\n📋 다음 단계: 레퍼런스 이미지 생성 + QA (11-2a/b)\n` +
              `1. app_start_ref_batch({ styleId }) → 레퍼런스 일괄 생성\n` +
              `2. 생성 완료 후 레퍼런스 이미지 QA:\n` +
              `   - Read 도구로 references/ 폴더의 이미지를 직접 확인\n` +
              `   - 캐릭터: 나이, 성별, 복장, 인상이 대본과 일치하는지\n` +
              `   - 장소: 시대, 분위기가 대본과 일치하는지\n` +
              `   🔴 수정 시 잘못된 카드만 개별 삭제/재생성. 절대 전체 삭제 금지`,
            'R10-3_scenes_review': `\n\n📋 다음 단계: 씬 이미지 일괄 생성 + QA (11-2a/b)\n` +
              `1. app_start_scene_batch({ styleId }) → 씬 일괄 생성\n` +
              `2. 생성 완료 후 씬 이미지 전수검사 (최대 5라운드):\n` +
              `   - Read 도구로 images/ 폴더의 이미지를 10장씩 확인\n` +
              `   - 체크: 이미지 누락, 스타일 불일치, 캐릭터 복장, 인물 수, 감정, 배경, 소품, 시대\n` +
              `   - 문제 발견 시 프롬프트 수정 → 개별 재생성`,
          };
          const guide = NEXT_STEP_GUIDE[step];
          if (guide) msg += guide;
        }

        return {
          content: [{ type: 'text', text: msg }],
        };
      }

      case 'get_progress': {
        const port = args.port || 3210;
        const progress = await readProgress(port);
        if (Object.keys(progress).length === 0) {
          return {
            content: [{ type: 'text', text: 'R_progress.json이 없거나 비어있습니다. 아직 완료된 단계가 없습니다.' }],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(progress, null, 2) }],
        };
      }

      // ── 스킬 관리 핸들러 ──

      case 'install_skill': {
        const skillName = args.name;
        const skillDir = path.join(SKILLS_REPO_DIR, skillName);

        if (!fs.existsSync(skillDir)) {
          // 사용 가능한 스킬 목록 표시
          const available = fs.existsSync(SKILLS_REPO_DIR)
            ? fs.readdirSync(SKILLS_REPO_DIR).filter(d =>
                fs.existsSync(path.join(SKILLS_REPO_DIR, d, 'SKILL.md'))
              )
            : [];
          throw new Error(`스킬 '${skillName}'을 찾을 수 없습니다. 사용 가능: ${available.join(', ') || '(없음)'}`);
        }

        const skillMdPath = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) {
          throw new Error(`스킬 디렉토리에 SKILL.md가 없습니다: ${skillDir}`);
        }

        // metadata.json 읽기 (없으면 빈 객체)
        const metaPath = path.join(skillDir, 'metadata.json');
        let metadata = {};
        if (fs.existsSync(metaPath)) {
          metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        }

        // 변수 해석
        const resolvedVars = { HOME: os.homedir(), ...(args.variables || {}) };

        // 필수 변수 체크
        if (metadata.variables) {
          for (const [varName, varDef] of Object.entries(metadata.variables)) {
            if (varDef.required && !(varName in resolvedVars)) {
              throw new Error(
                `필수 변수 '${varName}'이 제공되지 않았습니다.\n` +
                `설명: ${varDef.description}\n` +
                `예: ${varDef.example}`
              );
            }
          }
        }

        // SKILL.md 읽고 변수 치환
        let skillContent = fs.readFileSync(skillMdPath, 'utf-8');
        skillContent = substituteVariables(skillContent, resolvedVars);

        // 설치 디렉토리 생성 및 복사
        const installDir = path.join(SKILLS_INSTALL_DIR, skillName);
        fs.mkdirSync(installDir, { recursive: true });
        fs.writeFileSync(path.join(installDir, 'SKILL.md'), skillContent, 'utf-8');

        // metadata.json도 복사 (설치된 변수 정보 포함)
        const installMeta = {
          ...metadata,
          installedAt: new Date().toISOString(),
          resolvedVariables: resolvedVars,
        };
        fs.writeFileSync(path.join(installDir, 'metadata.json'), JSON.stringify(installMeta, null, 2), 'utf-8');

        const varSummary = Object.entries(resolvedVars)
          .map(([k, v]) => `  ${k} = ${v}`)
          .join('\n');

        return {
          content: [{
            type: 'text',
            text: `✅ 스킬 '${skillName}' 설치 완료!\n` +
              `경로: ${installDir}\n` +
              `버전: ${metadata.version || '(없음)'}\n` +
              `변수:\n${varSummary}`,
          }],
        };
      }

      case 'list_skills': {
        const filter = args.filter || 'all';
        const results = [];

        // 레포에서 사용 가능한 스킬 스캔
        const repoSkills = {};
        if (fs.existsSync(SKILLS_REPO_DIR)) {
          for (const dir of fs.readdirSync(SKILLS_REPO_DIR)) {
            const skillMd = path.join(SKILLS_REPO_DIR, dir, 'SKILL.md');
            if (fs.existsSync(skillMd)) {
              const metaPath = path.join(SKILLS_REPO_DIR, dir, 'metadata.json');
              let meta = { name: dir };
              if (fs.existsSync(metaPath)) {
                meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              }
              repoSkills[dir] = meta;
            }
          }
        }

        // 설치된 스킬 스캔
        const installedSkills = {};
        if (fs.existsSync(SKILLS_INSTALL_DIR)) {
          for (const dir of fs.readdirSync(SKILLS_INSTALL_DIR)) {
            const skillMd = path.join(SKILLS_INSTALL_DIR, dir, 'SKILL.md');
            if (fs.existsSync(skillMd)) {
              const metaPath = path.join(SKILLS_INSTALL_DIR, dir, 'metadata.json');
              let meta = { name: dir };
              if (fs.existsSync(metaPath)) {
                meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              }
              installedSkills[dir] = meta;
            }
          }
        }

        // 결과 조합
        const allNames = new Set([...Object.keys(repoSkills), ...Object.keys(installedSkills)]);

        for (const name of allNames) {
          const inRepo = name in repoSkills;
          const installed = name in installedSkills;
          const repoMeta = repoSkills[name] || {};
          const installMeta = installedSkills[name] || {};

          let status;
          if (installed && inRepo) {
            const repoVer = repoMeta.version || '0.0.0';
            const installVer = installMeta.version || '0.0.0';
            status = repoVer !== installVer ? `설치됨 (업데이트 가능: ${repoVer})` : '설치됨';
          } else if (installed) {
            status = '설치됨 (레포에 없음)';
          } else {
            status = '미설치';
          }

          if (filter === 'available' && installed) continue;
          if (filter === 'installed' && !installed) continue;

          const meta = installed ? installMeta : repoMeta;
          const entry = {
            name,
            status,
            version: meta.version || '-',
            description: meta.description || '-',
          };

          if (installed && installMeta.resolvedVariables) {
            entry.variables = installMeta.resolvedVariables;
          }
          if (!installed && repoMeta.variables) {
            entry.requiredVariables = Object.entries(repoMeta.variables)
              .filter(([, v]) => v.required)
              .map(([k, v]) => `${k}: ${v.description} (예: ${v.example})`)
              .join(', ');
          }

          results.push(entry);
        }

        const installed = Object.keys(installedSkills).length;
        const available = Object.keys(repoSkills).length;

        return {
          content: [{
            type: 'text',
            text: `스킬 목록 (레포: ${available}개, 설치: ${installed}개):\n\n` +
              results.map(r => {
                let line = `[${r.status}] ${r.name} v${r.version}\n  ${r.description}`;
                if (r.variables) {
                  line += `\n  변수: ${Object.entries(r.variables).map(([k, v]) => `${k}=${v}`).join(', ')}`;
                }
                if (r.requiredVariables) {
                  line += `\n  필수 변수: ${r.requiredVariables}`;
                }
                return line;
              }).join('\n\n'),
          }],
        };
      }

      case 'uninstall_skill': {
        const skillName = args.name;
        const installDir = path.join(SKILLS_INSTALL_DIR, skillName);

        if (!fs.existsSync(installDir)) {
          throw new Error(
            `스킬 '${skillName}'이 설치되어 있지 않습니다. list_skills로 설치된 스킬을 확인하세요.`
          );
        }

        fs.rmSync(installDir, { recursive: true, force: true });

        return {
          content: [{
            type: 'text',
            text: `✅ 스킬 '${skillName}' 제거 완료.\n경로: ${installDir}`,
          }],
        };
      }

      // ── 오디오 리뷰 핸들러 ──

      case 'list_audio_reviews': {
        const reviewPath = path.join(args.folder_path, '.audio_review.json');
        if (!fs.existsSync(reviewPath)) {
          return {
            content: [{ type: 'text', text: '부적합 마크된 파일이 없습니다. (.audio_review.json 파일 없음)' }],
          };
        }
        const reviews = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
        const entries = Object.entries(reviews);
        if (entries.length === 0) {
          return {
            content: [{ type: 'text', text: '부적합 마크된 파일이 없습니다.' }],
          };
        }
        const summary = entries.map(([filePath, info]) =>
          `⚠️ ${filePath}\n   사유: ${info.reason || '(없음)'}\n   시간: ${info.flaggedAt || '-'}`
        ).join('\n\n');
        return {
          content: [{
            type: 'text',
            text: `부적합 마크 ${entries.length}개:\n\n${summary}`,
          }],
        };
      }

      case 'update_audio_review': {
        const reviewPath = path.join(args.folder_path, '.audio_review.json');
        let reviews = {};
        if (fs.existsSync(reviewPath)) {
          reviews = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
        }
        if (args.action === 'flag') {
          reviews[args.relative_path] = {
            status: 'flagged',
            reason: args.reason || '',
            flaggedAt: new Date().toISOString(),
          };
          fs.writeFileSync(reviewPath, JSON.stringify(reviews, null, 2), 'utf-8');
          return {
            content: [{ type: 'text', text: `마크 완료: ${args.relative_path} (사유: ${args.reason || '-'})` }],
          };
        } else {
          delete reviews[args.relative_path];
          fs.writeFileSync(reviewPath, JSON.stringify(reviews, null, 2), 'utf-8');
          return {
            content: [{ type: 'text', text: `마크 해제: ${args.relative_path}` }],
          };
        }
      }

      case 'list_styles': {
        if (!fs.existsSync(STYLE_PRESETS_PATH)) {
          throw new Error(`스타일 프리셋 파일이 없습니다: ${STYLE_PRESETS_PATH}`);
        }
        const presets = JSON.parse(fs.readFileSync(STYLE_PRESETS_PATH, 'utf-8'));
        const lang = args.lang || 'ko';
        const nameKey = lang === 'en' ? 'name_en' : 'name_ko';

        // 카테고리 필터링
        let categories = presets.categories;
        let styles = presets.styles;
        if (args.category) {
          categories = categories.filter(c => c.id === args.category);
          styles = styles.filter(s => s.category === args.category);
          if (categories.length === 0) {
            const validIds = presets.categories.map(c => c.id).join(', ');
            throw new Error(`알 수 없는 카테고리: "${args.category}". 가능: ${validIds}`);
          }
        }

        // 카테고리별로 그룹핑하여 결과 생성
        const result = categories.map(cat => {
          const catStyles = styles.filter(s => s.category === cat.id);
          return {
            category_id: cat.id,
            category_name: cat[nameKey] || cat.name_en,
            icon: cat.icon,
            styles: catStyles.map(s => ({
              id: s.id,
              name: s[nameKey] || s.name_en,
              prompt_en: s.prompt_en,
            })),
          };
        });

        const totalStyles = result.reduce((sum, cat) => sum + cat.styles.length, 0);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              total_categories: result.length,
              total_styles: totalStyles,
              categories: result,
            }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`알 수 없는 도구: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `오류: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Prompts ──────────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'setup',
      description: 'Flow2CapCut 스킬 설치 상태를 확인하고 미설치 스킬을 안내합니다. MCP 연동 후 처음 사용할 때 실행하세요.',
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === 'setup') {
    // 레포 스킬 스캔
    const repoSkills = [];
    if (fs.existsSync(SKILLS_REPO_DIR)) {
      for (const dir of fs.readdirSync(SKILLS_REPO_DIR)) {
        const skillMd = path.join(SKILLS_REPO_DIR, dir, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          const metaPath = path.join(SKILLS_REPO_DIR, dir, 'metadata.json');
          let meta = { name: dir };
          if (fs.existsSync(metaPath)) {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          }
          repoSkills.push(meta);
        }
      }
    }

    // 설치 상태 확인
    const skillStatus = repoSkills.map(meta => {
      const installDir = path.join(SKILLS_INSTALL_DIR, meta.name);
      const installed = fs.existsSync(path.join(installDir, 'SKILL.md'));
      let needsUpdate = false;

      if (installed) {
        const installedMetaPath = path.join(installDir, 'metadata.json');
        if (fs.existsSync(installedMetaPath)) {
          const installedMeta = JSON.parse(fs.readFileSync(installedMetaPath, 'utf-8'));
          needsUpdate = installedMeta.version !== meta.version;
        } else {
          needsUpdate = true; // metadata 없으면 업데이트 필요
        }
      }

      return { ...meta, installed, needsUpdate };
    });

    const notInstalled = skillStatus.filter(s => !s.installed);
    const outdated = skillStatus.filter(s => s.installed && s.needsUpdate);
    const upToDate = skillStatus.filter(s => s.installed && !s.needsUpdate);

    let message = '# Flow2CapCut 스킬 설정\n\n';

    if (notInstalled.length === 0 && outdated.length === 0) {
      message += '✅ 모든 스킬이 최신 상태입니다!\n\n';
      message += upToDate.map(s => `- **${s.name}** v${s.version} — ${s.description}`).join('\n');
    } else {
      if (notInstalled.length > 0) {
        message += '## 🆕 설치 가능한 스킬\n\n';
        message += notInstalled.map(s => {
          const vars = s.variables
            ? Object.entries(s.variables)
                .filter(([, v]) => v.required)
                .map(([k, v]) => `${k}: "${v.example}"`)
                .join(', ')
            : '';
          return `- **${s.name}** v${s.version} — ${s.description}\n` +
            `  \`install_skill({ name: "${s.name}", variables: { ${vars} } })\``;
        }).join('\n\n');
        message += '\n\n';
      }

      if (outdated.length > 0) {
        message += '## 🔄 업데이트 가능\n\n';
        message += outdated.map(s => {
          const vars = s.variables
            ? Object.entries(s.variables)
                .filter(([, v]) => v.required)
                .map(([k, v]) => `${k}: "${v.example}"`)
                .join(', ')
            : '';
          return `- **${s.name}** → v${s.version}\n` +
            `  \`install_skill({ name: "${s.name}", variables: { ${vars} } })\``;
        }).join('\n\n');
        message += '\n\n';
      }

      if (upToDate.length > 0) {
        message += '## ✅ 최신\n\n';
        message += upToDate.map(s => `- **${s.name}** v${s.version}`).join('\n');
      }

      message += '\n\n---\n위 명령어를 실행하여 스킬을 설치/업데이트하시겠습니까?';
    }

    return {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: message },
        },
      ],
    };
  }

  throw new Error(`알 수 없는 프롬프트: ${name}`);
});

// ── Resources ─────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: csvPath ? [{
    uri: `file://${csvPath}`,
    name: path.basename(csvPath),
    description: 'EP10 씬 CSV 파일',
    mimeType: 'text/csv',
  }] : [],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri.startsWith('file://')) {
    const filePath = uri.slice(7);
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      contents: [{
        uri,
        mimeType: 'text/csv',
        text: content,
      }],
    };
  }
  throw new Error(`지원하지 않는 URI: ${uri}`);
});

// ── 서버 시작 ─────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Flow2CapCut MCP Server 시작됨 (stdio)');
}

main().catch(err => {
  console.error('MCP 서버 시작 실패:', err);
  process.exit(1);
});
