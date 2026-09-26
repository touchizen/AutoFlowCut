# ChatGPT 자동화 스파이크 — Phase 2 (주입·제출·이미지 저장) 설계 v4

> **목적:** Phase 1이 확정한 셀렉터로, chatgpt.com 컴포저에 프롬프트를 주입→제출→**제출 후 새로 생성된 이미지**를 폴링→디스크에 저장한다. 실앱 1회 성공 = **스파이크 종료 조건** 달성.
>
> **선행:** Phase 1 완료(커밋 …9b7117e6). dev 게이트·뷰 팩토리·idempotent ensure·표시/포커스·덤퍼·저장 헬퍼·globalShortcut 인프라 구현·리뷰 findings-0·실앱 검증 완료.
>
> **v1→v2 (R1):** 결과 상관을 개수→estuary CDN src 집합, src scheme 가드, 주입 검증(컴포저 clear+텍스트===prompt), fallback 상태기계, 테스트 필수화, ensureLoggedIn load-ready, submit fallback=Enter.
>
> **v2→v3 (R2):** CDN 매치를 `estuary/content`로 좁힘, 비교 키 `id` canonicalize, 2연속 폴링 안정, `__cg_verify__` 정의, fallback B clear, submit-ack, 단일 deadline, self-contained eval, normalize 비교, 빈 새 채팅 전제.
>
> **v3→v4 (R3, Codex 확정 버그):** ① **`__cg_submitAck__` 반환을 `submitPresent`로**(상태기계가 `ack.submitPresent`를 읽는데 v3은 `submitGone`을 반환해 Enter fallback이 영영 falsy였음 — 실제 버그). ② **Enter fallback을 2연속 ack(≥cadence 간격) `stillHasPrompt&&submitPresent` + Enter 직전 재검증**으로 보수화(slow-click 중복 완화; 잔여 타이밍은 경험적, 체크포인트 로그로 관측). ③ `idOf` **fail-closed**(estuary인데 id 없으면 후보 제외 — 서명 URL 취약성 재유입 방지). ④ **transient-retry 바운드**(연속 N회 eval reject 시 origin/auth/composer 재프로브, 안정 로그아웃/DOM부재/스크립트오류는 조기 실패). ⑤ 안정성 문구를 "same id"로 정합(§3-F가 `p.id` 비교), title·§4를 v3/v4 규칙과 동기화.

## 0. Phase 1이 실 DOM으로 확정한 사실 (이 설계의 기반)
| 대상 | 확정값 | 비고 |
|---|---|---|
| **컴포저** | `#prompt-textarea` | ProseMirror `contenteditable="true"` div, `role="textbox"`. (형제 `textarea.wcDTda_fallbackTextarea`는 숨은 폴백 — 실입력은 ProseMirror) |
| **전송 버튼** | `#composer-submit-button` (= `button[data-testid="send-button"]`, aria-label "프롬프트 보내기") | **컴포저가 비면 DOM에 없고, 텍스트가 있으면 나타난다** — Phase1 empty vs filled 비교로 확정. 이게 "주입 성공 + 제출 준비" 신호. |
| **생성 이미지** | `img[alt^="생성된 이미지"]` | result 덤프. alt가 "생성된 이미지:"로 시작 |
| **이미지 소스** | `img.src` = `https://chatgpt.com/backend-api/estuary/content?id=…&sig=…` | **인증형 https URL**(파티션 쿠키 필요). **blob/canvas 아님** → capture/base64 분기 전부 불필요 |

