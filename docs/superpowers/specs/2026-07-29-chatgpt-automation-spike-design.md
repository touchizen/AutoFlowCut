# ChatGPT 자동화 — 스파이크 설계 v6 (throwaway 증명)

> **목적:** AutoFlowCut(Electron) 안에서 chatgpt.com을 WebContentsView로 띄우고 **웹 자동화로 이미지 1장을 생성·저장**할 수 있는지 최소 증명한다. 되는 걸 확인한 뒤에야 정식 기능(Flow 타깃 일반화 + 엔진 선택 UI + 파이프라인 연결)을 설계한다. **스파이크 한정.**
>
> **개정 이력:** v1→v2 (R1: 로그인 뷰 표시·dev 트리거·게이트 방향·makeFlowView whitelist·주입 실험·이미지 저장·덤프 분할·상관·테스트). v2→v3 (R2: dev 게이트 macOS dev 오보고 정정, 단축키 등록 라이프사이클, 페이지 스크립트 매-호출 설치, mkdir, 통합 테스트 필수, canvas tainted fallback, G 재표시+focus, 덤프 3스냅샷, DOM auth 프로브, MIME 확장자). v3→v4 (R3: **ensureView 부트스트랩 계약 분리**(loadURL/ready만, auth 프로브는 ensureLoggedIn·G만 게이트), capturePage rect 정규화(scrollIntoView·정수 clamp·빈 rect 거부), install+invoke **단일 executeJavaScript**, **macOS-only dev 스파이크** 명시). v4→v5 (R4: **ensureView idempotent — 재-loadURL 금지**(D/T/F 재네비로 T 입력·F 이미지대화 소실 방지), §7 G-게이트 계약 테스트 추가, canvas 분기 **PROVISIONAL**로 스코프 다운). v5→v6 (R5: ensureView 재사용 술어를 origin 기준으로 정밀화, §8 canvas 요약 정합(부분저장 금지=명시 실패), diagram/테스트에 capture PROVISIONAL 표기, ensureView idempotence 단위테스트 추가).
>
> **플랫폼:** 이 스파이크는 **macOS(darwin) dev 전용**이다 — dev 게이트가 의존하는 `patch-electron-name.cjs`가 darwin 전용이고, 단축키가 `Cmd+Alt+Shift+…`다. Windows/Linux 미지원(정식 기능에서 `CommandOrControl`로 일반화).

## 0. 배경 / 결정 이력
- 서드파티 크롬 확장 "ChatGPT Automation"을 본 뒤 동등 기능을 AutoFlowCut에 넣을지 검토.
- **결정:** API 모드가 아니라 **Flow 모드(웹 자동화)** 쪽에 붙인다 — 기존 Flow(Google Labs Flow) 자동화와 나란히 ChatGPT를 두 번째 웹 타깃으로.
- **약관 리스크 인지:** chatgpt.com 자동화는 OpenAI ToS 위반·계정 밴 리스크. 단, 앱은 이미 Flow(Google Labs) 웹 자동화(trusted-event 우회 포함)를 **현역**으로 탑재 — 같은(또는 더 낮은) 리스크 카테고리. 사용자 배포 리스크는 정식 기능 설계 몫(스파이크 밖).
- **스코프:** "스파이크 먼저"(사용자 확정). **셀렉터 소싱:** DOM 덤프 스텝 포함(사용자 확정).
- **⚠️ 문서 정합:** repo `CLAUDE.md`의 "(구) Flow 웹 역공학 제거됨"은 **낡음** — Flow는 현역(`FLOW_URL`, `makeFlowView`, `appMode==='flow'`). 스파이크는 그 현역 인프라를 **확장**한다.
- **참고(정식 기능용):** API-vs-Flow 엔진 파사드(`src/engine/useGenerationEngine.js`)는 이미 있음. 없는 것은 **Flow 내부의 웹-타깃 추상화**(labs.google 하드코딩). 스파이크는 파사드/Flow 코드를 **무변경**.

