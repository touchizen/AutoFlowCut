# 핸드오프 — Flow 도메인 이전 대응 (2026-09-16)

레포: `~/workspace/AutoFlowCut-bugfix` (worktree, 브랜치 **main**, working tree clean)
상태: **수정 완료·커밋됨(`0bc50ae5`), 미푸시 1커밋. 리뷰 1라운드 미완, 빌드/눈검증 미실시.**

---

## 1. 사건

사용자가 앱(패키징 3.2.2)에서 Flow 를 켜면 저장된 프로젝트 열기가 **무한 반복**됐다.

```
[Flow Project] opening saved flow project: https://labs.google/fx/tools/flow/project/134cf5b5-…
[Flow] initial loadURL failed: ERR_ABORTED (-3) …
[Flow] did-finish-load: https://flow.google.com/project/134cf5b5-…
[Flow Project] open error — retry via home: 134cf5b5-…
[Flow Project] open failed after retry: 134cf5b5-… dead= false https://flow.google.com/project/134cf5b5-…
[Flow Project] opening saved flow project: …      ← 반복
```

## 2. 원인 (curl 로 실측, 301 · redirects=1)

**Google 이 Flow 를 옮겼다.**

| 옛 | 새 |
|---|---|
| `labs.google/fx/tools/flow` | `flow.google.com/` |
| `labs.google/fx/tools/flow/project/<id>` | `flow.google.com/project/<id>` |

앱의 URL 판정이 **`/tools/flow` 경로 세그먼트를 요구**해서, 리다이렉트로 착지한
`flow.google.com/project/<id>` 를 "대상 아님"으로 오판했다. 로그의
`open failed after retry … dead= false https://flow.google.com/project/<맞는 id>` 가 그 증거다 —
**정확히 맞는 URL 위에서 실패라고 보고**하고 있다.

실패로 끝나면 `src/hooks/useProjectData.js` 의 폴링이 mode-entry 를 다시 돌리고,
그게 `openFlowProject` 를 재호출해 무한 루프가 된다.

⚠️ `ERR_ABORTED (-3)` 는 원인이 아니다 — 리다이렉트가 원래 로드를 대체할 때 나는 정상 신호다.

## 3. 고친 것 (`0bc50ae5`)

같은 판정이 **여러 곳에 복제**돼 있던 것이 확산 반경이었다 → 순수 모듈 하나로 모았다.

| 파일 | 변경 |
|---|---|
| `electron/flowUrl.js` | **신규** — `flowBaseFromUrl` / `flowProjectUrl` / `onProjectComposerUrl`. 옛·새 배치 둘 다 인식, 옛 도메인의 로케일 접두어(`labs.google/ko/fx/…`) 보존 |
| `electron/ipc/dom.js` | open 프로브 — **여기가 루프가 난 자리** |
| `electron/ipc/shared.js` | `onProjectComposerUrl` 위임 + base 추출 2곳 + lenient 폴백 |
| `electron/ipc/character.js` · `electron/flow-character-api.js` · `electron/ipc/flow-api.js` | 같은 이전 |
| `electron/flow-media-collect.js` | **같은 원인으로 조용히 죽어 있던 것** — 생성 이미지 edit 카드 href 매칭이 `/tools/flow` 전용이라 새 도메인에서 **수집이 0건**이었다. 이 함수는 `Function.prototype.toString` 으로 페이지에 주입돼 **import 를 못 쓴다** → 두 패턴 인라인 |
| `package-lock.json` | 3.2.1 → 3.2.2 (앞선 버전 범프가 놓쳐 패키징 테스트가 깨져 있었다) |

TDD: `tests/electron/flowUrl.test.js`(11개 신규)와 `flow-media-collect.test.js`의
도메인 이전 케이스 4개를 **실패 상태로 먼저** 작성했다. **전체 7331 / 695 files green.**

## 3.5 ⚠️ 리뷰 라운드 1 결과 — **NO-GO** (Fable, 커밋 후 도착)

**수정 자체는 맞다** — 로그인 상태의 열기 무한반복은 끊긴다. 그런데 **범위가 이보다 훨씬 크다.**

### HIGH — 코드 전 반드시