**단순화(안전):** **완성된** 생성 이미지는 인증 https 단일 형태 → 저장은 `session.fetch` 한 경로. canvas tainted·blob·capturePage **분기 삭제**(완성 형태가 https로 확정). **⚠️ "완성"이 관건 + 미측정 지점**: Phase 1은 **완성** 이미지만 덤프했고 Phase 2는 **생성 중**을 폴링한다. 생성 창에서 같은 `img`가 (a) transient src(blob:/data:/저해상 preview) 또는 (b) **estuary URL이지만 progressive/부분 프레임**을 잠깐 가질 수 있다. (a)는 CDN 매치로 걸러지지만 (b)는 Phase1에서 관측 못 한 미지수다. 그래서 §3-C가 **CDN을 `estuary/content`로 좁히고 + 2회 연속 폴링에서 같은 신규 `id`** 일 때만 수락하며(§3-F `lastPollId===p.id`), 실행 중 수락된 src를 **체크포인트 로그**로 남겨 부분-프레임 캡처 여부를 실측 확인한다. (id-안정은 경험적 settle heuristic — 최종 프레임 보장 아님, 실 run이 유일 판정.)
- `CDN_RE = /^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/` (§0 실측 정확히). `/backend-api/` 만으론 attachment/avatar 등 다른 자산까지 승인해 오탐.
- **비교 키 = 서명 URL 전체 아님**: 같은 이미지도 `sig`가 갱신되면 URL이 바뀐다. `src`의 `id`(예: `file_000…`) 쿼리 파라미터를 뽑아 **id로 canonicalize**해 baseline/신규 판정.

**언어 의존성(정정):** 컴포저·전송버튼은 id/data-testid라 언어 무관이지만, **생성 이미지 `img[alt^="생성된 이미지"]`는 한국어 localized alt에 의존**한다(계정 UI 한국어 전제). throwaway run엔 무해하나 전제로 명시. (더 견고하게는 alt 대신 estuary src 패턴으로 이미지를 식별 — §3-C가 src 집합 기반이라 alt는 보조.)

## 1. 성공 기준 (스파이크 종료)
`Cmd+Alt+Shift+G`(하드코딩 프롬프트) 1회로:
1. `#prompt-textarea`에 프롬프트가 주입된다(**성공 판정 = `norm(textContent)===norm(prompt)`**, §3-B `__cg_inject__`; submit 버튼 등장은 보조 신호).
2. 제출이 확인된다(**submit-ack = 컴포저가 비워짐 `||` submit 버튼 사라짐**, §3-B `__cg_submitAck__`).
3. 제출 후 **새 estuary content-id** 이미지가 로드 완료된다(§3-C, 2회 연속 같은 id).
4. 그 `img.src`(estuary https)를 `session.fetch`로 받아 `spikeDir`에 저장한다.

1회 성공 = 스파이크 성공. 결과(어떤 주입 A/B·제출 click/Enter 기법이 먹혔는지 + 수락 src 체크포인트 로그)를 근거로 정식 기능 spec.

## 2. 스코프
### In
- `electron/spike-chatgpt-automate.js` — 페이지 스크립트 **단계 함수 6종**(`__cg_baseline__`/`__cg_inject__`/`__cg_verify__`/`__cg_clickSubmit__`/`__cg_submitAck__`/`__cg_poll__`, §3-B; self-contained) + 순수 헬퍼 `idOf`/`norm`/`pickNewCdnImage` + main측 `runGenerateStateMachine`(§3-F).
- `electron/spike-chatgpt-image.js` — 이미지 회수/저장(`session.fetch` → mkdir → ext) 순수 헬퍼.
- `electron/spike-chatgpt-authprobe.js` — `ensureLoggedIn` DOM 프로브(확정 셀렉터 사용).
- `electron/ipc/spike-chatgpt.js` 확장 — `Cmd+Alt+Shift+G` 핸들러(ensureVisibleAndFocused → ensureLoggedIn 게이트 → 주입/제출 → 이미지 폴링/저장).
- 단위/통합 테스트.

### Out (정식 기능 이연 — Phase 1과 동일)
상단 타깃 토글 UI, Flow 일반화, 파이프라인 연결, I2I(레퍼런스 업로드), 셀렉터 원격 config, 리트라이/동시성, 밴 고지/동의, 크레딧 게이트.

## 3. 아키텍처

