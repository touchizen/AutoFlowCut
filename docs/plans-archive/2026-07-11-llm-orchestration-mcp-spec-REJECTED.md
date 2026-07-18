# LLM 오케스트레이션 — MCP 표면 확장 (Spec)

**날짜**: 2026-07-11
**브랜치**: `main` (base `e9ee291`)
**상태**: 설계 초안 — Fable 5 리뷰 대기
**선행 조사**: 본 문서 §1 (2026-07-11 코드 실측)

---

## 0. 목표 (한 줄)

외부 LLM 에이전트가 **주제만 받아서 대본 → 씬 → 오디오 → 이미지/영상 → Export 까지 앱을 끝까지 몰 수 있도록**, 지금 UI 에서만 닿는 스토리 파이프라인·영상 생성·시각 QA 를 MCP 표면으로 끌어올린다.

### 비목표 (YAGNI — 이번에 안 함)

| 항목 | 안 하는 이유 |
|---|---|
| **헤드리스 동작** | MCP HTTP 서버가 렌더러 `useEffect` 에서 뜨고(`useMcpServer.js:128-134`), 20개 라우트 중 14개가 `window.__mcp*` → 렌더러 `useState` 를 거친다. 이걸 메인으로 들어올리는 건 앱 절반 재작성이다. **앱 창을 띄워둔 채 에이전트가 조종하는 것으로 충분하다.** 창이 떠 있다는 전제를 명시적 사전조건으로 못박는다. |
| **로그인 자동화** (Google OAuth, Gemini 키, Claude/Codex CLI) | 1회성 사전조건. 자동화 가치 없음. |
| **video-as-base exporter** | 영상이 이미지 위 오버레이로만 깔리는 제약(`prepareCloudRequest.js:148`, `sceneMedia.js:32-52`)은 **GCF 크로스레포**(whisk2capcut/whisk2premiere) 작업이라 별건. 본 스펙은 "영상을 만들고 볼 수 있게" 까지만 책임진다. |
| **브릿지 인증** | 아래 §D7 참조 — 리스크 수용, 별건. |

---

## 1. 현재 상태 (실측 앵커)

**MCP 는 앱의 3분의 1만 덮는다.** 44개 툴 전부 이미지/CSV/Export 축이다.

| 영역 | IPC 채널 | MCP 툴 | 상태 |
|---|---|---|---|
| 이미지 생성 | 있음 | 6개 | ✅ |
| CSV 스토리보드 | (로컬 파일) | 15개 | ✅ |
| Export | 있음 | 2개 | ✅ (단, §D5 경고) |
| **스토리 파이프라인** | **20개** (`story-api.js:106-192`) | **0개** | ❌ |
| **영상 생성** | **4개** (`video.js:118,465,744,883`) | **0개** | ❌ |
| **시각 QA** | — | 0개 (오디오만 있음) | ❌ |

브릿지 구조 (4홉, 전부 필요):
```
MCP client --stdio--> mcp-server/index.js
   --HTTP 127.0.0.1:3210--> electron/main.js:880 (startMcpHttpServer)
   --executeJavaScript / webContents.send--> src/hooks/useMcpServer.js (window.__mcp*)
   --React state--> src/hooks/useScenes.js
```
`/api/story*`, `/api/video*` 라우트는 **하나도 없다.**

### 자율 실행을 죽이는 하드 블로커 2개

1. **`charactersConfirmed` 게이트** — `stepMachine.js:1704-1706`
   ```js
   if (step !== 'script' && ['title','pasted'].includes(state?.input?.type)
       && state.charactersConfirmed === false) return { error: 'unconfirmed' }
   ```
   `scenes`/`audio`/`prompts` 를 **전부 막는다.** 푸는 `story:confirm-synopsis` 의 유일한 호출자는 `StoryView.jsx:974` 의 버튼. **이거 하나로 자율 실행이 죽는다.**

2. **`projectToken`** — `story-api.js:77-78`
   ```js
   if (!machine || payload.projectToken !== machine.projectToken) return { error: 'stale-token' }
   ```
   토큰은 `stepMachine.js:95` 에서 발급되어 `story:open` 응답으로 **렌더러에게만** 간다. MCP 쪽은 획득 경로가 없다.

---

