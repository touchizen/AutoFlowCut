# M2 빈 Reference Card 자동생성 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flow 모드 씬 이미지 배치 생성 시, 대상 씬이 참조하는 빈 Reference Card를 감지해 모달로 "먼저 생성 / 제외하고 진행 / 취소"를 묻고, "먼저 생성"은 참조된 생성가능 빈카드만 targeted 생성한 뒤 fail-closed로 씬 배치를 잇는다.

**Architecture:** M2 비동기 orchestration을 `src/services/emptyRefGate.js`의 **dependency-injected 단일 async flow**(`runEmptyRefGateFlow(context, deps)`)로 추출한다. App.jsx는 React 상태(모달·latch)와 live getter만 소유하는 얇은 wiring이 된다. 사용자 선택은 promise를 반환하는 `gateView` 포트로 await한다. 이 경계 덕분에 fail-closed·latch 수명·stale source·MCP 인터리빙을 fake + deferred promise로 **실제 행동 테스트**할 수 있다.

**Tech Stack:** React 18, Electron, vitest + @testing-library/react, 기존 `src/services/*` DI 패턴(`videoRecovery.js`, `imageFinalize.js`, `startGuard.js`)

## Global Constraints

- 기준 브랜치: `feature/ref-image-guard-m1`. 대상 리포: `/Users/tuxxon/workspace/AutoFlowCut-main`
- 스펙: `docs/superpowers/specs/2026-07-16-empty-reference-card-auto-generate-design.md` (§ 참조는 이 문서 기준)
- **TDD 필수**: 실패테스트 → 최소구현 → green → 커밋. 태스크마다 `npx vitest run <path>` 실행 결과를 붙일 것.
- 커밋 메시지는 **영어**. `package.json`의 `buildNumber`는 자동증가값 — **커밋에 넣지 말 것** (`git add`에서 제외).
- `tests/`는 `src/`를 미러링한다.
- `docs/superpowers/`는 이 레포 `.gitignore` — 이 계획/스펙은 커밋되지 않는다.
- 빈카드 정의는 **오직** `!data && !filePath && !imagePath && !mediaId`. `status`/`entityId`/`workflowId`/`registered`로 이미지 유무를 판정하지 않는다. (§2.2)
- M2 UI는 **Flow 모드 + text/list 탭 배치 버튼**에서만. 개별 재생성·`handleGenerateScene`·Ref탭 수동배치·MCP 시작 배치는 모달을 띄우지 않는다. (§2.1, §3)
- **Fail-closed**: ref 실패/중단/timeout/busy/postcondition 실패가 하나라도 있으면 씬 배치를 시작하지 않는다. (§10)
- Targeted ref batch는 **Ref 탭 수동 배치와 동일한 스타일 해석**(`overrideStyleId=null`, auto-fallback). 씬 `effectiveStyleId`를 절대 전달하지 않는다. (§5.3, §11.10)
- 기존 global/manual/MCP ref batch 계약(force 의미, 명시 style, `'none'` sentinel, `allRefsGenerated` 토스트)은 **보존**한다. (§5.9, §15.34)

---

## 스펙 대비 확정된 계약 변경 (구현 전 반드시 읽을 것)

스펙은 설계 리뷰 findings 0이지만, 코드와 대조하니 아래 6건이 실제와 어긋난다. **이 문서의 결정이 스펙보다 우선한다.**

| # | 스펙의 서술 | 코드 실측 | 이 계획의 결정 |
|---|---|---|---|
| 1 | §13 Task 6 "App 통합 시나리오" (A~F) | `tests/` 중 `src/App`을 import하는 파일 **0개**. App mount 하네스 없음 (App.jsx 3037줄, provider 5중첩 `src/Shell.jsx:94-109`, `useMcpServer`가 `window.electronAPI.startMcpHttp` 호출 `src/hooks/useMcpServer.js:131`) | 시나리오 A~F를 **coordinator 레벨 테스트**(Task 7)로 재배치. App 렌더 테스트는 만들지 않는다. |
| 2 | §6.2/§12 `scenesRef.current` | `useScenes.js:60-61`에 내부 `scenesRef`가 있으나 **export 안 됨**(return 블록 `:740-759`) → App에서 접근 불가. ~~useEffect라 post-commit 갱신~~ **← 이 우려는 틀렸음(Task 2에서 실측)**: 공개 `setScenes`(`:729`)는 정규화 **래퍼**이고, 래퍼가 `_setScenes()` **앞에서** `scenesRef.current`를 쓴다(`:118-119`, 주석 "같은 tick 의 back-to-back 호출도 직전 결과 본다"). `:61` useEffect는 래퍼를 우회하는 경로용 안전망. | `useScenes`가 `scenesRef`를 **export**한다(Task 2 완료). 이 ref는 공개 setter 경로에서 **진짜 동기적**이므로, App에 렌더타임 미러를 새로 만들지 말고 이걸 그대로 `getLiveScenes`로 주입한다(렌더타임 미러는 동기 갱신 창을 잃는다). 동기성은 Task 2의 뮤테이션 검증으로 확인됨(`:118` 제거 시 테스트 2개 사망). |
| 3 | §6.2/§8.2 `referencesRef.current` (단수형) | **두 개** 존재: App 렌더타임 미러 `App.jsx:504-505`, useReferenceGeneration 전용 `useReferenceGeneration.js:65-66` (배치 중 `:224`에서 **동기 패치**) | 권한 분리 명문화: **배치 이후** ref 판정 = `batchResult.currentRefs`(=useReferenceGeneration의 동기 ref). **배치를 돌리지 않는** exclude 경로·sync Proceed seed = App의 `referencesRef.current`. 코드 주석으로 남길 것. |
| 4 | §5.8 "`_executeBatchRefs(null, options)`가 overrideStyleId를 드랍" | 실제로는 `handleGenerateAllRefs`가 overrideStyleId를 **이미 전달**(`:766`, `:772`). 진짜 버그는 queue 경로가 **결과를 return하지 않고**(`:769` `await` only) enqueue rejection도 `console.warn`으로 삼킴(`:774-776`) | Task 4에서 **return + structured 실패 반환**으로 고친다. M2 fail-closed가 `batchResult.ok`를 읽으므로 `undefined` 반환은 blocking 결함. |
| 5 | §7.1 모달을 수동 `useState`로 모델링 | flow가 사용자 선택을 **await**해야 함 | `gateView.confirm(items) → Promise<choice>` 포트로 확정. App이 resolver를 state에 보관. 폴링/effect-chain 금지. |
| 6 | §6.6 사전 gate 통과 후 최종 `start()`에서 paywall 가능 | `useAutomation.js:518-522` gate가 `batchIntent:'full'`이면 정상적으로 paywall 발동 → ref는 이미 생성됨 | fail-closed라 안전. 단 **latch 해제 경로를 반드시 테스트**한다(Task 7 invariant 6): start가 paywall로 early-return해도 coordinator의 `finally`가 latch를 푼다. |
| 7 | §5.4 targeted 선택 조건 `isReferenceImageEmpty(ref) && ref.status !== 'done'` | **스펙 자체 모순 — Task 4에서 Codex가 발견, 실측 확인.** 이 `status !== 'done'` 항은 스펙 §2.2/§11.11("이미지 유무는 4필드로만 판정, status 로 판정하지 않는다")과 정면 충돌한다. `status:'done'`인데 실제 이미지가 없는 카드(저장 실패·stale status)는 targeted batch가 영원히 skip → postcondition이 `still-empty`로 잡아 **fail-closed 데드엔드**(사용자가 먼저생성으로는 절대 진행 불가). Fable 3라운드가 놓친 스펙 버그. | targeted 선택은 `isReferenceImageEmpty(ref)` **단독**으로 판정한다(`status` 항 삭제). global/manual 선택은 기존 pending 의미(`!data && !filePath && status !== 'done'`)를 그대로 보존 — 두 조건을 통합하지 않는다. 뮤테이션 검증됨(스펙 조건 복원 시 해당 테스트 사망). |

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/utils/refImageGuard.js` (수정) | 순수 도메인: `isReferenceImageEmpty`, `referenceGuardKey`, `collectReferencedEmptyCards`. M1 술어와 key 정책 공유. |
| `src/hooks/useScenes.js` (수정) | `getMatchingReferences(scene, referencePool = references)` + `scenesRef` export |
| `src/hooks/useAutomation.js` (수정) | `batchIntent` 옵션 — full/partial 의미를 subscription reuse와 batchId 양쪽에 단일 적용 |
| `src/hooks/useReferenceGeneration.js` (수정) | targeted selection(`targetRefKeys`), structured batch result, queue return pass-through, targeted noop 토스트 억제 |
| `src/services/emptyRefGate.js` (신규) | **M2 control flow 전체**: 순수 헬퍼(`resolveLiveTargetScenes`, `evaluateEmptyRefPostcondition`) + DI async flow(`runEmptyRefGateFlow`) |
| `src/services/startGuard.js` (수정) | `isStartBlocked()` 추출 — handleStart 초입 guard를 순수 함수로 |
| `src/components/EmptyReferenceGateModal.jsx` / `.css` (신규) | confirm/busy/failure 3-phase 렌더, 리스트형 3버튼 |
| `src/locales/ko.js`, `src/locales/en.js` (수정) | M2 문자열 |
| `src/App.jsx` (수정) | **얇은 wiring만**: `scenesRef`/`automationStartRef` 연결, `emptyRefGate` state + gateView resolver, `buildEmptyRefGateDeps`, direct/tag-proceed 양 진입점을 `runEmptyRefGateFlow` 하나로 통합 |

**소유권 경계 (위반 시 리뷰 reject):**
- **App 소유**: 모든 React state(`emptyRefGate`, `hasPendingBatch`, `syncGate`), 모달 렌더, auth/folder/style/tag preflight, 토스트 출력
- **coordinator 소유**: M2 진입 이후 순서 전체 — 사전 gate → latch acquire → confirm → (generate-first: await batch → postcondition → close) / exclude / cancel → live M1 재계산 → sync gate 위임 → final sceneIds 확정 → startScenes → `finally` latch release
- coordinator는 **React state를 복제하지 않는다**. context에 scene/ref **객체를 저장하지 않는다** — ID와 설정만.

---

## Task 1: 빈카드 순수 도메인 함수 (역할 A)

**Files:**
- Modify: `src/utils/refImageGuard.js` (기존 `m1RefKey` `:30-33` 재사용/승격)
- Test: `tests/utils/refImageGuard.emptyCards.test.js` (신규)

**Interfaces:**
- Consumes: 기존 `sourceAvailable` (`:5-7`), `flowImageInjectable` (`:9-11`), `normalizeTagKey` (from `./tagMatch`)
- Produces:
  ```js
  export function isReferenceImageEmpty(ref): boolean
  export function referenceGuardKey(ref): string   // 'id:<id>' | '<type>:<normalizedName>'
  export function collectReferencedEmptyCards(scenes, getMatchingReferences, options?): {
    cards: Array<{ key: string, ref: object, hasPrompt: boolean, occurrences: Array<{sceneId, sceneIndex}> }>,
    generatableCards: Array<card>,   // hasPrompt === true
    missingPromptCards: Array<card>, // hasPrompt === false
  }
  ```
  `options.filter(scene, sceneIndex) => boolean`. `getMatchingReferences`는 **1인자 호출**(`getMatchingReferences(scene)`)만 한다.

- [ ] **Step 1: Write the failing test**

`tests/utils/refImageGuard.emptyCards.test.js`:
```js
import { describe, expect, it } from 'vitest'
import {
  collectReferencedEmptyCards,
  isReferenceImageEmpty,
  referenceGuardKey,
} from '../../src/utils/refImageGuard'