### 3-A. `ensureLoggedIn` (G 전용 게이트) — 확정 셀렉터
`electron/spike-chatgpt-authprobe.js`. G 핸들러에서만 호출(L/D/T/F는 무게이트, Phase 1 그대로). URL 아닌 **DOM 프로브**(executeJavaScript 반환):
- **로그인**: `#prompt-textarea` 존재(컴포저 렌더 = 로그인 세션).
- **미로그인**: 로그인/회원가입 CTA 존재(`[data-testid="login-button"]`, 또는 `a[href*="/auth/login"]`, 또는 본문에 로그인 링크) **AND** `#prompt-textarea` 부재.
- 판정: `#prompt-textarea` 있으면 true, 없으면 false(명시적 실패 반환 → 사용자에게 L 로그인 안내). 순수 boolean 반환 → 단위 테스트(DOM 스냅샷 fixture).
- **⚠️ load-ready 대기:** 첫 G(직전 L/D/T/F 없이)면 `ensureChatgptView`가 뷰를 새로 만들고 `loadURL`한 직후라 프로브가 로드 중 실행돼 `#prompt-textarea` 부재로 **거짓 미로그인**이 난다. 그래서 프로브 전에 `did-finish-load` 대기(또는 짧은 재시도 ~2s)를 둔다. 이미 로드된 뷰(idempotent 재사용)는 무영향.

### 3-B. 페이지 스크립트 API (`spike-chatgpt-automate.js`) — **단계 함수들**(단일 eval로 각각 호출)
page script는 `sendInputEvent`를 못 부르므로, **하나의 거대 eval이 주입~폴링을 다 하지 않는다.** 대신 작은 **단계 함수**들을 정의하고 main이 필요한 단계를 개별 eval로 호출한다. **각 eval은 self-contained** — 함수들을 매번 idempotent 정의(있으면 skip)한 뒤 해당 함수를 호출한다(하드 navigation으로 window 함수가 사라져도 ReferenceError 없이 재정의). SELECTORS = `{ composer:'#prompt-textarea', submit:'#composer-submit-button' }`, `CDN_RE = /^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/`.

공통: `idOf(src)` = src의 `id` 쿼리 파라미터. **fail-closed**: estuary URL인데 `id`가 없으면 후보 제외(전체 signed src로 fallback 안 함 — 서명 URL 취약성 재유입 방지). `norm(s)` = `s.replace(/[​﻿]/g,'').replace(/ /g,' ').trim()` (ZWSP/BOM 제거, nbsp→space).

- **`__cg_baseline__()`** → `{ ids: [현재 문서의 CDN_RE 매치 이미지 src들의 idOf] }`. 제출 **전** 호출. 이 **id 집합**이 "이미 있던 이미지".
- **`__cg_inject__(prompt)`** → 주입:
  1. `composer` focus. **기존 내용 clear**: select-all(`document.execCommand('selectAll')`) + `document.execCommand('delete')` (또는 ProseMirror 노드 비우기).
  2. `document.execCommand('insertText', false, prompt)`. (보조: `beforeinput`/`input` `InputEvent`.)
  3. return `{ textMatches: norm(composer.textContent) === norm(prompt), submitPresent: !!document.querySelector(submit) }`. 성공 = textMatches(submitPresent 보조).
