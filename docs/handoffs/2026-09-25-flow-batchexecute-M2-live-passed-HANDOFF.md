# HANDOFF — Flow 모드(flow.google.com·batchexecute) 재작업: M2(영상) 완료 — 구현·리뷰·실기 통과, 리뷰 루프 종료

작성: 2026-09-25 10:20 · **갱신 2026-09-25 저녁 — M2 리뷰 루프 종료(아래 §0-1)** · 워크트리 `~/workspace/AutoFlowCut-bugfix` · 브랜치 **`fix/flow-batchexecute`**(`main` `52c7930b` 분기) · **전부 미푸시**(푸시·머지는 사용자 결정)
이전 핸드오프: `docs/handoffs/2026-09-25-flow-batchexecute-M1-done-M2-inflight-HANDOFF.md`(M1 완료·M2 착수 시점)

---

## 0. 한 줄 요약

새 Flow 에서 **이미지·영상 생성이 실제로 된다**. 영상은 Omni Flash(4·6초)·Veo 3.1 Fast(8초 고정) 둘 다 실기 통과(오늘 4회, 9:16·720p). 코드는 M2 구현 → 독립 리뷰 8라운드(BLOCKER 1·MAJOR 9·MINOR 약 40 반영) → 실기에서 결함 5개 발견·수정. 남은 것: 실기 수정분의 독립 리뷰(진행 중), 리뷰 8라운드 MINOR 5건(브리프 있음), 레퍼런스(M3, 캡처 필요), 정리·푸시.

## 0-1. 갱신 — M2 리뷰 루프 종료 (최종)

