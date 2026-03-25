# AutoFlowCut MCP Server

AutoFlowCut 앱을 Claude Code에서 제어하기 위한 MCP(Model Context Protocol) 서버.

## 개요

stdio 기반 MCP 서버로, 두 가지 채널을 통해 AutoFlowCut을 제어합니다:

1. **CSV 직접 관리** — CSV 파일을 읽고/수정하고/저장
2. **HTTP 앱 제어** — 실행 중인 앱의 React 상태를 직접 조작 (포트 3210)

## 설치 및 설정

### 1. 의존성 설치

```bash
cd mcp-server
npm install
```

### 2. Claude Code에 등록

#### 방법 A: 글로벌 설정 (모든 프로젝트에서 사용) — 권장

```bash
claude mcp add --scope user --transport stdio flow2capcut -- node /path/to/AutoFlowCut/mcp-server/index.js
```

`~/.claude.json`의 `mcpServers`에 저장됩니다.

#### 방법 B: 프로젝트 로컬 설정 (특정 프로젝트에서만 사용)

프로젝트 루트에 `.mcp.json` 생성:

```json
{
  "mcpServers": {
    "flow2capcut": {
      "command": "node",
      "args": ["/path/to/AutoFlowCut/mcp-server/index.js"]
    }
  }
}
```

#### 설정 우선순위

Claude Code는 MCP 서버를 3가지 스코프로 관리하며, 같은 이름이 여러 곳에 있으면 아래 순서로 우선합니다:

| 우선순위 | 스코프 | 파일 | 공유 범위 |
|---------|--------|------|---------|
| 1 | Local | `.claude/settings.local.json` | 개인 (Git 무시) |
| 2 | Project | `.mcp.json` | 팀 공유 (Git 커밋) |
| 3 | User (글로벌) | `~/.claude.json` | 개인, 모든 프로젝트 |

> **참고:** `~/.claude/settings.json`의 `mcpServers`는 Claude Code가 읽지 않습니다. 반드시 `claude mcp add --scope user` 또는 `~/.claude.json`을 사용하세요.

#### 등록 확인

```bash
claude mcp list
```

### 3. 앱 설정

AutoFlowCut 앱 > 설정 > MCP HTTP 서버 > **ON** (포트: 3210)

## 아키텍처

```
Claude Code
    │
    ├── stdio ──► MCP Server (index.js)
    │                 │
    │                 ├── CSV 파일 직접 읽기/쓰기
    │                 │
    │                 └── HTTP ──► Electron Main Process (port 3210)
    │                                    │
    │                                    └── IPC ──► React Renderer
    │                                                  (상태 직접 변경)
    │
    └── 결과 확인
```

## HTTP 엔드포인트 (Electron 내장)