- **`__cg_verify__(prompt)`** → **주입 안 함**, 상태만 확인: `{ textMatches: norm(composer.textContent)===norm(prompt), submitPresent: !!document.querySelector(submit) }`. (fallback B로 main이 sendInputEvent 타이핑한 뒤 재검증용 — 별도 함수라야 `__cg_inject__` 재호출이 clear로 B의 입력을 지우지 않는다.)
- **`__cg_clickSubmit__()`** → `document.querySelector(submit)?.click(); return { clicked: !!document.querySelector(submit) }`.
- **`__cg_submitAck__(prompt)`** → 제출 상태: `{ composerCleared: norm(composer.textContent)==='', submitPresent: !!document.querySelector(submit), stillHasPrompt: norm(composer.textContent)===norm(prompt) }`. **확인된 제출 = composerCleared || !submitPresent**(ChatGPT는 제출 시 컴포저를 비우고 submit 버튼을 없앤다). Enter fallback 게이트 = `stillHasPrompt && submitPresent`(§3-F).
- **`__cg_poll__(baselineIds)`** → CDN_RE 매치 이미지 중 `idOf`가 baselineIds에 **없는(신규)** + 로드 완료(`complete && naturalWidth>0`) 이미지의 `{ src, id, w, h }` 반환(없으면 `null`). 최신 노드를 `scrollIntoView`해 lazy/virtualized 렌더 유도. **부분-프레임 완화(보장 아님)는 §3-F가 2회 연속 같은 id를 요구** — fresh-id progressive frame은 §0이 인정한 경험적 잔여(체크포인트 로그로 관측).

각 함수는 `[autoflowcut CGPT GEN]` prefix 로그. Node/CDP 토큰 없음.

### 3-C. 결과 상관 = **새 estuary content id** (개수·서명URL 아님)
개수 증가는 신원이 아니고(virtualization으로 개수 불변→timeout), 서명 URL 전체는 sig 갱신에 취약하다. 대신 **content id 기반**:
- **baseline** = 제출 직전 `CDN_RE` 매치 이미지들의 `idOf` **집합**(`__cg_baseline__`).
- **accept** = baseline에 **없던 새 id** + `CDN_RE`(estuary/content) 매치 + **로드 완료** + **§3-F에서 2회 연속 폴링 같은 id**(부분-프레임/progressive swap **경험적 settle 완화 — 보장 아님**). → transient blob/data는 CDN_RE 불일치로, stale은 baseline id로 확실히 제외되나, **fresh-id progressive frame은 안정성 검사로도 못 거르는 경험적 잔여**(§0, 체크포인트 로그로 실측).
- **전제**: 빈 새 채팅에서 실행(baseline id 집합이 작고, 폴링 중 옛 이미지 lazy-mount 오탐 최소화). Phase1 수동 전제(비-temporary 새 채팅)와 동일.
- turn 셀렉터 불필요(id 집합만으로 신원). 폴링은 §3-F가 **단일 total deadline(120s)·고정 cadence**로 관리.

반환 최종 계약(main 조립): `{ ok:true, src }`(estuary https) | `{ ok:false, stage:'inject'|'submit'|'poll'|'context', detail }`. (`context` = §3-F transient-retry 바운드에서 안정 로그아웃/DOM부재/스크립트오류 조기실패.)

