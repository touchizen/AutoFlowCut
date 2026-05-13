# Style Resolution Refactor (proposal)

**Status:** Proposal (별도 PR 대기)
**Date:** 2026-05-13
**Origin:** Tag Input UX / Style Card UX 라운드의 누적된 외부 reviewer 권고

## 배경

지난 두 PR (Style Card UX + Tag Input UX, 합계 67 commit)에서 발견된 패턴:

> "라벨", "클릭 가드", "실제 적용 스타일"이 같은 의미를 공유해야 하는데 **세 곳에서 따로 들고 있어서** 한 곳을 고치면 다른 곳이 어긋난다.

대표 사례 (모두 fix됨, 그러나 같은 패턴):

| 라운드 | 증상 | 원인 |
|---|---|---|
| 라운드 5 | "자동 (씬별 매칭)"이라 라벨 붙였는데 실제는 첫 카드 강제 적용 | `findAutoStyle` fallback이 한 군데에만 적용 |
| 라운드 7 | UI 잘 묵고 있었는데 MCP가 `selectedStyleRefId` UI 누수 | 호출 측 fallback과 내부 fallback 분리 안 됨 |
| 라운드 직전 | video-text 자동 카드 클릭 → 라벨은 "test style" / 실제는 무스타일 | 탭별 자동 의미가 컴포넌트마다 다른 곳에서 결정 |
| 라운드 직전 | StylePicker 자동 카드의 tooltip/아이콘/요약이 image 매칭 기준 | scenes prop으로 매칭 미리보기를 자체 계산 |

각 라운드마다 inline 분기로 막았지만, 다음 새 흐름(video-i2v? batch refs? 다른 자동화 진입점?)에서 같은 패턴 재발 가능.

## 현재 분산된 결정 지점

스타일 의미 결정이 **6 곳**에 분산:

| 위치 | 책임 | 의미 |
|---|---|---|
| [App.jsx `computeStyleLabel`](src/App.jsx) | Start/Stop 버튼 라벨 | 탭 분기 inline |
| [App.jsx handleStart `effectiveStyleId`](src/App.jsx:654) | 실제 적용 styleId | 탭 분기 inline (image vs video-text) |
| [App.jsx StylePicker onSelect](src/App.jsx:1547) | 자동 카드 클릭 가드 | 탭 분기 inline |
| [App.jsx `<StylePicker autoCardLabelOverride>`](src/App.jsx:1583) | 자동 카드 표시 | 탭 분기 inline |
| [`useReferenceGeneration._resolveEffectiveStyleId`](src/hooks/useReferenceGeneration.js:223) | Reference 단건/배치 styleId | UI selectedStyleRefId fallback |
| [`useMcpServer.__mcpStartBatch` / `__mcpStartRefBatch` / `__mcpGenerateRef`](src/hooks/useMcpServer.js) | MCP 호출자 styleId | 호출 측 fallback ('auto' sentinel) |

각자 `findAutoStyle`, `previewStyleMatching`, `selectedStyleRefId`, `references` 등 같은 입력으로 같은 종류 결정을 함.

## 제안 — `useStyleResolver` 공통 hook

### Shape

```js
// src/hooks/useStyleResolver.js (또는 src/services/styleResolver.js if hook이 무겁다면 함수)

export function useStyleResolver({ activeTab, scenes, references, selectedStyleRefId, t, isKo }) {
  // 입력 4가지 (탭, 씬 상태, ref, UI 선택값)로
  // 5가지 출력 결정. 모두 메모이제이션 가능.

  return {
    // 1) 자동 모드 가용 여부 (Start 버튼 enable, picker 가드)
    autoAvailable: boolean,

    // 2) 탭별 자동 모드의 effective styleId
    //    - image/list: null (씬별 매칭이 useAutomation에서 해석)
    //    - video-text: findAutoStyle(refs)
    autoEffectiveStyleId: string | null,

    // 3) 자동 카드/Start 버튼 라벨 (override 없을 때)
    autoLabel: string,

    // 4) 자동 카드 시각 메타 — StylePicker가 이걸 한 prop으로 받으면 라벨/아이콘/툴팁/요약 일관
    autoCardMeta: {
      label: string,
      icon: '🪄' | '🚫',
      tooltip: string,           // 빈 string이면 표시 안 함
      summary: string | null,    // null이면 숨김
    },

    // 5) 명시 styleId resolver (Stop 라벨 snapshot 등에서 사용)
    resolveLabelForId: (id: string | null) => string,

    // 6) 호출 측 effective styleId 결정 (handleStart override → effective)
    //    - undefined: UI 선택값 사용
    //    - null: 자동 모드 (탭별로 알아서)
    //    - 'ref:*' / 'preset:*': 그대로
    resolveEffectiveStyleId: (override: string | null | undefined) => string | null,
  }
}
```

