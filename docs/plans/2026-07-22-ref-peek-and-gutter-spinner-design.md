# 설계 — 레퍼런스 패널 자동 펼침 + 프롬프트 거터 진행 링

작성 2026-07-22 / 개정 R3 2026-07-22 / 브랜치 `main` (HEAD `6280e47f` 기준)

두 개의 작은 UI 기능. 서로 독립이지만 "지금 무엇이 돌고 있는지 눈에 보이게 한다"는 같은 목적이라
한 스펙에 담는다.

> **개정 이력**
> - **R1**(리뷰어 2명): 초판의 두 전제가 무너졌다. `refWorkActive` 를 순간 신호 OR 로 정의해
>   배치당 창이 2~3번 열렸고, "문단 index = 씬 index" 가 거짓이었다.
> - **R2**(리뷰어 2명, 둘 다 NO-GO): R1 수정이 만든 새 구멍. `setTimeout(0)` 래치는 IPC 틈을
>   삼킬 수 없고, 억제 플래그 해제 규칙은 자기 받아들임 기준을 깨는 자기모순이었다. 그리고
>   "CSV 임포트는 창과 겹칠 수 없다"는 단정과 거터 픽셀 산술이 틀렸다.
> - **R3**(이 문서): 타이머로 틈을 메우려는 시도를 버리고 **틈 자체를 관측 가능하게** 만든다.
>   억제의 수명은 배치 경계에 묶는다. 신호 합성은 훅 안으로 옮겨 실행되는 테스트가 물게 한다.
>   변경점은 **[R3]** 로 표시했다.

---

## 기능 1 — 레퍼런스 준비 작업이 도는 동안 패널을 펼친다

### 문제

배치 생성을 시작하면 앱은 씬을 만들기 전에 **레퍼런스 쪽에서** 여러 가지 일을 한다. 그동안 화면은
프롬프트 탭 그대로라 사용자는 아무 일도 안 일어나는 것처럼 보이는 몇 초~수십 초를 본다.

### 사실 확인 (실측 완료)

배치 Start 의 실제 순서:

