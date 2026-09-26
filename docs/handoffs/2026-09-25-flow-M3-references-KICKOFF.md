# KICKOFF — M3 레퍼런스 (새 Flow = flow.google.com · batchexecute)

작성: 2026-09-25 · 워크트리 `~/workspace/AutoFlowCut-bugfix` · 출발점 브랜치 `fix/flow-batchexecute`(M2 완료, 44커밋 미푸시) → **M3 는 여기서 새 브랜치 `feat/flow-m3-references` 를 따서** 진행(M2 를 따로 푸시·머지할 수 있게).
배경: `docs/handoffs/2026-09-25-flow-batchexecute-M2-live-passed-HANDOFF.md`(§0-1 최신 상태 · §2 설계 규칙 · §5 함정) · 계획서 `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md`(§3 공통 규칙) · 실기 증거 `docs/handoffs/evidence/2026-09-25-m2-live-gate.md`.

---

## 1. 목표

Flow 모드에서 **레퍼런스가 태그된 씬**(캐릭터·장소·사물·스타일 레퍼런스 이미지)과 **@멘션 캐릭터**가 새 flow.google.com 에서 생성되게 한다. 지금은 M1·M2 의 fail-closed 게이트가 **제출 전에 거부**한다(크레딧 0, 사용자에겐 "Flow 모드는 레퍼런스 이미지와 @멘션을 아직 지원하지 않습니다").

## 2. 지금 막는 자리 (M1-10 게이트 — M3 가 여는 곳)

| 자리 | 코드 | 결과 |
|---|---|---|
| 엔진 입력 게이트(이미지) | `src/engine/engineFlow.js` `flowInputGate` — `matchedRefCount > 0` 또는 `referenceImages` 가 있으면 | `flow-references-unsupported` |
| 이미지 핸들러 | `electron/ipc/flow-angular.js` `generateImage` — `referenceImages` 비어 있지 않으면 | `flow-references-unsupported` |
| 영상 엔진 | `engineFlow.generateVideoT2V` — `segments`(@멘션 칩) / 실제 ref 이미지 | `flow-mention-chips-unsupported` / `flow-t2v-reference-images-unsupported` |
| 영상 핸들러 | `flow-angular.js` `generateVideoT2V` — `segments` | `flow-mention-chips-unsupported` |
| 캐릭터(Ref 탭) | 옛 사이트는 `/characters` 컴포저 entity + @멘션 칩(`electron/flow-character-api.js`, `electron/ipc/character.js`, 옛 `flow-compose-mention.js`) | 새 사이트 **미관측** |

## 3. 아무도 본 적 없는 것 → 캡처로 확인

1. 컴포저의 **"소재 추가"** 버튼(`button[aria-label="프롬프트 상자에 소재 추가"]`, 아이콘 `add`) 팝업 DOM.
2. **로컬 이미지 업로드 경로** — batchexecute rpcid 인지, 별도 업로드 엔드포인트인지(NET_TRACE 는 xhr·fetch·webRequest 를 전부 찍는다). 업로드가 앱이 직접 불러도 되는 RPC 인지(reCAPTCHA 토큰 없음?), 아니면 페이지 UI(파일 입력)를 거쳐야 하는지.
3. 레퍼런스가 붙은 **이미지 생성(`ogiZ0b`) 요청**에서 레퍼런스 미디어 id 의 위치·개수 제한.
4. 레퍼런스가 붙은 **영상 제출(`YhhmEf`)** 의 모델 키 — 진리표에 `abra_r2v_6s` 가 있다(reference-to-video 로 추정). 요청 안 레퍼런스 위치, 크레딧.
5. 새 사이트에 **캐릭터 엔티티와 @멘션**이 있는지 — 있으면 멘션 목록·칩 DOM 과 요청 모양.
6. 크레딧: 레퍼런스 이미지 생성이 여전히 0 인지, r2v 가 몇 크레딧인지(Omni 는 길이 비례: 4초 7·6초 10, Veo Fast 8초 20).

## 4. 캡처 절차 (사용자 손 1회 — 새 세션이 한 단계씩 안내한다)

에이전트가 앱을 추적 모드로 띄운다:
```bash
cd ~/workspace/AutoFlowCut-bugfix
pkill -f "MacOS/AutoFlowCut"; pkill -f "node_modules/.bin/vite"
AUTOFLOWCUT_NET_TRACE=1 AUTOFLOWCUT_NET_TRACE_FILE=<scratch>/flow-capture-m3.jsonl env -u ELECTRON_RUN_AS_NODE npm run dev > <scratch>/afc-dev-m3.log 2>&1 &
# 준비: curl -s localhost:3210/api/batch-status → app.flowProjectReady:true
```
사용자가 Flow 창에서(각 단계 끝에 **`Cmd+Shift+E`** = 인터랙티브 요소 DOM 덤프 → 바탕화면 `flow-dom-dump-*.elements.json`):
- a. 이미지 모드에서 **소재 추가** 클릭 → 팝업이 열린 상태에서 `Cmd+Shift+E`
- b. 로컬 이미지 1장 업로드 → 첨부된 상태에서 `Cmd+Shift+E`
- c. 프롬프트 입력 후 **이미지 1장 생성**(0크레딧)
- d. (선택, 크레딧 확인 후) 영상 모드에서 같은 소재로 Omni 4초 1개 — r2v 키·크레딧 확인
- e. (선택) 프롬프트에 `@` 입력 → 멘션 목록이 뜨면 `Cmd+Shift+E`