### 호출 측 변경

**App.jsx:**
```js
const styleResolver = useStyleResolver({ activeTab, scenes, references, selectedStyleRefId, t, isKo })

// handleStart
const effectiveStyleId = styleResolver.resolveEffectiveStyleId(overrideStyleId)
setRunningStyle({ styleId: effectiveStyleId, label: styleResolver.resolveLabelForId(effectiveStyleId), applies: true })

// JSX
const startStyleLabel = styleResolver.resolveLabelForId(selectedStyleRefId)
const stopStyleLabel = runningStyle.label ?? styleResolver.resolveLabelForId(runningStyle.styleId)

// StylePicker
<StylePicker
  autoCardMeta={styleResolver.autoCardMeta}
  onSelect={(id) => {
    if (id === null && !styleResolver.autoAvailable && settings.requireStyle) {
      toast.warning(...)
      return
    }
    handleStart(id)
  }}
/>
```

**useReferenceGeneration:** `_resolveEffectiveStyleId`도 `styleResolver.resolveEffectiveStyleId` 사용 (또는 ref 흐름 전용 변형이 필요하면 별도).

**useMcpServer:** `findAutoStyle` 호출을 `styleResolver.autoEffectiveStyleId`로 대체.

**StylePicker:** `scenes`, `references`, `autoCardLabelOverride` prop 다 제거. 대신 `autoCardMeta` 하나 받음.

### 효과

- 새 탭 추가 시 한 곳만 수정 (`useStyleResolver`의 탭 분기)
- "라벨 vs 적용" 같은 모순 발생 불가능 (둘 다 같은 hook이 결정)
- StylePicker가 의미 모름 → 순수 표시 컴포넌트로 단순화
- 테스트가 이 hook에 집중되어 회귀 가드 강화

## 부가 정리 (동시 또는 별도)

### A. `splitTags` 중복 제거
- `src/utils/tagMatch.js:7` ↔ `src/hooks/useScenes.js:239` — 같은 함수 두 정의
- useScenes 안 inline 정의 제거하고 utils 사용

### B. MCP `'none'` sentinel
- 현재: MCP 호출자가 "스타일 안 씀"을 명시할 방법 없음 (생략 = first-card fallback)
- 추가: `styleId: 'none'` → 자동 fallback 무시하고 진짜 미적용
- 변경 위치: `useMcpServer` (`__mcpStartBatch`, `__mcpStartRefBatch`, `__mcpGenerateRef`)

### C. useMcpServer closure stale 가드
- 현재 `referencesRef`만 ref pattern. 다른 closure들 (`scenes`, `selectedStyleRefId` 등)도 동일 위험
- 필요 시 ref pattern 통합 (over-engineering 주의 — 실제 stale 사례 발생 후 결정도 OK)

### D. Video T2V `findAutoStyle` 일관 (이미 fix되긴 함)
- 라운드 직전 video-text 자동 카드 fix가 inline 분기. `useStyleResolver` 도입하면 자연스럽게 흡수.

## 작업 규모 추정

| 항목 | 파일 영향 | 복잡도 |
|---|---|---|
| `useStyleResolver` 신규 + 단위 테스트 | 신규 1 + 테스트 1 | 중 |
| App.jsx 통합 | App.jsx 큰 수정 | 중-상 |
| useReferenceGeneration 통합 | 1 파일 | 소 |
| useMcpServer 통합 | 1 파일 + 테스트 | 소 |
| StylePicker 시그니처 단순화 | StylePicker.jsx 큰 수정 + 테스트 갱신 | 중 |
| splitTags 중복 제거 | useScenes.js 1 파일 | 소 |
| MCP `'none'` sentinel | useMcpServer + tool description + 테스트 | 소 |

총 1-2일 작업. 전 phase의 fix들과 비교하면 작은 편이지만 영향 범위가 크니 spec → plan → 단계 commit 권장.

## 안 하는 옵션

- 현재 상태도 동작은 정확함 (모든 reviewer P1/P2 fix됨)
- 문제는 **회귀 위험** — 새 탭/새 진입점 추가 시 다시 같은 종류 버그 들어올 가능성
- 신기능 추가 빈도가 낮으면 refactor 미루는 것도 합리

## 다음 단계

1. 사용자 GO → spec 갱신 (이 doc) → 정식 plan 작성 (`docs/superpowers/plans/`)
2. 각 통합 단계를 commit 단위로 분리 (helper 도입 → 호출 측 1곳씩 마이그레이션 → 정리)
3. 통합 후 회귀 테스트 갱신