**#1 `isFlowFrameOrigin` 이 아직 `https://labs.google` 로 박혀 있다** (실측 증명)
`electron/reportResponseRouter.js:23`, `electron/main.js:829`. 페이지가 `flow.google.com` 이면
`flow:report-response` 가 전부 `unauthorized origin` 으로 **버려진다** → monkey-patch 가 잡은
응답(batchGenerateImages, video submit/status/upsample)이 main 에 도달 못 해
`pendingGeneration*` 이 전부 타임아웃까지 매달린다. `capturedApiOrigin` 도 영영 안 잡힌다.
**이게 이번 커밋이 쓸었다고 주장한 바로 그 부류인데, host 기반이라 `/tools/flow` grep 에서 빠졌다.**
이대로 나가면 증상이 "무한 루프" → **"생성이 영영 안 끝남"** 으로 바뀔 뿐이다.
테스트 `tests/electron/reportResponseRouter.test.js:107-108` 도 labs.google 만 핀한다.

**#2 로그아웃 상태는 여전히 무한 재시도** (헤드리스 크롬 실측)
쿠키 없이 `flow.google.com/project/<id>` → 1초 안에 `/about` 로 클라이언트 리다이렉트
(마케팅 랜딩, interactive 208개). dom.js 의 2초 probe 시점엔 이미 떠나 있어 실패 →
`useFlowAdoptPrompt` 가 **5초마다** 재시도(`useFlowAdoptPrompt.js:8,49` → `useProjectData.js:782`).
**상한도 백오프도 없다.** 한 사이클에 `loadURL` 3번(~12초)이라, 사용자가 뷰에서 Sign in 하려 해도
다음 사이클이 끌어낸다. `main.js:446` 랜딩 자동클릭도 `labs.google` 게이트라 `/about` 에선 안 돈다.

**#3 `flow.google.com` 은 다른 프론트엔드다 — 주입 셀렉터 전부 미검증**
번들이 `boq-labs-ai-sandbox.AiSandboxAngularFrontend`, DOM 에 `[ng-version]`,
styled-components `sc-*` **0개**(옛 라이브 덤프 `tests/fixtures/flow-live-dom-20260714.js` 는 전부 `sc-*`).
영향: `[data-slate-editor='true']`(`flow-compose-editor.js:15`, `flow-agent-toggle.js:37,74`),
`add_2` XPath(`dom.js:143-150`, `main.js:606-612`), `button[aria-pressed]` 토글,
`media.getMediaUrlRedirect?name=` img src(`flow-media-collect.js:35`).
부속: `FLOW_LOADED_MIN_INTERACTIVE = 20`(`flowOpenRetry.js:24`)은 옛 앱 "랜딩 7 vs 프로젝트 63"
기준인데 새 `/about` 만 208 → `isFlowErrorPage` 가 사실상 영영 false.

**#4 Bearer 토큰 파이프라인이 끊긴다**
`SESSION_URL='https://labs.google/fx/api/auth/session'`(`main.js:127`)을 **페이지 컨텍스트**에서
fetch 한다(`flow-api.js:93,:356`, `main.js:544`, `character.js:117`). origin 이 `flow.google.com` 이면
cross-origin 인데 응답에 `Access-Control-Allow-Origin` 이 없다 → reject → 토큰 null.
게다가 그 엔드포인트는 next-auth 인데 새 앱은 Google one-bar 로 로그인한다
(`flow.google.com/api/auth/session` 은 JSON 이 아니라 Angular 셸 HTML).
**새 앱의 대체 토큰 경로는 미확인.** 기존 사용자는 옛 labs.google 쿠키 만료까지만 버틴다.

### MEDIUM / LOW
- **#5** `main.js:473,524` 의 `url.includes('labs.google/fx')` 가 did-finish-load 부트스트랩
  (동의 클릭·`capturedProjectId`·startup open·`authenticated:true`)을 새 도메인에서 통째로 끈다.