## 2. 확정 설계 결정

| # | 결정 | 근거 |
|---|---|---|
| **D1** | **`projectToken` 은 메인 프로세스가 보관하고 HTTP 라우트가 자동 주입한다.** MCP 툴 시그니처에 토큰을 노출하지 않는다. | 토큰의 목적은 "stale machine 방어"이지 인증이 아니다. 에이전트에게 토큰을 들고 다니게 하면 렌더러가 `story:open` 을 다시 불렀을 때 조용히 stale 이 된다. 메인이 현재 토큰을 알고 있으니 메인이 주입하는 게 맞다. |
| **D2** | **게이트를 없애지 않는다. MCP 에서도 *통과시킬 수 있게* 만든다.** `story_confirm_synopsis`, `story_research_commit`, `story_research_skip` 툴 추가. | 게이트는 품질 장치로 일부러 넣은 것이다(§v2.11 이력). 사람이 보고 싶으면 UI 에서 누르고, 에이전트가 몰 땐 에이전트가 확인한다. **게이트 제거는 명시적 비목표.** |
| **D3** | **렌더러와 MCP 는 같은 `stepMachine` 인스턴스를 공유한다.** 별도 headless machine 을 만들지 않는다. | 두 개의 진실 공급원을 만들면 상태가 갈린다. UI 를 보면서 에이전트가 도는 게 오히려 정상 사용 시나리오다(사람이 지켜봄). |
| **D4** | **영상 프레임 추출은 렌더러 `<video>` + canvas 를 쓴다. ffmpeg 를 새로 넣지 않는다.** `src/utils/videoPoster.js` 의 단일 포스터 캡처를 **N프레임 샘플링으로 확장**한다. | ffmpeg 는 현재 하드 의존이 아니다(`audioProbe.js:2` — "ffmpeg 불필요", `filesystem.js:54` — ffprobe 실패 시 폴백). 영상 QA 하나 때문에 200MB 바이너리를 넣는 건 비용 대비 손해. |
| **D5** | **`export_*` 의 무음 사고를 에러로 승격한다.** | 현재 `useMcpServer.js:191` — 오디오 패키지가 없으면 `console.warn` 만 찍고 **무음으로 export 된다.** 사람이면 듣고 알지만 **에이전트는 모른다.** 자율 실행에서 이건 조용한 손상이다. `requireAudio: true` (기본값) 일 때 에러를 반환한다. |
| **D6** | **`get_scene_image` 는 실제 픽셀을 반환한다.** MCP image content block. 지금은 `{path, exists}` 문자열만 준다(`index.js:976-988`). | 순수 MCP 클라이언트는 지금 **장님이다.** 파일시스템 접근이 있는 에이전트(Claude Code)만 우회로 볼 수 있는데, 그건 설계가 아니라 사고다. |
| **D7** | **브릿지 인증은 이번에 안 한다. 리스크로 문서화하고 수용한다.** | `main.js:1453` 은 `127.0.0.1` 바인드에 `Access-Control-Allow-Origin: *`, 토큰 검사 0. 다만 **localhost 전용 + 로컬 에이전트**라 신뢰 경계가 동일하다. 지금 인증을 넣으면 기존 MCP 클라이언트와 skill 등록 경로가 전부 깨진다. 표면을 넓히는 것과 잠그는 것을 한 커밋에 섞지 않는다. **별건으로 분리.** |

---

## 3. 마일스톤

의존성 순서. 각 마일스톤 끝에 Codex 리뷰 (findings 0 까지 loop).

### M1 — 부트스트랩 (가장 작음, 나머지의 전제)

작업 폴더가 네이티브 다이얼로그(`filesystem.js:346`)로만 잡힌다. 없으면 `/api/projects` 전 라우트가 400 (`main.js:1282,1314,1361,1400`). 신규 설치에서 에이전트가 아무것도 못 한다.

- `POST /api/work-folder { path }` → `work-folder-config.json` 기록
- `GET /api/work-folder` → 현재 경로 + `configured: bool`
- MCP: `app_get_work_folder`, `app_set_work_folder`
- `app_create_project` 가 `story/` 디렉토리도 만들게 수정 (`main.js:1333` — 현재 `scenes/ references/ images/ videos/ sfx/` 만 만들고 `story/` 를 빼먹음)