## 1. 성공 기준 (이게 전부)
실앱에서:
1. dev 트리거로 chatgpt.com 뷰가 **화면에 표시**되어 사용자가 수동 로그인, **DOM auth 프로브**가 로그인 확정(§3-A).
2. **Phase 1:** 3회 덤프(컴포저-빈 / 컴포저-입력됨 / 결과-이미지있음)로 4개 셀렉터(컴포저 입력 / 전송 버튼[disabled↔enabled] / 생성 이미지 요소 / 이미지 소스)를 확정(§4-B).
3. **Phase 2:** 프롬프트 1개 주입(실험 시퀀스) → 전송(제출 관측) → **제출 후 생성된** 이미지 로드 완료까지 폴링 → 디스크에 1장 저장(§4-C, §5).

(3)이 **1회** 성공하면 스파이크 성공.

## 2. 스코프
### In
- chatgpt.com용 standalone WebContentsView 팩토리(§3-A, `makeFlowView`에서 **선별 복사**).
- DOM 덤퍼(페이지 주입 문자열, `flow-settings-dumper.js` 패턴): 컴포저-빈 / 컴포저-입력됨 / 결과.
- 프롬프트 주입·전송·제출관측·이미지 폴링·저장.
- **dev 전용 트리거**: main-프로세스 `globalShortcut`(§3-B). preload/렌더러 무변경.
- 셀렉터 하드코딩(Phase 1 덤프로 저자가 수동 확정).
- **단위 + 통합 테스트**(§7).

### Out (정식 기능으로 이연)
상단 타깃 토글 UI, 설정 기본 타깃, Flow labs.google 추상화, 씬/배치 파이프라인, I2I(레퍼런스 업로드), 셀렉터 원격 config, 로그인 온보딩·밴 고지·동의, 크레딧/과금 게이트, 리트라이/동시성/에러 분류.

## 3. 아키텍처
### 3-A. WebContentsView 팩토리 — `makeFlowView`에서 **선별 복사** + DOM auth 프로브
신규 `electron/spike-chatgpt-view.js` `makeChatgptView()`.

**복사(whitelist):**
- `new WebContentsView({ webPreferences:{ partition:'persist:chatgpt', contextIsolation:true } })` (webSecurity 기본 true 유지).
- `console-message` → main forward, prefix `[autoflowcut CGPT]` 필터.
- `did-fail-load` 에러 로깅.

**복사 금지(forbid — Flow 전용):** `webSecurity:false`, `preload:flow-preload.cjs`, labs.google origin 핀, **`flow-status` 렌더러 이벤트 송신**(렌더러 Flow 상태 오염), `unsupported-country`, projectId 캡처, 전체-URL `webRequest.onBeforeRequest`, `FLOW_PAGE_INJECTION`, `FLOW_SETTINGS_DUMPER` 주입, consent/landing 자동클릭, enter-tool 부트스트랩, 토큰 프로빙, startup-project 자동열기, `modeController` flowDetached 가드. (makeFlowView에 `setWindowOpenHandler`·UA 오버라이드는 없음 → 대상 아님.)