describe('isReferenceImageEmpty', () => {
  it('data/filePath/imagePath/mediaId 중 하나라도 있으면 빈카드가 아니다', () => {
    expect(isReferenceImageEmpty({ data: 'x' })).toBe(false)
    expect(isReferenceImageEmpty({ filePath: '/a.png' })).toBe(false)
    expect(isReferenceImageEmpty({ imagePath: '/b.png' })).toBe(false)
    expect(isReferenceImageEmpty({ mediaId: 'm1' })).toBe(false)
  })

  it('네 필드가 모두 없으면 빈카드다', () => {
    expect(isReferenceImageEmpty({ name: 'A', type: 'character' })).toBe(true)
    expect(isReferenceImageEmpty(null)).toBe(true)
  })

  it('status done / entityId / workflowId / registered 만으로는 이미지가 있다고 보지 않는다', () => {
    expect(isReferenceImageEmpty({
      status: 'done', entityId: 'e1', workflowId: 'w1', registered: true,
    })).toBe(true)
  })
})

describe('referenceGuardKey', () => {
  it('id가 있으면 id가 authoritative key다', () => {
    expect(referenceGuardKey({ id: 7, type: 'character', name: 'A' })).toBe('id:7')
  })

  it('id가 없으면 type + normalized name으로 폴백한다', () => {
    expect(referenceGuardKey({ type: 'character', name: '  Alice  ' }))
      .toBe(referenceGuardKey({ type: 'character', name: 'alice' }))
  })

  it('id가 없고 type이 달라지면 다른 key다', () => {
    expect(referenceGuardKey({ type: 'scene', name: 'A' }))
      .not.toBe(referenceGuardKey({ type: 'character', name: 'A' }))
  })
})

describe('collectReferencedEmptyCards', () => {
  const empty = { id: 'ghost', name: 'Ghost', type: 'character', prompt: 'a ghost' }
  const emptyNoPrompt = { id: 'void', name: 'Void', type: 'character', prompt: '' }
  const filled = { id: 'alice', name: 'Alice', type: 'character', mediaId: 'm1', prompt: 'alice' }

  it('빈카드만 수집하고 채워진 카드는 제외한다', () => {
    const scenes = [{ id: 's1', prompt: '@Ghost @Alice' }]
    const result = collectReferencedEmptyCards(scenes, () => [empty, filled])

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].key).toBe('id:ghost')
  })

  it('같은 카드가 mention과 tag 양쪽에 걸려도 카드 1건으로 dedup한다', () => {
    const scenes = [{ id: 's1', prompt: '@Ghost', characters: 'Ghost' }]
    const result = collectReferencedEmptyCards(scenes, () => [empty, empty])

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].occurrences).toHaveLength(1)
  })

  it('여러 씬이 같은 카드를 참조하면 occurrences를 누적하고 원본 씬 index를 유지한다', () => {
    const scenes = [
      { id: 's1', prompt: '@Ghost' },
      { id: 's2', prompt: 'no refs' },
      { id: 's3', prompt: '@Ghost' },
    ]
    const result = collectReferencedEmptyCards(
      scenes,
      scene => (scene.prompt.includes('@Ghost') ? [empty] : []),
    )

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].occurrences).toEqual([
      { sceneId: 's1', sceneIndex: 0 },
      { sceneId: 's3', sceneIndex: 2 },
    ])
  })

  it('options.filter를 통과한 씬만 처리하되 sceneIndex는 원본 배열 index다', () => {
    const scenes = [
      { id: 's1', prompt: '@Ghost' },
      { id: 's2', prompt: '@Ghost' },
    ]
    const result = collectReferencedEmptyCards(scenes, () => [empty], {
      filter: scene => scene.id === 's2',
    })

    expect(result.cards[0].occurrences).toEqual([{ sceneId: 's2', sceneIndex: 1 }])
  })

  it('prompt 유무로 generatable / missingPrompt를 분리한다', () => {
    const scenes = [{ id: 's1', prompt: '@Ghost @Void' }]
    const result = collectReferencedEmptyCards(scenes, () => [empty, emptyNoPrompt])

    expect(result.generatableCards.map(c => c.key)).toEqual(['id:ghost'])
    expect(result.missingPromptCards.map(c => c.key)).toEqual(['id:void'])
    expect(result.cards.map(c => c.hasPrompt)).toEqual([true, false])
  })

  it('matcher를 1인자로만 호출한다 (App wrapper 계약)', () => {
    const calls = []
    const scenes = [{ id: 's1', prompt: '@Ghost' }]
    collectReferencedEmptyCards(scenes, (...args) => { calls.push(args); return [empty] })

    expect(calls.every(args => args.length === 1)).toBe(true)
  })

  it('scenes가 비면 빈 결과를 반환한다', () => {
    const result = collectReferencedEmptyCards([], () => [empty])
    expect(result).toEqual({ cards: [], generatableCards: [], missingPromptCards: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/refImageGuard.emptyCards.test.js`
Expected: FAIL — `isReferenceImageEmpty is not a function` 외 다수

- [ ] **Step 3: Write minimal implementation**

`src/utils/refImageGuard.js`에 추가. 기존 `m1RefKey`는 `referenceGuardKey`로 승격하고 M1 collector가 이를 쓰도록 교체(동작 동일, 중복 제거):
```js
// M1/M2 공통 stable key. 배열 index 는 MCP merge/reorder 로 바뀌므로 외부 계약에 쓰지 않는다.
export function referenceGuardKey(ref) {
  if (ref?.id != null) return `id:${String(ref.id)}`
  return `${ref?.type || ''}:${normalizeTagKey(ref?.name)}`
}

// 빈카드 = 실제 이미지 소스가 전혀 없는 ref. status/entityId 는 판정에 쓰지 않는다(§2.2).
export function isReferenceImageEmpty(ref) {
  return !sourceAvailable(ref) && !flowImageInjectable(ref)
}

export function collectReferencedEmptyCards(
  scenes = [],
  getMatchingReferences = () => [],
  options = {}
) {
  const filter = options.filter || (() => true)
  const byKey = new Map()

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex]
    if (!filter(scene, sceneIndex)) continue

    const matchedRefs = getMatchingReferences(scene) || []
    const seenInScene = new Set()

    for (const ref of matchedRefs) {
      if (!ref || !isReferenceImageEmpty(ref)) continue
      const key = referenceGuardKey(ref)
      // 같은 씬에서 mention+tag 로 두 번 잡혀도 occurrence 는 1회.
      if (seenInScene.has(key)) continue
      seenInScene.add(key)

      let card = byKey.get(key)
      if (!card) {
        card = { key, ref, hasPrompt: !!ref.prompt, occurrences: [] }
        byKey.set(key, card)
      }
      card.occurrences.push({ sceneId: scene.id, sceneIndex })
    }
  }

  const cards = [...byKey.values()]
  return {
    cards,
    generatableCards: cards.filter(card => card.hasPrompt),
    missingPromptCards: cards.filter(card => !card.hasPrompt),
  }
}
```
그리고 `m1RefKey(ref)` 정의를 삭제하고 `collectM1FlowReferenceExclusions` 내부 `const refKey = m1RefKey(ref)`를 `const refKey = referenceGuardKey(ref)`로 교체한다.

- [ ] **Step 4: Run tests to verify they pass (M1 회귀 포함)**

Run: `npx vitest run tests/utils/refImageGuard.emptyCards.test.js tests/utils/refImageGuard.test.js tests/integration/referenceImageGuardM1.test.jsx`
Expected: PASS 전부 (M1 기존 테스트가 key 승격으로 깨지지 않아야 함)

- [ ] **Step 5: Commit**

```bash
git add src/utils/refImageGuard.js tests/utils/refImageGuard.emptyCards.test.js
git commit -m "feat: add empty reference card predicates and collector (M2 task 1)"
```

---

## Task 2: `getMatchingReferences` referencePool + `scenesRef` export (역할 C)

**Files:**
- Modify: `src/hooks/useScenes.js:597-647` (matcher), `:60-61` (scenesRef), `:740-759` (return 블록)
- Test: `tests/hooks/useScenes.referencePool.test.js` (신규)

**Interfaces:**
- Produces:
  ```js
  getMatchingReferences(scene, referencePool = references) → Array<ref>
  // useScenes() 반환 객체에 scenesRef 추가 — { current: Scene[] }
  ```
- Consumed by: Task 6/7 (`deps.matchRefs`), Task 9 (`deps.getLiveScenes`)

- [ ] **Step 1: Write the failing test**

`tests/hooks/useScenes.referencePool.test.js`:
```js
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

const character = { id: 'c1', name: 'Alice', type: 'character' }
const sceneRef = { id: 'r1', name: 'Forest', type: 'scene' }
const styleRef = { id: 'st1', name: 'Noir', type: 'style' }

describe('useScenes.getMatchingReferences — referencePool override', () => {
  it('hook closure references가 비어 있어도 override pool로 매칭한다 (초입 guard가 pool 기준)', () => {
    const { result } = renderHook(() => useScenes())
    // references는 비어 있는 상태
    const scene = { id: 's1', prompt: '', characters: 'Alice' }

    const matched = result.current.getMatchingReferences(scene, [character])

    expect(matched).toHaveLength(1)
    expect(matched[0].id).toBe('c1')
  })

  it('character / scene / style 태그 매칭 모두 override pool을 쓴다', () => {
    const { result } = renderHook(() => useScenes())
    const scene = { id: 's1', prompt: '', characters: 'Alice', scene_tag: 'Forest', style_tag: 'Noir' }

    const matched = result.current.getMatchingReferences(scene, [character, sceneRef, styleRef])

    expect(matched.map(r => r.id).sort()).toEqual(['c1', 'r1', 'st1'])
  })

  it('@mention 해석도 override pool을 쓴다', () => {
    const { result } = renderHook(() => useScenes())
    const scene = { id: 's1', prompt: '@Alice walks' }

    const matched = result.current.getMatchingReferences(scene, [character])

    expect(matched.map(r => r.id)).toEqual(['c1'])
  })

  it('override pool이 closure references를 이긴다 (stale closure 방지)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.updateReferences([{ id: 'stale', name: 'Alice', type: 'character' }]) })
    const scene = { id: 's1', prompt: '', characters: 'Alice' }

    const matched = result.current.getMatchingReferences(scene, [character])

    expect(matched.map(r => r.id)).toEqual(['c1'])
  })

  it('인자를 안 주면 기존대로 hook references를 쓴다 (기존 호출자 호환)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.updateReferences([character]) })
    const scene = { id: 's1', prompt: '', characters: 'Alice' }

    expect(result.current.getMatchingReferences(scene).map(r => r.id)).toEqual(['c1'])
  })

  it('pool이 비면 빈 배열이다', () => {
    const { result } = renderHook(() => useScenes())
    expect(result.current.getMatchingReferences({ id: 's1', characters: 'Alice' }, [])).toEqual([])
  })
})

