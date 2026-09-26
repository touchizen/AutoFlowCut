# HANDOFF — M3 레퍼런스: 구현·리뷰 끝, 실기 게이트 남음 (G1 첫 시도는 생성이 안 나감)

작성: 2026-09-26 · 워크트리 `~/workspace/AutoFlowCut-bugfix` · 브랜치 **`feat/flow-m3-references`**(`fix/flow-batchexecute` `f00a2775` 위, 19커밋, **전부 미푸시**) · 앱 꺼짐 · 트리 깨끗
이전 문서: 킥오프 `docs/handoffs/2026-09-25-flow-M3-references-KICKOFF.md`, M2 핸드오프 `docs/handoffs/2026-09-25-flow-batchexecute-M2-live-passed-HANDOFF.md`(§2 돈 규칙 · §5 함정)

---

## 0. 한 줄 요약

새 flow.google.com 에서 **레퍼런스 이미지 · @인라인 멘션 · 레퍼런스 영상(r2v)** 을 여는 M3 를 캡처 → 프로브 → 계획(4라운드 리뷰, R3 findings 0) → TDD 구현(5묶음) → 코드 리뷰(2라운드, R2 findings 0)까지 끝냈다. 전체 스위트 **8649 초록 / 54 스킵**. 남은 것은 **실기 게이트 G1~G7**. G1 첫 시도는 씬이 `done` 으로 바뀌었지만 **Flow 로 요청이 한 건도 안 나갔다**(§4) — 다음 세션 첫 일.

## 1. 커밋 흐름 (`git log --oneline f00a2775..HEAD`)

| 단계 | 커밋 | 내용 |
|---|---|---|
| 캡처 | `432b2a89` | rpc 표 §7 · 마스킹 샘플 · DOM 13개 · 요약 `docs/handoffs/evidence/2026-09-25-m3-references-capture.md` |
| 계획 R0 | `ddb14b99` | `docs/plans/2026-09-25-flow-M3-references-plan.md`(저자 Opus 5.5 — Fable 5.1 소진) |
| 프로브 | `c2a815e0` · `b0683c78` | `docs/handoffs/evidence/2026-09-25-m3-probes.md`(P1~P9 + §4 중복 멘션) |
| 계획 R1~R3 | `03e2c442` · `d423b469` · `4a7f1028` · `372817e7` | 리뷰 R0 4 → R1 4 → R2 4 → **R3 0**(Sonnet×2, 사본 분리) |
| 구현 | `004961ff`(브리프) · `dce01bde` C1 · `d61272e7` C2 · `3d64a8a2` C3 · `b4cb5c83` C4 · `ccd247e8` C5 · `c5859ef9` | 묶음별 새 Opus 5.5 구현자, 전체 vitest·커밋은 메인 |
| 코드 리뷰 | `25245406`(프롬프트) · `c4d46d62`(R1 B1 핀) · `93323db5` | R1: A 0 · B MINOR 1 → 수정 · **R2: A 0 · B 0**(뮤테이션 9개 전부 빨강) |

findings 기록: `docs/handoffs/briefs/2026-09-25/findings/m3-plan-r0..r2.findings.md`, `m3-code-r1.findings.md`, `m3-code-r2.findings.md`. 브리프·리뷰 프롬프트: `docs/handoffs/briefs/2026-09-25/m3-*.md`.

버린 브랜치 `probe/m3-0`(`e11c0205` · `efcc1039`) — 프로브 라우트(`AUTOFLOWCUT_M3_PROBE=1` 일 때만 `POST /api/dev/m3-probe`). **머지 금지**, M3 끝나면 삭제. 다시 잴 일이 있으면 이 브랜치로 체크아웃해 앱을 띄운다(생성 단계는 이미지만 기본 허용, 영상은 `allowVideo`+`maxCredits`).

## 2. 무엇이 어떻게 동작하나 (설계 정본 = 계획서 R3 §2)