### 3-F. 상태 기계 (main 오케스트레이션 — 단일 deadline·submit-ack·중복방지)
**타이밍**: 전체 생성에 **단일 total deadline = 120s**(primary+fallback 합산, 240s 아님). 폴링 cadence **1.5s**. eval이 navigation/context-loss로 reject되면 deadline 내 transient 재시도 — **단 무한 마스킹 방지**: 연속 3회 reject되면 `ensureLoggedIn`/composer 재프로브 → 안정 로그아웃·`#prompt-textarea` 부재·스크립트 오류면 `stage:'context'`로 **조기 실패**(120s 낭비 방지).
```
1. baseline = eval(__cg_baseline__)                       // 제출 전 content-id 집합
2. r = eval(__cg_inject__(PROMPT))                        // 주입 A: clear→insertText→검증
   if (!r.textMatches):                                    // A 실패
     [fallback B] main: composer focus → sendInputEvent select-all+delete(clear) → prompt char 입력
     r = eval(__cg_verify__(PROMPT))                       // 별도 verify(재-inject 아님 — B 입력 보존)
     if (!r.textMatches) → return { ok:false, stage:'inject' }
3. submitMethod = 'click'; eval(__cg_clickSubmit__)        // primary 제출
4. deadline 루프(≤120s, 1.5s cadence). 초기화: notSubmittedStreak=0, submittedAck=false, enterTried=false, lastPollId=null:
     ack = eval(__cg_submitAck__(PROMPT))
     // 두 조건 독립 계산(상호 배타 아님 — 중간 상태: 다른 텍스트+submit 존재 → 둘 다 거짓, 안전하게 계속 폴링)
     submitted    = ack.composerCleared || !ack.submitPresent   // 확인된 제출
     notSubmitted = ack.stillHasPrompt && ack.submitPresent     // 제출 안 먹은 확정
     if (submitted) submittedAck = true
     notSubmittedStreak = notSubmitted ? notSubmittedStreak + 1 : 0
     // Enter fallback: 2연속 "안 먹음" 관측(≥cadence 간격) + 직전 재검증 + 1회 한정 (slow-click 중복 방지)
     if (notSubmittedStreak >= 2 && submitMethod==='click' && !enterTried):
         ack2 = eval(__cg_submitAck__(PROMPT))         // Enter 직전 즉시 재검증
         if (ack2.stillHasPrompt && ack2.submitPresent):
             [submit fallback] main sendInputEvent Enter(컴포저 focus); enterTried=true; submitMethod='enter'
     // 이미지 폴링(2회 연속 같은 신규 id = 부분프레임 안정)
     p = eval(__cg_poll__(baseline.ids))
     if (p && lastPollId === p.id) → src=p.src 확보, 성공 → 5
     lastPollId = p?.id ?? null
   deadline 초과 → return { ok:false, stage: submittedAck ? 'poll' : 'submit' }   // 제출은 ack됐는데 이미지 안 나옴=poll, 제출 자체 실패=submit
5. return { ok:true, src }  → saveImage (§3-D)
```
**중복 제출 방지 = 설계로 크게 완화(보장 아님)**: Enter fallback은 2연속 `stillHasPrompt && submitPresent` + ack2일 때만 1회. 제출이 늦게라도 성공하면 컴포저가 비워져 이 조건이 거짓 → Enter 대부분 안 감. **잔여 경험적 window**: click이 서버측 제출은 됐는데 ack2(~3s)까지도 컴포저가 안 비워지면 Enter가 겹칠 수 있음(§7 리스크 목록, 체크포인트 로그로 관측). 각 실패 stage 태그드 로그. "어떤 주입(A/B)·제출(click/Enter) 기법이 먹혔는지 + 수락된 src"가 스파이크 산출물(체크포인트 로그).

### 3-D. 저장 (`spike-chatgpt-image.js`, main)
`saveImage(app, view, src, fs, deps) → path`:
- `res = await view.webContents.session.fetch(src)` (persist:chatgpt 쿠키 — 기존 `ipc/shared.js:363` 전례). `res.ok` 아니면 실패.
- `buf = Buffer.from(await res.arrayBuffer())`.
- ext = Content-Type(`res.headers.get('content-type')`)에서 매핑(image/png→png, jpeg→jpg, webp→webp), 불명 시 src 확장자 또는 png.
- `mkdirSync(spikeDir,{recursive:true})` → `writeFileSync(spikeDir/generated-<ts>.<ext>, buf)`. 경로 반환.
- 순수 부분(ext 매핑·경로 조립·mkdir-before-write)은 단위 테스트, `session.fetch`는 mock.

### 3-E. G 핸들러 (ipc 확장) — §3-F 상태기계 구동
```
Cmd+Alt+Shift+G →
  view = ensureChatgptView(state,{makeView})               // Phase1 idempotent(재-loadURL 금지)
  ensureVisibleAndFocused(view, mainWindow, {disposeView})  // sendInputEvent fallback 전제(표시+focus)
  await whenLoaded(view)                                    // did-finish-load(§3-A) — 첫 G 거짓미로그인 방지
  if (!await ensureLoggedIn(view)) → log '[spike] not logged in — press L' ; return   // G만 게이트(L/D/T/F 무게이트)
  const r = await runGenerateStateMachine(view, PROMPT, SELECTORS)   // §3-F: baseline→inject(+B)→submit(+Enter)→poll
  if (!r.ok) → log '[spike] generate failed: ' + r.stage ; return
  const p = await saveImage(app, view, r.src, fsSync, {})
  log '[spike] image saved: ' + p
  // 전 구간 try/catch로 태그드 실패 로그(Phase1 F2)
```
`runGenerateStateMachine`은 §3-F 순서(개별 eval + main sendInputEvent fallback)를 실행하고 `{ok, src}|{ok:false, stage}` 반환. 하드코딩 프롬프트(예: "간단한 빨간 사과 한 개, 흰 배경"). SELECTORS는 §3-B 확정 상수.

