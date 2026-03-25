/**
 * AutoFlowCut API Documentation
 * OpenAPI 3.0 spec + Swagger UI HTML
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AutoFlowCut API',
    version: '1.0.0',
    description: `AutoFlowCut Electron 앱의 HTTP API입니다.

MCP(Model Context Protocol) 서버를 통해 Claude Code에서 제어하거나, 직접 HTTP 호출로 사용할 수 있습니다.

## 빠른 시작

### 1. 앱 설정

AutoFlowCut 앱 > **설정** > **MCP HTTP 서버** > **ON** (포트: 3210)

### 2. MCP 서버 설치

\`\`\`bash
cd /path/to/AutoFlowCut/mcp-server
npm install
\`\`\`

### 3. Claude Code에 MCP 서버 등록

#### 글로벌 설정 (모든 프로젝트에서 사용) — 권장

\`\`\`bash
claude mcp add --scope user --transport stdio flow2capcut -- node /path/to/AutoFlowCut/mcp-server/index.js
\`\`\`

\`~/.claude.json\`의 \`mcpServers\`에 저장됩니다.

#### 프로젝트 로컬 설정 (특정 프로젝트에서만 사용)

프로젝트 루트에 \`.mcp.json\` 파일을 생성합니다:

\`\`\`json
{
  "mcpServers": {
    "flow2capcut": {
      "command": "node",
      "args": ["/path/to/AutoFlowCut/mcp-server/index.js"]
    }
  }
}
\`\`\`

#### 설정 우선순위

| 우선순위 | 스코프 | 파일 | 공유 범위 |
|---------|--------|------|---------|
| 1 | Local | \`.claude/settings.local.json\` | 개인 (Git 무시) |
| 2 | Project | \`.mcp.json\` | 팀 공유 (Git 커밋) |
| 3 | User (글로벌) | \`~/.claude.json\` | 개인, 모든 프로젝트 |

> **주의:** \`~/.claude/settings.json\`의 \`mcpServers\`는 Claude Code가 읽지 않습니다. 반드시 \`claude mcp add --scope user\` 또는 \`~/.claude.json\`을 사용하세요.

### 4. 확인

\`\`\`bash
claude mcp list          # 등록된 MCP 서버 목록 확인
curl http://127.0.0.1:3210/api/status   # HTTP API 상태 확인
\`\`\`

## 아키텍처

\`\`\`
Claude Code ── stdio ──▶ MCP Server (mcp-server/index.js)
                              │
                              ├── CSV 파일 직접 읽기/쓰기
                              │
                              └── HTTP ──▶ Electron Main (port 3210)
                                                │
                                                └── IPC ──▶ React Renderer
                                                              (상태 직접 변경)
\`\`\`

## MCP 도구 매핑

| MCP 도구 | HTTP 엔드포인트 | 설명 |
|----------|----------------|------|
| \`app_list_projects\` | \`GET /api/projects\` | 프로젝트 목록 |
| \`app_create_project\` | \`POST /api/projects\` | 프로젝트 생성 |
| \`app_rename_project\` | \`PUT /api/projects\` | 프로젝트 이름 변경 |
| \`app_delete_project\` | \`DELETE /api/projects\` | 프로젝트 삭제 |
| \`app_status\` | \`GET /api/status\` | 서버 상태 확인 |
| \`app_get_references\` | \`GET /api/references\` | 레퍼런스 목록 |
| \`app_update_reference\` | \`POST /api/update\` | 레퍼런스 수정 |
| \`app_get_scenes\` | \`GET /api/scenes\` | 씬 목록 |
| \`app_update_scene\` | \`POST /api/update\` | 씬 수정 |
| \`app_generate_reference\` | \`POST /api/generate-reference\` | 레퍼런스 이미지 생성 |
| \`app_generate_scene\` | \`POST /api/generate-scene\` | 개별 씬 이미지 생성 |
| \`app_start_scene_batch\` | \`POST /api/start-scene-batch\` | 씬 일괄 생성 시작 |
| \`app_start_ref_batch\` | \`POST /api/start-ref-batch\` | 레퍼런스 일괄 생성 시작 |
| \`app_batch_status\` | \`GET /api/batch-status\` | 배치 진행 상태 |
| \`app_wait_batch\` | *(MCP 전용 — 폴링)* | 배치 완료 대기 |

## CSV 관리 도구 (MCP 전용)

CSV 파일을 직접 읽고/수정하는 도구들은 MCP 서버에서만 사용 가능합니다:

| 도구 | 설명 |
|------|------|
| \`load_csv\` | CSV 파일 로드 |
| \`list_scenes\` | 씬 목록 조회 (범위 지정 가능) |
| \`get_scene\` | 특정 씬 상세 정보 |
| \`get_scene_image\` | 씬 이미지 경로 확인 |
| \`list_problem_scenes\` | 문제 씬 목록 (카테고리별) |
| \`update_prompt\` | 씬 프롬프트 수정 |
| \`batch_update_prompts\` | 프롬프트 일괄 수정 |
| \`save_csv\` | CSV 저장 |
| \`search_scenes\` | 키워드 검색 |
| \`get_stats\` | 전체 통계 |
| \`update_field\` | 임의 필드 수정 |

## 레퍼런스 관리 도구 (MCP 전용)

| 도구 | 설명 |
|------|------|
| \`list_references\` | 레퍼런스 목록 (project.json) |
| \`get_reference\` | 레퍼런스 상세 |
| \`update_reference_prompt\` | 레퍼런스 프롬프트 수정 |

## 사용 예시

### 프롬프트 수정 후 재생성

\`\`\`bash
# 1. 씬 프롬프트 수정 + 이미지 초기화
curl -X POST http://127.0.0.1:3210/api/update \\
  -H "Content-Type: application/json" \\
  -d '{"type":"update-scene","index":5,"fields":{"prompt":"새 프롬프트...","imagePath":null,"status":"pending"}}'

# 2. 일괄 생성 시작
curl -X POST http://127.0.0.1:3210/api/start-scene-batch

# 3. 진행 상태 확인
curl http://127.0.0.1:3210/api/batch-status
\`\`\`

## 주의사항

- HTTP API는 앱이 실행 중이고 MCP HTTP 서버가 ON일 때만 동작합니다
- \`app_update_*\` 도구는 React 상태를 직접 변경하므로 auto-save로 project.json에 자동 반영됩니다
- 생성 관련 API는 fire-and-forget 방식입니다 — 즉시 응답하고 생성은 백그라운드로 진행됩니다
- \`app_batch_status\` 또는 \`app_wait_batch\`로 진행 상태를 확인할 수 있습니다
`,
  },
  servers: [
    { url: 'http://127.0.0.1:3210', description: 'Local AutoFlowCut' },
  ],
  tags: [
    { name: '프로젝트', description: '프로젝트 생성/목록/수정/삭제' },
    { name: '상태', description: '서버 및 배치 상태 확인' },
    { name: '레퍼런스', description: '레퍼런스 이미지 관리' },
    { name: '씬', description: '씬 데이터 관리' },
    { name: '생성', description: '이미지/배치 생성 트리거' },
    { name: '범용', description: '범용 상태 업데이트' },
  ],
  paths: {
    '/api/projects': {
      get: {
        tags: ['프로젝트'],
        summary: '프로젝트 목록 조회',
        description: '작업 폴더 내 모든 프로젝트 목록을 반환합니다. 각 프로젝트의 project.json 존재 여부도 포함됩니다.',
        responses: {
          200: {
            description: '프로젝트 목록',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    workFolder: { type: 'string', description: '작업 폴더 절대 경로' },
                    projects: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', description: '프로젝트 이름' },
                          hasProjectJson: { type: 'boolean', description: 'project.json 존재 여부' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: '작업 폴더 미설정' },
        },
      },
      post: {
        tags: ['프로젝트'],
        summary: '프로젝트 생성',
        description: '새 프로젝트를 생성합니다. 디렉토리 구조(scenes, references, images, videos, sfx + history)와 빈 project.json이 자동 생성됩니다.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: '프로젝트 이름', example: '무한야담_ep10' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: '프로젝트 생성 완료',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    projectDir: { type: 'string', description: '생성된 프로젝트 절대 경로' },
                    projectName: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'name 누락 또는 작업 폴더 미설정' },
          409: { description: '같은 이름의 프로젝트가 이미 존재' },
        },
      },
      put: {
        tags: ['프로젝트'],
        summary: '프로젝트 이름 변경',
        description: '기존 프로젝트의 디렉토리 이름을 변경합니다.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['oldName', 'newName'],
                properties: {
                  oldName: { type: 'string', description: '현재 프로젝트 이름', example: 'ep10' },
                  newName: { type: 'string', description: '새 프로젝트 이름', example: '무한야담_ep10' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '이름 변경 완료', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, oldName: { type: 'string' }, newName: { type: 'string' } } } } } },
          404: { description: '원본 프로젝트 없음' },
          409: { description: '새 이름의 프로젝트가 이미 존재' },
        },
      },
      delete: {
        tags: ['프로젝트'],
        summary: '프로젝트 삭제',
        description: '프로젝트 디렉토리를 완전히 삭제합니다. **되돌릴 수 없으므로 주의하세요.**',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: '삭제할 프로젝트 이름', example: 'test-project' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '삭제 완료', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, deleted: { type: 'string' } } } } } },
          404: { description: '프로젝트 없음' },
        },
      },
    },
    '/api/status': {
      get: {
        tags: ['상태'],
        summary: '서버 상태 확인',
        description: 'MCP HTTP 서버가 정상 동작 중인지 확인합니다.',
        responses: {
          200: {
            description: '정상',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    app: { type: 'string', example: 'AutoFlowCut' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/batch-status': {
      get: {
        tags: ['상태'],
        summary: '배치 생성 진행 상태',
        description: '현재 배치 생성의 진행 상태를 반환합니다. isRunning으로 생성 중 여부를 확인할 수 있습니다.',
        responses: {
          200: {
            description: '배치 상태',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BatchStatus' },
              },
            },
          },
          503: { description: '앱이 준비되지 않음' },
        },
      },
    },
    '/api/references': {
      get: {
        tags: ['레퍼런스'],
        summary: '레퍼런스 목록 조회',
        description: '현재 프로젝트의 레퍼런스 목록을 반환합니다. base64 이미지 데이터는 제외됩니다.',
        responses: {
          200: {
            description: '레퍼런스 배열',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Reference' },
                },
              },
            },
          },
          503: { description: '앱이 준비되지 않음' },
        },
      },
    },
    '/api/scenes': {
      get: {
        tags: ['씬'],
        summary: '씬 목록 조회',
        description: '현재 프로젝트의 모든 씬 목록을 반환합니다. 이미지 바이너리 데이터는 제외됩니다.',
        responses: {
          200: {
            description: '씬 배열',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Scene' },
                },
              },
            },
          },
          503: { description: '앱이 준비되지 않음' },
        },
      },
    },
    '/api/update': {
      post: {
        tags: ['범용'],
        summary: '범용 상태 업데이트',
        description: `IPC를 통해 React Renderer의 상태를 직접 변경합니다.

**지원 type:**
- \`update-references\`: 레퍼런스 전체 교체
- \`update-reference\`: 특정 레퍼런스 수정 (index + fields)
- \`update-scenes\`: 씬 전체 교체
- \`update-scene\`: 특정 씬 수정 (index + fields)
- \`generate-reference\`: 레퍼런스 생성 트리거 (index + styleId?)
- \`generate-scene\`: 씬 생성 트리거 (sceneId)
- \`start-scene-batch\`: 씬 일괄 생성 시작
- \`start-ref-batch\`: 레퍼런스 일괄 생성 시작`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateRequest' },
              examples: {
                'update-scene': {
                  summary: '특정 씬 프롬프트 수정',
                  value: {
                    type: 'update-scene',
                    index: 5,
                    fields: { prompt: 'A girl walking through...', imagePath: null, status: 'pending' },
                  },
                },
                'update-reference': {
                  summary: '특정 레퍼런스 수정',
                  value: {
                    type: 'update-reference',
                    index: 0,
                    fields: { prompt: 'Updated reference prompt...' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '성공', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          503: { description: '앱이 준비되지 않음' },
        },
      },
    },
    '/api/generate-reference': {
      post: {
        tags: ['생성'],
        summary: '레퍼런스 이미지 생성',
        description: 'Fire-and-forget 방식으로 특정 레퍼런스의 이미지를 생성합니다. 즉시 응답하고 생성은 백그라운드에서 진행됩니다.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['index'],
                properties: {
                  index: { type: 'integer', description: '레퍼런스 인덱스 (0-based)', example: 2 },
                  styleId: { type: 'string', description: '스타일 ID (ref:<id> 또는 preset:<id>)', example: 'ref:1773499846144' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '생성 요청 접수', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } } },
          503: { description: '앱이 준비되지 않음' },
        },
      },
    },
    '/api/generate-scene': {
      post: {
        tags: ['생성'],
        summary: '개별 씬 이미지 생성',
        description: 'Fire-and-forget 방식으로 특정 씬의 이미지를 생성합니다.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sceneId'],
                properties: {
                  sceneId: { type: 'string', description: '씬 ID', example: 'scene_42' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '생성 요청 접수', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } } },
          503: { description: '앱이 준비되지 않음' },
        },
      },
    },
    '/api/start-scene-batch': {
      post: {
        tags: ['생성'],
        summary: '씬 일괄 생성 시작',
        description: 'pending/error 상태인 모든 씬의 이미지를 일괄 생성합니다. 앱의 "생성 시작" 버튼과 동일한 동작입니다. Body 없이 POST합니다.',
        responses: {
          200: { description: '씬 일괄 생성 시작됨', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } } },
          503: { description: '앱이 준비되지 않음' },
        },
      },
    },
    '/api/start-ref-batch': {
      post: {
        tags: ['생성'],
        summary: '레퍼런스 일괄 생성 시작',
        description: '모든 레퍼런스의 이미지를 일괄 생성합니다. Body 없이 POST합니다.',
        responses: {
          200: { description: '레퍼런스 일괄 생성 시작됨', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } } },
          503: { description: '앱이 준비되지 않음' },
        },
      },
    },
  },
  components: {
    schemas: {
      BatchStatus: {
        type: 'object',
        properties: {
          isRunning: { type: 'boolean', description: '배치 생성 실행 중 여부' },
          isPaused: { type: 'boolean', description: '일시 정지 여부' },
          progress: {
            type: 'object',
            properties: {
              current: { type: 'integer' },
              total: { type: 'integer' },
              percent: { type: 'number' },
            },
          },
          total: { type: 'integer', description: '전체 씬 수' },
          done: { type: 'integer', description: '완료된 씬 수' },
          pending: { type: 'integer', description: '대기 중인 씬 수' },
          generating: { type: 'integer', description: '생성 중인 씬 수' },
          error: { type: 'integer', description: '오류 씬 수' },
          status: { type: 'string', description: '현재 상태', example: 'ready' },
          statusMessage: { type: 'string', description: '상태 메시지' },
        },
      },
      Reference: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: '레퍼런스 이름' },
          prompt: { type: 'string', description: '생성 프롬프트' },
          imagePath: { type: 'string', description: '이미지 파일 경로', nullable: true },
        },
      },
      Scene: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string', description: '생성 프롬프트' },
          subtitle: { type: 'string', description: '자막/대사' },
          characters: { type: 'string', description: '등장인물' },
          status: { type: 'string', enum: ['pending', 'generating', 'done', 'error'], description: '생성 상태' },
          imagePath: { type: 'string', description: '이미지 파일 경로', nullable: true },
        },
      },
      UpdateRequest: {
        type: 'object',
        required: ['type'],
        properties: {
          type: {
            type: 'string',
            enum: ['update-references', 'update-reference', 'update-scenes', 'update-scene', 'generate-reference', 'generate-scene', 'start-scene-batch', 'start-ref-batch'],
          },
          index: { type: 'integer', description: '대상 인덱스 (0-based)' },
          fields: { type: 'object', description: '수정할 필드 객체' },
          references: { type: 'array', description: '레퍼런스 전체 교체 시' },
          scenes: { type: 'array', description: '씬 전체 교체 시' },
          sceneId: { type: 'string', description: '생성할 씬 ID' },
          styleId: { type: 'string', description: '스타일 ID' },
        },
      },
    },
  },
}

export function getSwaggerHtml(port) {
  const specUrl = `http://127.0.0.1:${port}/api/openapi.json`
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>AutoFlowCut API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
    .swagger-ui .info { margin: 30px 0 20px; }
    .swagger-ui .info .title { font-size: 28px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    })
  </script>
</body>
</html>`
}