| # | 구간 | 무엇을 하나 | 관측 신호 | 앵커 |
|---|---|---|---|---|
| 1 | 빈카드 ref 이미지 생성 | 씬이 쓰는 레퍼런스 중 이미지가 없는 카드를 **배치가 직접 생성한다** | `preparingRefs`, `generatingRefs.length` | [emptyRefGate.js:51](../../src/services/emptyRefGate.js#L51) |
| 2 | 캐릭터 동기화 게이트 | 미동기화 @멘션 캐릭터를 Flow 에 등록 | `syncGate`, `syncGateBusy` | [emptyRefGate.js:190](../../src/services/emptyRefGate.js#L190) |
| 3 | 배치 프리플라이트 | 구독 게이트 → 폴더 권한 IPC → 토큰 IPC | **현재 관측 불가** ([R3] 아래) | [useAutomation.js:539-584](../../src/hooks/useAutomation.js#L539) |
| 4 | 비-character ref 업로드 | 스타일/씬 이미지를 Flow 에 업로드 | `automation.status === 'uploading'` | [useAutomation.js:622](../../src/hooks/useAutomation.js#L622) |
| 5 | 씬 큐 시작 | 여기서부터는 결과 카드가 진행을 보여준다 | `await runConcurrentQueue` | [useAutomation.js:768](../../src/hooks/useAutomation.js#L768) |

**[R3] 배치만이 유일한 진입점이 아니다.** 동기화 게이트를 여는 곳은 셋이다
([App.jsx](../../src/App.jsx) grep):

- 배치(빈카드 게이트) — [App.jsx:1439](../../src/App.jsx#L1439)
- T2V 배치 — [App.jsx:1726](../../src/App.jsx#L1726)
- **개별 씬 생성** — [App.jsx:900](../../src/App.jsx#L900) `requestMentionSync`. 이 경로는 생성
  **전**(프리플라이트)뿐 아니라 엔진이 미해결로 거절한 뒤
  **`status:'generating'` 인 상태에서 다시** 게이트를 연다
  ([useSceneGeneration.js:146](../../src/hooks/useSceneGeneration.js#L146); `status:'generating'`
  세팅은 77줄). 즉 **생성 중에도 동기화가 일어난다.**
  (배치는 실행 중 게이트를 열지 않는다 — stale 멘션은 ref 를 `failed` 로 찍고 다음 실행에서
  자가치유한다: [useAutomation.js:349-354](../../src/hooks/useAutomation.js#L349).)

**[R3] R2 에서 확정된 사실들:**

- **`setTimeout(0)` 래치는 3번 구간을 삼킬 수 없다.** [useAutomation.js:584](../../src/hooks/useAutomation.js#L584)
  `await getAccessToken()` 은 **무조건 실행되는 IPC 왕복**이고, flow 모드에서는 그 안에서 IPC 를
  3회 직렬 await 한다([engineFlow.js:277](../../src/engine/engineFlow.js#L277)). IPC invoke 는
  매크로태스크 경계이므로 `setTimeout(0)` 이 **항상 먼저 발화한다.** 리뷰어 두 명이 독립적으로
  같은 결론을 냈다.
- **나머지 틈은 마이크로태스크뿐이다**(실측): 1↔2 는 `generatingRefs` 해제부터 게이트 open 의
  동기 setState 까지 await 가 없고, 게이트 close→`start()` 진입 사이도
  ([emptyRefGate.js:190→206→233](../../src/services/emptyRefGate.js#L190)) 동기 계산뿐이다.
- **`hasPendingBatch` 는 창 신호로 쓸 수 없다.** `start()` 가
  [useAutomation.js:768](../../src/hooks/useAutomation.js#L768) 에서 배치 전체를 await 하고 latch
  해제는 그 뒤 `finally`([emptyRefGate.js:341](../../src/services/emptyRefGate.js#L341)) 라서 씬
  생성 내내 true 다. **그러나 배치 경계 신호로는 정확하다** — rising edge 가 배치당 1회다.
  용도가 다르다.
- **API 모드에서 `uploading` 은 무동작이다.** `uploadReference` 가
  [useGenAPI.js:190](../../src/hooks/useGenAPI.js#L190) 에서 `{ success: true, mediaId: null }`
  스텁이고, character 제외 필터는 [useAutomation.js:619](../../src/hooks/useAutomation.js#L619)
  에서 **flow 모드에서만** 걸린다. 4번 신호는 flow 로 한정한다.
- **[R3] "CSV 임포트는 창과 겹칠 수 없다"는 R2 초판의 단정은 거짓이었다.**
  `anyRunning` 은 `preparingRefs`/`refBatchRunning` 을 **포함하지 않고**
  ([App.jsx:2014](../../src/App.jsx#L2014)), 임포트 버튼은 `anyRunning || generatingRefs.length > 0`
  만 본다([App.jsx:2162](../../src/App.jsx#L2162)). `preparingRefs` 구간(폴더/토큰 체크 ~ 첫
  submit)에는 임포트 버튼이 **살아 있다.**
- 레퍼런스 UI 는 접기 패널이다: `showReferences`([App.jsx:248](../../src/App.jsx#L248)),
  토글 [App.jsx:2153](../../src/App.jsx#L2153), 렌더 [App.jsx:2176](../../src/App.jsx#L2176).
  `setShowReferences` 호출처는 셋: 248(선언), 1175(CSV 임포트 완료), 2153(토글 버튼).
- **프로젝트 전환은 App 을 언마운트하지 않는다** — 같은 훅 트리에서 state 만 교체된다
  ([Shell.jsx:53](../../src/Shell.jsx#L53), [useProjectData.js:1404](../../src/hooks/useProjectData.js#L1404)).
  훅이 프로젝트 전환을 알려면 **명시적 입력이 필요하다.**

### [R3] 변경 1 — 틈을 관측 가능하게 만든다: `'preparing'` 상태

`useAutomation.start()` 진입의 `setStatus('running')`
([useAutomation.js:512](../../src/hooks/useAutomation.js#L512))을 **`setStatus('preparing')`** 로
바꾸고, 씬 큐 직전([useAutomation.js:767](../../src/hooks/useAutomation.js#L767))에서 `'running'`
으로 복귀한다. 그러면 3번 구간(구독/폴더/토큰 IPC)이 관측 가능해지고 `'uploading'` 은 그 안의
하위 상태가 된다 — **타이머로 틈을 메울 필요가 사라진다.**

영향 조사 결과 `automation.status` 소비처는 [StatusBar.jsx](../../src/components/StatusBar.jsx)
하나뿐이다(App.jsx 에서 다른 소비처 grep 0건). 두 곳을 고친다:
- [StatusBar.jsx:21-28](../../src/components/StatusBar.jsx#L21) 라벨/클래스 맵에 `preparing` 추가
  (없으면 `|| ''` 로 떨어져 색이 사라진다)
- [StatusBar.jsx:32](../../src/components/StatusBar.jsx#L32) `isActive` 에 `'preparing'` 포함

`src/components/story/*` 의 `status === 'running'` 들은 **스토리 파이프라인의 별개 status** 라
무관하다(확인함).

### [R3] 변경 2 — 신호 합성을 훅 안으로

R2 는 "App 배선을 소스 문자열로 핀하는" 테스트 계획을 MAJOR 로 냈다(이 repo 의 기지 실패
패턴). 합성을 App 에 두면 그 핀 말고는 검증 수단이 없다. **원신호를 훅이 직접 받는다:**

```js
useRefPanelPeek({
  preparingRefs,          // boolean
  generatingRefsCount,    // number
  syncGate,               // object|null  — 모달 존재(클릭 대기 포함)
  syncGateBusy,           // boolean
  mode,                   // 'flow' | 'api'
  automationStatus,       // 'ready'|'preparing'|'uploading'|'running'|...
  batchPending,           // hasPendingBatch — 배치 경계 신호(창 신호 아님)
  projectKey,             // 프로젝트 전환 관측용
  isOpen, setOpen,
})
// 반환: { onUserToggle }
```

훅 안에서:

```js
active =
     preparingRefs
  || generatingRefsCount > 0
  || syncGate != null
  || syncGateBusy
  || (mode === 'flow' && (automationStatus === 'preparing' || automationStatus === 'uploading'))
```

이러면 다섯 신호의 진리표를 훅 테스트가 실행으로 문다 — App 소스 핀이 사라진다.

**남은 마이크로태스크 틈**만 `setTimeout(0)` 닫기 예약으로 메운다. 이제 이 래치는 "IPC 를
삼킨다"는 거짓 약속이 아니라 **마이크로태스크 경계만** 덮는다(위 실측 근거).

### [R3] 변경 3 — 억제의 수명을 배치 경계에 묶는다

R2 의 억제 규칙은 "창이 닫힌 뒤 첫 사용자 토글에 해제"였다. 사용자가 Ref 토글을 누를 이유 없이
Start 만 누르면 **해제가 영영 안 와서 다음 배치부터 패널이 안 열린다**(자기 받아들임 기준 위반).

| 항목 | 규칙 |
|---|---|
| 억제 **세팅** | `batchPending` 이 true 인 동안, **또는** 창이 열려 있는 동안 사용자가 **닫기 방향**으로 토글 |
| 억제 **해제** | `batchPending` 이 false→true (**다음 배치 시작**), 또는 `projectKey` 변경 |

세팅 조건에 `batchPending` 을 넣는 이유: 틈에서(창이 잠깐 닫힌 순간) 사용자가 닫으면 R2 규칙은
그 의사를 **기록하지 않았고**, 심지어 기존 억제를 지웠다. 배치가 도는 동안의 닫기는 언제 눌렸든
사용자 의사다.

`batchPending` rising edge 가 배치당 정확히 1회임은 위 실측에 있다
([emptyRefGate.js:232/258](../../src/services/emptyRefGate.js#L232) 세팅,
[:249/:341](../../src/services/emptyRefGate.js#L249) `finally` 해제).

**개별 씬 생성 세션에서 닫은 경우**: `batchPending` 은 false 다. 창이 열려 있는 동안의 토글로
억제가 세팅되고, 해제는 **다음 배치 시작 또는 프로젝트 전환**이다. 즉 "한 번 닫으면 다음 배치
전까지는 앱이 다시 열지 않는다" — 일관된 규칙이므로 그대로 둔다(의식적 결정).

### [R3] 변경 4 — 사용자 의도 열기를 단일 경로로

`setShowReferences` 직접 호출을 없애고 App 에 래퍼를 하나 둔다.

```js
const toggleReferencesByUser = () => { onUserToggle(); setShowReferences(v => !v) }
const openReferencesByUser  = () => { onUserToggle(); setShowReferences(true) }
```

- 토글 버튼([App.jsx:2153](../../src/App.jsx#L2153)) → `toggleReferencesByUser`
- **CSV 임포트 완료**([App.jsx:1175](../../src/App.jsx#L1175)) → `openReferencesByUser`

R2 초판은 임포트 경로를 "겹칠 수 없으니 제외"로 뒀는데 그 전제가 거짓이었다(위). **호출처별
예외 대신 단일 래퍼**로 간다 — 예외는 이미 한 번 틀렸다.

### 동작

| 전이 | 동작 |
|---|---|
| `active` false→true, 패널 닫힘, 억제 없음 | 패널을 펼치고 "앱이 열었다"를 기억 |
| `active` false→true, 패널 이미 열림 | 아무것도 안 함(기억 없음) |
| `active` false→true, **억제됨** | 아무것도 안 함 |
| `active` true→false | 닫기를 한 틱 예약. 그 사이 다시 true 면 취소(같은 창 유지) |
| 예약 만료, 기억 살아 있음 | 패널을 원래대로 닫음 |
| 배치 중 / 창 중 사용자 토글(닫기) | 기억을 버리고 억제 세팅 |
| `batchPending` false→true | 억제 해제 |
| `projectKey` 변경 / 언마운트 | 기억·억제 모두 버리고 **패널은 건드리지 않는다** |

### 받아들임 기준

1. ref 작업이 전혀 없으면 패널은 열리지 않는다.
2. 배치가 빈카드 ref 이미지를 생성하기 시작하면 닫혀 있던 패널이 열린다.
3. **1→2→3→4 를 지나는 동안 패널은 한 번도 닫히지 않는다** (`'preparing'` 이 3번을 덮으므로
   IPC 틈에서도 끊기지 않는다 — R2 가 불가능하다고 판정한 바로 그 케이스).
4. 씬 큐가 시작되고 ref 작업이 끝나면 패널은 원래대로 닫힌다.
5. 배치가 도는 동안 사용자가 패널을 닫으면, **그 배치의 이후 어떤 구간에서도** 앱이 다시 열지
   않는다. 틈에서 닫아도 마찬가지다.
6. 다음 배치를 시작하면 억제가 풀려 다시 열린다(사용자가 Ref 토글을 누르지 않아도).
7. 창 전부터 사용자가 패널을 열어 뒀으면, 끝나도 닫지 않는다.
8. API 모드에서는 `preparing`/`uploading` 만으로 패널이 열리지 않는다.
9. **개별 씬 생성의 동기화 게이트**(프리플라이트 및 생성 중 사후복구)에서도 창이 열린다.
10. 프로젝트가 바뀌면 패널 상태를 되돌리지 않고 기억·억제를 버린다.

### 알려진 한계

- **[R3] 동기화 구간(2번)은 언제나 자기 모달 뒤다.** `syncGate` 가 있는 동안 전면 오버레이가
  화면을 덮고([Modal.jsx:25](../../src/components/Modal.jsx#L25)), 동기화가 끝나면 모달이
  닫히면서 `syncGateBusy` 도 같이 내려간다. 그래서 이 구간에 패널을 펼쳐도 **시각적 이득은
  0** 이다 — 신호에 넣는 이유는 오직 **창의 연속성**(틈에서 끊겨 깜빡이지 않게)이다.
  실제로 눈에 보이는 건 1번(빈카드 ref 생성)과 4번(업로드)뿐이다.
- 개별 씬 생성 세션은 사실상 2번뿐이라 위 이유로 시각적 이득이 없다. 그래도 창을 여는 이유는
  경로마다 동작이 달라지지 않게 하기 위해서다("왜 여기선 안 열려?"를 만들지 않는다).

---

## 기능 2 — 생성 중인 줄의 거터에 도는 링

### 문제

프롬프트 편집기의 왼쪽 거터에는 씬 번호만 있다. 어느 줄이 지금 생성 중인지는 결과 탭으로 가야
안다.

### 사실 확인 (실측 완료)

- 거터 번호는 **CSS counter** 다: `.prompt-paragraph { counter-increment: scene-line }` →
  `::before { content: counter(scene-line) }` ([App.css:580-599](../../src/App.css#L580)).
  `.prompt-paragraph` 에 `position: relative` 가 **있다**(582줄) → `::after` 절대배치 기준은 문단.
- **[R3] 루트 font-size 는 14px 다**([App.css:106](../../src/App.css#L106)). 따라서
  `--gutter-w: 2rem` = **28px** 이고, 번호 박스는
  `left: calc(-1*(2rem+12px-4px))` = **-36px**, `width: calc(2rem-4px)` = **24px** →
  박스는 **[-36px, -12px]** 를 차지한다. (R2 까지 `[-40, -28]` 로 적혀 있었는데 루트 16px 을
  가정한 내 산수 오류였다. 리뷰어 한 명은 이 틀린 숫자를 그대로 받아썼고, 다른 한 명이
  App.css 를 직접 열어 잡았다.)
- 문단 클래스는 Lexical theme: `theme.paragraph = 'prompt-paragraph'`
  ([PromptInput.jsx:62](../../src/components/PromptInput.jsx#L62)).
- 금색 토큰: `--warning-color: #ecc94b`([App.css:92](../../src/App.css#L92)).
- **[R3]** `@keyframes spin` 이 두 번 정의돼 있다([App.css:167](../../src/App.css#L167) 은 `to` 만,
  [1911](../../src/App.css#L1911) 은 `from`+`to`) — 텍스트는 다르고 **동작은 동등**하다(`from`
  생략 = 0deg). 사용처는 [App.css:165](../../src/App.css#L165)(0.8s)와
  [1908](../../src/App.css#L1908)(1s) 둘뿐이고 현재도 cascade 상 1911 정의가 둘 다에 이긴다 →
  **1911 하나만 남겨 통합해도 안 깨진다.** 세 번째를 만들지 말 것.
- `prefers-reduced-motion` 블록이 이미 있다([App.css:771](../../src/App.css#L771)).

#### "문단 index = 씬 index" 는 거짓이다 (R1 BLOCKER)

에디터에서 타이핑한 내용만 보면 성립한다: `$applyTextToRoot` 는 `(text || '').split('\n')` 로
줄마다 문단을 만들고 빈 줄도 빈 문단이 된다
([promptLexicalAdapter.js:146-154](../../src/utils/promptLexicalAdapter.js#L146)) — **중간의 빈
prompt 는 index 를 밀지 않는다.**

문제는 **scene.prompt 안에 `\n` 이 들어오는 경로**다. 둘 다 실존한다:

1. **씬 상세 모달** — 프롬프트 입력이 Lexical `PromptInput` 이라 Enter 로 문단이 갈리고 `\n` 으로
   직렬화되며([SceneDetailModal.jsx:294](../../src/components/SceneDetailModal.jsx#L294)), 저장은
   정규화 없이 그대로다([SceneDetailModal.jsx:168](../../src/components/SceneDetailModal.jsx#L168)).
   `useScenes` 에도 개행 strip 이 없다(grep 0건). **일상 경로다.**
2. **CSV/MCP 임포트** — 따옴표로 감싼 멀티라인 셀을 파서가 **설계상 보존한다**
   ([parsers.js:32-35](../../src/utils/parsers.js#L32)).

씬 3의 prompt 가 두 줄이면 씬 4부터 문단 index 가 +1 밀리고, 씬 5가 생성 중일 때 링이 **씬 4의
줄에서** 돈다. **따라서 매핑은 index 동일성이 아니라 계산으로 얻는다.**

### 동작

그 씬의 **이미지 또는 비디오(T2V/I2V) 중 하나라도** 생성 중이면, 그 씬이 차지하는 **첫 문단**의
거터 씬 번호 둘레를 금색 링이 계속 회전한다. 숫자는 그대로 읽힌다.

- 리뷰어 셋 모두 "현재 탭의 것만 보라"고 권고했지만, 제품 결정은 **"둘 중 하나라도"** 다
  (사용자 확정 2026-07-22). 이미지 탭을 보고 있어도 그 씬의 비디오가 돌면 링이 보인다.
- 판정: `scene.status === 'generating'` **또는** `scene.videoT2VStatus === 'generating'`
  **또는** `scene.videoI2VStatus === 'generating'`.
  (T2V/I2V 필드 producer 는 각각 `useVideoScenes` 갱신 경로와
  [App.jsx:1823](../../src/App.jsx#L1823) `buildI2VScenePatch` 다 —
  [useScenes.js:218,226](../../src/hooks/useScenes.js#L218) 은 보존 코드지 producer 가 아니다.)

### 구조

1. **순수 헬퍼** `src/utils/promptBusyLines.js` **[R3: 시그니처 확정]**
   ```js
   busyPromptLines(scenes, { field, trimTrailing })
   // field: 'prompt' | 'videoT2VPrompt'
   // trimTrailing: boolean  — 탭 value 가 .replace(/\n+$/,'') 를 쓰는지. 암묵 추론 금지.
   // → Set<number>  (0-based 문단 index)
   ```
   - "생성 중" 판정은 위 세 필드의 OR 하나로 고정(탭과 무관).
   - **문단 오프셋 누적**: 씬 i 가 차지하는 문단 수 = `String(scene[field] || '').split('\n').length`.
     씬 i 의 첫 문단 index = 앞선 씬들의 합. 생성 중인 씬은 **첫 문단 index 만** 넣는다.
   - **[R3] 방어 상한은 탭 value 와 동일 규칙으로 계산한다**: `scenes.map(...).join('\n')` 에
     `trimTrailing` 이면 `.replace(/\n+$/,'')` 를 적용한 문자열의 `split('\n').length`.
     씬별 카운트 단순합을 쓰면 잘려나간 꼬리 씬을 못 거른다.
   - **[R3] 전부 빈 경우**: 비디오 프롬프트가 모두 `''` 이면 value 도 `''` 이고 문단은 1개다.
     그 단일 문단은 **씬 1 소유**로 본다(index 0). 씬 2 이상은 상한에 걸려 빠진다.
     (리뷰어 둘이 이 케이스에서 갈렸다 — 한 명은 모순, 한 명은 무해라 했다. 계산 결과는 같고
     해석만 달랐으므로 **여기서 명시해 모호성을 없앤다.**)

2. **PromptInput 새 prop** `busyLines: Set<number>` (기본 빈 Set)
   문단 DOM 에 `is-busy` 를 index 로 토글한다. 적용 시점 두 가지 — `busyLines` 변경 시, 그리고
   `editor.registerUpdateListener`. 둘 다 필요하다: Lexical 재조정이 theme 의 className 을 다시
   쓰므로 앞의 것만 하면 편집 후 클래스가 날아가고, 뒤의 것만 하면 상태 변화가 반영되지 않는다.

3. **CSS** `.prompt-paragraph.is-busy::after` **[R3: 좌표 확정]**
   번호 박스는 **[-36px, -12px]**, 숫자는 그 안에서 **우측정렬**이라 자릿수에 따라 글리프 중심이
   움직인다 → **고정 링을 숫자 중심에 맞추는 것은 불가능하다.** 링은 **박스 안에 들어가되 우측
   끝을 기준으로 고정 앵커**한다(예: `left: -30px; width: 18px; height: 18px`). 1자리에서는 숫자가
   링 안 오른쪽에, 2자리에서는 거의 중앙에 온다. 텍스트(x ≥ 0)를 침범하지 않는다.
   테두리 1.5px, 위쪽만 `--warning-color`, `animation: spin 1s linear infinite`,
   `prefers-reduced-motion` 에서는 회전 없이 정적 링. `::before`(숫자)는 건드리지 않는다.
   **최종 위치는 실앱 눈검증으로 확정한다** — 픽셀 산술은 이 스펙에서 이미 한 번 틀렸다.

### 받아들임 기준

1. 생성 중이 아닌 줄은 지금과 똑같다(숫자만).
2. 생성 중인 씬은 숫자가 그대로 보이면서 링이 돈다.
3. 이미지 탭과 비디오 탭이 **같은 판정**을 쓴다 — 이미지 탭에서도 그 씬의 비디오가 생성 중이면
   링이 돈다(그 반대도).
4. **prompt 에 내장 개행이 있는 씬이 섞여도** 링은 그 씬의 **첫 문단**에 붙고 이후 씬이 밀리지
   않는다.
5. 문단 수와 씬 수가 다를 때 터지지 않고, 남는 문단에는 링이 없다.
6. 편집기를 수정해도(Lexical 재렌더) 링이 사라지지 않는다.

### 알려진 한계

- 비디오 탭에서 `videoT2VPrompt` 가 빈 **꼬리쪽** 씬은 `.replace(/\n+$/,'')` 때문에 문단이 없다.
  그 씬의 비디오가 생성 중이어도 그 탭에서는 링을 그릴 자리가 없다(이미지 탭에서는 보인다).
  중간의 빈 씬은 영향 없다.
- 씬 번호가 3자리(100+)면 링이 빡빡해진다. 그때 거터 폭을 늘리는 별건으로 다룬다.
- 링 애니메이션은 CSS 만 쓴다(타이머 없음).

---

## 테스트 계획 **[R3 갱신]**

| 대상 | 방식 |
|---|---|
| `useRefPanelPeek` | 훅 테스트. **다섯 원신호의 진리표**(합성이 훅 안에 있으므로 실행으로 문다), 받아들임 기준 1~10, 마이크로태스크 틈(T→F→T 한 틱 내), **억제: 배치 중 닫기 → 같은 배치 재오픈 안 됨 / 다음 배치 rising edge 에 해제됨**, `projectKey` 변경, **StrictMode effect 이중 실행** |
| `useAutomation` `'preparing'` | 상태 전이 테스트 — `start()` 진입 시 `preparing`, 씬 큐 직전 `running`. 기존 배치 테스트 회귀 확인 |
| `StatusBar` | `preparing` 에서 클래스/활성 표시가 나오는지 |
| `busyPromptLines` | 순수 테스트 — 내장 개행 혼재, 빈 prompt 중간/꼬리, **전부 빈 비디오**, CRLF, 마지막 씬이 개행으로 끝남, image·T2V·I2V 각각, 빈 배열 |
| `PromptInput` busyLines | 렌더 테스트 — 해당 index 문단에만 `is-busy`, prop 변경 시 갱신, 편집(Lexical 재조정) 후 유지 |
| App 배선 | **[R3] 소스 문자열 핀을 쓰지 않는다.** 합성이 훅 안으로 갔으므로 남는 건 (b) 토글 버튼과 CSV 임포트가 **래퍼를 통하는지**, (c) 두 PromptInput 에 넘어간 `busyLines` **내용**이 맞는지 — 둘 다 PromptInput 을 mock 컴포넌트로 바꾼 렌더 테스트로 **실행 검증**한다 |
| 링의 생김새/회전/위치 | **실앱 눈검증** |

## 하지 않는 것

- 거터 폭 변경, 숫자 대체, 색으로 이미지/비디오 구분.
- 사용자가 Ref 패널에서 **직접** 시작한 ref 생성으로도 신호는 뜨지만, 그때 패널은 이미 열려 있어
  훅의 "이미 열림 → 아무것도 안 함" 규칙이 처리한다. 별도 분기 없음.
