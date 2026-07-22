# 설계 — 레퍼런스 패널 자동 펼침 + 프롬프트 거터 진행 링

작성 2026-07-22 / 개정 2026-07-22 (리뷰 R1 반영) / 브랜치 `main` (HEAD `e0f4c2b0` 기준)

두 개의 작은 UI 기능. 서로 독립이지만 "지금 무엇이 돌고 있는지 눈에 보이게 한다"는 같은 목적이라
한 스펙에 담는다.

> **개정 이력 — R1 에서 무너진 것**
> 초판은 두 전제가 틀렸다. (1) `refWorkActive` 를 순간 신호 OR 로 정의해 배치당 창이 2~3번
> 열리고 자기 받아들임 기준을 위반했다. (2) "문단 index = 씬 index 가 정확히 성립한다"가
> 거짓이었다 — scene.prompt 에 내장 개행이 들어오는 실경로가 둘 있다. 아래는 그 둘을 고친
> 개정본이다. 초판 대비 바뀐 곳은 **[R1]** 로 표시했다.

---

## 기능 1 — 배치가 레퍼런스를 준비하는 동안 패널을 펼친다

### 문제

배치 생성을 시작하면 앱은 씬을 만들기 전에 **레퍼런스 쪽에서** 세 가지 일을 한다. 그동안 화면은
프롬프트 탭 그대로라 사용자는 아무 일도 안 일어나는 것처럼 보이는 몇 초~수십 초를 본다.

### 사실 확인 (실측 완료)

배치 Start 의 실제 순서 — `src/services/emptyRefGate.js`:

