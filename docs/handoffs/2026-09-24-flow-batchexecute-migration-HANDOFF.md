# HANDOFF — Flow 가 flow.google.com(Angular·batchexecute)으로 옮겨가 Flow 모드 생성 파이프라인이 끊겼다

작성: 2026-09-24 · 워크트리: `AutoFlowCut-bugfix` (branch `main` @ `c9000c35`, **오늘 수정분 미커밋**)
관련 메모리: `autoflowcut-flow-moved-to-batchexecute`, `fal-seedance-25-single-pass-ad`

---

## 0. 한 줄 요약

새 Flow(`flow.google.com`)는 **Angular 앱(`AiSandboxAngularFrontend`)이고 모든 RPC 가 `POST /_/AiSandboxAngularFrontend/data/batchexecute`(XHR, 쿠키 인증)** 로 나간다.
옛 Flow 모드가 기대던 세 기둥 — ① NextAuth 세션 API 의 Bearer 토큰, ② aisandbox REST 직접 호출(상태 폴링·미디어), ③ 페이지 `fetch` 몽키패치로 생성 응답 캡처 — 가 **전부 사라졌다**.
"Flow 로그인이 필요합니다" 토스트는 로그인 문제가 아니다(로그아웃/재로그인 실측 무효). DOM 층(프로젝트 열기·새 프로젝트 만들기·버튼 클릭)은 살아 있다.

---

## 1. 증거 (전부 이 저장소 `docs/handoffs/evidence/` 에 복사해 둠)

| 파일 | 무엇을 증명하나 |
|---|---|
| `2026-09-23-flow-net-trace.log` | main 의 `webRequest.onBeforeSendHeaders` 추적. 프로젝트 열 때 `batchexecute` POST 27건(auth: none, type: xhr). aisandbox 호스트 호출 **0건**, Bearer 헤더 **0건**. `session probe: miss (3 candidates) → no captured bearer` 반복 |
| `flow-diag-20260923-170017.json` | 옛 "새 프로젝트" 셀렉터(`<i>add_2</i>`)가 새 홈에서 `trusted-click:new-project → not-found` |
| `flow-dom-dump-20260923-173104.elements.json` | 새 홈 인터랙티브 요소 86개. 새 프로젝트 버튼 = `button.mdc-fab.new-project-button` + `material-symbols` 리거처 `add`(홈에서 유일) |
| Desktop `autoflowcut-net-2026-09-23T08-59-52-765Z.json` (미복사, 개인 파일) | 페이지 주입 `fetch` 캡처: `flow.google.com/fx/api/auth/session` 과 `/api/auth/session` 둘 다 **HTML(SPA 폴백)**, `labs.google/fx/api/auth/session` 은 cross-origin 이라 `{}` |
| Desktop `autoflowcut-net-2026-09-23T09-34-28-521Z.json` | 사용자가 Flow 안에서 이미지 1장 수동 생성 → 캡처된 건 reCAPTCHA `enterprise/clr` 2건뿐. **생성 요청은 fetch 가 아니라 XHR** 이라 몽키패치가 못 본다(옛 메모 "수집 0건"의 진짜 원인) |

인증 방식 관측: `ogads-pa.clients6.google.com`·`play.google.com/log` 는 `SAPISIDHASH`, `flow.google.com` 자체는 `auth: none`(쿠키). 미디어 CDN 은 `flow-content.google/image/<uuid>`(쿠키, GET).

---

## 2. 오늘 넣은 코드 (미커밋 — 먼저 §4-A 대로 정리·커밋할 것)

`git status` 기준:

| 파일 | 내용 | 테스트 |
|---|---|---|
| `electron/flow-new-project-button.js` (신규) | 새 홈 "새 프로젝트" 파인더. `i, mat-icon, [class*=google-symbols], [class*=material-symbols], [class*=material-icons]` 안의 리거처 `add`/`add_2` 로 앵커(번역 문구 안 씀). `FIND_NEW_PROJECT_BUTTON_JS` 로 주입 | `tests/electron/flow-new-project-button.test.js` 5개 ✅ **실기 검증됨** — 새 Flow 프로젝트 `8e463fb2-…` 생성·persist·ready 까지 확인 |
| `electron/ipc/dom.js` | `flow:new-project` 의 인라인 XPath 셀렉터를 위 파인더로 교체 | (위) |
| `electron/flow-session.js` (신규) | 세션 URL 후보(`{origin}/fx/api/auth/session` → `{origin}/api/auth/session` → 옛 절대주소) + 토큰 든 첫 응답을 고르는 페이지 프로브 | `tests/electron/flow-session.test.js` 6개 ✅ — **실기에서는 셋 다 miss**(새 도메인에 세션 API 없음). 무해하지만 새 Flow 엔 답이 아님 |
| `electron/flow-bearer-capture.js` (신규) | `webRequest.onBeforeSendHeaders` 로 aisandbox 요청의 Bearer 를 저장, 세션 대용 `{access_token}` 반환 | `tests/electron/flow-bearer-capture.test.js` 7개 ✅ — **실기에서는 캡처 0건**(새 Flow 는 Bearer 안 씀) |
| `electron/ipc/shared.js` | `readFlowSession(flowView)` 헬퍼(후보 프로브 → 캡처 Bearer 폴백), `ctx.getCapturedSessionText/getCapturedBearerAgeMs` | — |
| `electron/ipc/flow-api.js` | 세션 fetch 두 곳(`flow:extract-token`, 미디어 fetch 자동추출)을 `readFlowSession` 으로 | — |
| `electron/main.js` | `flowBearerStore`, `onBeforeSendHeaders` 훅(호스트+인증방식별 1회 `[Flow Net] host seen` 로그 — **무조건 찍힘, 게이트 필요**), `AUTOFLOWCUT_NET_TRACE=1` 이면 API성 요청 전부 `[Flow Net] req:` 로그, 부트스트랩 세션 확인도 `readFlowSession` | — |
| `src/hooks/useMcpServer.js` | ① `start-scene-batch` 에 `mode:'video'|'image'` → `handleStart(…, { tab })` 오버라이드 ② `__mcpBatchStatus()` 에 `app:{mode,flowProjectReady,activeTab}` + `video:{total,done,generating,error,pending}` | `tests/hooks/useMcpServer.startBatchMode.test.js` 4개, `useMcpServer.batchStatusApp.test.js` 3개 ✅ **실기 검증됨**(탭 전환·상태 노출) |
| `src/App.jsx` | `handleStartImpl` 이 `options.tab` 을 받아 `startTab` 으로 분기하고 `setActiveTab`; `useMcpServer` 에 `mode, flowProjectReady, activeTab` 전달 | (위) |

테스트 상태: `npx vitest run tests/electron` 205 파일/2159 통과, `tests/hooks/useMcpServer*` 13 파일/117 통과 (2026-09-23 18:0x).

**정리 필요(커밋 전):**
- `main.js` 의 `[Flow Net] host seen` 로그는 `AUTOFLOWCUT_NET_TRACE` 게이트 안으로(프로덕션 로그·Sentry breadcrumb 소음).
- `flow-session.js` / `flow-bearer-capture.js` 는 남겨도 무해하나, 헤더 주석에 "새 Flow 에선 둘 다 miss — §3 의 batchexecute 작업이 진짜 수정" 한 줄 추가.
- `FLOW_URL` 상수는 아직 `https://labs.google/fx/tools/flow`(리다이렉트로 동작). 필요 시 `flowUrl.js` 의 `FLOW_BASE` 로 통일.

---

## 3. 해야 할 일

### A. 오늘 수정분 커밋 (P0, 30분)
1. §2 "정리 필요" 반영.
2. `npx vitest run` 전체 초록 확인.
3. 커밋(영어 메시지, 예: `fix(flow): find the new-project FAB on flow.google.com; add MCP video-mode batch and batch-status diagnostics`).
4. 푸시 여부는 사용자 확인(`main` 직접이면 브랜치 먼저).

### B. Flow 모드 재작업 — batchexecute (P1, 프로젝트 규모)
목표: Flow 모드에서 이미지·T2V 생성 → 상태 → 미디어 수집이 다시 돈다.