앱 설정에서 MCP HTTP 서버를 ON으로 켜면 `127.0.0.1:3210`에서 동작합니다.

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/status` | 서버 상태 확인 |
| `GET` | `/api/references` | 레퍼런스 목록 (base64 제외) |
| `GET` | `/api/scenes` | 씬 목록 (이미지 데이터 제외) |
| `POST` | `/api/update` | 범용 상태 업데이트 (IPC 전달) |
| `POST` | `/api/generate-reference` | 레퍼런스 이미지 생성 트리거 |
| `POST` | `/api/generate-scene` | 개별 씬 이미지 생성 트리거 |
| `POST` | `/api/start-batch` | 일괄 생성 시작 |
| `GET` | `/api/batch-status` | 배치 생성 진행 상태 조회 |

### POST /api/update — type 목록

| type | 필드 | 설명 |
|------|------|------|
| `update-references` | `references` | 레퍼런스 전체 교체 |
| `update-reference` | `index`, `fields` | 특정 레퍼런스 수정 |
| `update-scenes` | `scenes` | 씬 전체 교체 |
| `update-scene` | `index`, `fields` | 특정 씬 수정 |
| `generate-reference` | `index`, `styleId?` | 레퍼런스 생성 (IPC → global 호출) |
| `generate-scene` | `sceneId` | 씬 생성 (IPC → global 호출) |
| `start-batch` | — | 일괄 생성 시작 |

### POST /api/generate-reference

```json
{
  "index": 2,
  "styleId": "ref:1773499846144"
}
```

- `index` (필수): 레퍼런스 인덱스 (0-based)
- `styleId` (선택): 스타일 적용 (`ref:<id>` 또는 `preset:<id>`)

### POST /api/generate-scene

```json
{
  "sceneId": "scene_42"
}
```

### POST /api/start-batch

Body 없이 POST. 앱의 "생성 시작" 버튼과 동일한 동작.

## MCP 도구 목록

### CSV 관리 도구

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `load_csv` | CSV 파일 로드 | `csv_path` |
| `list_scenes` | 씬 목록 조회 (범위 지정 가능) | — |
| `get_scene` | 특정 씬 상세 정보 | `scene_number` |
| `get_scene_image` | 씬 이미지 경로 확인 | `scene_number` |
| `list_problem_scenes` | 문제 씬 목록 (카테고리별) | `category` |
| `update_prompt` | 씬 프롬프트 수정 | `scene_number`, `prompt` |
| `batch_update_prompts` | 프롬프트 일괄 수정 | `updates` |
| `save_csv` | CSV 저장 | — |
| `search_scenes` | 키워드 검색 | `keyword` |
| `get_stats` | 전체 통계 | — |
| `update_field` | 임의 필드 수정 | `scene_number`, `field`, `value` |

### 레퍼런스 관리 도구 (project.json 직접)

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `list_references` | 레퍼런스 목록 | — |
| `get_reference` | 레퍼런스 상세 | `name` |
| `update_reference_prompt` | 레퍼런스 프롬프트 수정 | `name`, `prompt` |

### HTTP 앱 제어 도구 (실행 중인 앱 직접 조작)

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `app_status` | 앱 HTTP 서버 상태 확인 | — |
| `app_get_references` | 앱에서 레퍼런스 조회 | — |
| `app_update_reference` | 앱 레퍼런스 직접 수정 | `index`, `fields` |
| `app_get_scenes` | 앱에서 씬 조회 | — |
| `app_update_scene` | 앱 씬 직접 수정 | `index`, `fields` |
| `app_generate_reference` | 레퍼런스 이미지 생성 | `index`, `styleId?` |
| `app_generate_scene` | 개별 씬 이미지 생성 | `sceneId` |
| `app_start_batch` | 일괄 생성 시작 | — |
| `app_batch_status` | 배치 생성 진행 상태 조회 | — |
| `app_wait_batch` | 배치 완료까지 대기 (long-poll) | `interval?`, `timeout?` |

> 모든 `app_*` 도구는 선택적 `port` 파라미터 지원 (기본: 3210)

## 사용 예시

### 1. 프롬프트 수정 후 재생성

```
# 1. 씬 프롬프트 수정 (앱 상태 직접 변경)
app_update_scene(index=5, fields={prompt: "...", imagePath: null, image: null, status: "pending"})

# 2. 일괄 생성 시작
app_start_batch()
```

### 2. 레퍼런스 재생성

```
# 스타일 적용하여 레퍼런스 이미지 생성
app_generate_reference(index=2, styleId="ref:1773499846144")
```

### 3. CSV에서 프롬프트 일괄 업데이트 → 앱 동기화

```
# 1. CSV 로드 및 프롬프트 수정
load_csv(csv_path="/path/to/scenes.csv")
batch_update_prompts(updates=[{scene_number: 1, prompt: "..."}, ...])
save_csv()

# 2. 앱 씬에 반영 (이미지 제거 + 프롬프트 업데이트)
app_update_scene(index=0, fields={prompt: "...", imagePath: null, status: "pending"})

# 3. 일괄 생성
app_start_batch()
```

## 주의사항

- HTTP 앱 제어 도구(`app_*`)는 앱이 실행 중이고 MCP HTTP 서버가 ON일 때만 동작
- `app_update_*` 도구는 앱의 React 상태를 직접 변경하므로 auto-save로 project.json에 자동 반영됨
- `app_generate_*` 도구는 fire-and-forget 방식 — 즉시 응답하고 생성은 백그라운드 진행
- 생성 진행 상태는 `app_get_scenes`로 확인 가능 (status 필드)