describe('useScenes.scenesRef', () => {
  it('scenesRef를 export하고 setScenes 직후 동기적으로 최신 씬을 가리킨다', () => {
    const { result } = renderHook(() => useScenes())

    act(() => { result.current.setScenes([{ id: 's1', prompt: 'a' }]) })

    expect(result.current.scenesRef.current.map(s => s.id)).toEqual(['s1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useScenes.referencePool.test.js`
Expected: FAIL — override 테스트는 빈 배열 반환(초입 guard), `scenesRef` 는 undefined

- [ ] **Step 3: Write minimal implementation**

`src/hooks/useScenes.js:597-598` 시그니처와 초입 guard 교체:
```js
  // referencePool: 판정에 쓸 authoritative refs. 기본값은 hook closure references.
  //   M2 continuation 은 모달을 연 지 수 분 뒤 실행돼 closure 가 stale 하므로 live pool 을 명시 주입한다.
  const getMatchingReferences = useCallback((scene, referencePool = references) => {
    if (!scene || referencePool.length === 0) return []
```
그리고 함수 본문의 **모든** `references` 참조를 `referencePool`로 교체한다 — `:605`, `:615`, `:625` 태그 loop 3곳 + `:636` `resolveMentions(scene.prompt, references)`. `useCallback` deps는 `[references]` 유지(기본 인자가 closure를 읽으므로).

`scenesRef` export — return 블록(`:740-759`)에 추가:
```js
    // Queries
    scenesRef,   // live scenes — async continuation 이 stale closure 대신 읽는 동기 최신값
    getMatchingReferences,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/useScenes.referencePool.test.js tests/hooks/useScenes.test.js tests/integration/referenceImageGuardM1.test.jsx tests/integration/mention-to-genai.test.jsx`
Expected: PASS 전부

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useScenes.js tests/hooks/useScenes.referencePool.test.js
git commit -m "feat: accept live reference pool in getMatchingReferences and export scenesRef (M2 task 2)"
```

---

## Task 3: `useAutomation` batchIntent (역할 C)

**Files:**
- Modify: `src/hooks/useAutomation.js:518-522` (subscription reuse), `:733-734` (batchId), start 옵션 destructure
- Test: `tests/hooks/useAutomation.batchIntent.test.jsx` (신규)

**Interfaces:**
- Produces: `start({ ..., batchIntent?: 'full' | 'retry' })`
  - `batchIntent === 'full'` → `isPartialRetry = false` (sceneIds가 있어도 새 full batch)
  - `batchIntent === 'retry'` → `isPartialRetry = true`
  - `batchIntent == null` → 기존 추론 `!!(sceneIds || sceneIndices)` 보존
- Consumed by: Task 7 (`startScenes(finalStartOptions)`)

- [ ] **Step 1: Write the failing test**

`tests/hooks/useAutomation.batchIntent.test.jsx` — ⚠️ 계획 초안은 `tests/hooks/useAutomation.batchGate.test.js`의 harness를 재사용하라고 했으나 **그 파일에는 hook harness가 없다**(순수 helper 테스트뿐). 실제로는 `tests/hooks/useAutomation.integration.test.jsx`의 renderHook harness/mock 셋업을 재사용한다(Task 3에서 실측 확인). 검증할 행동:
```js
// 1) batchIntent:'full' + sceneIds 존재 → subscription gate가 isReusingBatch=false로 평가된다
//    (기존 batchId가 프로젝트에 있어도 paywall이 정상 발동)
// 2) batchIntent:'full' + sceneIds 존재 → resolveProjectBatchId가 새 full batch id를 만든다
//    (직전 batchId를 재사용하지 않는다)
// 3) batchIntent 미전달 + sceneIds 존재 → 기존 동작 보존: isReusingBatch=true, batchId 재사용
// 4) batchIntent:'retry' + sceneIds 없음 → partial retry로 취급
// 5) batchIntent:'full'이 targetScenes 선택 로직을 바꾸지 않는다 (sceneIds가 여전히 membership을 결정)
```
`resolveProjectBatchId`(`src/utils/batchId.js:5-20`)와 `batchStartGate` 호출 인자를 spy로 관찰해 `isReusingBatch`/`isPartialRetry`를 직접 단언한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useAutomation.batchIntent.test.jsx`
Expected: FAIL — `batchIntent:'full'`인데 `isReusingBatch=true`로 평가됨

- [ ] **Step 3: Write minimal implementation**

start 옵션에 `batchIntent = null` destructure 추가. 그리고 **단일 출처**로 계산해 두 곳에 쓴다:
```js
    // #M2: sceneIds 는 membership 고정용이지 partial retry 의미가 아니다. 호출자가 batchIntent 로
    //   명시하면 그 의미가 우선하고, 미전달이면 기존 sceneIds/sceneIndices 추론을 보존한다.
    const inferredPartialRetry = !!(sceneIds || sceneIndices)
    const isPartialRetry =
      batchIntent === 'retry' ||
      (batchIntent == null && inferredPartialRetry)
```
이 값을 `:518-522`의 subscription gate에서 사용:
```js
      const isReusingBatch = !!(isPartialRetry && batchIdByProjectRef.current.get(projectName))
```
그리고 `:733-734`의 기존 `const isPartialRetry = !!(sceneIds || sceneIndices)` 라인을 **삭제**하고 위에서 계산한 값을 그대로 쓴다(선언 위치를 gate 앞으로 올린다). 두 곳이 같은 변수를 읽어야 한다 — 스펙 §6.8.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/useAutomation.batchIntent.test.jsx tests/hooks/useAutomation.batchGate.test.js tests/hooks/useAutomation.integration.test.jsx tests/hooks/useAutomation.retryErrors.test.js`
Expected: PASS 전부 (기존 retry 의미 보존 확인)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAutomation.js tests/hooks/useAutomation.batchIntent.test.jsx
git commit -m "feat: add batchIntent option to distinguish full batch from partial retry (M2 task 3)"
```

---

## Task 4: targeted ref batch — 선택 + 결과 반환 경로 (역할 B)

**Files:**
- Modify: `src/hooks/useReferenceGeneration.js:409-426` (시그니처/pickIndices/noop), `:763-777` (queue wrapper)
- Test: `tests/hooks/useReferenceGeneration.targetedBatch.test.jsx` (신규)

**Interfaces:**
- Produces:
  ```js
  _executeBatchRefs(overrideStyleId = null, options = {}) // options: { force?, targetRefKeys?, reason? }
  handleGenerateAllRefs(overrideStyleId = null, options = {}) → Promise<BatchResult>  // ← 반드시 return
  ```
  `targetRefKeys: string[] | null` — `null`이면 기존 전체 배치, 배열이면 그 key만, `[]`면 targeted noop.
- Consumes: `referenceGuardKey`, `isReferenceImageEmpty` (Task 1)
- Produces (Task 5에서 완성될 최소 형태): `{ ok, outcome, requestedKeys, currentRefs }`

⚠️ **호환 경계**: 현재 `handleGenerateAllRefs(overrideStyleId, options)`는 이미 options 객체를 받는다(`:763`). 바꾸는 건 (a) 내부 `_executeBatchRefs`의 2번째 인자를 `force` boolean → `options` 객체로, (b) queue/no-queue 양쪽에서 **결과를 return**하도록. MCP 호출(`src/hooks/useMcpServer.js:509-513`)과 ReferencePanel 호출(`src/App.jsx:2123`)은 시그니처가 안 바뀌므로 그대로 통과해야 한다.

- [ ] **Step 1: Write the failing test**

`tests/hooks/useReferenceGeneration.targetedBatch.test.jsx` — 기존 `tests/hooks/useReferenceGeneration.batchOrder.test.jsx`의 harness를 읽고 재사용한다. 검증할 행동:
```js
// targeted 선택
// 1) targetRefKeys:['id:ghost'] → ghost만 submit. 같은 pool의 다른 pending ref는 submitGeneration 호출 0회
// 2) targetRefKeys 안의 style ref → non-style ref 순서 보존 (style phase 먼저)
// 3) targetRefKeys에 있지만 이미 채워진(mediaId 있음) 카드 → skip, submit 0회
// 4) targetRefKeys에 있지만 prompt 없는 카드 → skip, submit 0회
// 5) targetRefKeys에 있지만 삭제된(pool에 없는) key → submit 0회, 예외 없음
// 6) targetRefKeys:[] → submit 0회, ok:true, outcome:'noop'
// 7) targetRefKeys:null → 기존 전체 pending 배치 동작 보존 (imagePath/mediaId 판정 안 바뀜)

// noop 토스트 정책
// 8) targeted 전부 already-filled → toast.info(allRefsGenerated) 호출 0회
// 9) global(targetRefKeys:null) 대상 0개 → 기존대로 allRefsGenerated 토스트 1회

// 결과 반환 경로 (fail-closed의 생명줄)
// 10) generationQueue 있음 → handleGenerateAllRefs가 _executeBatchRefs의 결과를 그대로 return (undefined 금지)
// 11) generationQueue 없음 → 동일하게 return
// 12) queue enqueue가 reject → ok:false, outcome:'failed', failed[0].stage==='exception' (console.warn만 하고 삼키지 않음)

// style pass-through
// 13) queue 경유 + overrideStyleId 'preset:noir' → _executeBatchRefs가 'preset:noir'로 호출됨
// 14) queue 경유 + overrideStyleId 'none' → 'none' 보존 (조용히 null로 바뀌지 않음)
// 15) M2 호출 형태 handleGenerateAllRefs(null, {targetRefKeys, reason:'m2-empty-reference-gate'})
//     → _resolveEffectiveStyleId(null)이 Ref탭과 동일한 auto-fallback을 타고, 씬 effectiveStyleId는 어디에도 안 들어감
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useReferenceGeneration.targetedBatch.test.jsx`
Expected: FAIL — targetRefKeys 무시하고 전체 생성, queue 경로가 undefined 반환

- [ ] **Step 3: Write minimal implementation**

시그니처 + targeted 선택 (`:409-426`):
```js
  // options = { force?, targetRefKeys?, reason? }
  //   targetRefKeys == null : 기존 Ref 탭 전체 배치 / MCP 전체 배치 (pending 의미 그대로)
  //   targetRefKeys: string[] : 그 key 의 ref 만 대상 (M2 targeted). [] 면 정상 noop.
  //   reason 은 토스트/로깅 식별자일 뿐 생성 의미를 바꾸지 않는다.
  const _executeBatchRefs = async (overrideStyleId = null, options = {}) => {
    const { force = false, targetRefKeys = null, reason = 'manual' } = options
    const targetKeySet = targetRefKeys ? new Set(targetRefKeys) : null
    const isTargeted = targetKeySet !== null

    const pickIndices = (refMatches) => referencesRef.current
      .map((ref, index) => {
        if (!ref.prompt || !refMatches(ref)) return -1
        if (isTargeted && !targetKeySet.has(referenceGuardKey(ref))) return -1
        if (force) return index
        // targeted: 실제 이미지 4필드만 본다 — status='done' 같은 workflow 표식은 이미지 존재
        //   증거가 아니다(§2.2/§11.11). 스펙 §5.4 의 `&& ref.status !== 'done'` 은 그 원칙과
        //   모순이라 뺐다 — 넣으면 done 인데 빈 카드가 영영 생성 안 돼 postcondition 데드엔드.
        // global: Ref 탭/MCP 의 기존 pending 의미를 그대로 둬 회귀를 막는다.
        return isTargeted
          ? (isReferenceImageEmpty(ref) ? index : -1)
          : ((!ref.data && !ref.filePath && ref.status !== 'done') ? index : -1)
      })
      .filter(i => i !== -1)

    const styleIndices = pickIndices(isStyleReference)
    const nonStyleIndices = pickIndices(ref => !isStyleReference(ref))
    const allIndices = [...styleIndices, ...nonStyleIndices]

    const requestedKeys = targetRefKeys ? [...targetRefKeys] : []

    if (allIndices.length === 0) {
      // targeted 정상 noop 은 전체 Ref 배치가 끝났다는 인상을 주면 안 된다(§5.9).
      if (!isTargeted) toast.info(t('toast.allRefsGenerated'))
      return {
        ok: true, outcome: 'noop',
        requestedKeys, attemptedKeys: [], succeededKeys: [], skipped: [], failed: [],
        currentRefs: referencesRef.current,
      }
    }
```
`import { isReferenceImageEmpty, referenceGuardKey } from '../utils/refImageGuard'` 추가.

queue wrapper (`:763-777`) — **결과 return + rejection을 structured로**:
```js
  // 큐를 통한 배치 생성. options = { force?, targetRefKeys?, reason? }.
  // #M2: 결과를 반드시 return 한다 — M2 fail-closed 가 batchResult.ok 를 읽는다. 예전엔 queue 경로가
  //   await 만 하고 결과를 버려서 호출자가 undefined 를 받았다(조용한 실패).
  const handleGenerateAllRefs = async (overrideStyleId = null, options = {}) => {
    if (!generationQueue) {
      return _executeBatchRefs(overrideStyleId, options)
    }
    try {
      return await generationQueue.enqueue({
        type: 'reference_batch',
        label: 'Batch References',
        execute: () => _executeBatchRefs(overrideStyleId, options),
      })
    } catch (err) {
      console.warn('[RefGen] Batch queue rejected:', err.message)
      return {
        ok: false, outcome: 'failed',
        requestedKeys: options.targetRefKeys ? [...options.targetRefKeys] : [],
        attemptedKeys: [], succeededKeys: [], skipped: [],
        failed: [{ key: null, stage: 'exception', error: err.message }],
        currentRefs: referencesRef.current,
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/useReferenceGeneration.targetedBatch.test.jsx tests/hooks/useReferenceGeneration.batchOrder.test.jsx tests/hooks/useReferenceGeneration.test.js tests/hooks/useReferenceGeneration.styleMemory.test.jsx tests/hooks/useMcpServer.test.js tests/components/ReferencePanel.batchButton.test.jsx`
Expected: PASS 전부 (MCP style 계약 + Ref탭 배치 회귀 없음)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReferenceGeneration.js tests/hooks/useReferenceGeneration.targetedBatch.test.jsx
git commit -m "feat: support targeted reference batch and return batch result through queue (M2 task 4)"
```

---

## Task 5: structured batch result — stage 집계 (역할 B)

**Files:**
- Modify: `src/hooks/useReferenceGeneration.js` — gates(`:446-470`), Flow character 분기(`:596-601`), submit 실패(`:625-653`), catch(`:655-665`), `collectCompleted` 실패(`:545-562`), timeout/stop 정리(`:687-709`), 최종 return(`:734-740`)
- Test: `tests/hooks/useReferenceGeneration.batchResult.test.jsx` (신규)

**Interfaces:**
- Produces (완성형 `BatchResult`, 스펙 §5.6):
  ```js
  {
    ok: boolean,
    outcome: 'completed' | 'noop' | 'failed' | 'stopped',
    requestedKeys: string[],
    attemptedKeys: string[],
    succeededKeys: string[],
    skipped: Array<{ key, stage: 'already-filled'|'missing-prompt'|'not-found'|'not-eligible' }>,
    failed: Array<{ key, stage: 'permission'|'auth'|'flow-ready'|'prepare'|'submit'|'collect'|'save'|'timeout'|'busy'|'exception', error }>,
    currentRefs: Reference[],   // = referencesRef.current (배치 중 :224 에서 동기 패치된 authoritative 배열)
  }
  ```
  `ok=true` 조건: 사용자 중단 아님 **AND** `failed.length === 0` **AND** 실행 시점 생성가능 target이 모두 성공 또는 already-filled skip.
  gate 실패(permission/auth/flow-ready)는 batch 전역 사건이므로 `failed: [{ key: null, stage, error }]` 1건으로 집계한다.

- [ ] **Step 1: Write the failing test**

`tests/hooks/useReferenceGeneration.batchResult.test.jsx`. 검증할 행동:
```js
// 성공/스킵
// 1) target 2건 전부 성공 → ok:true, outcome:'completed', succeededKeys 2건, failed:[]
// 2) target 중 이미 채워진 것 → skipped[{stage:'already-filled'}], ok:true
// 3) target 중 prompt 삭제된 것 → skipped[{stage:'missing-prompt'}], ok:true (postcondition이 잡음)
// 4) target key가 pool에 없음(삭제) → skipped[{stage:'not-found'}]

// 실패 (전부 ok:false + outcome:'failed')
// 5) submit 실패 → failed[{stage:'submit', error}]
// 6) Flow character coordinator busy(_executeGenerateRef가 {busy:true}) → failed[{stage:'busy'}]
// 7) collect 중 예외 → failed[{stage:'collect'}]
// 8) timeout(pendingQueue 잔존, stop 아님) → failed[{stage:'timeout'}]
// 9) 폴더 권한 거부 → failed[{key:null, stage:'permission'}], submit 0회
// 10) auth 토큰 실패 → failed[{key:null, stage:'auth'}]
// 11) Flow project 미준비 → failed[{key:null, stage:'flow-ready'}]

// 중단
// 12) stopGenerateAllRefs 중 → outcome:'stopped', ok:false

// currentRefs
// 13) 생성 성공 후 currentRefs가 생성 결과(mediaId/entityId 패치)를 반영한 최신 배열이다
//     — 렌더 클로저 references가 아니라 referencesRef.current
// 14) Flow character 생성 시 entityId/workflowId가 currentRefs에 실려 있다 (§1.3 자동 동기화 근거)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useReferenceGeneration.batchResult.test.jsx`
Expected: FAIL — 대부분 `undefined` 반환

- [ ] **Step 3: Write minimal implementation**

배치 스코프 accumulator를 `_executeBatchRefs` 최상단(`allIndices` 계산 직후)에 만들고, 각 종료 지점에서 기록한다:
```js
    // 구조화 결과 accumulator — 기존 setReferences 상태 갱신은 그대로 두고, 호출자용 결과만 별도 집계.
    const succeededKeys = new Set()
    const attemptedKeys = new Set()
    const failedByKey = new Map()   // key -> { key, stage, error }
    const skippedByKey = new Map()  // key -> { key, stage }
    const keyAt = index => referenceGuardKey(referencesRef.current[index])
    const recordFail = (key, stage, error) => {
      if (!failedByKey.has(key)) failedByKey.set(key, { key, stage, error: error ?? null })
    }
```
그리고 결과를 조립하는 단일 함수로 모든 return을 통일한다:
```js
    const buildResult = () => {
      const stopped = stopRequestedRef.current || authStoppedRef.current
      const failed = [...failedByKey.values()]
      // targeted: 요청했지만 시도/성공/스킵 어디에도 없는 key 는 not-found 로 명시.
      if (isTargeted) {
        for (const key of requestedKeys) {
          if (succeededKeys.has(key) || failedByKey.has(key) || skippedByKey.has(key)) continue
          skippedByKey.set(key, { key, stage: 'not-found' })
        }
      }
      const outcome = stopped ? 'stopped' : (failed.length > 0 ? 'failed' : 'completed')
      return {
        ok: !stopped && failed.length === 0,
        outcome,
        requestedKeys,
        attemptedKeys: [...attemptedKeys],
        succeededKeys: [...succeededKeys],
        skipped: [...skippedByKey.values()],
        failed,
        currentRefs: referencesRef.current,
      }
    }
```
기록 지점 (각각 기존 로직은 건드리지 말고 **기록만 추가**):
- gates `:446-470`의 3개 early return → `recordFail(null, 'permission'|'auth'|'flow-ready', msg)` 후 `return buildResult()`
- Flow character 분기 `:596-601` → `direct?.busy` 면 `recordFail(keyAt(index), 'busy', direct.error)`, `direct?.success` 면 `succeededKeys.add(keyAt(index))`, 그 외 `recordFail(..., 'submit', ...)`
- submit 성공 → `attemptedKeys.add(keyAt(index))`, 실패 `:625` → `recordFail(keyAt(index), 'submit', submitResult?.error)`
- catch `:655` → `recordFail(keyAt(index), 'exception', err.message)`
- `collectCompleted` 후처리 성공 → `succeededKeys.add(...)`, 후처리 throw → `recordFail(..., 'collect', ...)`
- timeout/stop 정리 `:687-709` → userStop이 아니면 각 pending에 `recordFail(..., 'timeout', 'Timed out')`
- targeted에서 pickIndices가 버린 target 분류: 실행 시점 pool을 다시 훑어 `!ref` → `not-found`, `!ref.prompt` → `missing-prompt`, `!isReferenceImageEmpty(ref)` → `already-filled`를 `skippedByKey`에 기록
- 최종 `finally` 직전 `return buildResult()`. `finally`의 flag 정리(`:737-738`)는 유지.

⚠️ 기존 `runPhase`는 `_executeBatchRefs` 내부 클로저라 accumulator에 그대로 접근한다. `runPhase`의 시그니처는 바꾸지 않는다.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/useReferenceGeneration.batchResult.test.jsx tests/hooks/useReferenceGeneration.targetedBatch.test.jsx tests/hooks/useReferenceGeneration.batchStop.test.jsx tests/hooks/useReferenceGeneration.quotaStop.test.jsx tests/hooks/useReferenceGeneration.characterEntity.test.jsx tests/hooks/useReferenceGeneration.preflightBusy.test.jsx`
Expected: PASS 전부

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReferenceGeneration.js tests/hooks/useReferenceGeneration.batchResult.test.jsx
git commit -m "feat: return structured batch result with failure stages (M2 task 5)"
```

---

## Task 6: emptyRefGate 순수 헬퍼 (역할 D)

**Files:**
- Create: `src/services/emptyRefGate.js`
- Test: `tests/services/emptyRefGate.helpers.test.js`

**Interfaces:**
- Consumes: `collectReferencedEmptyCards` (Task 1), `filterPendingScenes` (`src/utils/sceneFilters.js:23` — App도 `src/App.jsx:46`에서 같은 경로로 import한다)
- Produces:
  ```js
  export function resolveLiveTargetScenes(context, liveScenes): Scene[]
  export function evaluateEmptyRefPostcondition({ batchResult, liveTargetScenes, matchRefs }):
    { ok: boolean, failures: Array<{ key, stage: 'postcondition', error: 'still-empty'|'missing-prompt'|'not-found' }> }
  ```
  `context` = `{ startMode, projectName, force, initialTargetSceneIds, selectedStyleRefId, startOptionsWithoutSceneIds }` — **scene/ref 객체 금지, ID와 설정만**.

- [ ] **Step 1: Write the failing test**

`tests/services/emptyRefGate.helpers.test.js`:
```js
import { describe, expect, it } from 'vitest'
import {
  evaluateEmptyRefPostcondition,
  resolveLiveTargetScenes,
} from '../../src/services/emptyRefGate'

const ctx = (over = {}) => ({
  startMode: 'flow',
  projectName: 'P',
  force: false,
  initialTargetSceneIds: ['s1', 's2'],
  selectedStyleRefId: null,
  startOptionsWithoutSceneIds: {},
  ...over,
})

describe('resolveLiveTargetScenes', () => {
  it('최초 의도 ID 집합 밖의 씬은 (게이트 중 추가돼도) 포함하지 않는다', () => {
    const live = [
      { id: 's1', prompt: 'a', status: 'pending' },
      { id: 's2', prompt: 'b', status: 'pending' },
      { id: 's3', prompt: 'c', status: 'pending' },  // 게이트 중 MCP가 추가
    ]
    expect(resolveLiveTargetScenes(ctx(), live).map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('non-force: 게이트 중 완료된 씬은 pending 필터로 빠져 재생성하지 않는다', () => {
    const live = [
      { id: 's1', prompt: 'a', status: 'done', data: 'img' },
      { id: 's2', prompt: 'b', status: 'pending' },
    ]
    expect(resolveLiveTargetScenes(ctx(), live).map(s => s.id)).toEqual(['s2'])
  })

  it('force: 최초 의도 ID 중 실행 시점에 prompt가 있는 씬만 포함한다', () => {
    const live = [
      { id: 's1', prompt: '', status: 'done' },       // prompt 사라짐
      { id: 's2', prompt: 'b', status: 'done' },      // 완료됐어도 force면 포함
    ]
    expect(resolveLiveTargetScenes(ctx({ force: true }), live).map(s => s.id)).toEqual(['s2'])
  })

  it('삭제된 씬은 조용히 빠진다', () => {
    expect(resolveLiveTargetScenes(ctx(), [{ id: 's2', prompt: 'b', status: 'pending' }])
      .map(s => s.id)).toEqual(['s2'])
  })
})

describe('evaluateEmptyRefPostcondition', () => {
  const emptyGhost = { id: 'ghost', name: 'Ghost', type: 'character', prompt: 'p' }
  const filledGhost = { ...emptyGhost, mediaId: 'm1' }
  const scenes = [{ id: 's1', prompt: '@Ghost' }]

  it('요청한 ref가 채워졌으면 통과한다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], currentRefs: [filledGhost] },
      liveTargetScenes: scenes,
      matchRefs: () => [filledGhost],
    })
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('batch가 ok:true라도 요청한 ref가 여전히 빈카드로 참조되면 실패다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], currentRefs: [emptyGhost] },
      liveTargetScenes: scenes,
      matchRefs: () => [emptyGhost],
    })
    expect(result.ok).toBe(false)
    expect(result.failures).toEqual([
      { key: 'id:ghost', stage: 'postcondition', error: 'still-empty' },
    ])
  })

  it('batchResult.failed가 있으면 실패다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: false, outcome: 'failed', requestedKeys: ['id:ghost'], failed: [{ key: 'id:ghost', stage: 'submit', error: 'boom' }], currentRefs: [filledGhost] },
      liveTargetScenes: scenes,
      matchRefs: () => [filledGhost],
    })
    expect(result.ok).toBe(false)
  })

  it('outcome:stopped면 실패다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: false, outcome: 'stopped', requestedKeys: [], failed: [], currentRefs: [] },
      liveTargetScenes: scenes,
      matchRefs: () => [],
    })
    expect(result.ok).toBe(false)
  })

  it('요청 대상이 아니었던 빈카드(프롬프트 없음)는 postcondition 실패가 아니다 — 최종 M1이 제외한다', () => {
    const noPrompt = { id: 'void', name: 'Void', type: 'character', prompt: '' }
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], currentRefs: [filledGhost, noPrompt] },
      liveTargetScenes: [{ id: 's1', prompt: '@Ghost @Void' }],
      matchRefs: () => [filledGhost, noPrompt],
    })
    expect(result.ok).toBe(true)
  })

  it('targeted batch 후 새로 추가된 빈카드 참조는 postcondition 실패가 아니다 (§10.5)', () => {
    const newcomer = { id: 'new', name: 'New', type: 'character', prompt: 'p' }
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], currentRefs: [filledGhost, newcomer] },
      liveTargetScenes: [{ id: 's1', prompt: '@Ghost @New' }],
      matchRefs: () => [filledGhost, newcomer],
    })
    expect(result.ok).toBe(true)
  })

  it('요청한 ref가 사라졌으면 not-found로 실패다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], skipped: [{ key: 'id:ghost', stage: 'not-found' }], currentRefs: [] },
      liveTargetScenes: scenes,
      matchRefs: () => [],
    })
    expect(result.ok).toBe(false)
    expect(result.failures[0].error).toBe('not-found')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/emptyRefGate.helpers.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Write minimal implementation**

`src/services/emptyRefGate.js` 생성. 구현 전 `filterPendingScenes`의 실제 export 위치를 `grep -rn "export.*filterPendingScenes" src`로 확인해 import한다.
```js
import { collectReferencedEmptyCards } from '../utils/refImageGuard'
import { filterPendingScenes } from '../utils/sceneFilters'

// 스캔 집합과 최종 생성 집합의 단일 출처(§6.3). 최초 Start 의도(initialTargetSceneIds)를 membership
// 경계로 잠그고, 실행 시점 live scenes 로 force/pending 을 재적용한다.
export function resolveLiveTargetScenes(context, liveScenes = []) {
  const intendedIds = new Set(context.initialTargetSceneIds || [])
  const liveIntendedScenes = liveScenes.filter(scene => intendedIds.has(scene.id))
  return context.force
    ? liveIntendedScenes.filter(scene => scene.prompt)
    : filterPendingScenes(liveIntendedScenes)
}

// App 독립 postcondition(§10). batchResult.ok 만으로 씬 배치를 시작하지 않는다.
export function evaluateEmptyRefPostcondition({ batchResult, liveTargetScenes, matchRefs }) {
  const failures = []

  for (const item of batchResult.failed || []) {
    failures.push({ key: item.key, stage: 'postcondition', error: 'still-empty' })
  }
  if (batchResult.outcome === 'stopped') {
    failures.push({ key: null, stage: 'postcondition', error: 'still-empty' })
  }

  const requestedKeySet = new Set(batchResult.requestedKeys || [])

  // 요청했는데 사라진 target 은 성공으로 위장되면 안 된다(§11.3).
  for (const item of batchResult.skipped || []) {
    if (item.stage === 'not-found' && requestedKeySet.has(item.key)) {
      failures.push({ key: item.key, stage: 'postcondition', error: 'not-found' })
    }
  }

  // 요청한 target 이 여전히 빈카드로 참조되면 fail-closed.
  const liveEmpty = collectReferencedEmptyCards(liveTargetScenes, matchRefs)
  for (const card of liveEmpty.cards) {
    if (!requestedKeySet.has(card.key)) continue  // 요청 대상이 아니면 최종 M1 소관(§10.5)
    failures.push({
      key: card.key,
      stage: 'postcondition',
      error: card.hasPrompt ? 'still-empty' : 'missing-prompt',
    })
  }

  return { ok: failures.length === 0, failures }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/emptyRefGate.helpers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/emptyRefGate.js tests/services/emptyRefGate.helpers.test.js
git commit -m "feat: add live target resolution and fail-closed postcondition helpers (M2 task 6)"
```

---

## Task 7: emptyRefGate coordinator — `runEmptyRefGateFlow` (역할 D) ★핵심

**Files:**
- Modify: `src/services/emptyRefGate.js`
- Test: `tests/services/emptyRefGate.test.js`

> 이 태스크가 스펙 §13 Task 4·5·6(시나리오 A~F)을 **전부 흡수**한다. App mount 테스트는 만들지 않는다(위 "계약 변경" #1).

**Interfaces:**
- Produces:
  ```js
  export async function runEmptyRefGateFlow(context, deps) → { started: boolean, reason: string }
  // reason: 'no-empty-cards' | 'started' | 'cancelled' | 'gate-login' | 'gate-paywall' | 'gate-loading'
  //       | 'batch-failed' | 'batch-stopped' | 'postcondition-failed' | 'mode-changed' | 'project-changed'
  //       | 'no-live-targets' | 'sync-cancelled'
  ```
- `deps` (전부 **함수**. 배열 스냅샷 금지 — 진입 시 `typeof !== 'function'`이면 throw):
  ```js
  {
    getLiveScenes(): Scene[],           // App: () => scenesHook.scenesRef.current
    getLiveRefs(): Reference[],         // App: () => referencesRef.current
    getMode(): string,                  // App: () => modeRef.current
    getProjectName(): string,           // App: () => ensureProjectName()
    matchRefs(scene, refPool): Ref[],   // App: scenesHook.getMatchingReferences
    subscriptionPreGate(): Promise<'proceed'|'login'|'paywall'|'loading'>,
    setPendingLatch(on: boolean): void, // App: setHasPendingBatch
    generateRefs(targetRefKeys: string[]): Promise<BatchResult>,
                                        // App: keys => handleGenerateAllRefs(null, { force:false, targetRefKeys, reason:'m2-empty-reference-gate' })
    openSyncGate({ refs }): Promise<{ proceeded: boolean, patchedRefs: Reference[] | null }>,
    startScenes(finalStartOptions): Promise<any>,   // App: automationStartRef.current
    toastM1Exclusions(exclusions): void,
    gateView: {
      confirm(items): Promise<'generate-first'|'exclude'|'cancel'>,
      setBusy(): void,
      failure(info): Promise<void>,     // 사용자가 확인을 누르면 resolve
      close(): void,
    },
  }
  ```

**불변 계약 (테스트가 이걸 증명한다):**
1. live source only — `batchResult.currentRefs`(배치 후) / `getLiveRefs()`(배치 없는 경로) / `getLiveScenes()`
2. failure 모달이 열려 있는 동안 latch는 **true**
3. postcondition은 `gateView.close()` **전에** 실행, `batchResult.ok`만으로 진행 금지
4. final `sceneIds` = live 재필터 결과, `batchIntent:'full'`
5. mode/project 변경 시 `startScenes` 호출 금지
6. 어떤 종료 경로에서도 latch는 최종적으로 해제된다(paywall early-return 포함)

- [ ] **Step 1: Write the failing test**

`tests/services/emptyRefGate.test.js`. deferred promise 유틸로 사용자 선택/배치를 제어한다:
```js
import { describe, expect, it, vi } from 'vitest'
import { runEmptyRefGateFlow } from '../../src/services/emptyRefGate'

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

const emptyGhost = { id: 'ghost', name: 'Ghost', type: 'character', prompt: 'a ghost' }
const filledGhost = { ...emptyGhost, mediaId: 'm1', entityId: 'e1', workflowId: 'w1' }

const baseContext = (over = {}) => ({
  startMode: 'flow',
  projectName: 'P',
  force: false,
  initialTargetSceneIds: ['s1'],
  selectedStyleRefId: null,
  startOptionsWithoutSceneIds: { projectName: 'P', saveMode: 'memory' },
  ...over,
})

// 기본 deps — 각 테스트가 필요한 부분만 override한다.
const makeDeps = (over = {}) => {
  const state = {
    scenes: [{ id: 's1', prompt: '@Ghost', status: 'pending' }],
    refs: [emptyGhost],
  }
  const calls = []
  const deps = {
    __state: state,
    __calls: calls,
    getLiveScenes: () => state.scenes,
    getLiveRefs: () => state.refs,
    getMode: () => 'flow',
    getProjectName: () => 'P',
    matchRefs: (scene, pool) => (pool || []).filter(r => (scene.prompt || '').includes(`@${r.name}`)),
    subscriptionPreGate: vi.fn(async () => 'proceed'),
    setPendingLatch: vi.fn(on => calls.push(`latch:${on}`)),
    generateRefs: vi.fn(async () => {
      calls.push('generateRefs')
      state.refs = [filledGhost]
      return { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [], currentRefs: state.refs }
    }),
    openSyncGate: vi.fn(async () => ({ proceeded: true, patchedRefs: null })),
    startScenes: vi.fn(async opts => { calls.push('startScenes'); return opts }),
    toastM1Exclusions: vi.fn(),
    gateView: {
      confirm: vi.fn(async () => { calls.push('confirm'); return 'generate-first' }),
      setBusy: vi.fn(() => calls.push('busy')),
      failure: vi.fn(async () => { calls.push('failure') }),
      close: vi.fn(() => calls.push('close')),
    },
    ...over,
  }
  return deps
}

describe('runEmptyRefGateFlow — 빈카드 없음', () => {
  it('빈카드가 없으면 모달을 열지 않고 바로 씬 배치로 간다', async () => {
    const deps = makeDeps({ getLiveRefs: () => [filledGhost] })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.gateView.confirm).not.toHaveBeenCalled()
    expect(deps.subscriptionPreGate).not.toHaveBeenCalled()  // 빈카드 있을 때만 사전 gate(§6.6)
    expect(deps.startScenes).toHaveBeenCalledTimes(1)
    expect(result.started).toBe(true)
  })
})

describe('불변 1: live source only', () => {
  it('모달이 열려 있는 동안 refs가 바뀌면 클릭 시점 live refs로 target을 다시 뽑는다', async () => {
    const gate = deferred()
    const deps = makeDeps({
      gateView: { confirm: vi.fn(() => gate.promise), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    const newEmpty = { id: 'new', name: 'New', type: 'character', prompt: 'p' }
    const flow = runEmptyRefGateFlow(baseContext(), deps)
    await Promise.resolve()

    // 모달이 떠 있는 사이 ghost는 채워지고 새 빈카드가 참조에 추가됨
    deps.__state.refs = [filledGhost, newEmpty]
    deps.__state.scenes = [{ id: 's1', prompt: '@Ghost @New', status: 'pending' }]
    gate.resolve('generate-first')
    await flow

    // 모달을 연 시점의 ['id:ghost']가 아니라 클릭 시점의 ['id:new']를 생성해야 한다
    expect(deps.generateRefs).toHaveBeenCalledWith(['id:new'])
  })

  it('postcondition/M1/final start는 stale getLiveRefs가 아니라 batchResult.currentRefs를 쓴다', async () => {
    const sentinel = [{ ...filledGhost, __sentinel: true }]
    const matchRefs = vi.fn((scene, pool) => (pool || []).filter(r => (scene.prompt || '').includes(`@${r.name}`)))
    const deps = makeDeps({
      matchRefs,
      // getLiveRefs는 의도적으로 stale(빈카드)로 남긴다
      getLiveRefs: () => [emptyGhost],
      generateRefs: vi.fn(async () => ({
        ok: true, outcome: 'completed', requestedKeys: ['id:ghost'],
        attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [],
        currentRefs: sentinel,
      })),
    })

    const result = await runEmptyRefGateFlow(baseContext(), deps)

    // 배치 이후의 모든 matcher 호출은 sentinel(=currentRefs)을 pool로 받아야 한다
    const poolsAfterBatch = matchRefs.mock.calls.slice(1).map(args => args[1])
    expect(poolsAfterBatch.every(pool => pool === sentinel)).toBe(true)
    expect(deps.startScenes.mock.calls[0][0].currentRefs).toBe(sentinel)
    expect(result.started).toBe(true)
  })

  it('exclude 경로는 클릭 시점 getLiveRefs()로 M1을 재계산하고 generateRefs를 호출하지 않는다', async () => {
    const gate = deferred()
    const deps = makeDeps({
      gateView: { confirm: vi.fn(() => gate.promise), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    const flow = runEmptyRefGateFlow(baseContext(), deps)
    await Promise.resolve()
    gate.resolve('exclude')
    await flow

    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(deps.startScenes).toHaveBeenCalledTimes(1)
    // 빈 ghost가 M1으로 제외돼 멘션 제거 맵이 실린다
    expect(deps.startScenes.mock.calls[0][0].m1ExcludedMentionNamesBySceneId).toEqual({ s1: ['Ghost'] })
    expect(deps.toastM1Exclusions).toHaveBeenCalledTimes(1)
  })
})

describe('불변 2: failure 모달 중 latch 유지 (MCP stop-restart 차단)', () => {
  it('batch stopped → failure 모달이 열린 동안 latch를 풀지 않고, 확인 후에만 해제한다', async () => {
    const ack = deferred()
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: false, outcome: 'stopped', requestedKeys: ['id:ghost'], attemptedKeys: [], succeededKeys: [], skipped: [], failed: [], currentRefs: [emptyGhost] })),
      gateView: {
        confirm: vi.fn(async () => 'generate-first'),
        setBusy: vi.fn(),
        failure: vi.fn(() => ack.promise),
        close: vi.fn(),
      },
    })
    const flow = runEmptyRefGateFlow(baseContext(), deps)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    // failure 모달이 열린 상태: latch는 true인 채여야 하고 씬은 시작되면 안 된다
    expect(deps.gateView.failure).toHaveBeenCalled()
    expect(deps.setPendingLatch).toHaveBeenCalledWith(true)
    expect(deps.setPendingLatch).not.toHaveBeenCalledWith(false)
    expect(deps.startScenes).not.toHaveBeenCalled()

    ack.resolve()
    const result = await flow

    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'batch-stopped' })
  })

  it('batch failed → 동일하게 failure 유지, 씬 시작 0회', async () => {
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: false, outcome: 'failed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: [], skipped: [], failed: [{ key: 'id:ghost', stage: 'busy', error: 'coordinator busy' }], currentRefs: [emptyGhost] })),
    })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.gateView.failure).toHaveBeenCalledWith(
      expect.objectContaining({ failures: [expect.objectContaining({ stage: 'busy' })] })
    )
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result.started).toBe(false)
  })
})

describe('불변 3: postcondition이 close보다 먼저 (ok:true로 충분하지 않다)', () => {
  it('batch ok:true인데 요청한 ref가 여전히 빈카드 → failure, close/start 금지', async () => {
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [], currentRefs: [emptyGhost] })),
    })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.gateView.close).not.toHaveBeenCalled()
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'postcondition-failed' })
    expect(deps.gateView.failure).toHaveBeenCalledWith(
      expect.objectContaining({ failures: [expect.objectContaining({ stage: 'postcondition', error: 'still-empty' })] })
    )
  })

  it('성공 경로의 호출 순서: generateRefs → close → startScenes', async () => {
    const deps = makeDeps()
    await runEmptyRefGateFlow(baseContext(), deps)

    const order = deps.__calls.filter(c => ['generateRefs', 'close', 'startScenes'].includes(c))
    expect(order).toEqual(['generateRefs', 'close', 'startScenes'])
  })
})