## 4. 결과 상관 규칙 (재확인 — §3-C/§3-F)
- baseline = 제출 전 `CDN_RE`(estuary/content) 이미지들의 **content-id 집합**(개수·서명URL 아님).
- accept = baseline에 없던 **새 id** + `CDN_RE` + 로드 완료 + **2회 연속 폴링 같은 id**(§3-F, 경험적 settle 완화). transient blob/data(CDN 불일치)·stale(baseline id)·다른 backend-api 자산(estuary 아님)·same-id/new-sig(같은 id)는 제외되나, **fresh-id progressive frame은 경험적 잔여**(§0, 체크포인트 로그로 실측).
- 단일 120s deadline → 마지막 체크포인트와 실패.

## 5. 테스트 (단위 + **통합** — CLAUDE.md 필수, 문자열 검사만으론 불충분)
- **단위(순수 로직 — 페이지 스크립트에서 분리 가능한 부분은 헬퍼로 빼서):**
  - **상관 헬퍼 `pickNewCdnImage(baselineIds, imgs)`** — (a) `idOf`가 baseline에 있으면 제외, (b) `CDN_RE`(estuary/content) 불일치 제외, (c) 로드 미완료 제외, (d) 새 id + 로드완료 반환(id 포함). **fixture 6종**: stale(baseline id)→none, transient blob/data→none, **wrong-backend-path**(`/backend-api/files/…` 등 estuary 아님)→none, **same-id/new-sig**(같은 id·다른 sig = 기존 이미지 서명갱신)→none, 새 id 로드중→none, 새 id 로드완료→그것. (2회 연속 안정 검사는 상태기계 통합 테스트에서.)
  - `idOf(src)`/`norm(s)` 순수 함수 — id 추출(estuary인데 id 없으면 후보 제외=fail-closed), ZWSP/BOM/nbsp 정규화.
  - `ensureLoggedIn` 판정 — `#prompt-textarea` 있음→true, 로그인 CTA만+컴포저 없음→false (DOM fixture).
  - `saveImage` — Content-Type→ext(png/jpeg/webp/unknown→png), mkdir-before-write, session.fetch !ok→실패(fetch mock).
  - 페이지 스크립트 문자열 계약 — **6개 함수** 정의(`__cg_baseline__`/`__cg_inject__`/`__cg_verify__`/`__cg_clickSubmit__`/`__cg_submitAck__`/`__cg_poll__`), self-contained(define+call), 확정 셀렉터·`CDN_RE`(estuary/content) 포함, Node/CDP 토큰 없음.
  - **eval-boundary 반환 키 계약**(v3 필드-불일치 버그 재발 방지 — 통합 테스트가 eval을 mock하면 실제 반환 shape를 안 잡음): 페이지 함수 문자열을 jsdom에서 실제 실행하거나, `__cg_submitAck__`의 반환 키(`composerCleared/submitPresent/stillHasPrompt`)가 §3-F가 읽는 필드의 상위집합임을 assert. `submitGone` 같은 옛 키가 다시 들어오면 실패해야.
