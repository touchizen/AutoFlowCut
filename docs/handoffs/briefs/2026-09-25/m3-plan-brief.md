# 브리프 — M3(레퍼런스) 계획서 저작 (저자: Opus 5.5 — Fable 5.1 은 사용량 소진)

워크트리 `~/workspace/AutoFlowCut-bugfix`, 브랜치 `feat/flow-m3-references`(M2 `fix/flow-batchexecute` 위, 캡처 증거 커밋 `432b2a89`). **소스 코드는 고치지 않는다 — 계획서 파일 하나만 쓴다.** 산출물: `docs/plans/2026-09-25-flow-M3-references-plan.md`. 커밋·푸시는 하지 않는다(오케스트레이터가 한다).

## 0. 반드시 먼저 읽을 것
1. `docs/handoffs/2026-09-25-flow-M3-references-KICKOFF.md` — 목표·막는 자리(M1-10 게이트)·함정.
2. `docs/handoffs/evidence/2026-09-25-m3-references-capture.md` — **이번 캡처의 관측 사실 전부**(단계·새 rpcid·인덱스 경로·DOM·미관측). 샘플 `…-m3-samples.masked.jsonl`, DOM `…-m3-dom-*.elements.json`.
3. `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md` — §2 설계 결정(D1~D8), **§3 머리 "구현자 공통 규칙"**(결과 계약·kind→params·배치 중단·마감·주입 문자열·로그·픽스처), §4 수용 게이트, §12 구현 메모(M2 리뷰가 굳힌 규칙).
4. `docs/handoffs/2026-09-25-flow-batchexecute-M2-live-passed-HANDOFF.md` §2(돈 규칙 등)·§5(실기 함정).
5. 코드 — 인용하는 모든 `file:line` 은 직접 열어 확인하고 쓴다: `src/engine/engineFlow.js`(`flowInputGate`·`planMentionRouting`·`parseSceneMentions`·`generateImage`·`submitGeneration`·`generateVideoT2V`), `electron/ipc/flow-angular.js`, `electron/flow-rpc-protocol.js`(모델 키 검증 `_t2v` 필수), `electron/flow-rpc-capture.js`(또는 캡처 주입이 있는 곳), 설정 드라이버·프롬프트 입력·신뢰 클릭 도우미·방패·키 잠금이 있는 모듈, 레퍼런스 데이터 모델(렌더러의 references 상태, 로컬 파일 경로·옛 Flow mediaId 필드), `electron/updater.js`(메뉴 `role:'paste'`), MCP/HTTP 배치 경로.

## 1. 사용자 결정(2026-09-25, 바꾸지 말 것)
- **@멘션 = 인라인 멘션 재현.** 씬 프롬프트의 `@이름` 위치에 Flow 인라인 멘션 노드를 넣는다(편집기에서 `@` → 애셋 창 → 해당 미디어 선택 → "프롬프트에 추가"). 관측상 인라인 멘션은 칩도 함께 붙고, 요청 프롬프트 `[1][0][8]` 이 세그먼트 배열이 된다. 캐릭터 엔티티(`C4BZMd`)는 쓰지 않는다.
- **업로드 = Flow 프로젝트당 1회 + mediaId 재사용.** 레퍼런스를 처음 쓸 때 업로드(붙여넣기)하고 mediaId 를 기억한다. 다음부터는 애셋 창 항목 썸네일(`img` src `flow-content.google/image/<mediaId>`)로 찾아 붙이고, 못 찾으면 다시 업로드한다.
- **범위 = 이미지(`ogiZ0b`) + 레퍼런스 영상(`MZZa6b`, r2v) 둘 다.** i2v(시작 프레임)·업스케일·캐릭터 엔티티는 범위 밖(fail-closed 유지).

## 2. 관측 핵심(상세는 캡처 문서)
- 업로드 `maseQ` 는 reCAPTCHA 토큰을 싣는다 → **UI 경유만**. 파일 입력은 DOM 에 없다. **편집기에 클립보드 이미지 붙여넣기(`Cmd+V` → 앱 메뉴 `role:'paste'` = `webContents.paste()` 경로)로 업로드가 됐다**(PNG 로 넘어감, ~10s, 새 칩).
- 칩: `button.chip-container[aria-label="소재"]` + `img[alt="소재 이미지"]` src 에 mediaId. 생성 뒤 컴포저는 비워진다.
- `@` 입력 = 같은 애셋 창을 연다. 애셋 창 항목 `button.asset-item[role=option]` 의 썸네일 `img` src 에 mediaId(이미지). "프롬프트에 추가" = `button.detail-add-to-prompt-btn`.
- 이미지: 요청 `[1][0][2]` 레퍼런스 목록(칩 순서), 인라인 멘션은 `[1][0][8]` 세그먼트. 응답이 레퍼런스를 되돌린다.
- 영상: 레퍼런스가 있으면 페이지가 `YhhmEf` 대신 **`MZZa6b`** 로 보낸다(모델 키 `abra_r2v_<N>s` / `veo_3_1_r2v_fast_portrait`). 응답 모양은 `YhhmEf` 와 같다. 크레딧 = 같은 길이 t2v(Omni 4초 7 · Veo Fast 20).
- 미관측: 업로드 중 칩 상태·실패 프레임, 레퍼런스 개수 상한(카탈로그 `[9]`: Omni r2v 7, Veo r2v 3 후보), 영상 다중 레퍼런스 요청 모양, **자동화 조건(Flow 뷰 숨김·앱 창 비포커스·방패)에서 `webContents.paste()` 가 먹는지**, `@` 를 자동 입력으로 쳤을 때 애셋 창이 열리는지, 같은 이미지 재업로드 시 새 id 여부.