describe('불변 4: final sceneIds + batchIntent:full', () => {
  it('게이트 중 추가된 씬은 빼고, 완료된 씬도 빼고, batchIntent:full로 시작한다', async () => {
    const gate = deferred()
    const deps = makeDeps({
      gateView: { confirm: vi.fn(() => gate.promise), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    deps.__state.scenes = [
      { id: 's1', prompt: '@Ghost', status: 'pending' },
      { id: 's2', prompt: 'b', status: 'pending' },
      { id: 's3', prompt: 'c', status: 'pending' },
    ]
    const ctx = baseContext({ initialTargetSceneIds: ['s1', 's2', 's3'] })
    const flow = runEmptyRefGateFlow(ctx, deps)
    await Promise.resolve()

    // 게이트 중: s2 완료, s4 추가
    deps.__state.scenes = [
      { id: 's1', prompt: '@Ghost', status: 'pending' },
      { id: 's2', prompt: 'b', status: 'done', data: 'img' },
      { id: 's3', prompt: 'c', status: 'pending' },
      { id: 's4', prompt: 'd', status: 'pending' },
    ]
    gate.resolve('exclude')
    await flow

    const opts = deps.startScenes.mock.calls[0][0]
    expect(opts.sceneIds).toEqual(['s1', 's3'])
    expect(opts.batchIntent).toBe('full')
    expect(opts.force).toBe(false)
  })

  it('force면 최초 의도 ID 중 live prompt가 있는 씬만 포함한다', async () => {
    const deps = makeDeps({ getLiveRefs: () => [filledGhost] })
    deps.__state.scenes = [
      { id: 's1', prompt: '', status: 'done' },
      { id: 's2', prompt: 'b', status: 'done' },
    ]
    await runEmptyRefGateFlow(baseContext({ force: true, initialTargetSceneIds: ['s1', 's2'] }), deps)

    expect(deps.startScenes.mock.calls[0][0].sceneIds).toEqual(['s2'])
  })

  it('최종 대상이 0개면 씬을 시작하지 않고 latch를 푼다', async () => {
    const deps = makeDeps({ getLiveRefs: () => [filledGhost] })
    deps.__state.scenes = [{ id: 's1', prompt: 'a', status: 'done', data: 'img' }]

    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'no-live-targets' })
  })
})

describe('불변 5: mode/project 변경 시 씬 시작 금지', () => {
  it('모달 중 mode가 바뀌면 generateRefs도 startScenes도 호출하지 않는다', async () => {
    const gate = deferred()
    let mode = 'flow'
    const deps = makeDeps({
      getMode: () => mode,
      gateView: { confirm: vi.fn(() => gate.promise), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    const flow = runEmptyRefGateFlow(baseContext(), deps)
    await Promise.resolve()
    mode = 'api'
    gate.resolve('generate-first')
    const result = await flow

    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'mode-changed' })
  })

  it('ref batch가 끝난 뒤 project가 바뀌었으면 다른 프로젝트에 이어서 제출하지 않는다', async () => {
    let project = 'P'
    const deps = makeDeps({
      getProjectName: () => project,
      generateRefs: vi.fn(async () => {
        project = 'OTHER'
        return { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [], currentRefs: [filledGhost] }
      }),
    })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'project-changed' })
  })
})