- **#6 ⚠️ 내가 쓴 테스트 하나가 공허하다.** 실제 로케일 배치는 **`/fx/ko/tools/flow`** 인데
  (라이브 픽스처 `flow-live-dom-20260714.js:18`, `flow-character-api.js:199`),
  `flowUrl.js:33` 의 regex 는 `/fx/tools/flow` 를 요구하고
  `tests/electron/flowUrl.test.js:25-26` 은 **존재하지 않는 `/ko/fx/tools/flow`** 를 검사한다.
  실해는 없지만(어차피 308 리다이렉트) docstring·커밋문·테스트가 전부 틀렸고
  `buildCharactersUrl` 은 맞는 추출을 따로 갖고 있어 **진실이 둘**이다.
  덤: `[^/]*labs\.google` 이 `notlabs.google` 도 받는다.
  그리고 `tests/electron/flow-character-api.test.js:31-32` 는 legacy 케이스를 새 도메인으로
  **바꿔치기**해서 그 입력 커버리지가 사라졌다 — 추가했어야 한다.
- **#7** 인라인 regex 틈: 새 셸의 `<base href>` 로 Angular 가 슬래시 없는 상대경로를 내면 놓치고,
  protocol-relative `//flow.google.com/…` 도 strip 이 안 된다. 둘 다 로그인 DOM 덤프 전엔 추측.

### 검증돼서 무발견인 것
`onProjectComposerUrl` 은 node 로 전수 확인 — 다른 origin·`?next=`·`/archive/project/`·
`-suffix`·`/characters`·`/edit/abc`·`/settings`·`/` 포함 id·`[` 전부 false. 새 host 는 `^/project/`
앵커라 legacy 보다 **더** 엄격. `null` id 도 이제 막힌다(옛 코드는 `String(null)='null'` 로 통과).

---

## 4. 새 세션이 할 일

⚠️ **이건 URL 판정 버그가 아니라 프론트엔드 교체 대응이다.** 커밋된 수정은 필요하지만
충분하지 않다 — 순서를 지켜야 한다.

1. **로그인한 프로젝트 화면의 DOM 을 먼저 덤프한다.** (§3.5 #3)
   `flow:dump-settings` / flow-dom-dump 로 새 Angular 앱의 실제 셀렉터·interactive 수를 받아온다.
   **이게 없으면 #3·#4·#7 이 전부 추측이다.** 다른 걸 고치기 전에 이것부터.
2. **#1 을 이번 fix 에 넣는다** — `isFlowFrameOrigin` 에 `https://flow.google.com` 허용 + 테스트.
   증명된 결함이고 싸다. 안 넣으면 "무한 루프"가 "생성이 영영 안 끝남"으로 바뀔 뿐이다.
3. **#6 정리** — 내 테스트가 존재하지 않는 로케일 배치를 검사한다. 실제 배치(`/fx/ko/tools/flow`)로
   고치고, `flow-character-api.test.js` 에서 바꿔치기한 legacy 케이스를 **되살린다**(추가).
4. **#2 방향 결정** — 로그아웃 루프. 재시도 상한/백오프를 넣을지, 로그인 필요를 사용자에게
   띄울지. **이건 설계 결정이라 사용자에게 물을 것.**
5. **#4 방향 결정** — 토큰 경로. 새 앱의 인증 수단을 DOM/네트워크 덤프로 먼저 확인.
6. 그 다음에야 빌드 + 눈검증. 확인 항목은 §3.5 말미 참고.

**리뷰**: 라운드 1 은 Fable 만 돌렸다(Codex MCP 가 `CONNECTION_CLOSED`).
라운드 2 부터는 Codex(gpt-6-astra, xhigh, read-only)도 같이. 직전 findings 를 통째로 붙일 것.

## 5. 주의

- 이 worktree 는 **다른 세션과 공유**된다. 작업 중 `main` 에 다른 커밋이 들어왔고
  `git stash` 스택에도 남의 WIP 가 있다 — **bare `git stash` / `pop` 금지.**
- `main.js:126` 의 `FLOW_URL` 과 `src/config/defaults.js:33` 의 `flowUrl` 은 **옛 도메인 그대로 뒀다.**
  리다이렉트가 동작하므로 기능엔 문제없고, 바꾸면 세션/인증 경로에 영향이 갈 수 있어 범위 밖으로 뒀다.
  `ERR_ABORTED` 로그 노이즈는 그래서 남는다.