## 3. 지켜야 할 규칙(위반은 BLOCKER)
- **돈 규칙**(M2): `generationId` 있고 `videoPath` 없으면 상태와 무관하게 재제출 금지. r2v 도 같다 — `MZZa6b` 200 = 과금.
- **fail-closed**: 모르는 모양·검증 불일치는 **클릭 전** 거부(크레딧 0). 클릭 전 게이트 = 붙은 칩 mediaId 집합 == 기대 집합, 인라인 멘션 순서·개수 == 기대, 설정 == 기대. 클릭 뒤 불일치(요청/응답의 레퍼런스·rpcid·모델 키)는 돈 규칙대로 처리(재제출 금지, 오류 표기).
- **제출은 신뢰 클릭만**(`sendInputEvent`), **요청 본문 변조 금지**(레퍼런스·멘션도 UI 로 붙여 페이지가 만들게), **CDP 금지**(`webContents.debugger`·`Page.*`·`Fetch.*`·파일 선택 가로채기 포함), reCAPTCHA 직접 호출 금지, 앱이 `maseQ` 를 직접 만들지 않는다.
- **로그·Sentry 에 내용 금지**(프롬프트·파일 경로·파일명·URL·본문·토큰·base64) — 길이·id 앞 8자·상태어만.
- M2 함정: 화면 밖 뷰는 재레이아웃 안 됨(창 안 제자리 확장+방패) · Escape 로 닫은 패널은 다음 트리거 클릭이 헛돔 · 한글 IME 는 키 잠금 우회(포커스를 앱 창으로, mouseDown 직전 편집기 재판독) · 문서 이동을 넘긴 `executeJavaScript` 는 영영 settle 안 함 · 방패 focus 핸들러가 편집기로 포커스를 되돌리면 안 됨.
- 새로 생기는 위험도 계획에 넣는다: **사용자 클립보드 덮어쓰기**(저장·복원, 복원 실패 시 행동, 사용자가 그 사이 복사한 경우), 붙여넣기가 **다른 창·다른 입력란**으로 가는 경우(포커스 확인 없이 paste 금지), 업로드 타임아웃·실패, 중복 업로드, mediaId 캐시 무효화(Flow 프로젝트 바뀜·미디어 삭제·레퍼런스 이미지 파일이 바뀜 — 무엇으로 동일성을 판정하나), 인라인 멘션 삽입 중 편집기 오염(사용자 타이핑).

## 4. 계획서가 담을 것
1. **목표·범위**(§1 결정 그대로, 범위 밖 목록과 그 fail-closed kind).
2. **고고학** — 지금 레퍼런스·멘션이 어디서 막히는지(`file:line`), 옛 Flow 레퍼런스 경로(옛 mediaId·캐릭터 entity·`flow-compose-mention` 등) 중 재사용 가능한 것과 죽은 것. 레퍼런스 데이터 모델에서 로컬 이미지 파일을 어떻게 얻는지.
3. **설계 결정**(D 번호) — 최소: 업로드 드라이버(클립보드+`webContents.paste()`), 업로드 응답 캡처·바인딩(`maseQ` → mediaId, 동시성), mediaId 캐시(키·저장 위치·무효화·검증), 애셋 창에서 mediaId 로 고르기, 인라인 멘션 삽입 절차(텍스트 세그먼트 입력 ↔ `@` 멘션을 어떤 입력 방식으로 — 신뢰 키 입력인지 편집기 명령인지 — 결정 근거), 클릭 전 게이트, `MZZa6b` 라우팅·모델 키 검증 확장(`_r2v_` 허용, 선택한 패밀리·길이와 일치), 응답 레퍼런스 되돌림 검증, 레퍼런스 개수 상한 처리, 결과 계약·새 kind 와 ko/en 문구.
4. **M3-0 프로브(0크레딧, 구현 전)** — 미관측 중 설계를 뒤집을 수 있는 것을 실기로 먼저 본다(예: 숨김 뷰+앱 창 비포커스에서 `webContents.paste()` 업로드, 자동 입력한 `@` 로 애셋 창 열림, 애셋 창 항목 선택). 무엇을 어떻게 재고, 결과가 X 면 설계 Y 로 간다는 분기까지.
5. **TDD 작업 목록** M3-1… — 작업마다 파일·함수·**실패 테스트 먼저**(단위+통합, 테스트 파일 경로)·수용 조건. 테스트가 "틀린 구현도 통과"하지 않게 무엇을 단언하는지 적는다(픽스처는 캡처 샘플을 재인코딩).
6. **수용 게이트** — 실기: 레퍼런스 이미지 1장(0크레딧) → 인라인 멘션 이미지(0크레딧) → 재사용(업로드 0회 확인) → r2v 영상 1개(크레딧, 사용자 확인). 기대 로그 형식.
7. **미지수와 틀렸을 때 코드가 하는 일**, **범위 밖**.
8. 리뷰 처분 절(빈 자리).

기존 계획서의 문체·형식(한국어, 표, `file:line` 앵커, 코드 블록 최소)을 따른다. 추측을 사실처럼 쓰지 않는다 — 관측/추정/미상을 구분한다. 과설계 금지(단일 용도 추상화 금지), 그러나 돈·fail-closed 경로는 빠짐없이.

## 5. 끝나면
최종 메시지에 (1) 계획서 경로와 줄 수, (2) 가장 불확실한 결정 3개와 그 근거, (3) M3-0 프로브 목록을 짧게 적는다.