| # | 구간 | 무엇을 하나 | 관측 신호 | 앵커 |
|---|---|---|---|---|
| 1 | 빈카드 ref 이미지 생성 | 씬이 쓰는 레퍼런스 중 이미지가 없는 카드를 **배치가 직접 생성한다** | `preparingRefs`, `generatingRefs.length` | [emptyRefGate.js:51](../../src/services/emptyRefGate.js#L51) `generateRefs: keys => handleGenerateAllRefs(...)` |
| 2 | 캐릭터 동기화 게이트 | 미동기화 @멘션 캐릭터를 Flow 에 등록 | `syncGate`(모달 존재), `syncGateBusy`(실행 중) | [emptyRefGate.js:190](../../src/services/emptyRefGate.js#L190) `await deps.openSyncGate(...)` |
| 3 | 비-character ref 업로드 | 스타일/씬 이미지를 Flow 에 업로드 | `automation.status === 'uploading'` | [useAutomation.js:622](../../src/hooks/useAutomation.js#L622) |
| 4 | 씬 생성 시작 | 여기서부터는 결과 카드가 진행을 보여준다 | — | [useAutomation.js:767](../../src/hooks/useAutomation.js#L767) |

- **[R1]** 초판은 1번을 "사용자가 Ref 패널에서 직접 시작하는 동작이라 이미 보고 있다"는 이유로
  제외했다. **거짓이다** — 배치 Start 가 이 경로를 직접 탄다. 사용자는 프롬프트 탭을 보고 있다.
  1번은 이 창에서 **가장 긴 구간**이므로 반드시 포함한다.
- **[R1]** 세 구간은 **연속이 아니다**. 사이에 틈이 있다:
  - 1↔2: `collectM1FlowReferenceExclusions` 등 마이크로태스크 구간.
  - 2 안쪽: 게이트 모달이 떠서 **사용자 클릭을 기다리는 동안 `syncGateBusy` 는 false** 다
    (busy 는 Proceed 를 누른 뒤에야 true — [App.jsx:1939](../../src/App.jsx#L1939)).
  - 2↔3: `start()` 진입 후 구독 게이트 → `await checkPermission()` → `await getAccessToken()` →
    그제서야 `uploading`([useAutomation.js:539-622](../../src/hooks/useAutomation.js#L539)).

  순간 신호를 OR 로 묶으면 이 틈마다 창이 닫혔다 열려 **깜빡임 + 사용자 토글 기억 오파기**가 난다.
- **[R1]** `hasPendingBatch` 는 창 신호로 쓸 수 없다. `start()` 는
  [useAutomation.js:783](../../src/hooks/useAutomation.js#L783) `await runConcurrentQueue(...)` 로
  배치 전체를 기다리고, latch 해제는 그 뒤 `finally`([emptyRefGate.js:341](../../src/services/emptyRefGate.js#L341))
  라서 씬 생성 내내 true 다.
- **[R1]** API 모드에서 `uploading` 은 **무동작**이다. `uploadReference` 가
  [useGenAPI.js:190](../../src/hooks/useGenAPI.js#L190) 에서 `{ success: true, mediaId: null }` 스텁이고,
  character 제외 필터는 [useAutomation.js:618](../../src/hooks/useAutomation.js#L618) 에서 **flow 모드에서만**
  걸리므로, API 모드는 매 배치가 모든 ref 를 대상으로 `uploading` 을 탄다. 3번 신호는 flow 모드로 한정한다.
- 레퍼런스 UI 는 탭이 아니라 접기 패널이다: `showReferences`
  ([App.jsx:248](../../src/App.jsx#L248)), 토글 [App.jsx:2153](../../src/App.jsx#L2153),
  렌더 [App.jsx:2176](../../src/App.jsx#L2176). 기본값 `false`.
- **[R1]** `setShowReferences` 호출처는 셋이다: 248(선언), **1175**(레퍼런스 CSV 임포트 완료),
  2153(토글 버튼). 1175 는 사용자 의도의 열기이고, 임포트 버튼은
  `disabled={anyRunning || generatingRefs.length > 0}`([App.jsx:2162](../../src/App.jsx#L2162))
  이라 이 창과 겹칠 수 없다 → **`onUserToggle` 대상 아님**. 의식적 제외로 못박는다.

### 동작 — 순간 신호가 아니라 하나의 논리 창 **[R1]**

```
refWorkActive =                       // 창을 "열어두는" 신호 (순간값)
     preparingRefs
  || generatingRefs.length > 0
  || syncGate != null                 // 모달이 떠 있는 동안 전체(클릭 대기 포함)
  || syncGateBusy
  || (mode === 'flow' && automation.status === 'uploading')
```

훅은 이 순간값을 그대로 쓰지 않고 **창으로 래치**한다:

- **열기**: `refWorkActive` 가 false→true 가 되는 첫 순간. 창을 연다.
- **유지**: `refWorkActive` 가 false 로 떨어져도 **즉시 닫지 않는다.** 닫기를 예약하고
  (`setTimeout(0)` 한 틱), 그 사이 다시 true 가 되면 예약을 취소한다 → 위 세 구간 사이의
  틈을 하나의 창으로 삼킨다. 고정 지연(수백 ms)을 쓰지 않는다 — 틈의 길이는 IPC 왕복이라
  상수로 못 잡는다. **연속성 판정만** 한 틱 미룬다.
  - ⚠️ 2↔3 틈은 IPC await 라 한 틱보다 길 수 있다. 그래서 신호에 `syncGate != null` 을 넣어
    **모달이 닫히는 순간까지** 창을 유지한다. 그래도 남는 틈에서 창이 닫히면 그건 **닫힘으로
    인정**하고(정직하게), 다음 true 는 새 창이다 — 대신 아래 규칙으로 사용자 의사만은 지킨다:
    **사용자 토글 기억의 파기는 창 경계를 넘어 유지된다**(§기억 규칙).
- **닫기**: 예약이 만료되면 창을 닫고, 창을 연 것이 앱이었다면 패널을 원래대로 되돌린다.

| 전이 | 동작 |
|---|---|
| 창 열림, 패널 닫혀 있음 | 패널을 펼치고 "앱이 열었다"를 기억 |
| 창 열림, 패널 이미 열림 | 아무것도 안 함(기억도 안 남김) |
| 창 닫힘, 기억 살아 있음 | 패널을 원래대로 닫음 |
| 창이 열려 있는 동안 사용자가 토글 버튼을 누름 | **기억을 버리고 억제 플래그를 세운다** |
| 언마운트 / 프로젝트 전환 | 기억을 버리고 아무것도 되돌리지 않음(사용자 화면을 건드리지 않는다) |

#### 기억 규칙 **[R1 — 초판이 여기서 깨졌다]**

사용자가 창 안에서 패널을 직접 건드리면 **그 배치 동안은 앱이 다시 열지 않는다.** 억제 플래그는
창이 닫혀도 유지되고, `refWorkActive` 가 **충분히 오래 false 였을 때**(= 다음 배치) 해제된다.
구현상 해제 시점은 "`active` 가 false 인 채로 창이 닫힌 뒤 첫 사용자 토글" 또는 언마운트/프로젝트
전환이다. 이 규칙이 없으면 2↔3 틈을 지나며 두 번째 창이 열려 **사용자가 닫은 패널을 앱이 다시
연다**(초판 설계의 실패 시나리오).

**[R1]** "배치당 1회"는 이제 신호가 아니라 **창 + 억제 플래그**가 보장한다.
`setStatus('uploading')` 자체는 호출 지점이 [useAutomation.js:622](../../src/hooks/useAutomation.js#L622)
하나뿐이고 루프 밖이라 run 당 ≤1회가 맞지만(실측), 합성 신호는 그것만으로 1회가 되지 않는다.

### 구조

판정을 `src/hooks/useRefPanelPeek.js` 로 분리한다. App 안에 인라인으로 두면 실행되는 테스트를
붙일 수 없다 — 이번 브랜치에서 그 대가를 이미 치렀다(App 배선을 통째로 되돌려도 전체 스위트가
초록불이었다).

```js
useRefPanelPeek({ active, isOpen, setOpen })
// active: 위 refWorkActive 순간값. 래치·닫기예약·기억·억제는 훅이 소유한다.
// 반환: { onUserToggle }  — 토글 버튼이 이걸 함께 호출해 "사용자가 건드렸다"를 알린다
```

App 은 `onClick={() => { onUserToggle(); setShowReferences(v => !v) }}` 로 배선한다.

**[R1]** `main.jsx` 가 `React.StrictMode` 이므로 훅 테스트에 **effect 이중 실행**(같은 전이를
두 번 관측) 케이스를 반드시 넣는다 — 두 번 관측해도 창은 하나여야 한다.

### 받아들임 기준 **[R1 갱신]**

1. ref 작업이 전혀 없으면(빈카드 없음·미동기화 멘션 없음·올릴 ref 없음) 패널은 열리지 않는다.
2. **배치가 빈카드 ref 이미지를 생성하기 시작하면** 닫혀 있던 패널이 열린다.
3. ref 이미지 생성 → 동기화 게이트 → 업로드 로 넘어가는 동안, 신호가 한 틱 이내로 끊겼다
   이어져도 패널은 닫히지 않는다(창은 하나, 깜빡임 없음).
4. 씬 생성이 시작되고 ref 작업이 끝나면 패널은 원래대로 닫힌다.
5. 창이 열려 있는 동안 사용자가 패널을 닫으면, **그 배치의 이후 어떤 구간에서도** 앱이 다시 열지
   않는다(틈을 지나 새 창이 열려도 마찬가지).
6. 창 전부터 사용자가 패널을 열어 뒀으면, 끝나도 닫지 않는다.
7. **API 모드에서는** `uploading` 만으로 패널이 열리지 않는다(무동작 구간이므로).
8. 언마운트/프로젝트 전환 시 패널 상태를 되돌리지 않는다.

---

## 기능 2 — 생성 중인 줄의 거터에 도는 링

### 문제

프롬프트 편집기의 왼쪽 거터에는 씬 번호만 있다. 어느 줄이 지금 생성 중인지는 결과 탭으로 가야
안다. 편집기에서 프롬프트를 보며 기다리는 동안 진행이 보이지 않는다.

### 사실 확인 (실측 완료)

- 거터 번호는 **CSS counter** 다: `.prompt-paragraph { counter-increment: scene-line }`
  → `.prompt-paragraph::before { content: counter(scene-line) }`
  ([App.css:580-599](../../src/App.css#L580)). `.prompt-paragraph` 에 `position: relative` 가
  **있다**(582줄) → `::after` 절대배치의 기준은 문단이다. 거터 폭 `--gutter-w: 2rem`
  ([App.css:97](../../src/App.css#L97)).
- 문단 클래스는 Lexical theme 이 준다: `theme.paragraph = 'prompt-paragraph'`
  ([PromptInput.jsx:62](../../src/components/PromptInput.jsx#L62)).
- 금색은 이미 쓰는 토큰이다: `--warning-color: #ecc94b` ([App.css:92](../../src/App.css#L92)).
- **[R1]** `@keyframes spin` 은 **이미 두 번 정의돼 있다**([App.css:167](../../src/App.css#L167),
  [1911](../../src/App.css#L1911) — 내용 동등). 세 번째를 만들지 말고 **먼저 하나로 합친 뒤**
  재사용한다. `prefers-reduced-motion` 블록도 이미 있다([App.css:771](../../src/App.css#L771)).
- `PromptInput` 은 jsdom 에서 렌더된다(기존 `tests/components/PromptInput.glow.test.jsx`).

#### **[R1] "문단 index = 씬 index" 는 거짓이다 — 이것이 초판의 BLOCKER**

에디터에서 타이핑한 내용만 놓고 보면 성립한다: `$applyTextToRoot` 는
`(text || '').split('\n')` 로 줄마다 문단을 만들고 빈 줄도 빈 문단이 된다
([promptLexicalAdapter.js:146-154](../../src/utils/promptLexicalAdapter.js#L146)) — 즉 **중간의 빈
prompt 는 index 를 밀지 않는다.**

문제는 **scene.prompt 안에 `\n` 이 들어오는 경로**다. 둘 다 실존한다:

1. **씬 상세 모달** — 프롬프트 입력이 Lexical `PromptInput` 이라 Enter 로 문단이 갈리고
   `\n` 으로 직렬화된다([SceneDetailModal.jsx:294](../../src/components/SceneDetailModal.jsx#L294)),
   저장은 정규화 없이 그대로다([SceneDetailModal.jsx:168](../../src/components/SceneDetailModal.jsx#L168)
   `onUpdate(scene.id, editData)`). `useScenes` 에도 개행 strip 이 없다(grep 0건).
   **일상 경로다.**
2. **CSV/MCP 임포트** — 따옴표로 감싼 멀티라인 셀을 파서가 **설계상 보존한다**
   ([parsers.js:32-35](../../src/utils/parsers.js#L32) 의 R14 fix 주석).

씬 3의 prompt 가 두 줄이면 `scenes.map(s => s.prompt).join('\n')`
([App.jsx:2221](../../src/App.jsx#L2221))에서 씬 4부터 문단 index 가 +1 밀린다. 그 상태로 씬 5가
생성 중이면 링은 **씬 4의 줄에서 돈다** — 사용자에게 거짓말하는 UI 다.

**따라서 매핑은 index 동일성이 아니라 계산으로 얻는다.**

### 동작 **[R1 확정]**

그 씬의 **이미지 또는 비디오(T2V/I2V) 중 하나라도** 생성 중이면, 그 씬이 차지하는 **첫 문단**의
거터 씬 번호 둘레를 금색 링이 계속 회전한다. 숫자는 그대로 읽힌다(대체하지 않는다).

- **[R1]** 두 리뷰어 모두 "현재 탭의 것만 보라"고 권고했지만, 제품 결정은 **"둘 중 하나라도"** 다
  (사용자 확정, 2026-07-22). 이미지 탭을 보고 있어도 그 씬의 비디오가 돌면 링이 보인다 —
  "어느 화면에서든 진행이 보인다"는 이 기능의 목적에 맞다. 따라서 **초판의 받아들임 기준 3과
  헬퍼의 `kind` 파라미터는 삭제한다**(그쪽이 자기모순의 범인이었다).
- 판정 필드: `scene.status === 'generating'` **또는** `scene.videoT2VStatus === 'generating'`
  **또는** `scene.videoI2VStatus === 'generating'`
  ([useScenes.js:218,226](../../src/hooks/useScenes.js#L218)).

### 구조

1. **순수 헬퍼** `src/utils/promptBusyLines.js` **[R1: 시그니처 변경]**
   ```js
   busyPromptLines(scenes, { field })   // field: 'prompt' | 'videoT2VPrompt'
   // → Set<number>  (0-based **문단** index)
   ```
   - "생성 중" 판정은 위 세 필드의 OR 하나로 고정한다(탭과 무관).
   - **문단 오프셋을 누적 계산한다**: 각 씬이 차지하는 문단 수 =
     `String(scene[field] || '').split('\n').length`. 씬 i 의 첫 문단 index = 앞선 씬들의 합.
     생성 중인 씬은 **첫 문단 index 만** Set 에 넣는다(여러 줄이어도 링은 하나).
   - 비디오용 호출은 탭 value 와 같은 규칙을 써야 한다 — value 는
     `scenes.map(s => s.videoT2VPrompt || '').join('\n').replace(/\n+$/, '')`
     ([App.jsx:2240](../../src/App.jsx#L2240)) 라 **꼬리의 빈 줄이 잘린다.** 잘려서 문단이 아예
     없어진 씬은 Set 에 넣지 않는다(링 표시 불가 — 아래 한계 참조).
   - 문단 수보다 큰 index 는 넣지 않는다(방어).

2. **PromptInput 새 prop** `busyLines: Set<number>` (기본 빈 Set)
   문단 DOM 에 `is-busy` 클래스를 index 로 토글한다. 적용 시점은 두 가지 —
   `busyLines` 가 바뀔 때, 그리고 Lexical 이 다시 그릴 때(`editor.registerUpdateListener`).
   둘 다 필요하다: Lexical 재조정이 theme 의 className 을 다시 쓰기 때문에 앞의 것만 하면 편집 후
   클래스가 날아가고, 뒤의 것만 하면 상태 변화가 반영되지 않는다.

3. **CSS** `.prompt-paragraph.is-busy::after` **[R1: 앵커 전략 명시]**
   숫자는 28px 폭 박스(`width: calc(2rem - 4px)`) 안에 **우측정렬**돼 있고 박스는
   `left: calc(-1 * (2rem + 12px - 4px))` = -40px 이다. 자릿수가 늘면 글리프 중심이 좌우로
   움직이므로 **고정 링을 숫자 중심에 맞추는 것은 불가능하다.** 따라서 링은
   **거터 박스의 우측 끝을 기준으로 고정 앵커**한다 — 1자리에서는 숫자가 링 안에서 오른쪽에,
   2자리에서는 거의 중앙에 온다. `::before`(숫자)는 건드리지 않는다.
   지름 ~18px, 테두리 1.5px, 위쪽만 `--warning-color`, `animation: spin 1s linear infinite`.
   `prefers-reduced-motion` 에서는 회전을 끄고 정적 링만 남긴다.

### 받아들임 기준 **[R1 갱신]**

1. 생성 중이 아닌 줄은 지금과 똑같다(숫자만).
2. 생성 중인 씬은 숫자가 그대로 보이면서 링이 돈다.
3. **이미지 탭과 비디오 탭 모두 같은 판정을 쓴다** — 이미지 탭에서도 그 씬의 비디오가 생성 중이면
   링이 돈다(그 반대도).
4. **prompt 에 내장 개행이 있는 씬이 섞여 있어도** 링은 **그 씬의 첫 문단**에 붙고, 이후 씬들이
   밀리지 않는다. (순수 테스트로 문다 — 초판이 여기서 깨졌다.)
5. 문단 수와 씬 수가 다를 때(편집 중) 터지지 않고, 남는 문단에는 링이 없다.
6. 편집기를 수정해도(Lexical 재렌더) 링이 사라지지 않는다.

### 알려진 한계

- **[R1]** 비디오 탭에서 `videoT2VPrompt` 가 비어 있는 **꼬리쪽** 씬은 탭 value 의
  `.replace(/\n+$/, '')` 때문에 문단 자체가 없다. 그 씬의 비디오가 생성 중이어도 그 탭에서는
  링을 그릴 자리가 없다(이미지 탭에서는 보인다). 중간의 빈 씬은 영향 없다.
- 씬 번호가 3자리(100+)가 되면 링이 숫자에 빡빡해진다. 겹침이 보기 싫으면 그때 거터 폭을 늘리는
  별건으로 다룬다.
- 링 애니메이션은 CSS 만 쓴다(타이머 없음).

---

## 테스트 계획 **[R1 갱신]**

| 대상 | 방식 |
|---|---|
| `useRefPanelPeek` | 훅 테스트 — 받아들임 기준 1~8 그대로. **틈을 지나는 케이스**(active: T→F→T 를 한 틱 안에), **억제 플래그가 창 경계를 넘는지**, **StrictMode 이중 실행** 필수 |
| `busyPromptLines` | 순수 테스트 — 내장 개행 씬 혼재, 빈 prompt 중간/꼬리, image·T2V·I2V 각각, 빈 배열 |
| `PromptInput` busyLines | 렌더 테스트 — 해당 index 문단에만 `is-busy`, prop 변경 시 갱신, 편집(Lexical 재조정) 후 유지 |
| App 배선 | **[R1] 핀 대상을 명시한다**: (a) `refWorkActive` 합성식에 다섯 신호가 모두 있는지, (b) 토글 버튼 onClick 에 `onUserToggle` 과 `setShowReferences` 가 **함께** 있는지, (c) 두 PromptInput 모두에 `busyLines` 가 넘어가는지. 훅 이름만 핀하면 `onUserToggle` 이 빠져도 초록불이다 |
| 링의 생김새/회전 | **실앱 눈검증** — CSS 애니메이션은 단위 테스트가 의미 없다 |

## 하지 않는 것

- 거터 폭 변경, 숫자 대체, 색으로 이미지/비디오 구분 — 모두 검토 후 뺐다.
- **[R1]** 사용자가 Ref 패널에서 **직접** 시작한 ref 생성으로도 신호는 뜬다(같은 `generatingRefs`).
  하지만 그때 패널은 이미 열려 있으므로 훅의 "이미 열림 → 아무것도 안 함" 규칙이 알아서 처리한다.
  별도 분기를 두지 않는다.
- **[R1]** 레퍼런스 CSV 임포트가 패널을 여는 경로([App.jsx:1175](../../src/App.jsx#L1175))는
  `onUserToggle` 대상이 아니다 — 임포트 버튼이 배치 중 disabled 라 창과 겹칠 수 없다.