describe('불변 6: 모든 종료 경로에서 latch 해제', () => {
  it('취소하면 씬을 시작하지 않고 latch를 푼다', async () => {
    const deps = makeDeps({
      gateView: { confirm: vi.fn(async () => 'cancel'), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
    expect(result).toEqual({ started: false, reason: 'cancelled' })
  })

  it('startScenes가 paywall로 조용히 early-return해도 latch는 풀린다 (§6.6 이중 gate 구멍)', async () => {
    const deps = makeDeps({ startScenes: vi.fn(async () => undefined) })
    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
  })

  it('startScenes가 throw해도 latch는 풀린다', async () => {
    const deps = makeDeps({ startScenes: vi.fn(async () => { throw new Error('boom') }) })
    await runEmptyRefGateFlow(baseContext(), deps).catch(() => {})

    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
  })
})

describe('subscription 사전 gate (§6.6)', () => {
  it.each([
    ['login', 'gate-login'],
    ['paywall', 'gate-paywall'],
    ['loading', 'gate-loading'],
  ])('%s면 모달을 열지 않고 latch도 잡지 않는다', async (gateResult, reason) => {
    const deps = makeDeps({ subscriptionPreGate: vi.fn(async () => gateResult) })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.gateView.confirm).not.toHaveBeenCalled()
    expect(deps.setPendingLatch).not.toHaveBeenCalledWith(true)
    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason })
  })

  it('사전 gate 통과 후에만 latch를 잡고 모달을 연다', async () => {
    const deps = makeDeps()
    await runEmptyRefGateFlow(baseContext(), deps)

    const latchIndex = deps.__calls.indexOf('latch:true')
    const confirmIndex = deps.__calls.indexOf('confirm')
    expect(latchIndex).toBeGreaterThan(-1)
    expect(latchIndex).toBeLessThan(confirmIndex)
  })
})