에이전트가 분석·커밋: `python3 scripts/flow-rpc-table.py <scratch>/flow-capture-m3.jsonl --out-md <scratch>/rpc-table-m3.md` → 새 rpcid 를 `docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md` 에 추가, 요청·응답 **마스킹 샘플**(UUID·토큰·서명 URL·프롬프트 마스킹)과 DOM 덤프를 `docs/handoffs/evidence/2026-09-2x-m3-*` 로.

## 5. 진행 순서 (M1·M2 와 같다)

1. 캡처 → 증거 커밋.
2. **계획서** `docs/plans/2026-09-2x-flow-M3-references-plan.md` — 설계 결정·TDD 작업 목록·수용 게이트. M2 규칙 재사용: 돈 규칙(`generationId` 있고 `videoPath` 없으면 재제출 금지) · fail-closed(모르는 모양은 클릭 전 거부) · 제출은 신뢰 클릭만 · 요청 본문 변조 금지 · CDP 금지 · 로그·Sentry 에 내용 금지 · 방패·키 잠금·포커스 규칙(§5 함정).
3. 계획 리뷰(저자와 다른 모델 독립 2인) → findings 0.
4. TDD 구현(저자) → 전체 vitest(메인 루프 판정) → 코드 리뷰(다른 모델 2인, 사본 분리) → findings 0.
5. **실기 게이트** — 레퍼런스 이미지 1장(0크레딧) → 레퍼런스 영상 1개(크레딧, 사용자 확인).

## 6. 미리 알아둘 함정

- 업로드는 **파일 입력(`input[type=file]`)** 일 가능성이 높다 — CDP 금지. 옛 코드에 파일 주입 경로가 있다(kind `character-file-injection-failed` 등) — 새 DOM 에 맞는지 확인. 파일 대화상자를 띄우지 않고 주입하는 방법(예: `DataTransfer` 로 `input.files` 설정 + `change` 이벤트)이 새 Angular 에서 먹는지가 첫 불확실성.
- 업로드 RPC 를 앱이 직접 불러도 되는지는 캡처로 판정 — 제출 RPC 처럼 reCAPTCHA 토큰이 붙으면 UI 경유만.
- 레퍼런스 개수·크기 제한, 지원 포맷, 업로드 실패 프레임 모양 — 관측 전엔 fail-closed.
- 캐릭터 entity 가 새 사이트에 없으면 @멘션은 "레퍼런스 이미지로 첨부"로 대체하는 설계를 계획서에서 결정(사용자 확인).
- M2 함정 전부 유효: 화면 밖 뷰는 재레이아웃 안 됨 · Escape 로 닫은 패널은 다음 트리거 클릭이 헛돔 · 한글 IME 는 키 잠금을 우회 · 문서 이동을 넘긴 `executeJavaScript` 는 영영 안 끝남 · 셸에 `ELECTRON_RUN_AS_NODE=1`(`env -u`) · 세션의 `grep` 은 셸 함수(`/usr/bin/grep`).
- 저자: Opus 5.5 또는 Fable 5.1(Fable 은 9/25 크레딧 소진 이력). 리뷰는 **저자와 다른 모델**(Sonnet · Codex `gpt-6-astra` xhigh — 9/27 06:01 이후 · Fable). 같은 모델끼리는 맹점을 공유한다.

## 7. 새 세션 시작 문구

```
AutoFlowCut-bugfix 워크트리(~/workspace/AutoFlowCut-bugfix)에서 M3(레퍼런스)를 시작해.
먼저 docs/handoffs/2026-09-25-flow-M3-references-KICKOFF.md 를 끝까지 읽고, 배경은 docs/handoffs/2026-09-25-flow-batchexecute-M2-live-passed-HANDOFF.md(§0-1·§2·§5).
브랜치는 fix/flow-batchexecute 에서 feat/flow-m3-references 를 새로 따서 작업해(M2 는 따로 둔다).
첫 단계는 캡처야: 앱을 NET_TRACE 로 띄우고, 내가 Flow 창에서 할 일(소재 추가 팝업 → 이미지 업로드 → 이미지 생성 → 각 단계 Cmd+Shift+E 덤프)을 한 단계씩 안내해.
내가 끝났다고 하면 로그·덤프를 분석해 rpc 표·마스킹 샘플·DOM 증거를 커밋하고, 계획서 → 저자와 다른 모델 독립 2인 계획 리뷰 → TDD 구현 → 코드 리뷰 findings 0 → 실기 게이트 순서로 가.
구현 저자는 Opus 5.5(또는 Fable 5.1), 리뷰는 저자와 다른 모델(리뷰어별 사본 분리). 전체 vitest 판정·커밋은 네가 직접, 커밋 메시지는 영어, 푸시는 나한테 물어봐.
M2 규칙(돈 규칙 · fail-closed · 제출은 신뢰 클릭만 · 요청 본문 변조 금지 · CDP 금지 · 로그에 내용 금지)은 그대로 지켜.
크레딧이 드는 생성은 매번 나한테 물어봐(이미지 0크레딧 생성은 네가 직접 돌려도 돼).
```