### M2 — 스토리 파이프라인 MCP (제일 큰 덩어리)

**메인 프로세스에 토큰 보관소를 둔다.** `story-api.js` 의 `guarded()` 는 그대로 두고, HTTP 라우트가 현재 machine 의 토큰을 읽어 payload 에 주입한 뒤 기존 핸들러를 재사용한다.

라우트 (전부 `POST /api/story/*`, 창 필요):

| 라우트 | 위임 대상 | MCP 툴 |
|---|---|---|
| `/api/story/open` | `story:open` | `story_open` |
| `/api/story/state` (GET) | `story:get-state` | `story_get_state` |
| `/api/story/start` | `story:start` (script\|scenes\|audio\|prompts) | `story_run_step` |
| `/api/story/abort` | `story:abort` | `story_abort` |
| `/api/story/synopsis` | `story:generate-synopsis` | `story_generate_synopsis` |
| `/api/story/synopsis/review` | `story:review-synopsis` | `story_review_synopsis` |
| **`/api/story/synopsis/confirm`** | `story:confirm-synopsis` | **`story_confirm_synopsis`** ← 하드 블로커 해제 |
| `/api/story/research/*` | search·fetch·analyze·factcheck·**commit**·skip·select | `story_research_*` (7개) |
| `/api/story/artifact` (GET) | `story/script.md`, `story/scenes.json`, `story/synopsis.md` 읽기 | `story_read_artifact` |
| `/api/story/llm-options` (GET) | `story:list-llm-options` | `story_list_llm_options` |

**`story_read_artifact` 가 필수인 이유**: 지금 에이전트는 **자기가 쓴 대본을 다시 못 읽는다.** `get_scene`/`list_scenes` 는 CSV 스토리보드를 읽는 별개 아티팩트다.

**진행 상황**: `story:start` 는 `story:delta` 스트림을 렌더러로 쏜다. MCP 는 스트리밍을 못 하므로 **폴링**으로 간다 — `story_run_step` 은 opId 를 즉시 반환, `story_get_state` 로 진행/완료를 확인. (`app_start_scene_batch` + `app_wait_batch` 와 동일한 기존 패턴.)

### M3 — 영상 생성 MCP

`video.js` 의 4개 핸들러를 브릿지한다.

- `POST /api/video/generate { sceneNumber, mode: 't2v'|'i2v', prompt, ... }` → `flow:generate-video-t2v|i2v`
- `GET /api/video/status` → `flow:check-video-status`
- `POST /api/video/upscale` → `flow:upscale-video` (⚠️ 1080p/4K 는 실제 Flow 업스케일을 태워 쿼터를 태운다 — 툴 설명에 명시)
- MCP: `app_generate_video`, `app_video_status`, `app_wait_video`
- **`useMcpServer.js:144` 의 `videoT2V`/`videoI2V` 필드 stripping 제거.** 지금 에이전트는 어떤 씬에 영상이 붙었는지조차 못 본다.

### M4 — 에이전트의 눈 + 시각 QA

**보기:**
- `get_scene_image` → MCP image content block 반환 (D6). `scene_${num}.jpg` 하드코딩(`index.js:979`) 제거, 실제 확장자 탐색.
- `get_reference_image` (신규)
- `get_scene_video_frames { sceneNumber, source: 't2v'|'i2v', n: 3 }` (신규) → `videoPoster.js` 확장으로 균등 간격 N프레임 → image block 배열. **첫 프레임만 멀쩡하고 3초쯤에 얼굴이 녹는** 전형적 실패를 잡기 위함이므로 **n≥3, 마지막 프레임 필수 포함.**

**점수 저장:** 지금 씬별 시각 QA 판정을 **저장할 곳 자체가 없다.** `app_notify_qa`(`index.js:1384`)는 UI 배너로 쏘는 단방향 쓰기고, 점수를 남기지 않는다. 오디오만 `update_audio_review`/`list_audio_reviews` 로 실제 리뷰 루프가 있다.

→ **오디오 리뷰와 대칭**으로 시각 리뷰 저장소를 만든다:
- `update_visual_review { sceneNumber, target: 'image'|'video_t2v'|'video_i2v', verdict: 'pass'|'retry'|'reject', score, reason }`
- `list_visual_reviews { filter }`
- 저장 위치: `<project>/reviews/visual.json` (오디오 리뷰 저장 방식 그대로 따름)