실기 수정분 리뷰 이후 네 라운드를 더 돌았다(모두 계획서 §12.10~§12.13, 행 #113~#142):

| 라운드 | 리뷰어 | 결과 | 수정 커밋 |
|---|---|---|---|
| 실기 수정분 | Fable ×2 | MAJOR 3·MINOR 12(방패 없는 입력 가로채기 · 없는 그룹 = 8초 규칙의 타이밍 · MCP update-settings 화이트리스트 …) | `18760b94` (N1~N10 + R8 M1~M5) |
| 마무리 | Opus ×2 | MAJOR 1(키보드 입력) · MINOR 7 | `1b28ed47` (O1~O6) |
| 마지막 | Opus ×2 | MAJOR 3(직렬화 교착 · 한글 IME 가 키 잠금 우회) | `a981ec62` (P1~P4) |
| 그다음 | Opus ×2 | MAJOR 1(방패 포커스가 편집기로 되돌림) · MINOR 3 | `72693702` (Q1~Q4) |
| **최종** | **Sonnet ×2** | **A: NO FINDINGS · B: MINOR 1(테스트 공백)** | 핀 추가 — 제품 코드 변경 없음 |

저자: Fable 5.1 이 Q1 도중 **사용량 크레딧 소진**, 이후 Opus(메인 루프)가 이어받음 → 리뷰어는 저자와 다른 Sonnet. Codex 는 9/27 06:01 까지 주간 한도.

최종 스위트: **746 파일 / 8306 테스트 초록, 54 스킵**. 매 라운드 실기 재확인(증거 `evidence/2026-09-25-m2-live-gate.md` §결과 4~7): 좁은 뷰·숨김 뷰(0×0) 제자리+방패, 같은 세션 연속 생성(트리거 재시도), Omni↔Veo 양방향 전환, 2개 항목 배치, 포커스를 앱 창으로 돌린 뒤 제출, mouseDown 직전 편집기 재판독 — 전부 통과. 오늘 누적 크레딧 1050 → 911.

**사용자 확인이 남은 것(자동으로 못 한다)**: ① 실행 중 앱에서 **한글**을 타이핑해도 Flow 프롬프트에 안 들어가는지 ② 좁은/숨김 창에서 Flow 뷰가 앱을 덮는 몇 초 동안 화면이 **하얗게** 되지 않는지(방패 투명도 — 이 터미널엔 화면 기록 권한이 없다).

다음 할 일은 아래 §4 에서 1·2·3 이 끝났다 — 남은 건 4(정리)·5(푸시 결정)·6(M3 레퍼런스, 사용자 캡처 필요)·7(썸네일 결정)과, 부수 관찰 하나: MCP `start-scene-batch {mode:'image'}` 가 이미지 대기 씬이 있는데도 바로 끝났다(렌더러 사전 검사 추정, 원인 미확인 — 범위 밖).

## 1. 커밋 흐름 (`git log --oneline 132a5d58..HEAD`)

| 구간 | 커밋 | 내용 |
|---|---|---|
| 회수 | `10e734ce` | M1 R2 부록 빨강 10개 → 초록(§12.0) |
| M2 | `9aeeefdc` | M2-2~M2-6(설정 영상 단계·해상도 배관·T2V 제출·상태 폴·렌더러 halt/drain) + 부록 #45~#48 |
| 리뷰 R1~R7 | `71645807`/`94224f89` · `c01cbfee`/`c6d057e5` · `069adb49`/`e1c24fb3` · `b027fdf0`/`676fe861` · `66438a55`/`0765fd87` · `ccdc6703`/`e446049d` · `acdaa416`/`6b9b5859` | 라운드마다 findings 파일+브리프(docs) / 수정(code). 계획서 §12.1~§12.9 행 #45~#112 |
| 리뷰 R8 | `87e1a74b` | 좁은 라운드 findings(MINOR 8, 고유 5) + 브리프 `fable-m2-fix8-brief.md` — **미구현** |
| MCP | `2f50c2fd` · `657b2524` | `start-scene-batch` 에 `mode`, `update-settings` — UI 없이 영상 배치 준비·시작 |
| 실기 수정 | `2e6a44ab` · `56e9baa5` · `f88c8924` · `fbe4cf63` · `50daab73` | 아래 §3 |
| 증거 | `2ab031e8` · `02899fa6` · `63e967f0` | `docs/handoffs/evidence/2026-09-25-m2-live-gate.md` |

전체 스위트(내 판정, `63e967f0` 직전 코드): **743 파일 / 8112 테스트 초록, 4 파일·54 스킵**(옛 핸들러 전용, 플랜 §11 #18 정리 대상).
```bash
cd ~/workspace/AutoFlowCut-bugfix && env -u ELECTRON_RUN_AS_NODE npx vitest run
```

## 2. 핵심 설계(리뷰로 굳은 규칙)

- **돈 규칙**: Flow 에선 `YhhmEf` 200 순간 과금되고 `generationId` = 미디어 id. `generationId` 있고 `videoPath` 없는 항목은 **상태와 무관하게 절대 새로 제출하지 않는다** — `mediaId` 있으면 download-only, 없으면 폴링(Phase 0 출처 분류, UUID 모양만). Regenerate/Clear 만 id 를 지운다. 레거시 서버 실패(`PUBLIC_ERROR_*`)는 예외(재생성 가능). 일반 Retry·로더 재부착·재시작·Stop·auth·타임아웃 경로 전부 이 규칙으로 닫았다.
- **새 제출만 중단**(`submitHaltRef`): 클릭 뒤 실패·거부 id·quota → 새 제출만 멈추고 pending 은 끝까지 폴링·다운로드.
- **늦은 send 유예 창**: 영상은 15s send 마감 뒤에도 100s loadend 창까지 바인딩 가능(크레딧 재판독으로 lost 격상).
- **모델키 검증**: 응답 `[3][0][7][0][12]` 는 `^(abra|veo|omni)_[a-z0-9_]+$`(≤64) + 카탈로그 표(`modelKeyMatches`); `[3][0][0]` 은 UUID. 못 믿는 값은 로그·Sentry 에 안 나간다.
- **다운로드 게이트 마커** `downloadGated`: 배치 게이트를 통과한 항목만 재다운로드 시 게이트 생략.

## 3. 실기(2026-09-25) — 통과와 결함

통과: Omni 6초(−10) · Veo Fast 8초(−20) · 같은 세션 연속 Veo 8초(−20) + Omni 4초(−7). 파일 전부 720×1280, 로그에 프롬프트·서명 URL 0건. 상세 `docs/handoffs/evidence/2026-09-25-m2-live-gate.md`.

결함(전부 클릭 전 실패 — 크레딧 손실 0):
1. 자동화 뷰포트를 **화면 밖**으로 옮기면 페이지가 다시 레이아웃되지 않음(innerWidth 597 그대로) → **창 안 제자리** 확장(`2e6a44ab`). 단위 테스트는 우리가 준 bounds 만 봐서 못 잡았다.
2. 트리거 클릭 직후 즉시 스캔 → `panel-not-open` → 첫 스캔 전 ≤3s 대기(`56e9baa5`).
3. **같은 페이지 두 번째 생성부터 트리거 클릭 한 번이 헛돔**(Escape 로 닫은 뒤 Flow 의 열림 상태가 안 풀림) → 드라이버가 트리거를 한 번 더 누름 + `group-not-found` 에 패널 shape 진단(`f88c8924`). 라이브로 재시도 발동·통과 확인.
4. **Veo 패널엔 길이·해상도 컨트롤이 없음** → 없는 그룹은 모델 기본값(8초·720p)만, Flow Veo 는 8초 스냅(`fbe4cf63`).
5. 모델 전환 뒤 Flow 가 **비율을 늦게 되돌림** → 2차 설정 패스(`50daab73`, 라이브 미발동·단위 테스트로 고정).

크레딧 실측: Omni 는 길이에 비례(4초 7·6초 10), Veo Fast 8초 20.

실기 절차(재현):
```bash
cd ~/workspace/AutoFlowCut-bugfix
pkill -f "MacOS/AutoFlowCut"; pkill -f "node_modules/.bin/vite"
AUTOFLOWCUT_NET_TRACE=1 AUTOFLOWCUT_NET_TRACE_FILE=<scratch>/flow-capture.jsonl env -u ELECTRON_RUN_AS_NODE npm run dev > <scratch>/afc-dev.log 2>&1 &
# 준비: curl -s localhost:3210/api/batch-status → app.flowProjectReady:true
curl -s -X POST localhost:3210/api/update -H 'Content-Type: application/json' -d '{"type":"update-settings","fields":{"videoModelT2V":"Omni Flash","videoResolution":"720p","videoBatchCount":1}}'
curl -s -X POST localhost:3210/api/update -H 'Content-Type: application/json' -d '{"type":"update-scene","index":2,"fields":{"videoT2VSelected":true}}'   # 나머지는 false
curl -s -X POST localhost:3210/api/start-scene-batch -H 'Content-Type: application/json' -d '{"styleId":"none","mode":"video"}'
```
주의: `app_generate_scene` MCP 호출은 권한 분류기에 한 번 막혔다가 다음엔 통과했다. main 프로세스 코드를 바꾸면 **앱 재시작**(HMR 은 렌더러만). 진단 파일은 `~/Desktop/flow-diag-*.json`(세션당 단계별 1회).

## 4. 다음 할 일 (순서대로) — 1·2·3 은 끝났다(§0-1)

1. **실기 수정분 독립 리뷰**(진행 중): 범위 `6b9b5859..63e967f0`(코드 7커밋), diff 는 스크래치 `review/m2-live.diff`. 리뷰어 Fable ×2(사본 분리). Codex 는 **9/27 06:01 까지 주간 한도**. findings → 저자 수정 → findings 0.
2. **리뷰 R8 MINOR 5건**: `docs/handoffs/briefs/2026-09-25/fable-m2-fix8-brief.md`(M1~M5 — 테스트 핀 4 + 미바인딩 loadend 보고를 "최근 앱이 닫은 gen" 있을 때만). 1번 findings 와 한 라운드로 묶어도 된다.
3. **계획서 §12.10** 에 실기 수정·R8 반영 기록, §12.2 기대 로그를 실측 형식(`duration=fixed(8)` 등)으로.
4. **정리**(플랜 §11 #18): 옛 핸들러·스킵 스위트 4개 삭제, `FLOW_URL` 통일.
5. **푸시·머지**: 사용자 결정.
6. **M3 레퍼런스**(범위 밖이었음): 사용자가 Flow 창에서 레퍼런스 1장 붙여 이미지 1장 생성 → NET_TRACE + `Cmd+Shift+E` 덤프로 업로드 RPC·제출 형식 확보 → 계획서 → 구현 → 리뷰 → 실기. 같은 방식으로 I2V·업스케일·이미지 모델 선택.
7. **썸네일(별건)**: 결과 테이블의 영상 썸네일이 소스 이미지를 우선함(`aedf1feb`, 5월). T2V 는 영상 자체 프레임을 쓰도록 바꿀지 사용자 결정 대기.

## 5. 함정

- 화면 밖 WebContentsView 는 다시 레이아웃되지 않는다 — "bounds 를 바꿨다"는 테스트는 공허하다. 라이브로 `innerWidth` 를 봐라.
- Flow 설정 패널은 Escape 로 닫으면 다음 트리거 클릭 한 번이 헛돈다.
- 모델마다 패널 컨트롤이 다르다(Veo Fast: 길이·해상도 없음). 모르는 패널은 shape 진단으로 0크레딧에 먼저 본다.
- 셸에 `ELECTRON_RUN_AS_NODE=1` 이 박혀 있다(`env -u`). 세션의 `grep` 은 셸 함수라 큰 파이프에서 조용히 비는 일이 있다(`/usr/bin/grep`).
- **한글 IME 는 `before-input-event` 키 잠금을 우회한다**(입력기가 처리한 keydown 은 PreHandleKeyboardEvent 를 건너뛴다). 재판독 뒤 OS 포커스를 앱 창으로 돌리고, 클릭 도우미의 `beforeDispatch` 로 mouseDown 직전에 편집기를 다시 읽는다.
- **문서 이동·렌더러 크래시를 넘긴 `executeJavaScript` 는 영영 settle 하지 않는다**(Electron 36 실측) — 그걸 기다리는 직렬화는 교착한다. `did-navigate`·`render-process-gone` 에서 워치독이 끊은 단계만 푼다.
- 방패(`WebContentsView`)는 포인터만 막는다. 방패의 focus 핸들러가 포커스를 Flow 로 되돌리면 편집기가 다시 입력을 받는다 — 넘긴 뒤엔 행선지를 앱 창으로.
- Fable 5.1 도 사용량 크레딧이 떨어질 수 있다. 그땐 Opus 가 저자, 리뷰는 Sonnet(저자와 다른 모델). Codex 는 9/27 06:01 까지 주간 한도.

## 6. 새 세션 시작 문구

> **M3(레퍼런스)를 시작할 거면** 이 문구 대신 `docs/handoffs/2026-09-25-flow-M3-references-KICKOFF.md` §7 의 시작 문구를 써라(캡처 절차·막는 자리·함정 포함).

```
AutoFlowCut-bugfix 워크트리(~/workspace/AutoFlowCut-bugfix, 브랜치 fix/flow-batchexecute)에서 이어서 작업해.
먼저 docs/handoffs/2026-09-25-flow-batchexecute-M2-live-passed-HANDOFF.md 를 끝까지 읽어(§0-1 이 최신 상태).
M2(영상)는 끝났다 — 구현·리뷰 루프·실기 통과, 44커밋 전부 미푸시.
남은 것 중 내가 정한 것만 해: (a) 푸시·머지 방식 (b) M3 레퍼런스 — 내가 Flow 창에서 레퍼런스 1장 붙여 이미지 1장 생성한 캡처로 시작
(c) 옛 핸들러·스킵 스위트 정리(플랜 §11 #18) (d) T2V 썸네일을 영상 프레임으로 바꿀지.
구현은 Fable 5.1(안 되면 Opus), 리뷰는 저자와 다른 모델 독립 2인(사본 분리)으로 findings 0 까지, 전체 vitest 판정과 커밋은 네가 직접, 커밋 메시지는 영어, 푸시는 나한테 물어봐.
크레딧이 드는 생성은 매번 나한테 물어봐(Flow 모드 테스트는 허용 — 이미지 0크레딧, Omni 4초 7·6초 10, Veo Fast 8초 20).
```

