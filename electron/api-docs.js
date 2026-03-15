/**
 * Flow2CapCut API Documentation
 * OpenAPI 3.0 spec + Swagger UI HTML
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Flow2CapCut API',
    version: '1.0.0',
    description: `Flow2CapCut Electron 앱의 HTTP API입니다.

MCP(Model Context Protocol) 서버를 통해 Claude Code에서 제어하거나, 직접 HTTP 호출로 사용할 수 있습니다.

## 빠른 시작

### 1. 앱 설정

Flow2CapCut 앱 > **설정** > **MCP HTTP 서버** > **ON** (포트: 3210)

### 2. MCP 서버 설치

\`\`\`bash
cd /path/to/Flow2CapCut/mcp-server
npm install
\`\`\`

### 3. Claude Code에 MCP 서버 등록

프로젝트 루트 또는 \`~/.claude/\`에 \`.mcp.json\` 파일을 생성합니다:

\`\`\`json
{
  "mcpServers": {
    "flow2capcut": {
      "command": "node",
      "args": ["/path/to/Flow2CapCut/mcp-server/index.js"]
    }
  }
}
\`\`\`

### 4. 확인

Claude Code를 실행하면 MCP 도구들이 자동으로 사용 가능해집니다.
HTTP API는 \`curl http://127.0.0.1:3210/api/status\` 로 확인할 수 있습니다.

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
| \`app_status\` | \`GET /api/status\` | 서버 상태 확인 |
| \`app_get_references\` | \`GET /api/references\` | 레퍼런스 목록 |
| \`app_update_reference\` | \`POST /api/update\` | 레퍼런스 수정 |
| \`app_get_scenes\` | \`GET /api/scenes\` | 씬 목록 |
| \`app_update_scene\` | \`POST /api/update\` | 씬 수정 |
| \`app_generate_reference\` | \`POST /api/generate-reference\` | 레퍼런스 이미지 생성 |
| \`app_generate_scene\` | \`POST /api/generate-scene\` | 개별 씬 이미지 생성 |
| \`app_start_batch\` | \`POST /api/start-batch\` | 일괄 생성 시작 |
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
curl -X POST http://127.0.0.1:3210/api/start-batch

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
    { url: 'http://127.0.0.1:3210', description: 'Local Flow2CapCut' },
  ],
  tags: [
    { name: '상태', description: '서버 및 배치 상태 확인' },
    { name: '레퍼런스', description: '레퍼런스 이미지 관리' },
    { name: '씬', description: '씬 데이터 관리' },
    { name: '생성', description: '이미지/배치 생성 트리거' },
    { name: '범용', description: '범용 상태 업데이트' },
  ],
  paths: {
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
                    app: { type: 'string', example: 'Flow2CapCut' },
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
- \`start-batch\`: 일괄 생성 시작`,
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
    '/api/start-batch': {
      post: {
        tags: ['생성'],
        summary: '일괄 생성 시작',
        description: 'pending/error 상태인 모든 씬의 이미지를 일괄 생성합니다. 앱의 "생성 시작" 버튼과 동일한 동작입니다. Body 없이 POST합니다.',
        responses: {
          200: { description: '일괄 생성 시작됨', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } } },
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
            enum: ['update-references', 'update-reference', 'update-scenes', 'update-scene', 'generate-reference', 'generate-scene', 'start-batch'],
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
  <title>Flow2CapCut API Docs</title>
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
