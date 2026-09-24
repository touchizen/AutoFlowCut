# HANDOFF — Flow 모드(flow.google.com·batchexecute) 재작업: M1(이미지) 완료·실기 통과, M2(영상) 구현 중

작성: 2026-09-25 01:15 · 워크트리 `~/workspace/AutoFlowCut-bugfix` · 브랜치 **`fix/flow-batchexecute`**(`main` `52c7930b` 에서 분기) · **전부 미푸시**(`main` 의 09-24 커밋 10개도 미푸시 — 푸시는 사용자 결정)
이전 핸드오프: `docs/handoffs/2026-09-24-flow-batchexecute-migration-HANDOFF.md`(왜 깨졌나) · 관련 메모리: `autoflowcut-flow-moved-to-batchexecute`

---

## 0. 한 줄 요약

새 Flow(`flow.google.com`, Angular + batchexecute) 위에서 **앱의 이미지 생성 경로가 다시 돈다** — 세션 판정 → 에이전트 OFF → 설정 패널(모드·비율·개수·모델 검증) → 프롬프트 주입 → 신뢰 클릭 제출 → 페이지 XHR 캡처(`ogiZ0b`) → 치수 검증 → 서명 URL 다운로드. 실기 3회 검증(0크레딧). **영상(T2V, `YhhmEf`/`jwpduf`/`as29s`)은 Fable 5.1 이 구현 중**이며, 실기 게이트 1회는 **10크레딧**이라 사용자 확인이 필요하다.

---

## 1. 지금 상태

### 1-1. 브랜치 커밋 (`git log --oneline main..HEAD`)

| 커밋 | 내용 |
|---|---|
| `21d65a8f` | 증거: 라이브 컴포저 마크업(닫힌 상태, 이미지·영상 모드) |
| `5c9cc74e` | **계획서** `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md`(R5, 리뷰 5라운드 89건 처분 §7~§10) |
| `82ef3de1` | **M1 구현**(Fable): `flow-rpc-protocol/-capture/-router/-client.js`, `flow-composer-dom/-settings.js`, `ipc/flow-angular.js`, `flow:session-status`, Sentry 스크럽, 미지원 입력 거부 |
| `d468f8e8` | 실기 결함 1: `flow:open-project` 가 2초 뒤 단발 검사 → 컴포저가 그려질 때까지 최대 15s 폴링(`waitForProjectLoaded`) |
| `4345f9f7` | 실기 게이트 통과 기록 |
| `8aebbc03` | **M1 코드 리뷰 1라운드 반영**(Opus×2, 26건) — Esc 는 body `keyCode 27`, 주입 전 포커스·확대, 세션 이유 토스트, errorParams 배관, 가드 추가 등 |
| `7670858b` | 실기 결함 2: 뷰 폭 597px 에선 flow.google.com 이 에이전트 칩을 안 그림 → DOM 단계 전체를 **화면 밖 자동화 뷰포트(≥700×600)** 로 |
| `22e673d6` | 실기 재확인 기록(실패→수정→통과) |

계획 앞의 `main` 커밋들(09-24 낮): 핸드오프·증거·트레이스 훅(`46835bf5` `AUTOFLOWCUT_NET_TRACE=1`)·rpcid 표(`3a95609b`)·DOM 덤프들.

### 1-2. 테스트