- **업로드**: `maseQ` 도 reCAPTCHA → UI 경유. 앱이 클립보드에 이미지 → Flow 편집기에 `webContents.paste()` → `maseQ` 응답 바인딩 → **칩 img 에 그 id 가 뜰 때까지**(busy 해제만으론 부족) 기다린다. 클립보드는 붙여넣기 관찰 즉시 복원(내가 쓴 그대로일 때만). **Finder 파일 복사(`text/uri-list`)면 업로드 중단**(`flow-reference-clipboard-busy`), 앱 전용 형식(Lexical)은 버리고 진행.
- **재사용**: 캐시 키 `${문서 nonce}|${projectId}|${sha}`(메모리만) — **같은 페이지 세션 안에서만**. 애셋 창(업로드 탭) 썸네일 id 로 찾고, 없으면 창을 한 번 다시 열고, 그래도 없으면 재업로드. 앞 세션 업로드는 썸네일이 불투명이라 레퍼런스당 세션마다 1장 중복(사용자 결정).
- **멘션**: `execCommand('insertText','@')` 로 애셋 창 → 항목 → "프롬프트에 추가". 앱은 Flow 뷰에 **키 이벤트를 안 보낸다**. `@` 로 연 창은 Escape 로만 닫힌다. 멘션 노드 `span.mention-chip[data-mention-id]`.
- **클릭 전 게이트**: 칩 id 집합 · 멘션 id 순서열(중복 포함) · 텍스트 · 설정 요약. mouseDown 직전 재판독에 칩도 포함.
- **제출·검증**: 이미지 `ogiZ0b`, 영상은 레퍼런스가 있으면 `MZZa6b`(없으면 `YhhmEf`), 서로를 대체 rpc 로 받아 **바인딩된 rpc 가 다르면 클릭 뒤 거부**(`rejectedMediaId`). 클릭 뒤 요청 refs·mentions 와 응답 되돌림이 기대와 다르면 거부(이미지는 다운로드 없음). 레퍼런스 없는 경로도 **잔여 칩을 먼저 비운다**(M2 돈 구멍 — 칩이 남으면 T2V 가 `MZZa6b` 로 나가 캡처가 못 봤다).
- **범위 밖(클릭 전 거부 유지)**: 캐릭터 엔티티, i2v, 업스케일, Veo Lite/Quality r2v, 레퍼런스 생성의 스타일 ref.

## 3. 실기 게이트 절차 (계획서 R3 §5 가 정본)

```bash
cd ~/workspace/AutoFlowCut-bugfix
pkill -f "MacOS/AutoFlowCut"; pkill -f "node_modules/.bin/vite"   # 옛 인스턴스가 남으면 3210 포트를 잡고 새 앱이 응답 안 한다(9/25 실측)
AUTOFLOWCUT_NET_TRACE=1 AUTOFLOWCUT_NET_TRACE_FILE=<scratch>/flow-capture-m3-live.jsonl env -u ELECTRON_RUN_AS_NODE npm run dev > <scratch>/afc-dev-m3-live.log 2>&1 &
# 준비: curl -s localhost:3210/api/batch-status → app.flowProjectReady:true
```
- 실기용 **앱 프로젝트 `m3-live-gate`**(9/26 생성, `~/Documents/AutoFlowCut/m3-live-gate`): 레퍼런스 `king`·`queen`(filePath = `~/Documents/AutoFlowCut/test/references/{king,queen}.jpg`), 씬 `scene_1`(G1: 프롬프트 "A king standing in a palace hall, cinematic lighting", `characters:"king"`, 멘션 없음). 넣는 법: `POST /api/update {type:'update-references', references:[…]}` · `{type:'update-scenes', scenes:[…]}`.
- 시작 전 사용자가 **AutoFlowCut 텍스트 입력창**에서 `clipboard-sentinel` 을 복사해 둔다 → 게이트마다 `pbpaste` 가 그대로여야 한다.
- G1 레퍼런스 이미지(0) → G1b 숨김 뷰(0) → G2 인라인 멘션 `@king … @queen … @king`(0, 사용자 눈) → G3 재사용(업로드 0회, `maseQ` 0건) → G3b 앱 재시작 뒤 1회 재업로드 → **G4 r2v Omni 4초 `@king`(7크레딧)** → G5 잔여 칩 이미지(0) → G6 Finder 파일 복사 거부(0) → G7 잔여 칩 영상(선택, 7).
- 크레딧: 사용자가 9/25 "크레딧 많다, 영상도 네가 눌러도 된다"고 허용 — **돌리기 전에 금액을 알리고**, 한 번에 20 초과는 먼저 묻는다.