**부트스트랩 계약(분리):** 순환·게이트 오작동을 막기 위해 역할을 나눈다.
- `ensureView()` = **생성 → attach → `loadURL('https://chatgpt.com')` → did-finish-load 대기**만. **auth 판정 안 함.** 로그아웃 상태여도 페이지를 띄운다(L로 수동 로그인해야 하므로). **⚠️ idempotent — 재사용 조건은 "뷰가 살아있고(비-destroyed) 현재 문서 `origin === 'https://chatgpt.com'`" 일 때만 생성·attach·`loadURL` 전부 생략(재네비게이션 금지).** loadURL을 트리거하는 경우 = 뷰 없음/파괴됨/`about:blank`/**off-origin(chatgpt.com 아님)**. (재사용을 "non-blank"로만 판정하면 off-origin 에러/로그인 리다이렉트 페이지도 non-blank라 잘못 보존되므로 origin으로 판정한다.) 안 그러면 D/T/F가 매 트리거마다 리로드돼 T의 타이핑 상태·F의 이미지 대화가 날아가 Phase 1 침몰.
- `ensureLoggedIn()`(**별도**) = URL이 아니라 **DOM 프로브**로 판정. chatgpt.com은 로그아웃도 같은 URL일 수 있으므로 URL 신뢰 금지. 프로브는 **거친 부트스트랩 휴리스틱**(로그인 CTA present → 미로그인; 컴포저/계정 컨트롤 present → 로그인) — Phase 1이 찾을 정밀 셀렉터에 의존하지 않는다(순환 방지). 덤프 확보 후 프로브를 정밀화할 수 있다.
- **게이트는 G만.** `Cmd+Alt+Shift+L/D/T/F`(로그인·덤프)는 `ensureLoggedIn()` **무게이트** — 로그인 전/셀렉터 확정 전에도 로그인·덤프가 가능해야 한다. `Cmd+Alt+Shift+G`(생성)만 `ensureLoggedIn()` 실패 시 명시적 실패 반환.

뷰는 lazy 생성(첫 dev 트리거), 재사용(모듈 스코프 1개).

### 3-B. dev 트리거 — main `globalShortcut` (라이프사이클·실패 체크 명시)
`electron/ipc/spike-chatgpt.js`의 `registerSpikeShortcuts()`를 **`app.whenReady()` 안, `createWindow()` 이후**에 호출(기존 단축키 등록과 동일 위치 — `electron/main.js`의 whenReady 블록, Cmd+Shift+E/N 등록 근처). **`isSpikeEnabled()`(§3-C) true일 때만.**
- `Cmd+Alt+Shift+L` — 뷰 생성 + **표시/포커스**(로그인용, §4-A).
- `Cmd+Alt+Shift+D` — 컴포저-빈 덤프. `Cmd+Alt+Shift+T` — 컴포저-입력됨 덤프. `Cmd+Alt+Shift+F` — 결과 덤프.
- `Cmd+Alt+Shift+G` — Phase 2 생성(하드코딩 프롬프트 1개).
- **각 `globalShortcut.register()`의 boolean 반환을 확인** — false면(액셀러레이터 선점) 에러 로그(조용한 미등록 방지). `will-quit`의 `unregisterAll()`이 정리 커버(기존).
- preload/렌더러 무변경. main-only 배선(신규 파일 + whenReady에 `registerSpikeShortcuts()` 호출 1줄).

### 3-C. dev 게이트 — 단일 권위 술어 (**macOS dev 오보고 정정**)
`electron/spike-devgate.js` `isSpikeEnabled()`:
```
(!!process.env.VITE_DEV_SERVER_URL || !app.isPackaged) && process.env.AUTOFLOWCUT_SPIKE === '1'
```
- **왜 `!app.isPackaged`만으론 안 되나:** darwin에서 `scripts/patch-electron-name.cjs`가 **postinstall/predev 자동 실행**으로 dev Electron 바이너리를 rename → `app.isPackaged`가 **dev에서 true로 오보고**(`electron/updater.js:24`가 실제 겪은 버그로 기록). 따라서 repo의 canonical dev 신호인 **`VITE_DEV_SERVER_URL`을 OR**로 복구한다(updater.js·main.js dev 판정과 동일). 그 위에 **명시적 opt-in `AUTOFLOWCUT_SPIKE=1`을 AND**로 요구해 프로덕션 차단.
- 실행: `AUTOFLOWCUT_SPIKE=1 npm run dev`.
- 진리표 단위 테스트(§7) — 특히 `{isPackaged:true, VITE_DEV_SERVER_URL:set, env:1}`(patched darwin dev)이 **true**임을 고정.

### 3-D. 데이터 흐름 (Phase 2) + 페이지 스크립트 설치
**설치+호출은 단일 `executeJavaScript`로**: v2가 nav-time 주입을 뺐고 로그인/네비가 페이지 globals를 파괴하므로, 두 번의 executeJavaScript(설치 후 호출) 사이에 네비가 끼면 함수가 사라진다. 따라서 각 D/T/F/G는 **한 번의 evaluated 표현식**으로 (a) `window.__autoflowcut_chatgpt_*`를 idempotent하게 정의하고 (b) 즉시 호출해 결과를 반환한다(설치-호출 사이 간극 제거).

```
globalShortcut(G) --> main(spike-chatgpt.js)
  ensureView()               // 생성/attach/loadURL/ready만 (auth 판정 안 함, §3-A)
  ensureVisibleAndFocused()  // 숨겨져 있으면 재표시(§4-A) + mainWindow.focus()+view.webContents.focus()
  ensureLoggedIn()           // DOM auth 프로브(§3-A); G에서만 게이트, 미로그인 → 실패
  executeJavaScript( "(define __generate__ if absent) ; __generate__(PROMPT, SELECTORS)" )  // 단일 eval
  page 반환 계약(셋 중 하나):
    { kind:'url',    url, mime? }               // https CDN(인증형)
    { kind:'base64', base64, mime, w, h }       // blob → 페이지 내 fetch→base64
    { kind:'base64', base64, mime:'image/png' } // canvas → toDataURL(성공 시)
    { kind:'capture', rect:{x,y,width,height} } // canvas tainted(toDataURL throw): PROVISIONAL — Phase 1이 canvas 확인 시에만 구현(아래 정규화 rect)
  main 저장 분기:
    kind==='base64' → 디코드 저장
    kind==='url'    → view.webContents.session.fetch(url)   // persist:chatgpt 쿠키(기존 ipc/shared.js:363 전례)
    kind==='capture'→ view.webContents.capturePage(rect)(비-CDP) → NativeImage 비었으면 실패 → PNG 저장
  저장 전: mkdirSync(spikeDir, {recursive:true})
  파일명: generated-<ts>.<ext>  // <ext>는 MIME/바이트에서 결정(png/jpeg/webp), 불명 시 png
  → spikeDir 저장 → 경로 로그
```
`spikeDir = app.getPath('userData')/spike-chatgpt/` (하위 디렉토리 신규 → **쓰기 전 mkdir 필수**).

**`kind:'capture'`(tainted canvas 전용) — ⚠️ PROVISIONAL:** ChatGPT 생성 이미지의 실제 형태(https `<img>` / blob / canvas)는 **Phase 1 결과 덤프로 확정**된다. **url·base64 두 분기가 유력 형태(`<img src>` https, blob)를 이미 커버**하므로, canvas-tainted 분기는 **Phase 1이 canvas임을 실제로 밝힌 경우에만** 실코드로 확정한다(불확실 분기를 미리 과설계하지 않는다 — 스파이크 원칙). 만약 canvas면: `capturePage(rect)`는 렌더된 뷰포트만·정수 좌표 요구 → 페이지에서 canvas `scrollIntoView` 후 `getBoundingClientRect` 재계산·정수 반올림, **rect가 뷰포트에 완전히 들어오지 않으면(잘림 위험) clamp해서 부분 저장하지 말고 명시적 실패**(또는 뷰 확대 후 재시도). readiness(draw 완료)는 tainted라 픽셀 검사 불가 → §5의 관측 신호(생성 인디케이터 사라짐 + 폴링 간 dimension 안정)로 판정. 이 세부는 Phase 1이 canvas를 확인한 뒤 실 DOM으로 확정.

## 4. Phase별 상세
### 4-A. 로그인 (선행 전제) + 표시/포커스 헬퍼
- `persist:chatgpt`는 새 파티션 → 첫 실행 무조건 로그아웃. `Cmd+Alt+Shift+L`이 `ensureVisibleAndFocused()`: 뷰를 `mainWindow.contentView.addChildView(view)` + `setBounds(가시 영역, non-0×0)` + `mainWindow.focus()` + `view.webContents.focus()`(기존 attach 전례: `ipc/mode.js:24`, setBounds: `ipc/shared.js:153`). 사용자가 그 안에서 로그인(구글 SSO 또는 이메일).
- **`sendInputEvent` fallback(§4-C)은 뷰 attach + non-0×0 + focus + BrowserWindow focus 상태여야 동작**(Electron 요구). 그래서 **G도 시작 시 `ensureVisibleAndFocused()`를 호출**해, 사용자가 L 이후 뷰를 숨겼거나 다른 앱이 foreground여도 fallback이 사문화되지 않게 한다.

### 4-B. Phase 1 — DOM 덤프 (3 스냅샷, 각각 별도 파일)
신규 `electron/spike-chatgpt-dumper.js`(문자열: `__autoflowcut_chatgpt_dump__`를 idempotent 정의 **+ 즉시 호출**해 현재 페이지 상태를 직렬화 반환하는 단일 표현식, §3-D). main은 `ensureView()` 후 이 단일 eval 실행(로그인·게이트 무관, §3-A).
- `Cmd+Alt+Shift+D` — **컴포저-빈**(빈 새 대화): 컴포저 + 전송 버튼(disabled). → `dom-dump-composer-empty.json`.
- `Cmd+Alt+Shift+T` — **컴포저-입력됨**(사용자가 아무 텍스트 타이핑한 상태): 전송 버튼(enabled). → `dom-dump-composer-filled.json`. (활성화 신호 = disabled/aria 차이 확정.)
- `Cmd+Alt+Shift+F` — **결과**(**이미지가 이미 생성돼 있는 대화**): assistant 생성 이미지 요소 + 소스(img src https/blob, 또는 canvas). → `dom-dump-result.json`.
- 세 파일 모두 `spikeDir`에 저장(파일명 상이 → 덮어쓰기 없음) + 터미널 로그(`[autoflowcut CGPT DUMP]`).
- 사용자가 **세 덤프 파일**을 저자에게 전달 → 저자가 4개 셀렉터를 확정해 `spike-chatgpt-automate.js` `SELECTORS`에 하드코딩.

**수동 전제(자동화 안 함, 문서화):** 이미지 생성 가능한 계정/모델, **일반(비-temporary) 새 채팅**, 결과 덤프용으로 미리 이미지 1장 생성해 둔 대화.

### 4-C. Phase 2 — 주입·제출·회수 (**실험 시퀀스**)
신규 `electron/spike-chatgpt-automate.js`(문자열: `__autoflowcut_chatgpt_generate__`를 idempotent 정의 **+ 즉시 호출**하는 단일 표현식, §3-D). main은 `ensureView()` → `ensureVisibleAndFocused()` → `ensureLoggedIn()`(G만) 후 이 단일 eval 실행.
1. **주입 A:** 컴포저 focus → `execCommand('insertText')` 또는 `beforeinput`/`InputEvent`.
2. **검증:** 에디터 텍스트 반영 + **전송 버튼 enabled** 확인. (Flow가 `sendInputEvent`를 쓰는 이유는 reCAPTCHA가 아니라 **위젯이 `isTrusted:false`를 무시**하기 때문 — `ipc/shared.js:89-91`. ChatGPT도 같을 수 있어 **가정 말고 검증**.)
3. **fallback B(2 실패 시):** main이 `view.webContents.sendInputEvent`로 focus된 컴포저에 trusted 키 입력(뷰 표시·focus 전제 — §4-A). 재검증.
4. **제출:** 활성 전송 버튼 클릭(A: `.click()`→검증, B: `sendInputEvent`). **제출 성공 = baseline 이후 새 user 메시지 실제 추가** 관측(§5).
5. **회수:** §5 상관으로 잡은 **새 assistant 이미지**의 소스를 계약(§3-D)으로 반환.

체크포인트 로그: `injection=A|B`, `sendEnabled`, `submitted`, `newAssistant`, `imageLoaded`, `mime`, `bytes`, `w×h`.

## 5. 결과 상관 (오탐/누락 방지)
- **제출 전 baseline**: 메시지 노드 수(또는 마지막 노드) 스냅샷. 또는 빈 새 채팅.
- **제출 후 새 assistant 메시지만 인정**: baseline 이후 생성된 assistant 노드에서만 이미지 탐색.
- **로드 완료 판정(요소 종류별):** `<img>` → `img.complete && img.naturalWidth>0`; blob URL → fetch 성공; **canvas(있을 때) → width>0 && height>0 + 생성 인디케이터 사라짐 + 폴링 2회 간 dimension 안정**(tainted라 픽셀 검사 불가하므로 이 관측 신호로 draw-완료 근사; 스켈레톤 제외).
- **타임아웃 120s**, 초과 시 마지막 체크포인트와 실패 반환.

## 6. 제약 / 절대 규칙
- **CDP 절대 금지** — `executeJavaScript`/`sendInputEvent`/`capturePage`만(모두 비-CDP). `webContents.debugger` 미사용.
- 기존 Flow·API·`useGenerationEngine` **무변경**. 스파이크 = 병렬 신규 파일 + whenReady의 `registerSpikeShortcuts()` 호출 1줄.
- throwaway. 검증된 조각(뷰 팩토리·덤퍼)만 정식 기능 승격.
- 저장은 `app.getPath('userData')/spike-chatgpt/`.

## 7. 테스트 (repo 규칙 — 단위 + **통합** 필수)
CLAUDE.md는 신규 모듈 배선에 단위+**통합** 둘 다 요구. 라이브 ChatGPT 자동화는 실앱 눈검증이지만 아래는 자동 테스트:
- **단위:**
  - `isSpikeEnabled()` 진리표 — prod(isPackaged:true, VITE 없음)=false, patched-darwin-dev(isPackaged:true, VITE set, env:1)=**true**, env 없음=false.
  - **G-게이트 계약**(4라운드 핵심): `ensureLoggedIn()` mock으로, L/D/T/F 경로는 **게이트 안 함**(미로그인이어도 실행)·G 경로는 **게이트함**(미로그인 → 명시적 실패, 생성 스크립트 미실행). 이 계약이 회귀(덤프에 게이트가 붙으면 로그인 전 Phase 1 데드락)해도 초록불 나지 않게 고정.
  - 저장경로 조립 + **mkdir 호출**(fs mock → `mkdirSync(recursive)` 호출 확인, 결정적 파일명은 주입 clock).
  - 결과-상관 헬퍼(baseline/새-assistant/로드완료 판정) — DOM 스냅샷 fixture.
  - 저장 분기 계약(`kind:'url'`→session.fetch mock, `kind:'base64'`→디코드) + **MIME→확장자** 매핑. (`kind:'capture'` 저장 분기는 **Phase 1이 canvas 확인 시에만** 구현·테스트 — 그전엔 미구현이 정상.)
  - **`ensureView()` idempotence**: 2차 호출이 origin===chatgpt.com이면 `loadURL` **미호출**, blank/파괴/off-origin이면 `loadURL` 호출(webContents mock으로 loadURL 호출 유무 확인). D/T/F 상태-소실 회귀 방지.
- **통합(모킹):** `registerSpikeShortcuts()` 등록(게이트 off면 0건, on이면 register() 호출·false 로깅) → `ensureVisibleAndFocused`(contentView.addChildView/setBounds/focus 호출) → dump/save 오케스트레이션 → `session.fetch` 저장까지 **배선 전체**를 mock(globalShortcut/mainWindow/view/fs/session)으로 관통. (스파이크는 main-only·preload/렌더러 무변경이라 `ipcMain` 표면 없음.)
- **제외(스코프 아님):** "덤프 파서→셀렉터 파생"은 저자가 **수동** 확정(§4-B)이라 자동 테스트 대상 아님.
- **게이트:** 전체 스위트 그린 + `tests/electron/api/genai.test.js` 무수정.

## 8. 리스크
- **ChatGPT DOM 취약성:** UI 변경 시 셀렉터 파손(정식 기능의 원격-config가 풀 문제). 덤퍼가 재캡처 수단.
- **주입/제출 trusted 요구:** §4-C 실험이 판정. fallback은 §4-A 표시·focus 전제.
- **이미지 형태 3종:** https(인증형)/blob/canvas → 계약 3종(url/base64/**capture는 PROVISIONAL**). **canvas cross-origin tainted → `toDataURL` throw** → `capturePage(rect)` fallback(비-CDP, §3-D). §3-D 규칙과 동일: scrollIntoView 후 정수 rect, **rect가 뷰포트에 완전히 안 들어오면 clamp해서 부분 저장하지 말고 명시적 실패**(잘린 이미지 금지). 이 canvas 분기는 **Phase 1이 canvas임을 밝힌 경우에만 실코드로 확정**(§3-D PROVISIONAL).
- **로그인 차단:** Cloudflare 챌린지 / 구글 SSO 임베디드-브라우저 차단(`disallowed_useragent`) 가능 → **이메일 로그인** 우회. 막히면 Phase 1 전 실패.
- **entitlement:** 이미지 생성 비활성 계정/모델이면 자동화 실패로 오인 → §4-B 수동 전제로 배제.

## 9. 종료 조건
Phase 2가 실앱에서 이미지 1장 저장 **1회 성공** → 스파이크 성공. 결과(되냐/안 되냐, DOM 실제 형태, 어떤 주입/제출 기법이 먹혔는지, 이미지 소스 형태)를 근거로 **정식 기능 spec** 별도 작성. 실패(자동화 불가/로그인 차단)면 폐기.