`list_problem_scenes` 는 현재 `missing`/`mismatch`(파일 존재 + 프롬프트 불일치)만 본다 — 시각 품질 신호 0. 여기에 `visual_reject` 종류를 추가해 위 저장소와 물린다.

---

## 4. TDD 슬라이스 (RED → GREEN)

CLAUDE.md 규칙: 테스트 없이 코드 수정 금지.

**M1**
1. `POST /api/work-folder` 로 폴더 설정 후 `GET /api/projects` 가 200 (기존: 400) — `tests/electron/mcpHttp.workFolder.test.js`
2. `app_create_project` 결과에 `story/` 디렉토리 존재 — 기존 프로젝트 생성 테스트 확장

**M2**
3. `POST /api/story/open` 이 토큰 없이 성공하고, 이어지는 `/api/story/start` 가 `stale-token` 없이 통과 (토큰 메인 주입) — `tests/electron/story.mcpBridge.test.js`
4. 렌더러가 `story:open` 을 다시 호출해 토큰이 재발급돼도 MCP 라우트가 계속 동작 (D1 회귀 방어)
5. `charactersConfirmed=false` 상태에서 `/api/story/start {step:'scenes'}` → `unconfirmed` 에러. `/api/story/synopsis/confirm` 후 → 통과 (**하드 블로커 해제 증명**)
6. `story_read_artifact('script.md')` 가 `stepMachine` 이 쓴 내용과 일치
7. `story_run_step` 이 opId 반환 → `story_get_state` 폴링으로 완료 관측

**M3**
8. `POST /api/video/generate` 가 `flow:generate-video-i2v` 를 호출하고 mediaId 반환 (핸들러 모킹)
9. `app_get_scenes` 응답에 `videoT2VPath`/`videoI2VPath` 가 포함 (stripping 제거 회귀 방어) — `tests/hooks/useMcpServer.videoFields.test.js`

**M4**
10. `get_scene_image` 가 image content block 을 반환 (문자열 아님) — `tests/mcp-server/sceneImage.test.js`
11. `get_scene_video_frames { n:3 }` 이 3개 image block, 마지막이 영상 끝단 프레임
12. `update_visual_review` → `list_visual_reviews` 왕복, `list_problem_scenes` 가 `visual_reject` 씬을 집어냄
13. **D5**: 오디오 패키지 없이 `export_capcut` 호출 → 에러 (기존: 조용히 무음 export)

---

## 5. 변경 파일 요약

| 파일 | 변경 |
|---|---|
| `electron/main.js` | `/api/work-folder`, `/api/story/*`(10), `/api/video/*`(3) 라우트 추가. `app_create_project` 에 `story/` 추가 |
| `electron/ipc/story-api.js` | 토큰 보관소 노출 (메인 주입용). `guarded()` 로직은 불변 |
| `electron/ipc/video.js` | 변경 없음 (라우트가 기존 핸들러 재사용) |
| `electron/ipc/filesystem.js` | 작업 폴더 프로그래매틱 설정 경로 |
| `mcp-server/index.js` | 툴 +~20 (story 12, video 3, 시각 QA 3, work-folder 2) |
| `src/hooks/useMcpServer.js` | video 필드 stripping 제거(:144). export 무음 → 에러(:191) |
| `src/utils/videoPoster.js` | 단일 포스터 → N프레임 샘플링 확장 |
| 신규 | `<project>/reviews/visual.json` 저장소 |

---

## 6. 완료 정의

에이전트가 **UI 클릭 0회로** 다음을 끝까지 수행:

1. 작업 폴더 설정 → 프로젝트 생성
2. (선택) 리서치 → commit
3. 시놉시스 생성 → 검토 → **confirm**
4. 대본 → 씬 → 오디오 → 프롬프트
5. 이미지 배치 생성 → **눈으로 보고** → 불량 판정 저장 → 재생성
6. 영상 생성 → **프레임 샘플로 보고** → 판정
7. Export (오디오 누락 시 조용히 넘어가지 않음)

사전조건: 앱 창이 떠 있고, 로그인이 완료돼 있음.