1. **프로토콜 역공학** (관측 우선, 추측 금지)
   - `AUTOFLOWCUT_NET_TRACE=1` 로 앱을 띄우고, Flow 안에서 **수동으로** 이미지 1장·영상 1개를 생성하며 main 의 `webRequest` 로 `batchexecute` 요청/응답 본문을 캡처하는 임시 훅을 추가(`onBeforeRequest` 의 `uploadData` + `debugger` 없이 응답은 `onCompleted` 로는 못 봄 → 페이지 주입에서 **XMLHttpRequest 를 몽키패치**해 `responseText` 를 `flow:report-response` 로 보내는 게 현실적).
   - 확인할 것: 폼 필드 `f.req`(JSON-in-JSON, `rpcids`), `at`(XSRF 토큰 — 페이지 초기 데이터 `WIZ_global_data` 의 `SNlM0e`), `f.sid`, `bl`, `hl`; 응답의 `)]}'` 프리픽스 + 길이 프리픽스 청크.
   - rpcid 를 목적별로 표: 프로젝트 초기 데이터 / 미디어 목록 / 이미지 생성 / T2V 생성 / 생성 상태 / 미디어 URL. 각 rpcid 의 요청·응답 샘플을 `docs/handoffs/evidence/` 에 저장(개인 id 마스킹).
2. **인증 게이트 교체**: flow 모드 `handleStartImpl` 의 `getAccessToken` 게이트를 "Flow 프로젝트 컴포저 진입 확인(`flowProjectReady`)" 으로. `useVideoAutomation` 296행의 `token` 필수 조건도 flow 모드에선 제거.
3. **생성 응답 캡처**: `flow-page-injection.js` 에 XHR 후킹 추가(현재 `fetch` 만). 라우팅은 URL 이 아니라 **rpcid 기준**(`reportResponseRouter.js`).
4. **상태 폴링**: `flow:check-video-status`(aisandbox REST + Bearer) → batchexecute 의 상태 rpc 로 교체하거나, 페이지가 스스로 폴링하는 응답을 XHR 훅으로 받아 쓰기(후자가 안전 — 서버 스펙 변화에 페이지가 맞춰줌).
5. **미디어 다운로드**: `flow-content.google/...`(쿠키)로. `sessionFetch`(view 세션) 그대로 쓰면 됨. `MEDIA_REDIRECT_URL`(labs.google trpc) 는 폐기.
6. **캐릭터/레퍼런스 API**(`electron/ipc/character.js`, `flow-character-api.js`)도 같은 이유로 깨져 있을 가능성 큼 — 별도 관측.
7. 테스트: rpc 페이로드 빌더·파서는 순수 함수로 두고 캡처 샘플로 픽스처 테스트. 실기 게이트는 "이미지 1장 생성→파일 저장"·"T2V 1개→mp4 저장" 두 개.

리스크: Google 이 다시 바꾸면 또 깨진다. 구현 전에 사용자와 **"Flow 모드를 유지할 가치가 있는가(무료) vs API/fal 로 갈아탈까"** 를 먼저 결정.

### C. 대안 경로 — fal.ai Seedance 2.5 (P2, 1~2일)
2026-09-23 스탠드얼론 스크립트(`~/Documents/AutoFlowCut/pringles-20s-ad/fal/run_seedance.py`)로 검증됨:
- `bytedance/seedance-2.5/text-to-video`, 4~30초 단일 패스, 9:16, 오디오 동시 생성. **타임코드 샷리스트 프롬프트 하나로 20초 광고의 7비트가 순서대로** 나옴. 720p 20초 ≈ $9.24(추정; 대시보드 실측은 더 낮았음).
- 브랜드는 이름을 그대로 쓰면 로고·화면 문구까지 렌더. 철자는 시드 복불복(3회 중 1회 "PRINLES") → 프레임 크롭 검수 필수.
- fal 큐 REST: 서브경로 엔드포인트는 상태 URL 에 sub 가 안 붙음(제출 응답의 `status_url`/`response_url` 사용).