describe('sync gate 위임', () => {
  it('sync gate를 취소하면 씬을 시작하지 않고 latch를 푼다', async () => {
    const unsynced = { id: 'sync-me', name: 'SyncMe', type: 'character', filePath: '/a.png' }
    const deps = makeDeps({
      getLiveRefs: () => [filledGhost, unsynced],
      openSyncGate: vi.fn(async () => ({ proceeded: false, patchedRefs: null })),
    })
    deps.__state.scenes = [{ id: 's1', prompt: '@SyncMe', status: 'pending' }]

    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
    expect(result).toEqual({ started: false, reason: 'sync-cancelled' })
  })

  it('sync gate가 patchedRefs를 주면 최종 start의 currentRefs로 쓴다', async () => {
    const unsynced = { id: 'sync-me', name: 'SyncMe', type: 'character', filePath: '/a.png' }
    const patched = [{ ...unsynced, mediaId: 'm9', entityId: 'e9' }]
    const deps = makeDeps({
      getLiveRefs: () => [filledGhost, unsynced],
      openSyncGate: vi.fn(async () => ({ proceeded: true, patchedRefs: patched })),
    })
    deps.__state.scenes = [{ id: 's1', prompt: '@SyncMe', status: 'pending' }]

    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes.mock.calls[0][0].currentRefs).toBe(patched)
  })
})