```bash
cd ~/workspace/AutoFlowCut-bugfix && env -u ELECTRON_RUN_AS_NODE npx vitest run   # 셸에 ELECTRON_RUN_AS_NODE=1 이 박혀 있다
```
마지막 판정(내 환경, `7670858b`): **727 파일 / 7756 테스트 초록, 4 파일·54 테스트 스킵**. 스킵은 새 호스트에서 도달 불가한 옛 핸들러 전용 스위트(`generateSceneAspect`, `flowModeSwitchAbort`, `mentionFailureRouting`, `flowGenerateImageAgentScope`; `generateCharacterAspect` 의 두 행은 다시 live) — 후속 정리에서 옛 코드와 함께 삭제(플랜 §11 #18).

### 1-3. ⚠️ 작업 트리에 미커밋 변경이 있을 수 있다 — **M2 저자(Fable 서브에이전트)가 이 세션에서 돌고 있었다**

새 세션엔 그 에이전트가 없다. 시작할 때:
1. `git status --short` 로 변경분을 본다. 있으면 `docs/plans/…rework-plan.md` 의 `## 12. 구현 메모 (M2)` 와 `### 11.1` 의 #41~#48(리뷰 2라운드 부록 8건)이 얼마나 채워졌는지 읽는다.
2. `env -u ELECTRON_RUN_AS_NODE npx vitest run` 을 돌린다. 초록이고 §12 가 M2-1~M2-6 을 다 적었으면 그대로 커밋(영어 메시지) 후 §4 로. 빨강이거나 반쪽이면 **새 저자 브리프**(`docs/handoffs/briefs/2026-09-25/fable-m2-brief.md` 를 바탕으로 "이미 있는 것 + 남은 것"을 적어) 로 Fable 5.1 에게 이어받기(`Agent(model:'fable')`)를 시킨다 — 저자가 트리에서 도는 동안엔 커밋·뮤테이션 금지.
3. 변경분이 없으면 M2 는 시작 전이다 — 같은 브리프로 처음부터.

### 1-4. 정본 문서

| 문서 | 무엇 |
|---|---|
| `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md` | 설계·TDD 작업 목록·**§3 머리 "구현자 공통 규칙"**(결과 계약·kind→params·배치 중단 의미·마감/시각·주입 문자열·로그·픽스처)·§7~§10 리뷰 처분·§11 구현 메모 |
| `docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md` | rpcid 표(전송 계층·프로젝트 열기·생성 단계·DOM) |
| `docs/handoffs/evidence/2026-09-24-flow-batchexecute-samples.masked.jsonl` | 마스킹 샘플 = 테스트 픽스처(요청 본문은 URL 디코드돼 있어 재인코딩) |
| `docs/handoffs/evidence/2026-09-24-flow-composer-*.json/html` | 컴포저·설정 패널·모델 메뉴 DOM |
| `docs/handoffs/evidence/2026-09-24-m1-live-gate.md` | 실기 3회 로그(무엇이 됐고 무엇이 깨졌나) |
| `docs/handoffs/briefs/2026-09-25/` | 저자·리뷰어 브리프 원문 + 코드 리뷰 findings 4벌(스크래치패드 경로 참조는 죽은 링크 — 내용은 이 폴더에 있다) |

---

## 2. 설계 요지 (구현된 것)

- **인증**: Bearer 대신 `flow:session-status`(Flow 호스트 URL + `WIZ_global_data{SNlM0e,FdrFJe,cfb2h}` + 읽기 RPC `nzlxg` 성공) → 렌더러 센티널 `'flow-session'` + 이유(`flowSessionReason`). `not-on-flow`/`wiz-missing` 은 로그인 토스트, `rpc:*`/`timeout` 은 "세션 확인 실패" 토스트.
- **제출**: 앱은 제출 RPC 를 만들지 않는다(reCAPTCHA 토큰은 페이지가 붙인다). 프롬프트 주입 → 신뢰 클릭. 항상 켜진 페이지 주입 `flow-rpc-capture.js` 가 `ogiZ0b`/`YhhmEf` XHR 의 send/loadend 를 보고하고, `flow-rpc-router.js` 가 **send 시점에 `{doc, seq}` 로 pending gen 에 결속**(문서 nonce, 문서 커밋 시 미완료 gen 은 `flow-submit-lost`).
- **읽기 RPC**: `flow-rpc-client.js` 가 페이지 컨텍스트 XHR 로 `nzlxg`/`jwpduf`/`as29s` 만 호출(허용 목록, 그 외 throw).
- **설정 패널**: `flow-composer-settings.js` — Material 토글을 리거처·텍스트로 찾고(id 는 자동 번호라 무시), 한 `executeJavaScript` 안에서 2단계(모드 → 재스캔 → 모델 → 비율·길이·해상도·개수), 닫기는 body `keyCode 27`, 실패 시 트리거 재클릭 폴백.
- **뷰포트**: 뷰가 0×0(모달) 이거나 좁으면(<700×600) DOM 단계 전체를 화면 밖 정본 크기로 두고 finally 에서 `updateBounds` 로 원복(`offscreen-bounds.js`).
- **fail-closed**: 미지원 입력(레퍼런스·@멘션·에이전트 모드·업스케일)은 제출 전 거부; 설정 미검증·모델 불일치(`flow-image-model-mismatch {requested, panel}`)·치수 불일치(±3%)·캡처 미설치·주입 불일치는 클릭/다운로드 전에 실패. 옛 핸들러 12개는 새 호스트에서 `flow-feature-unsupported:<name>`.
- **로그·Sentry**: 값(프롬프트·URL·토큰) 금지, `flow-content.google` 서명 URL 스크럽, 에러 문구에 숫자·auth 단어 금지(`rpcCode`/`httpStatus` 별도 필드 — `isFlowAuthError` 가 `\b403\b` 를 잡기 때문).

---

## 3. 실기 절차 (M1 게이트 — 0크레딧)

```bash
cd ~/workspace/AutoFlowCut-bugfix
pkill -f "MacOS/AutoFlowCut"; pkill -f "node_modules/.bin/vite"
AUTOFLOWCUT_NET_TRACE=1 AUTOFLOWCUT_NET_TRACE_FILE=/tmp/flow-capture.jsonl env -u ELECTRON_RUN_AS_NODE npm run dev > /tmp/afc-dev.log 2>&1 &
# 준비: curl -s localhost:3210/api/batch-status → app.flowProjectReady === true (저장된 Flow 프로젝트 열기 15s 폴링 포함)
```
- MCP(`mcp__autoflowcut__*`): `app_open_project('pringles-20s-ad')`(레퍼런스 0, 씬 비율 9:16) → `app_generate_scene(sceneId, styleId:'none')` → `/api/scenes` 로 결과.
- **레퍼런스가 태그된 씬은 `flow-references-unsupported` 로 제출 전 거부된다(의도)** — 게이트엔 레퍼런스 없는 프로젝트를 써라.
- 기대 로그 순서: `[Flow Session] ready credits=<n>` → `[Flow API] [Angular] generate-image` → `ensureAgentOff: already OFF` → `[Flow Settings] image mode=… ratio=…(crop_9_16) count=… model=verified ok=true` → `[Flow API] [Angular] submitted gen=<8>` → `[Flow RPC] ogiZ0b send doc=<8> seq=<n> bound=<8>` → `loadend seq=<n> status=200` → `results=1 768x1376` → `image 768x1376 ratio=ok` → `[AsyncCollect] download host=flow-content.google media=<8> bytes=<n>`. 씬 `done`, 파일 `scenes/<id>.jpg`, 크레딧 불변.
- 뷰가 좁거나 숨겨졌으면 `view narrow|hidden WxH → automation viewport WxH offscreen` 가 먼저 찍힌다(957×1022 에선 안 찍힘 — 좁은 경로는 아직 실기 미확인, 단위 테스트만).
- 표 재생성: `python3 scripts/flow-rpc-table.py /tmp/flow-capture.jsonl --out-md /tmp/rpc-table.md`.

---

## 4. 다음 할 일 (순서대로)

1. **M2 회수**(§1-3) → 전체 vitest → 커밋.
2. **M2 코드 리뷰**: 저자와 다른 모델로 독립 2인. Codex `gpt-6-astra`(xhigh)는 사용량 한도가 자주 걸린다(09-24 밤 두 번; 리셋 09-25 04:39) — 걸리면 Opus 독립 인스턴스 두 개(일반 축 / 테스트·배선 축), **리뷰어마다 rsync 사본**(`--exclude node_modules --exclude .git`, node_modules 는 심볼릭 링크, `.git` 은 넣지 말 것 — 워크트리 `.git` 파일이 원본 메타데이터를 가리킨다). 프롬프트 원문: `briefs/2026-09-25/m1-review-prompt.md`(M2 용으로 커밋 해시·범위만 바꿔라). findings 0(또는 MINOR 만 남고 판단 가능)까지 저자 수정 루프.
3. **M2 실기 게이트 — 10크레딧, 사용자에게 먼저 묻는다.** 플랜 §4 M2: Omni Flash·6초·720p·16:9(또는 9:16) 씬 1개. 기대: `[Flow Settings] video …ok=true` → `[Flow RPC] YhhmEf send/loadend` → `submitted media=<8> creditsLeft=<n>` → `[Flow VideoStatus] … state=2 → pending`×k → `state=3 → complete` → `[Flow VideoDownload] host=flow-content.google …` → mp4 가 videos 폴더, 크레딧 −10. 실패는 kind 로 닫힌다(`flow-video-settings-mismatch`/`-count-mismatch` 는 `rejectedMediaId` 동반, 새 제출만 중단).
4. **정리**: 옛 핸들러·스킵 스위트 삭제(플랜 §11 #18), `FLOW_URL` 상수 통일, 진단 훅(`flow-xhr-capture.js`)은 유지, `flow-session.js`/`flow-bearer-capture.js` 는 삭제 후보.
5. **머지·푸시**: 사용자 결정(`main` 직접 vs PR). 릴리스 전 눈검증(모달 열린 상태·좁은 창에서 생성, 모델 불일치 안내문에 값이 채워지는지).
6. **범위 밖**(각각 수동 캡처 1회 필요): 레퍼런스/캐릭터 첨부("소재 추가"), 프레임→영상, 업스케일, 이미지 모델 선택, 실패 프레임(콘텐츠 정책·reCAPTCHA 거부·크레딧 소진)의 실제 모양.

---

## 5. 실기에서 배운 함정 (다시 밟지 말 것)

- **새 사이트는 미디어 목록이 5~6초 뒤에 와 컴포저가 늦게 그려진다** → 단발 검사 금지, 폴링.
- **뷰 폭 <600 이면 에이전트 칩이 렌더되지 않는다**(Material handset) → 자동화 뷰포트. 597 실패·957 통과 실측.
- **CDK 오버레이는 `document` 의 `key:'Escape'` 로 안 닫힌다** — body 에 `keyCode 27`.
- 옛 `closeAgentPanels` 는 새 DOM 에 없는 버튼을 무조건 클릭해 "Button not found" 2건을 남겼다 → 프로브 뒤에만.
- `flowProjectReady:false` 는 인증이 아니라 **프로젝트 바인딩** 상태(§1-3 open 실패 → 죽은 매핑 삭제 → 다음 기동에 새 프로젝트 생성).
- 감시 스크립트에서 `wc -l` 출력의 앞 공백 → `tail -n +` 이 깨진다(`tr -d ' '`).
- Codex CLI 는 `npx -y @openai/codex@latest`(캐시된 0.144 는 `gpt-6-astra` 거절).

---

## 6. 리뷰 운영 기록

| 단계 | 라운드 | 리뷰어 | 결과 |
|---|---|---|---|
| 계획서 | R1 | Codex gpt-6-astra + Opus | BLOCKER 2·MAJOR 20·MINOR 14 → 36 처분 |
| 계획서 | R2~R4 | Opus×2(Codex 한도) | 24 / 18 / 11 처분, 기각 0 |
| 계획서 | R5 | — | fold-in, 커밋 `5c9cc74e` |
| M1 코드 | R1 | Opus×2 | MAJOR 6·MINOR 20 → `8aebbc03` |
| M1 코드 | R2 | Opus×2 | MINOR 11(고유 8) → M2 라운드 부록으로 반영 중 |

역할: 저자 Fable 5.1(`Agent(model:'fable')`), 리뷰 독립 2인, 오케스트레이션·전체 vitest 판정·실기·커밋은 메인 루프.

---

## 7. 새 세션 시작 문구

```
AutoFlowCut-bugfix 워크트리(~/workspace/AutoFlowCut-bugfix, 브랜치 fix/flow-batchexecute)에서 이어서 작업해.
먼저 docs/handoffs/2026-09-25-flow-batchexecute-M1-done-M2-inflight-HANDOFF.md 를 끝까지 읽고 §1-3 대로 작업 트리 상태를 판정해.
M2(영상)를 §4 순서로 끝내되, 리뷰는 저자와 다른 모델 독립 2인(사본 분리)으로 findings 0 까지, 커밋 메시지는 영어, 푸시는 나한테 물어봐.
M2 실기 게이트는 10크레딧이 드니 돌리기 전에 반드시 나한테 확인받아. 이미지 게이트(0크레딧)는 §3 대로 네가 직접 돌려도 돼.
```