앱에 넣는다면: `AutoFlowCut-main`(`feature/multi-provider-genapi`)의 `electron/api/providers/video/fal.js`(PROVISIONAL, Kling I2V 기본)에 **T2V + Seedance 2.5 엔드포인트 + duration 4~30 + `generate_audio`** 를 추가하고, "스토리 모드(샷리스트 → 단일 클립)" 를 새 생성 모드로. 키는 `keyStore`(현재 `keys/` 비어 있음).

### D. 잡일
- **Electron dev 재시작 시 옛 인스턴스가 안 죽고 3210 을 쥠** → 새 인스턴스가 HTTP 서버를 못 열고 재시도도 없음. `before-quit`/`window-all-closed` 경로 확인, 또는 `startMcpHttp` 에 EADDRINUSE 재시도 추가. 오늘은 `pkill -f MacOS/AutoFlowCut && pkill -f bin/vite` 후 `env -u ELECTRON_RUN_AS_NODE npm run dev` 로 우회.
- 셸에 `ELECTRON_RUN_AS_NODE=1` 이 박혀 있음(메모리 `autoflowcut-dev-crash-electron-run-as-node`).
- MCP 서버(`~/.claude.json` → `AutoFlowCut/mcp-server/index.js`)의 `load_csv mode:'video'` 는 라벨만 바꿈. 실제 T2V 프롬프트는 CSV `video_prompt`/`video_t2v_prompt` 컬럼이 `videoT2VPrompt` 로 감. `videoT2VSelected` 는 기본 false → `update-scene` 으로 켜야 함. README 에 적을 것.

---

## 4. 검증 방법 (새 세션이 상태를 다시 세우는 순서)

```bash
cd ~/workspace/AutoFlowCut-bugfix && git status --short          # §2 파일들이 보여야 함
npx vitest run tests/electron tests/hooks/useMcpServer            # 초록
pkill -f "MacOS/AutoFlowCut"; pkill -f "node_modules/.bin/vite"
AUTOFLOWCUT_NET_TRACE=1 env -u ELECTRON_RUN_AS_NODE npm run dev > /tmp/afc-dev.log 2>&1 &
curl -s localhost:3210/api/batch-status | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['app'], d['video'])"
grep -n "Flow Net\] req:" /tmp/afc-dev.log | head                   # batchexecute 가 보이면 §1 재현
```
프로젝트 `pringles-20s-ad`(`~/Documents/AutoFlowCut/pringles-20s-ad`)에 7씬(`videoT2VPrompt`·선택됨)과 Flow 프로젝트 id `8e463fb2-0b5c-4a71-badb-3f6e0f0f342b` 가 들어 있어 재현용으로 쓰기 좋다.

---

## 5. 새 세션용 시작 문구 (복사해서 붙여넣기)

```
AutoFlowCut-bugfix 워크트리(~/workspace/AutoFlowCut-bugfix, main)에서 이어서 작업해.
먼저 docs/handoffs/2026-09-24-flow-batchexecute-migration-HANDOFF.md 를 끝까지 읽고,
§2 의 미커밋 수정분을 §3-A 순서대로 정리해서 커밋해줘(전체 vitest 초록 확인 후, 커밋 메시지는 영어, 푸시는 나한테 물어봐).
그다음 §3-B(Flow 모드 batchexecute 재작업) 1번 "프로토콜 역공학"만 진행해: 추측으로 rpcid 를 정하지 말고,
AUTOFLOWCUT_NET_TRACE=1 로 앱을 띄우고 XHR 캡처 훅을 붙인 뒤 내가 Flow 안에서 이미지 1장·영상 1개를 수동 생성할 테니
그 요청/응답을 캡처해서 rpcid 표를 docs/handoffs/evidence/ 에 남겨줘(개인 id 는 마스킹).
구현(§3-B 2~7)은 표가 나온 뒤 나랑 "Flow 모드 유지 vs fal/API 전환" 결정하고 시작해.
막히는 곳은 개발해서라도 뚫되, 크레딧이 드는 생성은 매번 나한테 물어봐.
```