## 4. 🔴 G1 첫 시도 — 생성이 안 나갔다 (다음 세션 첫 일, systematic-debugging)

9/26 02:3x: `m3-live-gate` 를 MCP `app_create_project` 로 만들고 레퍼런스·씬을 넣은 뒤 MCP `app_generate_scene {sceneId:'scene_1', styleId:'none'}`. 약 114s 뒤 씬 `status: done`, 클립보드는 그대로. 그러나:
- NET_TRACE 에 `ogiZ0b`·`maseQ` **0건**, main 로그에 `[Flow API] [Angular] generate-image` · `[Flow Refs]` · `[Flow Upload]` **0줄**, `m3-live-gate/scenes/` 에 이미지 없음.
- 그 사이 Flow 뷰가 저장된 Flow 프로젝트 둘을 번갈아 열었다: `[Flow Project] opening saved flow project: …/b9dd61fa…` → `…/022d1884…`(`022d1884` 는 홈 목록의 최근 프로젝트). 새 앱 프로젝트는 `flowProjectId` 가 없고 시작 때 `flowProjectReady:false` 였다.
- 가설(미검증): (1) 새 앱 프로젝트의 Flow 프로젝트 연결 경로(생성/선택)가 M3 와 무관하게 흔들려 생성이 Flow 까지 안 갔다, (2) MCP `generate-scene` 단일 씬 경로가 Flow 모드에서 다른 분기로 빠졌다(렌더러 콘솔 확인 필요 — main 로그엔 렌더러 로그가 없다), (3) 씬이 에러 없이 `done` 이 된 것 자체가 버그.
- 순서 제안: 앱 렌더러 콘솔/씬 필드(`image`, `imagePath`, `error`)부터 본다 → 이미 Flow 프로젝트가 붙은 앱 프로젝트(예: `pringles-20s-ad`, `test`)에서 같은 G1 을 해 본다(레퍼런스·씬을 거기에 추가) → 배치 경로(`start-scene-batch {mode:'image', styleId:'none'}`)로도.

## 5. 이번 세션에 배운 것 (다시 밟지 말 것)

- **프로브가 설계를 뒤집었다**: `@` 는 insertText 로 열린다 · 칩 id 는 busy 해제 ~2s 뒤 · 멘션은 칩을 **추가**한다 · 애셋 창 썸네일 id 는 **이번 페이지 세션 업로드만** · `@` 창은 Escape 로만 닫히고 Escape 는 `@` 뒤 글자까지 지운다 · 지우기는 창이 열린 동안 안 먹는다 · 붙여넣기 업로드는 앱 창 비포커스·숨김 뷰에서도 된다 · 앱 텍스트창 복사는 `application/x-lexical-editor` 를 싣는다. 캡처 한 번으로 추정한 설계(썸네일 id 로 찾기)는 틀렸었다 — 0크레딧 프로브를 계획 리뷰와 **병렬로** 돌린 게 한 라운드를 아꼈다.
- 리뷰어가 "관측 아님"이라고 한 것은 추정으로 남기지 말고 **0크레딧 실측으로 닫아라**(같은 미디어 두 번 멘션 모양 — 샘플 19·20).
- 구현자 보고의 "뮤테이션 빨강"을 믿지 말고 리뷰어가 **직접 뮤테이션을 돌리게**(사본에 `node_modules` 심링크) — R1 에서 중복 id 검사의 공허한 핀을 그렇게 잡았다.
- **vite 개발 서버는 main 파일이 바뀌면 앱을 재시작한다** — 7크레딧 캡처 중엔 main 을 고치지 마라. 재시작 뒤 **옛 인스턴스가 3210 을 잡은 채 남을 수 있다**(프로세스 둘 → 전부 죽이고 다시).
- 파이썬 `str.splitlines()` 는 JSON 안의 유니코드 줄바꿈에서 끊는다 → JSONL 은 `split('\n')`. 서명 URL 은 JSON 이스케이프(`Signature=…`)로도 나타난다 — 마스킹·누출 검사 둘 다 그 형태를 봐야 하고, 누출 검사는 **원본에 돌려 빨개지는지** 먼저 확인.
- main 이 렌더러 모듈(`src/utils/flowReferencePlan.js`)을 import 하면 가드 → 캐릭터 동기화 → React 훅까지 main 번들에 들어온다 → 상수는 import 없는 `src/utils/flowR2vLimit.js`(핀 있음).