- **통합(모킹 — §3-F 상태기계 관통, happy path만 X):**
  - happy: baseline→inject(textMatches)→clickSubmit→submitAck(cleared)→poll(2회 연속 같은 새 id)→saveImage(session.fetch mock).
  - **A 실패→B**: `__cg_inject__` textMatches=false → main sendInputEvent clear+타이핑 → `__cg_verify__` 재검증.
  - **click 무반응→Enter**: submitAck가 **2회 연속** `stillHasPrompt && submitPresent`(notSubmittedStreak≥2) + ack2 재검증 → main sendInputEvent Enter **1회**(enterTried) → 재폴링.
  - **중복 제출 방지**: submitAck가 composerCleared(제출 됨)면 **Enter fallback 미호출**(늦은 성공 포함).
  - **부분-프레임**: poll이 새 id를 1회만 주고 다음에 다른 id/none → 미수락(2회 연속 필요). estuary 아닌 backend-api src·same-id/new-sig → 미수락.
  - **deadline**: 단일 120s(fake timer) 초과 → stage 태그 실패(ack 기준: `submittedAck` 없으면 'submit', 있으면 'poll'). + context 조기실패(연속 reject → 로그아웃/DOM부재 → 'context').
  - **게이트**: G만 ensureLoggedIn 게이트(false면 저장·상태기계 미실행, 태그드 로그), L/D/T/F 무게이트(Phase1 계약).
- **게이트:** 전체 스위트 그린 + `tests/electron/api/genai.test.js` 무수정.

## 6. 제약
- **CDP 금지** — executeJavaScript/sendInputEvent만(Phase 2엔 capturePage 불필요 — 이미지가 https라). `webContents.debugger` 미사용.
- 기존 Flow·API 무변경. 스파이크 병렬 파일 + ipc 확장 + (필요시) main G 핸들러 배선.
- 저장 `app.getPath('userData')/spike-chatgpt/`.

## 7. 리스크
- **주입이 ProseMirror 상태를 안 바꿈:** `__cg_inject__`가 `textMatches`(norm 비교)로 판정 → 실패면 sendInputEvent B(clear+타이핑)+`__cg_verify__`. Phase1에서 뷰 표시·focus 인프라 확보돼 fallback 가능.
- **클릭 isTrusted 무시:** `__cg_submitAck__`가 2회 연속 `notSubmitted`(stillHasPrompt&&submitPresent)+ack2 재검증이면 sendInputEvent Enter 1회(§3-F, 중복 방지).
- **이미지 생성 지연/실패:** 120s 타임아웃 + 체크포인트. entitlement(이미지 생성 가능 계정)는 Phase1에서 확인됨.
- **src 만료/서명:** 생성 직후 즉시 fetch(같은 세션) → 유효. 지연 시 재조회.
- **[경험적 잔여 ①] preview id 조기 수락:** ChatGPT가 최종 이미지 **전에** preview/저해상 렌더에 **별도 estuary id**를 부여하고 그 id가 2회 연속 폴링에서 안정(로드 완료)이면, 우리 규칙이 그 preview를 최종으로 오인해 조기 수락·저장할 수 있다. (id-안정 검사는 preview→final **id 스왑**은 잡지만, preview 자체가 안정된 새 id면 못 잡는다.) Phase1은 완성 이미지만 관측해 이 경로 미측정 → **수락 src를 체크포인트 로그**로 남겨 실 run에서 preview 여부 실측(§0/§3-C).
- **[경험적 잔여 ②] slow-click 중복 제출:** click이 서버측 제출됐는데 컴포저 clear가 ack2(~3s)보다 늦으면 Enter가 겹쳐 2회 생성될 수 있음. separate-eval 라운드트립·2연속 streak·ack2로 크게 완화하나 보장은 아님 → 실 run 체크포인트 로그로 관측(§3-F).

## 8. 종료 조건
`Cmd+Alt+Shift+G` → 이미지 1장 `spikeDir` 저장 1회 성공(실앱). → 스파이크 성공. 어떤 주입(A/B)·제출(click/sendInputEvent) 기법이 먹혔는지 기록 → 정식 기능(Flow 타깃 일반화 + 엔진 토글 UI + 파이프라인) spec.
