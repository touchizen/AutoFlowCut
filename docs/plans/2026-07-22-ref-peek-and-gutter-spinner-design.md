# 설계 — 레퍼런스 패널 자동 펼침 + 프롬프트 거터 진행 링

작성 2026-07-22 / 브랜치 `main` (HEAD `3bb47b38` 기준)

두 개의 작은 UI 기능. 서로 독립이지만 "지금 무엇이 돌고 있는지 눈에 보이게 한다"는 같은 목적이라
한 스펙에 담는다.

---

## 기능 1 — 배치가 레퍼런스를 동기화하면 패널을 펼친다

### 문제

배치 생성을 시작하면 앱이 먼저 레퍼런스를 Flow 에 올리거나(비-character ref 업로드) 캐릭터
동기화 게이트를 돈다. 그동안 화면은 프롬프트 탭 그대로라, 사용자는 **아무 일도 안 일어나는
것처럼** 보이는 몇 초~수십 초를 본다. 실제로는 Ref 쪽에서 카드가 하나씩 처리되고 있다.

### 사실 확인 (구현 전 반드시 열어볼 것)

- 레퍼런스 UI 는 **탭이 아니라 접기 패널**이다: `showReferences` state
  ([App.jsx:248](../../src/App.jsx#L248)), 토글 버튼 [App.jsx:2152-2153](../../src/App.jsx#L2152),
  렌더 [App.jsx:2176](../../src/App.jsx#L2176). 기본값 `false`(접힘).
- 배치의 ref 업로드 단계는 `setStatus('uploading')`
  ([useAutomation.js:622](../../src/hooks/useAutomation.js#L622))이고, `status` 는 훅이
  반환한다([useAutomation.js:911](../../src/hooks/useAutomation.js#L911)).
- 캐릭터 동기화 게이트의 진행 상태는 `syncGateBusy`(`useSyncGateHost`).

### 동작

`refWorkActive = mode === 'flow' && automation.status === 'uploading'`

> **리뷰(Fable)로 바뀐 부분.** 처음엔 `|| syncGateBusy` 를 함께 봤는데 세 가지가 걸렸다:
> - **API 모드에서 헛발화**: API 모드의 `uploadReference` 는 스텁이라 `mediaId` 가 영영 안 채워지고
>   ([useGenAPI.js:190](../../src/hooks/useGenAPI.js#L190)), 그래서 ref 를 쓰는 **모든** API 배치가
>   아무 일도 안 하면서 `'uploading'` 에 들어간다. → `mode === 'flow'` 로 막는다.
> - **배치당 2회 펄스**: 게이트 동기화(`syncGateBusy`) 뒤 폴더권한·토큰·구독 확인의 async 간격을
>   두고 `'uploading'` 이 뒤따라, 열림→닫힘→열림→닫힘이 된다. 게다가 두 번째 펄스가 그 사이
>   사용자가 닫은 패널을 다시 연다(아래 표의 마지막 줄과 정면 충돌).
>   → **"`uploading` 은 배치당 한 번뿐"이라는 원래 문장은 틀렸다.** 확인 없이 추론으로 쓴 것이었다.
> - **보이지도 않는다**: `syncGateBusy` 인 동안은 동기화 모달이 전체화면 오버레이로 떠 있어
>   ([Modal.jsx:25](../../src/components/Modal.jsx#L25)) 뒤에서 패널을 펼쳐도 안 보인다.
>
> 그래서 신호를 하나로 줄였다. 캐릭터 동기화만 도는 배치는 펼침을 못 받지만, 그건 모달 자체가
> 이미 피드백이다.

| 전이 | 동작 |
|---|---|
| false → true, 패널 닫힘 | 패널을 펼치고 "앱이 열었다"를 기억 |
| false → true, 패널 이미 열림 | 아무것도 안 함(기억도 안 남김) |
| true → false, 기억 살아 있음 | 패널을 원래대로 닫음 |
| 그 사이 사용자가 토글 버튼을 누름 | **기억을 버린다** → 복귀하지 않음 |

마지막 줄이 핵심이다. 사용자가 일부러 닫았는데 앱이 다시 열거나, 일부러 열어 뒀는데 앱이 닫으면
앱이 사용자와 싸우는 꼴이 된다. 사용자의 마지막 의사가 이긴다.

신호가 하나뿐이라 배치당 한 번만 펄스가 뜬다(위 리뷰 노트 참고).

### 구조

판정을 `src/hooks/useRefPanelPeek.js` 로 분리한다. App 안에 인라인으로 두면 실행되는 테스트를
붙일 수 없다 — 이번 브랜치에서 그 대가를 이미 치렀다(App 배선을 통째로 되돌려도 전체 스위트가
초록불이었다).

```js
useRefPanelPeek({ active, isOpen, setOpen })
// 반환: { onUserToggle }  — 토글 버튼이 이걸 함께 호출해 "사용자가 건드렸다"를 알린다
```

App 은 `onClick={() => { onUserToggle(); setShowReferences(v => !v) }}` 로 배선한다.

### 받아들임 기준

1. 올릴 ref 가 없어 `uploading` 단계가 없으면 패널은 열리지 않는다.
2. 동기화가 시작되면 닫혀 있던 패널이 열린다.
3. 동기화가 끝나면 다시 닫힌다.
4. 동기화 중 사용자가 패널을 닫으면, 끝나도 앱이 다시 열지 않는다.
5. 동기화 전부터 사용자가 패널을 열어 뒀으면, 끝나도 닫지 않는다.

---

## 기능 2 — 생성 중인 줄의 거터에 도는 링

### 문제

프롬프트 편집기의 왼쪽 거터에는 씬 번호만 있다. 어느 줄이 지금 생성 중인지는 결과 탭으로 가야
안다. 편집기에서 프롬프트를 보며 기다리는 동안 진행이 보이지 않는다.

### 사실 확인 (구현 전 반드시 열어볼 것)

- 거터 번호는 **CSS counter** 다: `.prompt-paragraph { counter-increment: scene-line }`
  → `.prompt-paragraph::before { content: counter(scene-line) }`
  ([App.css:581-599](../../src/App.css#L581)). 거터 폭 `--gutter-w: 2rem`
  ([App.css:97](../../src/App.css#L97)).
- 문단 클래스는 Lexical theme 이 준다: `theme.paragraph = 'prompt-paragraph'`
  ([PromptInput.jsx:62](../../src/components/PromptInput.jsx#L62)).
- **문단 index = 씬 index** 가 정확히 성립한다: 이미지 탭
  `value={scenes.map(s => s.prompt).join('\n')}` ([App.jsx:2221](../../src/App.jsx#L2221)),
  비디오 탭 `value={scenes.map(s => s.videoT2VPrompt || '').join('\n').replace(/\n+$/, '')}`
  ([App.jsx:2240](../../src/App.jsx#L2240)) — 둘 다 **전체 scenes 기준**이라 위에서부터 index 가 어긋나지 않는다 — **편집기에서 입력된
  내용에 한해서다.** `scene.prompt` 안에 리터럴 `\n` 이 들어가면(CSV 인용 셀은 줄바꿈을 보존한다:
  [csvParser.js:39](../../src/utils/csvParser.js#L39)) 그 씬이 문단 2개로 그려져 이후 index 가 밀린다.
  거터 **번호**가 이미 같은 이유로 밀리는 기존 한계이고, 링은 그걸 물려받는다.
- 금색은 이미 쓰는 토큰이다: `--warning-color: #ecc94b` ([App.css:92](../../src/App.css#L92)),
  생성 중 카드가 `gold-glow` 를 쓴다([App.css:1843](../../src/App.css#L1843)).
- `PromptInput` 은 jsdom 에서 렌더된다 — `tests/components/PromptInput/gutter.test.jsx` 가
  이미 `.prompt-paragraph` 요소를 직접 검사한다(더 강한 근거).

### 동작

**보고 있는 탭의 상태**를 본다 — 이미지 탭은 그 씬의 이미지가, 비디오 탭은 그 씬의 T2V 가 생성
중일 때 거터의 씬 번호 둘레를 금색 링이 계속 회전한다. 숫자는 그대로 읽힌다(대체하지 않는다).

- 이미지 탭: `scene.status === 'generating'`
- 비디오 탭: `scene.videoT2VStatus === 'generating'` (**I2V 는 세지 않는다** — 그 탭의 프롬프트가 아니다)

> 초안엔 "이미지 **또는** 비디오 중 하나라도"라고 썼는데, 받아들임 기준·헬퍼 API 와 모순이었다
> (Fable 지적). 탭이 보여주는 프롬프트의 상태만 본다로 확정.

### 구조

1. **순수 헬퍼** `src/utils/promptBusyLines.js`
   ```js
   busyPromptLines(scenes, kind)  // kind: 'image' | 'video' → Set<number>(0-based index)
   ```
   어떤 필드가 "생성 중"인지의 판정을 한 곳에 둔다.

2. **PromptInput 새 prop** `busyLines: Set<number>` (기본 빈 Set)
   문단 DOM 에 `is-busy` 클래스를 index 로 토글한다. 적용 시점은 두 가지 —
   `busyLines` 가 바뀔 때, 그리고 Lexical 이 다시 그릴 때
   (`editor.registerUpdateListener`). 둘 다 필요하다: 앞의 것만 하면 편집 후 클래스가 날아가고,
   뒤의 것만 하면 상태 변화가 반영되지 않는다.

3. **CSS** `.prompt-paragraph.is-busy::after`
   숫자 위치에 겹치는 원형 링(지름 ~18px, 테두리 1.5px, 위쪽만 `--warning-color` 로 강조),
   `animation: spin 1s linear infinite`. `::before`(숫자)는 건드리지 않는다.

### 받아들임 기준

1. 생성 중이 아닌 줄은 지금과 똑같다(숫자만).
2. 생성 중인 줄은 숫자가 그대로 보이면서 링이 돈다.
3. 이미지 탭은 이미지 상태를, 비디오 탭은 비디오 상태를 본다.
4. 문단 수와 씬 수가 다를 때(편집 중) 터지지 않고, 남는 문단에는 링이 없다.
5. 편집기를 수정해도(Lexical 재렌더) 링이 사라지지 않는다.

### 알려진 한계

- 씬 번호가 3자리(100+)가 되면 링이 숫자에 빡빡해진다. 링 지름을 숫자 폭에 맞춰 최소값으로
  잡되, 3자리에서 겹침이 보기 싫으면 그때 거터 폭을 늘리는 별건으로 다룬다.
- 링 애니메이션은 CSS 만 쓴다(타이머 없음). `prefers-reduced-motion` 에서는 회전을 끄고 정적
  링만 남긴다(App.css 에 이미 해당 블록이 있다).
- 링은 거터 박스의 **고정 지점에 앵커**된다. 숫자가 우측정렬이라 자릿수에 따라 글리프 중심이
  ±3px 움직인다 — 숫자마다 정확히 중앙에 오지는 않는다(18px 지름에서는 눈에 띄지 않는다).
- CSV/MCP 로 들어온 여러 줄 프롬프트는 위 index 한계를 그대로 받는다. `busyPromptLines` 가
  씬마다 `prompt.split('\n').length` 를 세어 보정할 수는 있으나, 거터 번호와의 일관성이 먼저다.
- 비디오 탭에서 **맨 끝** 씬의 프롬프트가 비어 있으면(trailing 정리로 문단이 없음) 생성 중이어도
  링이 없다. 받아들임 4 의 반대 경우다.
- `setShowReferences` 호출부는 토글 버튼 말고 하나 더 있다(레퍼런스 CSV 임포트 직후,
  [App.jsx:1175](../../src/App.jsx#L1175)). 그건 "사용자 토글" 로 세지 않는다.

---

## 테스트 계획

| 대상 | 방식 |
|---|---|
| `useRefPanelPeek` | 훅 테스트 — 위 받아들임 기준 5개 그대로 |
| `busyPromptLines` | 순수 테스트 — image/video 각각, 빈 배열, 상태 혼재 |
| `PromptInput` busyLines | 렌더 테스트 — 해당 index 문단에만 `is-busy`, prop 변경 시 갱신, 편집 후 유지 |
| App 배선 | 소스 핀 최소한(어떤 신호를 주입하는지) — 동작은 위 셋이 실행으로 검증 |
| 링의 생김새/회전 | **실앱 눈검증** — CSS 애니메이션은 단위 테스트가 의미 없다 |

## 하지 않는 것

- 거터 폭 변경, 숫자 대체, 색으로 이미지/비디오 구분 — 모두 검토 후 뺐다.
- 레퍼런스 *이미지 생성*(`generatingRefs`)으로는 패널을 열지 않는다. 그건 사용자가 Ref 패널에서
  직접 시작하는 동작이라 이미 그 화면을 보고 있다.