## 6. 남은 것

1. **§4 원인 규명 → G1~G7 실기**(크레딧 고지). 실기 증거는 `docs/handoffs/evidence/2026-09-2x-m3-live-gate.md` 로.
2. 실기에서 결함이 나오면: 수정 → 전체 vitest → 그 수정분 독립 리뷰(저자와 다른 모델) → 실기 재확인(M2 와 같은 방식).
3. 정리: 계획서를 끝나면 `docs/plans-archive/` 로(레포 CLAUDE.md), `probe/m3-0` 삭제, 옛 코드 정리(계획서 §7 — `sceneMentions` 엔티티 경로·`flow-compose-mention`·`cdp-image-inject`·동기화 게이트 UI).
4. **푸시·머지**: 사용자 결정(M2 `fix/flow-batchexecute` 44커밋 + M3 19커밋 전부 미푸시, main 도 미푸시 10커밋).
5. Flow 프로젝트 `8e463fb2…` 에 프로브·캡처 잔여물(단색 PNG 여러 장, "제목 없는 캐릭터" 1개, 영상 몇 개) — 사용자가 원하면 손으로 지운다.

크레딧: 이 세션 911 → **850**(−61: 캡처 47 · P9 7 · 중복 멘션 영상 7). 구현·리뷰·G1 시도는 0.

## 7. 새 세션 시작 문구

```
AutoFlowCut-bugfix 워크트리(~/workspace/AutoFlowCut-bugfix, 브랜치 feat/flow-m3-references)에서 M3 실기 게이트를 이어서 해.
먼저 docs/handoffs/2026-09-26-flow-M3-implemented-live-gate-pending-HANDOFF.md 를 끝까지 읽어(§4 가 첫 일).
M3 는 구현·계획 리뷰(R3 0)·코드 리뷰(R2 0)까지 끝났고 전부 미푸시다. 설계 정본은 docs/plans/2026-09-25-flow-M3-references-plan.md(R3), 실기 절차는 그 §5.
첫 일: G1 첫 시도에서 씬이 done 인데 Flow 요청(ogiZ0b/maseQ)이 0건이었던 원인을 systematic-debugging 으로 규명 → G1~G7.
실기에서 결함이 나오면 TDD 수정 → 전체 vitest(네가 직접) → 저자와 다른 모델 독립 리뷰 → 실기 재확인. 커밋 메시지는 영어, 푸시는 나한테 물어봐.
크레딧: 이미지는 0이라 네가 돌려도 되고, 영상은 돌리기 전에 금액을 알려줘(20 초과는 먼저 물어봐).
M2 규칙(돈 규칙 · fail-closed · 신뢰 클릭만 · 요청 본문 변조 금지 · CDP 금지 · Flow 에 키 이벤트 금지 · 로그에 내용 금지)은 그대로.
```