describe('M1 토스트 정책 (§8.3)', () => {
  it('실패로 씬 배치가 시작되지 않으면 M1 토스트를 띄우지 않는다', async () => {
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: false, outcome: 'failed', requestedKeys: ['id:ghost'], attemptedKeys: [], succeededKeys: [], skipped: [], failed: [{ key: 'id:ghost', stage: 'submit', error: 'x' }], currentRefs: [emptyGhost] })),
    })
    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.toastM1Exclusions).not.toHaveBeenCalled()
  })

  it('먼저 생성 성공 후 프롬프트 없는 빈카드가 남으면 최종 M1 토스트를 1회 띄운다', async () => {
    const noPrompt = { id: 'void', name: 'Void', type: 'character', prompt: '' }
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [], currentRefs: [filledGhost, noPrompt] })),
    })
    deps.__state.scenes = [{ id: 's1', prompt: '@Ghost @Void', status: 'pending' }]

    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.toastM1Exclusions).toHaveBeenCalledTimes(1)
    expect(deps.startScenes).toHaveBeenCalledTimes(1)
  })
})

describe('deps 계약 방어', () => {
  it('live source dep이 함수가 아니면 즉시 throw한다 (배열 스냅샷 miswiring 차단)', async () => {
    const deps = makeDeps({ getLiveScenes: [{ id: 's1' }] })
    await expect(runEmptyRefGateFlow(baseContext(), deps)).rejects.toThrow(/getLiveScenes/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/emptyRefGate.test.js`
Expected: FAIL — `runEmptyRefGateFlow is not a function`

- [ ] **Step 3: Write minimal implementation**

`src/services/emptyRefGate.js`에 `runEmptyRefGateFlow` 구현. 구조 요구사항:
- 진입 시 `getLiveScenes`/`getLiveRefs`/`getMode`/`getProjectName`/`matchRefs`/`generateRefs`/`startScenes` 가 함수인지 검사, 아니면 `throw new Error('[emptyRefGate] deps.<name> must be a function')`
- **latch 획득 이후의 모든 경로**를 `try/finally`로 감싸 `finally`에서 `setPendingLatch(false)` — 단 failure 모달을 `await`한 **뒤**에 finally가 돌도록(즉 `gateView.failure()` await가 try 블록 안)
- invariant 재검증 헬퍼:
  ```js
  const invariantBroken = () => {
    if (deps.getMode() !== context.startMode) return 'mode-changed'
    if (deps.getProjectName() !== context.projectName) return 'project-changed'
    return null
  }
  ```
  이 검사를 (a) 진입, (b) confirm 이후, (c) batch 이후, (d) sync 이후, (e) final start 직전에 호출
- 순서는 스펙 §9.1 그대로: 빈카드 수집 → 없으면 M1/sync/launch → 있으면 사전 gate → latch → confirm → 분기 → live M1 → sync → final target 재계산 → `startScenes({ ...startOptionsWithoutSceneIds, sceneIds, force, batchIntent:'full', currentRefs: authoritativeRefs, m1ExcludedMentionNamesBySceneId })`
- `authoritativeRefs` 선택 규칙(계약 변경 #3): generate-first 경로 = `batchResult.currentRefs`, exclude 경로 = `deps.getLiveRefs()`, sync 통과 후 = `patchedRefs ?? 직전 authoritativeRefs`
- matcher wrapper: `const matchWithRefs = scene => deps.matchRefs(scene, authoritativeRefs)` — collector와 M1 모두 이 wrapper를 1인자로 호출
- M1 토스트는 **final launch 직전 최종 M1 결과에 대해서만** 1회

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/emptyRefGate.test.js tests/services/emptyRefGate.helpers.test.js`
Expected: PASS 전부

- [ ] **Step 5: Commit**

```bash
git add src/services/emptyRefGate.js tests/services/emptyRefGate.test.js
git commit -m "feat: add fail-closed empty reference gate coordinator (M2 task 7)"
```

---

## Task 8: `EmptyReferenceGateModal` + i18n

**Files:**
- Create: `src/components/EmptyReferenceGateModal.jsx`, `src/components/EmptyReferenceGateModal.css`
- Modify: `src/locales/ko.js`, `src/locales/en.js`
- Test: `tests/components/EmptyReferenceGateModal.test.jsx`

**Interfaces:**
- Produces:
  ```jsx
  <EmptyReferenceGateModal
    phase="confirm" | "busy" | "failure"
    items={[{ key, name, type, refId, hasPrompt, sceneNumbers: number[] }]}
    failure={{ outcome, failures: [{ key, stage, error }] } | null}
    onChoose={(choice) => {}}   // 'generate-first' | 'exclude' | 'cancel'
    onAcknowledge={() => {}}    // failure 확인
  />
  ```
- ⚠️ 계획 초안은 "공용 Modal 컴포넌트가 없다"고 했으나 **틀렸다**(내 `ls | grep -i modal | head` 가 알파벳순 10개에서 잘려 `Modal.jsx` 를 놓쳤음). `src/components/Modal.jsx` 가 공용 래퍼이고 17개 컴포넌트가 쓴다 — 이걸 쓴다(`import Modal from './Modal'`). `TagBatchModal.jsx`/`DeleteSceneConfirmModal.jsx` 의 title/footer/className 관례를 따르고, 오버레이·패널 CSS 를 재구현하지 않는다.
- **닫기 경로는 반드시 promise 를 resolve해야 한다.** `gateView.confirm`/`failure` 는 coordinator 가 await 하고 그동안 latch 를 쥔다 — resolve 없이 닫히면 latch 를 쥔 채 영원히 매달려 Start 가 영구 비활성(soft-lock). 그래서 `onClose` 를 phase 별로: confirm → `onChoose('cancel')`, busy → **닫기 없음**(진행 중이라 안전한 답이 없음), failure → `onAcknowledge()`. 공용 `Modal` 은 `onClose` 가 있을 때만 ✕ 를 그리도록 함께 고쳤다(핸들러 없는 모달이 죽은 ✕ 를 광고하던 문제 — 소비자 17곳 전부 onClose 를 넘기므로 무영향).

- [ ] **Step 1: Write the failing test**

`tests/components/EmptyReferenceGateModal.test.jsx`. 검증할 행동:
```js
// 1) confirm: 카드 이름/타입/참조 씬 번호(#N)를 표시한다
// 2) confirm: hasPrompt=false 카드에 경고 표시 + "자동 생성 제외" 안내
// 3) confirm: 생성가능 카드가 0개면 "먼저 생성" 버튼이 disabled이고 안내 문구가 뜬다
// 4) confirm: 3버튼 클릭이 각각 'generate-first' | 'exclude' | 'cancel'로 onChoose를 부른다
// 5) busy: 3버튼이 전부 disabled (중복 클릭 차단)
// 6) busy: 연속 클릭해도 onChoose가 추가로 불리지 않는다
// 7) failure: 카드별 실패 stage/원인 + "씬 배치가 시작되지 않았습니다" 안내 + 확인 버튼
// 8) failure: 확인 클릭 → onAcknowledge 1회
// 9) 동명 카드: 목록에 type과 id를 함께 표시해 구분 가능 (§11.16)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/EmptyReferenceGateModal.test.jsx`
Expected: FAIL — 컴포넌트 없음

- [ ] **Step 3: Write minimal implementation**

컴포넌트 + i18n 키. 최소 키 세트(ko/en 양쪽 동일 구조):
```
emptyRefGate.title              "빈 레퍼런스 카드가 있습니다"
emptyRefGate.description        "생성할 씬이 이미지 없는 레퍼런스를 참조합니다. 어떻게 할까요?"
emptyRefGate.generateFirst      "빈카드 먼저 생성 → 씬 생성"
emptyRefGate.excludeAndStart    "제외하고 씬만 생성"
emptyRefGate.cancel             "취소"
emptyRefGate.noPrompt           "⚠ 프롬프트 없음 — 자동 생성 제외"
emptyRefGate.noneGeneratable    "자동 생성 가능한 빈카드가 없습니다. 프롬프트를 추가하거나 \"제외하고 씬만 생성\"을 선택하세요."
emptyRefGate.busy               "레퍼런스 생성 중..."
emptyRefGate.failureTitle       "레퍼런스 생성 실패"
emptyRefGate.failureStopped     "레퍼런스 생성이 중단되었습니다"
emptyRefGate.sceneBatchNotStarted "씬 배치는 시작되지 않았습니다."
emptyRefGate.stage.<stage>      각 failure stage 라벨 (permission/auth/flow-ready/prepare/submit/collect/save/timeout/busy/exception/postcondition)
emptyRefGate.confirm            "확인"
emptyRefGate.referencedScenes   "참조 씬: {{scenes}}"
```
`tests/locales/emptyRefGateKeys.test.js`를 신규 작성한다 — 기존 `tests/locales/referenceExclusionKeys.test.js`(M1 토스트 키 대칭성 테스트)의 패턴을 그대로 따라 ko/en 양쪽에 위 키가 모두 존재하고 비어있지 않은지 검증한다.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/EmptyReferenceGateModal.test.jsx tests/locales/`
Expected: PASS 전부

- [ ] **Step 5: Commit**

```bash
git add src/components/EmptyReferenceGateModal.jsx src/components/EmptyReferenceGateModal.css src/locales/ko.js src/locales/en.js tests/components/EmptyReferenceGateModal.test.jsx
git commit -m "feat: add empty reference gate modal and i18n strings (M2 task 8)"
```

---

## Task 9: App wiring — deps 빌더 + 양 진입점 통합

**Files:**
- Modify: `src/services/startGuard.js` (+ `isStartBlocked`)
- Modify: `src/App.jsx` — `scenesRef`/`automationStartRef` 연결, `emptyRefGate` state + gateView resolver, `buildEmptyRefGateDeps`, `handleStartImpl` direct 경로(`:1480-1517`), `handleTagValidationProceed`(`:1743-1827`), `handleSyncGateProceed` seed(`:1842`) + `onCancel`, 모달 렌더
- Test: `tests/services/emptyRefGateDeps.test.js` (신규), `tests/components/App.emptyRefGateWiring.test.js` (신규, 얇은 wiring만)

**Interfaces:**
- Produces:
  ```js
  // src/services/startGuard.js
  export function isStartBlocked({ isRunning, videoRunning, hasPendingBatch, retryInFlight }): boolean

  // src/App.jsx (export하지 않고 파일 내 정의해도 되나, 테스트 위해 별도 export 권장)
  export function buildEmptyRefGateDeps({ scenesRef, referencesRef, modeRef, ... }): deps
  ```

⚠️ **가장 큰 위험**: coordinator 테스트는 fake로 통과하는데 App이 deps를 잘못 연결(예: `getLiveScenes: () => scenes` 렌더 클로저)해 stale 버그가 한 층 위에서 부활하는 것. 그래서 **deps 빌더 자체를 liveness 단위테스트**한다.

- [ ] **Step 1: Write the failing test**

`tests/services/emptyRefGateDeps.test.js`:
```js
import { describe, expect, it, vi } from 'vitest'
import { buildEmptyRefGateDeps } from '../../src/services/emptyRefGate'

describe('buildEmptyRefGateDeps — liveness 배선', () => {
  it('getLiveScenes는 ref를 뮤테이트한 뒤 호출해도 최신 값을 준다 (렌더 클로저 캡처 금지)', () => {
    const scenesRef = { current: [{ id: 's1' }] }
    const deps = buildEmptyRefGateDeps({
      scenesRef,
      referencesRef: { current: [] },
      modeRef: { current: 'flow' },
      getProjectName: () => 'P',
      getMatchingReferences: vi.fn(),
      subscriptionPreGate: vi.fn(),
      setPendingLatch: vi.fn(),
      handleGenerateAllRefs: vi.fn(),
      openSyncGate: vi.fn(),
      automationStartRef: { current: vi.fn() },
      toastM1Exclusions: vi.fn(),
      gateView: {},
    })

    scenesRef.current = [{ id: 's1' }, { id: 's2' }]

    expect(deps.getLiveScenes().map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('getLiveRefs / getMode도 동일하게 live하다', () => { /* 위와 같은 형태 */ })

  it('startScenes는 automationStartRef.current를 호출 시점에 읽는다 (stale start closure 금지)', () => {
    const oldStart = vi.fn()
    const newStart = vi.fn()
    const automationStartRef = { current: oldStart }
    const deps = buildEmptyRefGateDeps({ /* ... */ automationStartRef })

    automationStartRef.current = newStart
    deps.startScenes({ a: 1 })

    expect(oldStart).not.toHaveBeenCalled()
    expect(newStart).toHaveBeenCalledWith({ a: 1 })
  })

  it('generateRefs는 M2 계약으로 handleGenerateAllRefs를 부른다 (overrideStyleId=null, force=false, reason)', () => {
    const handleGenerateAllRefs = vi.fn()
    const deps = buildEmptyRefGateDeps({ /* ... */ handleGenerateAllRefs })

    deps.generateRefs(['id:ghost'])

    expect(handleGenerateAllRefs).toHaveBeenCalledWith(null, {
      force: false,
      targetRefKeys: ['id:ghost'],
      reason: 'm2-empty-reference-gate',
    })
  })
})
```
`isStartBlocked` 테스트는 `tests/components/App.handleStart.test.js`에 추가한다 — 이 파일이 이미 `src/services/startGuard.js`의 `computeGuardAvailable`을 import해 테스트하는 startGuard의 테스트 홈이다(`tests/services/startGuard.test.js`는 존재하지 않는다). 검증할 행동:
```js
// hasPendingBatch=true면 차단 (failure 모달 중 MCP restart 차단의 반쪽)
// isRunning / videoRunning / retryInFlight 각각 true면 차단, 전부 false면 통과
```
`tests/components/App.emptyRefGateWiring.test.js` — 소스 문자열 검사는 **얇은 wiring 확인에만** 쓴다:
```js
// 1) direct 경로와 tag-proceed 경로가 둘 다 runEmptyRefGateFlow를 호출한다 (두 진입점 통합)
// 2) tag-proceed가 pendingStartOptions의 stale M1 map / scene 객체를 재사용하지 않는다
//    (opts.m1ExcludedMentionNamesBySceneId를 start로 직접 흘리는 옛 코드가 남아있지 않다)
// 3) handleSyncGateProceed의 seed가 scenesHook.references가 아니라 referencesRef.current다
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/services/emptyRefGateDeps.test.js tests/components/App.emptyRefGateWiring.test.js`
Expected: FAIL — `buildEmptyRefGateDeps` 없음, App이 아직 coordinator를 호출 안 함

- [ ] **Step 3: Write minimal implementation**

App.jsx 변경:
1. `automationStartRef` 추가 — 매 렌더 최신 `start` 반영:
   ```js
   // #M2: 모달/ref batch 이후 실행되는 scene start 는 과거 render 의 start closure 를 부르면 안 된다.
   const automationStartRef = useRef(start)
   automationStartRef.current = start
   ```
2. `scenesRef`는 Task 2에서 export한 `scenesHook.scenesRef`를 그대로 쓴다(App에 새 렌더타임 미러를 만들지 않는다 — 동기 갱신 창을 잃는다).
3. `emptyRefGate` state + gateView resolver 브리지:
   ```js
   const [emptyRefGate, setEmptyRefGate] = useState(null)
   // gateView.confirm/failure 는 사용자의 클릭을 기다리는 promise 를 반환한다. resolver 를 state 에 보관하고
   // 모달 버튼이 그걸 호출한다 — coordinator 는 폴링 없이 선택을 await 한다.
   const gateView = useMemo(() => ({
     confirm: (items) => new Promise(resolve =>
       setEmptyRefGate({ phase: 'confirm', items, resolve })),
     setBusy: () => setEmptyRefGate(prev => prev ? { ...prev, phase: 'busy' } : prev),
     failure: (info) => new Promise(resolve =>
       setEmptyRefGate(prev => ({ ...(prev || {}), phase: 'failure', failure: info, resolve }))),
     close: () => setEmptyRefGate(null),
   }), [])
   ```
4. `handleStartImpl` 초입 guard(`:1318`)를 `isStartBlocked({...})`로 교체
5. direct 경로: `:1480-1517`의 M1 토스트/sync gate/start 블록을 **삭제**하고 `runEmptyRefGateFlow(context, deps)` 호출로 대체. `context.startOptionsWithoutSceneIds`는 기존 `startOptions`에서 `force`/`m1ExcludedMentionNamesBySceneId`를 뺀 것.
6. tag-proceed 경로: `:1785-1823`의 M1 토스트/sync gate/start 블록을 **삭제**하고 동일하게 `runEmptyRefGateFlow(context, deps)` 호출. `context`는 저장된 `pendingStartOptions`가 아니라 **재검증 후 새로 만든다**(stale M1 map/scene 객체 재사용 금지).
7. `openSyncGate` dep — 기존 `setSyncGate`를 promise로 감싼다:
   ```js
   const openSyncGate = useCallback((({ refs }) => new Promise(resolve => {
     setSyncGate({
       refs,
       proceed: patchedRefs => resolve({ proceeded: true, patchedRefs: patchedRefs ?? null }),
       onCancel: () => resolve({ proceeded: false, patchedRefs: null }),
     })
   })), [])
   ```
   `handleSyncGateCancel`은 `syncGate.onCancel?.()`를 호출한 뒤 gate를 닫도록 수정.
8. `handleSyncGateProceed`의 seed(`:1842`) `let patchedRefs = scenesHook.references` → `let patchedRefs = referencesRef.current` (§8.2)
9. 모달 렌더 — `emptyRefGate &&  <EmptyReferenceGateModal ... onChoose={emptyRefGate.resolve} onAcknowledge={emptyRefGate.resolve} />`
10. `buildEmptyRefGateDeps`를 `src/services/emptyRefGate.js`에 export하고 App이 호출

`src/services/startGuard.js`:
```js
// handleStart 초입 guard — hasPendingBatch 는 M2 failure 모달이 열린 동안 유지되어 MCP stop-restart 의
// scene start 재호출을 막는 latch다(§11.14).
export function isStartBlocked({ isRunning, videoRunning, hasPendingBatch, retryInFlight }) {
  return !!(isRunning || videoRunning || hasPendingBatch || retryInFlight)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/services/ tests/components/App.emptyRefGateWiring.test.js tests/components/App.referenceGuardM1.test.js tests/components/App.handleStart.test.js tests/components/App.syncGateCoordinator.test.js`
Expected: PASS 전부. **기존 M1 소스 문자열 테스트가 깨지면** — direct/tag-proceed 블록을 coordinator로 옮겼으므로 그 테스트의 검사 대상을 coordinator 호출로 갱신하는 게 맞다. 단 **삭제하지 말고** 의미를 보존해 옮길 것.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/services/emptyRefGate.js src/services/startGuard.js tests/services/emptyRefGateDeps.test.js tests/components/App.emptyRefGateWiring.test.js
git commit -m "wire empty reference gate into direct and tag-proceed start paths (M2 task 9)"
```

---

## Task 10: 전체 회귀 + 마일스톤 검증

**Files:** 없음(검증 전용). 회귀가 나오면 해당 태스크로 돌아간다.

- [ ] **Step 1: 전체 스위트 실행**

Run: `npm run test:run`
Expected: M1 기준선 **5831 통과** + M2 신규 테스트. 실패 0.
실패가 있으면 **반드시 원인을 고친다** — 테스트를 지우거나 약화시키지 않는다.

- [ ] **Step 2: 수용 기준 대조 (스펙 §15, 35개)**

각 항목을 이 계획의 테스트로 매핑한 표를 작성하고, 매핑이 없는 항목은 테스트를 추가한다. 특히 확인:
- #12 targeted noop에서 `allRefsGenerated` 토스트 없음 → Task 4
- #20 MCP stop-restart가 latch에 차단 → Task 7 불변2 + Task 9 `isStartBlocked`
- #25 스캔 집합 == 최종 sceneIds → Task 7 불변4
- #34 기존 manual/MCP global ref batch 동작 유지 → Task 4/5

- [ ] **Step 3: Fable 5 마일스톤 리뷰 (findings 0까지 루프)**

subagent(model:'fable')로 M2 전체 diff 리뷰. 스펙 §14 "통합 리뷰 체크" 항목을 명시적으로 지시:
target ref 외 생성 / scene effectiveStyleId 누수 / queue overrideStyleId 누락 / stale scene·ref closure / failure 모달 중 latch 유지 / scan set과 final sceneIds 일치 / M2 sceneIds가 partial retry로 오인 / M1 토스트 중복 / Flow character 이중 sync.
findings 0이 될 때까지 수정 루프. **리뷰어에게 모든 앵커를 직접 열어 대조하라고 명시할 것.**

- [ ] **Step 4: 실앱 눈검증 (사용자)**

리뷰어는 "버튼이 안 보인다"를 못 잡는다. 사용자가 직접:
1. Flow 모드 + 실제 Flow 로그인
2. 프롬프트 있는 빈 캐릭터 카드 생성 → 씬에서 멘션(`@이름`) 또는 태그로 참조
3. 씬 목록 배치 생성 클릭 → **모달이 뜨는지**
4. "빈카드 먼저 생성" → ref가 생성되고 → 씬 배치가 이어서 시작되는지
5. 생성된 캐릭터가 씬에 실제로 반영되는지(멘션 해석)
6. 프롬프트 없는 빈카드만 있을 때 "먼저 생성"이 비활성인지
7. "제외하고 씬만 생성" → M1 토스트 뜨고 씬만 생성되는지

- [ ] **Step 5: Commit (필요 시)**

```bash
git add -u
git commit -m "test: verify M2 acceptance criteria across full suite"
```

---

## Self-Review

**스펙 커버리지**: §2 UX→Task 8, §4 감지→Task 1·2, §5 targeted batch→Task 4·5, §6 orchestration→Task 6·7·9, §7 모달 상태/latch→Task 7·8, §8 sync/M1/토스트→Task 7, §9 실행순서→Task 7, §10 postcondition→Task 6·7, §11 엣지케이스→Task 4·5·7, §12 변경파일→전 태스크, §15 수용기준→Task 10.

**미커버 항목과 처리**:
- §13 Task 6 시나리오 A~F → Task 7로 재배치(위 "계약 변경" #1). App mount 테스트 없음.
- §11.12 API 모드 미노출 → Task 9에서 direct 경로 진입 조건이 `modeRef.current === 'flow'`임을 유지(기존 `:1487` 조건 재사용). Task 9 wiring 테스트에 포함할 것.
- §11.8 StylePicker 재진입 → 기존 `pendingStyleForceRef`(`:1437`)가 force를 보존하고 재진입은 `handleStart`를 다시 타므로 M2 guard를 다시 통과한다. Task 9 wiring 테스트에서 "StylePicker Proceed가 coordinator를 우회하지 않는다"를 확인할 것.
