# AutoFlowCut M2 설계 스펙: 씬 배치 생성 전 참조된 빈 Reference Card 자동 생성

- 대상 리포지토리: `/Users/tuxxon/workspace/AutoFlowCut-main`
- 기준 브랜치: `feature/ref-image-guard-m1`
- 선행 상태: M1 완료
- 문서 상태: Fable 5 리뷰 findings 14건(기존 9 + 신규 5) 전체 반영
- 구현 범위: 설계 전용. 본 문서 작성 과정에서 코드·파일을 변경하지 않음.
- 참고: M2a(동기화 유도) 스펙은 "Flow 생성=자동 동기화" 확인으로 보류. 이 M2가 새 방향.

---

## 1. 배경

### 1.1 문제

Flow 이미지 씬 생성에서 씬이 참조하는 Reference Card에 실제 이미지 소스가 전혀 없으면, 해당 ref를 Flow 요청에 주입하는 과정에서 서버 오류가 발생할 수 있다.

M1은 이런 ref를 씬 생성 입력에서 제외하고 토스트로 알리는 방식으로 Flow 500을 방지한다.

현재 M1 진입점은 이미지 배치 시작 대상에 대해 `collectM1FlowReferenceExclusions`를 호출하는 부분이다.

- 이미지 배치 대상 계산 및 M1 호출: `src/App.jsx:1314-1352`
- M1 제외 토스트 생성: `src/App.jsx:1471`
- direct 경로 M1 토스트 및 sync gate: `src/App.jsx:1485-1517`
- tag-validation Proceed 경로의 M1/sync 처리: `src/App.jsx:1751-1824`
- M1 분류 구현: `src/utils/refImageGuard.js:35-91`

M2는 M1을 제거하는 기능이 아니다. 씬이 참조한 빈카드 중 생성 가능한 카드를 먼저 채운 뒤 씬 배치를 시작할 수 있게 하는 상위 UX다.

### 1.2 M1과 M2의 관계

M2 모달의 두 번째 액션인 **"제외하고 씬만 생성"은 정확히 M1 기존 동작**이다.

M2에서 먼저 ref 생성을 선택해도 다음 이유로 M1은 최종 씬 시작 직전에 다시 실행해야 한다.

- 프롬프트가 없어 생성하지 못한 빈카드가 남을 수 있다.
- ref 배치 중 ref가 삭제·변경될 수 있다.
- ref 배치나 sync gate 중 MCP가 씬 프롬프트·태그를 수정할 수 있다.
- 처음 감지되지 않았던 새 빈카드 참조가 기존 대상 씬에 추가될 수 있다.
- 일부 ref는 이미지가 생겼어도 Flow에서 사용할 수 없는 상태일 수 있다.

따라서 M2의 최종 안전망은 계속 M1이며, M2는 "가능하면 먼저 채우고, 남은 문제는 M1로 제외한다"는 구조다.

### 1.3 Flow character 자동 동기화 근거

Flow 모드에서 character ref를 생성하면 별도 M2 동기화 작업을 추가할 필요가 없다.

- Flow character 생성은 `runFlowCharacterOperation`의 `generate-character` 작업으로 실행된다: `src/hooks/useReferenceGeneration.js:337-352`
- 생성 응답 전체가 `_processAndSaveImage`에 전달된다: `src/hooks/useReferenceGeneration.js:309-313`
- `_processAndSaveImage`는 응답의 `entityId`, `workflowId`, `registered` 등을 `entityPatchForNewImage`로 카드에 반영한다: `src/hooks/useReferenceGeneration.js:140-143`, `src/hooks/useReferenceGeneration.js:213-225`
- 저장 직후 `referencesRef.current`도 동기 갱신된다: `src/hooks/useReferenceGeneration.js:226-230`

따라서 targeted ref batch가 성공하면 해당 character는 생성과 동시에 Flow entity 정보까지 카드에 반영된다. M2 전용 재업로드나 강제 sync를 추가하지 않는다.

---

## 2. 확정 UX

### 2.1 트리거

M2 빈카드 가드는 다음 조건에서만 실행한다.

- `text` 또는 `list` 탭
- 씬 목록의 이미지 배치 생성 버튼
- 일반 배치와 `force=true` 배치 모두 포함
- UI `handleStart` 이미지 배치 경로

제외 대상:

- 개별 씬 재생성
- `handleGenerateScene`
- ref 탭의 개별 ref 생성
- ref 탭의 수동 전체 생성
- MCP가 직접 시작한 씬 배치 자체에는 M2 모달을 새로 표시하지 않음

현재 이미지 배치 분기는 `src/App.jsx:1318-1322`, `src/App.jsx:1412-1524`에 있다.

### 2.2 빈카드 정의

씬이 멘션 또는 태그로 참조하는 Reference Card 중 아래 네 필드가 모두 없는 카드다.

```js
!ref.data &&
!ref.filePath &&
!ref.imagePath &&
!ref.mediaId
```

기존 술어로는 다음과 같이 표현한다.

```js
!sourceAvailable(ref) && !flowImageInjectable(ref)
```

근거:

- `sourceAvailable`: `data || filePath || imagePath` — `src/utils/refImageGuard.js:5-7`
- `flowImageInjectable`: `mediaId` — `src/utils/refImageGuard.js:9-11`

`status`, `entityId`, `workflowId`, `registered`만으로는 이미지가 있다고 판단하지 않는다.

### 2.3 감지 시 모달

빈카드가 하나 이상 감지되면 배치 시작당 모달을 한 번 표시한다.

목록 행:

- 카드 이름
- 카드 타입
- 참조한 씬 번호 또는 참조 씬 수
- 프롬프트가 없으면 `⚠ 프롬프트 없음 — 자동 생성 제외` 표시

확인 상태의 액션은 리스트형 3버튼으로 고정한다.

1. **빈카드 먼저 생성 → 씬 생성**
2. **제외하고 씬만 생성**
3. **취소**

### 2.4 액션 의미

#### 빈카드 먼저 생성 → 씬 생성

- 모달을 연 시점의 카드 객체를 그대로 생성하지 않는다.
- 클릭 시 live scenes와 live references로 빈카드를 다시 판정한다.
- 그중 프롬프트가 있는 빈카드만 targeted ref batch에 전달한다.
- targeted batch 완료를 `await`한다.
- batch 결과와 App postcondition이 모두 성공해야 씬 파이프라인으로 진행한다.
- ref 실패, 사용자 중단, timeout, coordinator busy 또는 postcondition 실패가 하나라도 있으면 씬 생성은 시작하지 않는다.
- 실패 시 모달을 닫지 않고 failure 상태로 전환한다.

#### 제외하고 씬만 생성

- 실행 시점 live scenes/live references로 M1 제외 집합을 다시 계산한다.
- 빈카드를 생성하지 않는다.
- M1 제외 목록과 멘션 제거 맵을 적용해 씬 배치를 진행한다.
- 즉, 기존 M1 동작과 동일하다.

#### 취소

- ref와 씬을 모두 생성하지 않는다.
- pending latch와 모달 상태를 해제한다.

### 2.5 프롬프트가 없는 카드만 남은 경우

프롬프트가 있는 live 빈카드가 0개면 첫 번째 버튼을 비활성화한다.

안내 문구:

> 자동 생성 가능한 빈카드가 없습니다. 프롬프트를 추가하거나 "제외하고 씬만 생성"을 선택하세요.

프롬프트 없는 카드는 targeted batch에 넣지 않는다.

### 2.6 실패 상태 UX

Failure 상태에서는 다음을 표시한다.

- 실패 또는 중단 요약
- 카드별 실패 stage와 원인
- 씬 배치가 시작되지 않았다는 명시적 안내
- `확인` 버튼

`확인`으로 failure 모달을 닫을 때만 M2가 보유한 `hasPendingBatch` latch를 해제한다. Failure 상태에서 자동으로 씬 생성을 재개하지 않는다.

---

## 3. 적용 모드

### 3.1 M2 UI는 Flow 모드 우선 적용

M2 모달은 이번 범위에서 Flow 모드에만 적용한다.

근거:

- M1의 500 방지 exclusion 자체가 `mode === 'flow'`일 때만 계산된다: `src/App.jsx:1342-1351`
- M1의 가용성 판정은 Flow image/entity 주입 조건을 중심으로 구성돼 있다: `src/utils/refImageGuard.js:13-30`
- 확정 요구사항은 M1의 "제외" 대신 빈카드를 "채워서" 해결하는 기능이다.

### 3.2 API 모드

Targeted ref batch 기반은 API 모드에서도 기술적으로 재사용할 수 있지만, 이번 M2에서는 API 모드에 빈카드 모달을 노출하지 않는다.

API 모드의 오류 조건, 비용 UX, 이미지 없는 ref 처리 계약이 Flow와 동일하다는 코드 근거가 충분하지 않기 때문이다. API 확대는 별도 범위로 유보한다.

### 3.3 모드 변경 방어

모달 또는 ref batch 대기 중 시작 모드와 현재 모드가 달라지면 씬 배치를 시작하지 않는다.

현재 tag-validation 경로도 모달 도중 mode/project 변경을 재검증한다: `src/App.jsx:1751-1788`.

M2도 동일한 원칙을 사용한다.

---

## 4. 빈카드 감지 설계

### 4.1 순수 술어

`src/utils/refImageGuard.js`에 다음 술어를 추가한다.

```js
export function isReferenceImageEmpty(ref) {
  return !sourceAvailable(ref) && !flowImageInjectable(ref)
}
```

별도 필드 검사를 여러 위치에 복제하지 않는다.

### 4.2 안정적인 ref key

Targeted batch와 dedup에 사용할 key:

```js
export function referenceGuardKey(ref) {
  if (ref?.id != null) return `id:${String(ref.id)}`
  return `${ref?.type || ''}:${normalizeTagKey(ref?.name)}`
}
```

원칙:

- `id`가 있으면 `id`가 authoritative key다.
- `id`가 없는 legacy ref만 `type + normalized name`을 fallback으로 사용한다.
- 배열 index는 MCP merge/reorder 중 바뀔 수 있으므로 외부 계약에 사용하지 않는다.

M1도 `id`, 아니면 `type + normalized name`으로 dedup한다: `src/utils/refImageGuard.js:31-33`.

### 4.3 collector 계약

추가 순수 함수 예시:

```js
collectReferencedEmptyCards(
  scenes,
  getMatchingReferences,
  options = {}
)
```

반환 형태:

```js
{
  cards: [
    {
      key,
      ref,
      hasPrompt,
      occurrences: [
        { sceneId, sceneIndex }
      ]
    }
  ],
  generatableCards,
  missingPromptCards
}
```

동작:

1. `options.filter`를 통과한 씬만 처리한다.
2. 각 씬에서 `getMatchingReferences(scene)`를 호출한다.
3. `isReferenceImageEmpty(ref)`인 ref만 선택한다.
4. stable ref key로 전체 씬에 걸쳐 dedup한다.
5. 같은 카드가 여러 씬에서 참조되면 `occurrences`만 누적한다.
6. 원본 씬 index를 유지해 UI의 `#N` 표시가 실제 씬 번호와 일치하게 한다.

### 4.4 멘션과 태그 수집

기존 `getMatchingReferences`를 단일 수집 소스로 재사용한다.

현재 함수는 다음 합집합을 반환한다.

- `characters` 태그: `src/hooks/useScenes.js:602-610`
- `scene_tag`: `src/hooks/useScenes.js:612-620`
- `style_tag`: `src/hooks/useScenes.js:622-632`
- prompt의 `@mention`: `src/hooks/useScenes.js:634-644`

태그 분리는 콤마·세미콜론·콜론을 지원한다: `src/utils/tagMatch.js:13-16`.

멘션은 case-insensitive name map으로 해석한다: `src/utils/mentionParser.js:80-103`.

따라서 collector가 멘션과 태그를 별도로 다시 파싱하지 않는다. 기존 scene-to-reference 해석과 동일한 결과를 사용한다.

### 4.5 `getMatchingReferences` live override

현재 `getMatchingReferences`는 hook closure의 `references`만 사용한다.

- 현재 시그니처와 초입 guard: `src/hooks/useScenes.js:597-598`
- 내부 전체 루프와 멘션 해석도 closure `references` 사용: `src/hooks/useScenes.js:602-644`

다음처럼 optional pool을 받도록 확장한다.

```js
const getMatchingReferences = useCallback(
  (scene, referencePool = references) => {
    if (!scene || referencePool.length === 0) return []

    // 모든 태그 loop와 resolveMentions에 referencePool 사용
  },
  [references]
)
```

중요한 수정:

```diff
- if (!scene || references.length === 0) return []
+ if (!scene || referencePool.length === 0) return []
```

초입 guard가 계속 `references.length`를 사용하면 live override가 있어도 closure 배열이 비어 있는 순간 override가 무력화된다.

### 4.6 App의 matcher 전달 계약

Collector들은 기존과 같이 `getMatchingReferences(scene)` 1인자 호출을 유지한다.

App은 판정에 사용할 authoritative refs를 명시적으로 캡처한 wrapper를 전달한다.

```js
const matchWithRefs = scene =>
  scenesHook.getMatchingReferences(scene, authoritativeRefs)

collectReferencedEmptyCards(
  liveTargetScenes,
  matchWithRefs
)
```

M1 계산에도 같은 wrapper를 전달한다.

```js
collectM1FlowReferenceExclusions(
  liveScenes,
  scene => scenesHook.getMatchingReferences(scene, authoritativeRefs),
  { filter }
)
```

이 계약으로 collector 자체는 단순하게 유지하면서 stale reference closure를 피한다.

---

## 5. Targeted ref batch 설계

### 5.1 현재 제한

현재 `_executeBatchRefs`는 `pickIndices`에서 전체 references의 pending ref를 선택한다.

- 실행 함수: `src/hooks/useReferenceGeneration.js:409`
- 전체 pool 순회: `src/hooks/useReferenceGeneration.js:411-418`
- style/non-style 전체 pending 집합 구성: `src/hooks/useReferenceGeneration.js:419-421`

따라서 현재 공개 API만으로 "씬이 참조한 특정 빈카드만" 생성할 수 없다. `targetRefKeys` 옵션이 필요하다.

### 5.2 새 options 계약

```js
{
  force?: boolean,
  targetRefKeys?: string[] | null,
  reason?: 'manual' | 'm2-empty-reference-gate'
}
```

의미:

- `targetRefKeys == null`: 기존 Ref 탭 전체 배치와 MCP 전체 ref batch
- `targetRefKeys`가 배열: 해당 key에 속하는 ref만 대상
- 빈 배열: targeted 정상 noop
- M2는 `force:false`
- `reason`은 토스트·로깅·결과 분기를 위한 식별자이며 생성 의미를 바꾸지 않는다.

### 5.3 시그니처와 스타일 계약

내부 시그니처:

```js
const _executeBatchRefs = async (
  overrideStyleId = null,
  options = {}
) => {
  const {
    force = false,
    targetRefKeys = null,
    reason = 'manual',
  } = options
}
```

M2 호출:

```js
await handleGenerateAllRefs(null, {
  force: false,
  targetRefKeys,
  reason: 'm2-empty-reference-gate',
})
```

M2 targeted batch의 스타일은 **Ref 탭의 수동 배치와 동일하게 해석**한다.

- `overrideStyleId`는 `null`
- `_resolveEffectiveStyleId`의 기존 UI 선택 및 auto-fallback chain을 그대로 사용
- 씬 배치용 `context.effectiveStyleId`는 전달하지 않음
- 씬 스타일의 `'none'`, preset, ref, null 의미를 targeted ref batch에 투영하지 않음

Ref batch 스타일 해석은 `_resolveEffectiveStyleId`에서 독립적으로 수행된다: `src/hooks/useReferenceGeneration.js:233-252`.

### 5.4 대상 선택

Targeted 모드의 선택 조건:

```js
const targetKeySet = targetRefKeys
  ? new Set(targetRefKeys)
  : null

const pickIndices = refMatches =>
  referencesRef.current
    .map((ref, index) => {
      if (!refMatches(ref)) return -1
      if (targetKeySet && !targetKeySet.has(referenceGuardKey(ref))) return -1
      if (!ref.prompt) return -1

      if (force) return index

      return isReferenceImageEmpty(ref) &&
        ref.status !== 'done'
        ? index
        : -1
    })
    .filter(index => index !== -1)
```

Targeted batch는 실행 시점 `referencesRef.current`를 기준으로 다시 선택한다.

- 모달 이후 이미 이미지가 생긴 카드는 정상 skip
- 삭제된 카드는 `not-found`
- 프롬프트가 사라진 카드는 `missing-prompt`
- target 외 pending ref는 생성하지 않음

Global/manual 배치는 기존 pending 의미를 보존해야 하므로 targeted와 global 선택 조건을 분리해도 된다.

### 5.5 기존 2-phase 순서 보존

Targeted 집합 안에서도 현재 순서를 유지한다.

1. style ref phase
2. non-style ref phase

현재 구현은 style phase 종료 후 non-style의 effective style을 계산하므로, 방금 생성한 style ref가 auto-fallback에 사용될 수 있다: `src/hooks/useReferenceGeneration.js:719-728`.

### 5.6 구조화 결과

`_executeBatchRefs`와 `handleGenerateAllRefs`는 다음 결과를 반환한다.

```js
{
  ok: boolean,
  outcome: 'completed' | 'noop' | 'failed' | 'stopped',
  requestedKeys: string[],
  attemptedKeys: string[],
  succeededKeys: string[],
  skipped: [
    {
      key,
      stage:
        'already-filled' |
        'missing-prompt' |
        'not-found' |
        'not-eligible',
    }
  ],
  failed: [
    {
      key,
      stage:
        'permission' |
        'auth' |
        'flow-ready' |
        'prepare' |
        'submit' |
        'collect' |
        'save' |
        'timeout' |
        'busy' |
        'exception',
      error,
    }
  ],
  currentRefs: referencesRef.current,
}
```

`ok=true` 조건:

1. 사용자 중단이 아님
2. `failed.length === 0`
3. 실행 시점에 생성 가능한 target은 모두 성공하거나 이미 이미지가 있어 정상 skip
4. target 전체가 이미 채워져 있으면 `outcome:'noop'`, `ok:true`

`missing-prompt`는 실행 시점의 "생성 가능한 target"에서 빠지므로 batch 자체는 `ok:true`가 될 수 있다. 그러나 여전히 씬이 참조하는 빈 target이면 App postcondition이 이를 잡아 failure 모달로 전환한다.

Flow character coordinator가 busy를 반환하면 다음처럼 집계한다.

```js
{
  key,
  stage: 'busy',
  error: coordinated.error
}
```

현재 busy 반환 경로: `src/hooks/useReferenceGeneration.js:337-350`.

### 5.7 완료 대기

현재 ref batch는 fire-and-forget으로 submit한 뒤 내부 polling으로 수집을 완료할 때까지 함수가 종료되지 않는다.

- 완료 상태 polling과 후처리: `src/hooks/useReferenceGeneration.js:482-562`
- 남은 generation의 최대 180초 대기: `src/hooks/useReferenceGeneration.js:670-680`
- timeout/stop 정리: `src/hooks/useReferenceGeneration.js:682-708`
- batch lifecycle flag 정리: `src/hooks/useReferenceGeneration.js:734-739`

M2는 별도 외부 polling을 만들지 않는다. `handleGenerateAllRefs`가 `_executeBatchRefs`의 구조화 결과를 반환하도록 고쳐 기존 내부 polling promise를 그대로 `await`한다.

### 5.8 queue wrapper의 override pass-through

`handleGenerateAllRefs`는 첫 번째 인자인 `overrideStyleId`를 queue 경유 여부와 관계없이 그대로 전달해야 한다.

```js
const handleGenerateAllRefs = async (
  overrideStyleId = null,
  options = {}
) => {
  if (!generationQueue) {
    return _executeBatchRefs(overrideStyleId, options)
  }

  try {
    return await generationQueue.enqueue({
      type: 'reference_batch',
      label: 'Batch References',
      execute: () => _executeBatchRefs(overrideStyleId, options),
    })
  } catch (error) {
    return {
      ok: false,
      outcome: 'failed',
      failed: [{
        key: null,
        stage: 'exception',
        error: error.message,
      }],
      currentRefs: referencesRef.current,
    }
  }
}
```

`_executeBatchRefs(null, options)`로 하드코딩하면 MCP가 전달한 명시 스타일이나 `'none'`이 조용히 사라진다.

MCP는 현재 첫 번째 인자로 명시 style을 전달한다: `src/hooks/useMcpServer.js:509-513`.

M2 호출자만 `overrideStyleId=null`을 사용한다. Global/manual/MCP 계약은 그대로 보존한다.

### 5.9 targeted noop 토스트

현재 전체 대상이 0개면 `toast.allRefsGenerated`를 표시한다: `src/hooks/useReferenceGeneration.js:423-426`.

Targeted M2에서 모든 target이 이미 채워진 정상 noop이면 이 토스트를 표시하지 않는다. 모달 흐름 중 전체 Ref 탭 배치가 끝났다는 인상을 주기 때문이다.

정책:

- global/manual 대상 0개: 기존 `allRefsGenerated` 토스트 유지
- M2 targeted 대상 0개, 전부 already-filled: 토스트 없음
- M2 targeted 실패 또는 postcondition 실패: failure 모달이 단일 사용자 피드백 소스

---

## 6. App orchestration

### 6.1 실행 context

이미지 배치 preflight가 완료되면 다음 context를 만든다.

```js
{
  startMode,
  projectName,
  force,
  initialTargetSceneIds,
  selectedStyleRefId,
  startOptionsWithoutSceneIds,
}
```

`initialTargetSceneIds`는 첫 Start 의도를 잠근 membership 경계다. 씬 객체 자체는 저장하지 않는다.

### 6.2 authoritative live-source 계약

Continuation은 모달을 연 뒤 수 분 후 실행될 수 있으므로 `handleStart` 시점 closure의 `scenes`나 `references`를 판정에 사용하지 않는다.

#### ref 판정 소스

- M2 진입 전 또는 "제외하고 진행" 경로: 액션 실행 시점 `referencesRef.current`
- targeted batch 성공 직후:
  - 빈카드 재확인
  - M1 재계산
  - sync gate 후보 선정
  모두 `batchResult.currentRefs`
- sync gate Proceed 시작점:
  - `patchedRefs = referencesRef.current`
  - 즉, Proceed 버튼을 누른 시점의 최신 refs
- sync loop 중:
  - 각 ref마다 `referencesRef.current`에서 다시 조회
- sync 완료 후:
  - 누적 patch가 적용된 `patchedRefs`

`syncGate.currentRefs`는 저장하지 않는다. Gate 렌더 시점 snapshot은 Proceed 시점에는 stale할 수 있다.

현재 sync loop도 각 ref마다 `referencesRef.current`를 다시 읽는다: `src/App.jsx:1858-1865`.

#### scene 판정 소스

다음 모든 scene 판정은 `scenesRef.current` 또는 동등한 live 재조회 결과를 사용한다.

- 빈카드 수집
- M1 재계산
- sync 후보 씬 구성
- postcondition
- 새로 추가된 ref 참조의 최종 제외
- 최종 `sceneIds` 확정

초기 scene 객체 배열을 continuation closure에 저장하지 않는다.

### 6.3 live target membership

공통 helper:

```js
function resolveLiveTargetScenes(context, liveScenes) {
  const intendedIds = new Set(context.initialTargetSceneIds)

  const liveIntendedScenes = liveScenes.filter(scene =>
    intendedIds.has(scene.id)
  )

  return context.force
    ? liveIntendedScenes.filter(scene => scene.prompt)
    : filterPendingScenes(liveIntendedScenes)
}
```

이 결과를 이하 `liveTargetScenes`라고 한다.

계약:

- 스캔 집합과 최종 생성 집합은 같은 helper 결과를 사용한다.
- 게이트 중 MCP가 새로 추가한 씬은 `initialTargetSceneIds`에 없으므로 생성하지 않는다.
- non-force 배치에서 게이트 중 완료된 씬은 `filterPendingScenes`에서 빠져 재생성하지 않는다.
- force 배치는 최초 의도에 포함된 씬 중 실행 시점에도 prompt가 있는 씬만 생성한다.

### 6.4 공통 continuation

Direct 경로와 TagValidation Proceed 경로가 다음 공통 함수를 호출한다.

```js
continueImageBatchWithM2(context)
```

이 함수는:

1. mode/project invariant 재검증
2. live target 재계산
3. live references를 사용한 빈카드 수집
4. 빈카드가 없으면 M1/sync/launch continuation
5. 빈카드가 있으면 subscription 사전 gate
6. gate 통과 후 `hasPendingBatch=true`
7. empty-ref 모달 open

TagValidation Proceed는 과거에 계산한 M1 map이나 target scene 객체를 재사용하지 않는다.

### 6.5 "먼저 생성" continuation

클릭 시 순서:

1. mode/project invariant 재검증
2. `scenesRef.current`로 live target 재계산
3. `referencesRef.current`로 빈카드 재수집
4. 프롬프트가 있는 target key 추출
5. 모달을 `busy`로 전환
6. 다음 호출을 `await`

```js
const batchResult = await handleGenerateAllRefs(null, {
  force: false,
  targetRefKeys,
  reason: 'm2-empty-reference-gate',
})
```

7. `batchResult.ok !== true`이면 failure 상태로 전환
8. `batchResult.currentRefs`와 실행 시점 live scenes로 §10 postcondition 평가
9. postcondition 실패면 failure 상태로 전환
10. postcondition 통과 후에만 empty-ref 모달을 닫음
11. latch는 유지한 채 M1/sync/scene continuation으로 ownership 이전

### 6.6 subscription 사전 gate

Subscription 사전 gate는 **빈카드가 감지된 경우에만**, 모달을 열기 직전에 실행한다.

일반 이미지 배치의 기존 login/paywall 시점을 바꾸지 않는다.

분기:

- `login`: 로그인 모달을 열고 M2 모달을 열지 않음
- `paywall`: paywall을 열고 M2 모달을 열지 않음
- `loading`: 기존 subscription loading 안내 후 M2 모달을 열지 않음
- `proceed`: `hasPendingBatch=true` 후 M2 모달 open

이 사전 gate는 quota를 consume하지 않는다. 최종 `useAutomation.start()`의 기존 gate와 consume 절차는 유지한다.

M2는 논리적으로 full scene batch이므로 사전 gate의 `isReusingBatch`는 `false`다.

현재 실제 subscription gate와 세 분기:

- reuse 판정: `src/hooks/useAutomation.js:518-522`
- login/paywall/loading 처리: `src/hooks/useAutomation.js:522-543`

### 6.7 최종 scene start

최종 launch 직전 다시 live target을 계산한다.

```js
const liveTargetScenes = resolveLiveTargetScenes(
  context,
  scenesRef.current
)

const finalStartOptions = {
  ...context.startOptionsWithoutSceneIds,
  sceneIds: liveTargetScenes.map(scene => scene.id),
  force: context.force,
  batchIntent: 'full',
  currentRefs: authoritativeRefs,
  m1ExcludedMentionNamesBySceneId,
}
```

`sceneIds`를 명시하지 않으면 `useAutomation.start()`가 실행 시점 전체 scenes에서 대상을 다시 계산해, M2 스캔을 받지 않은 새 씬을 포함할 수 있다.

반대로 `sceneIds`만 명시하면 현재 `useAutomation`은 pending filter를 다시 적용하지 않는다: `src/hooks/useAutomation.js:496-502`.

따라서 App에서 force/pending 필터를 적용한 최종 ID를 명시적으로 확정해야 한다.

### 6.8 `batchIntent:'full'`

현재 `useAutomation`은 `sceneIds || sceneIndices`만으로 부분 retry라고 추론한다.

- subscription reuse 판정: `src/hooks/useAutomation.js:518-522`
- batch ID partial 판정: `src/hooks/useAutomation.js:734-737`
- full/partial batch ID 의미: `src/utils/batchId.js:5-20`

M2는 membership 고정을 위해 `sceneIds`를 전달하지만 논리적으로는 새 full batch다. 그대로 두면 이전 batch ID를 재사용하거나 paywall을 우회하는 잘못된 의미가 된다.

`useAutomation.start()`에 optional `batchIntent`를 추가한다.

```js
const inferredPartialRetry = !!(sceneIds || sceneIndices)

const isPartialRetry =
  batchIntent === 'retry' ||
  (batchIntent == null && inferredPartialRetry)
```

동일한 `isPartialRetry`를 다음 두 곳에 사용한다.

- subscription `isReusingBatch`
- `resolveProjectBatchId`

호환 정책:

- M2: `batchIntent:'full'`
- 기존 retry 호출: 필요하면 `batchIntent:'retry'`
- `batchIntent`를 전달하지 않는 기존 호출: 현재 `sceneIds/sceneIndices` 추론 보존

### 6.9 start 최신 함수

Ref batch나 모달 이후 실행되는 scene start는 과거 render의 `start` closure를 직접 호출하지 않는다.

```js
automationStartRef.current(finalStartOptions)
```

`automationStartRef`는 매 render 최신 `start`를 가리켜야 한다.

### 6.10 최종 대상 0개

최종 live target이 0개면:

- scene start를 호출하지 않음
- M2 모달을 닫음
- `hasPendingBatch=false`
- 기존 `allScenesGenerated` 또는 동등한 단일 안내 표시

이는 non-force 게이트 중 다른 경로에서 모든 대상 씬이 완료된 정상 상황이다.

---

## 7. 모달 상태와 전환

### 7.1 상태 모델

```js
const [emptyRefGate, setEmptyRefGate] = useState(null)
```

```js
{
  phase: 'confirm' | 'busy' | 'failure',
  context,
  items,
  failure: null | {
    outcome,
    failures,
  }
}
```

`items`는 렌더용 snapshot이다. 버튼 액션의 authoritative 판정에는 사용하지 않는다.

### 7.2 상태 전환표

| 현재 상태 | 이벤트 | 다음 상태 | `hasPendingBatch` | 씬 시작 |
|---|---|---|---:|---:|
| 없음 | live 빈카드 없음 | M1/sync continuation | 기존 launch 시점 계약 | 가능 |
| 없음 | 빈카드 감지 + subscription 통과 | `confirm` | `true` | 금지 |
| `confirm` | 먼저 생성 | `busy` | `true` | 금지 |
| `busy` | batch 실패 | `failure` | `true` | 금지 |
| `busy` | batch stopped | `failure` | `true` | 금지 |
| `busy` | batch `ok=true`, postcondition 실패 | `failure` | `true` | 금지 |
| `busy` | batch + postcondition 성공 | 모달 close, M1/sync continuation | `true`, ownership 이전 | 조건부 |
| `confirm` | 제외하고 진행 | 모달 close, M1/sync continuation | `true`, ownership 이전 | 조건부 |
| `confirm` | 취소 | 없음 | `false` | 금지 |
| `failure` | 확인/close | 없음 | `false` | 금지 |
| continuation | mode/project 불일치 | `failure` 또는 안전 중단 | failure 표시 중 `true` | 금지 |
| continuation | final target 0 | 없음 | `false` | 금지 |
| continuation | scene start promise 종료 | 없음 | `false` | 완료 |

### 7.3 pending latch ownership

빈카드 모달을 열 때 M2가 `hasPendingBatch=true`를 획득한다.

다음 동안 계속 `true`를 유지한다.

- confirm 모달 표시
- targeted ref batch 실행
- targeted ref batch stopped/failure 모달 표시
- postcondition failure 모달 표시
- M1 계산
- M2가 연 sync gate
- scene batch queue/start

해제 시점:

- confirm에서 취소
- failure 모달의 확인/close
- continuation이 안전하게 중단되고 사용자에게 실패 상태를 표시한 뒤 close
- final target이 0개
- scene batch promise의 `finally`

Failure/stopped 발생 직후 `false`로 바꾸지 않는다. Failure 모달이 열린 동안은 반드시 `true`다.

### 7.4 sync gate ownership 이전

M2 continuation이 sync gate를 열면 다음 형태를 사용한다.

```js
setSyncGate({
  refs: unsyncedMentioned,
  proceed: patchedRefs => continueToFinalLaunch(patchedRefs),
  onCancel: () => releaseM2PendingLatch(),
})
```

`handleSyncGateCancel`은 M2가 제공한 `onCancel`을 호출한 뒤 gate를 닫는다.

기존 비-M2 sync gate에는 `onCancel`이 없어도 된다.

---

## 8. Sync gate와 M1의 관계

### 8.1 순서

M2 결정 이후 순서는 다음으로 고정한다.

1. live target 계산
2. authoritative refs 선택
3. M1 재계산
4. M1 mention exclusion 적용
5. 남은 mention 중 unsynced 후보 선정
6. sync gate
7. final launch 직전 live target과 M1 재계산
8. scene start

빈카드는 M1에서 먼저 제외되므로 sync gate가 생성 불가능한 빈 character를 동기화하려 하지 않는다.

### 8.2 sync Proceed의 authoritative refs

`handleSyncGateProceed` 시작 시:

```js
let patchedRefs = referencesRef.current
```

현재 코드의 `scenesHook.references` seed는 Proceed 시점 live ref로 교체한다: `src/App.jsx:1835-1845`.

`syncGate.currentRefs`는 저장하거나 우선하지 않는다.

각 loop iteration은 기존처럼 `referencesRef.current`에서 해당 ref를 다시 읽는다: `src/App.jsx:1858-1865`.

성공 patch는 `patchedRefs`에 누적하고, 최종 `proceed(patchedRefs)`로 다음 단계에 전달한다: `src/App.jsx:1885-1905`.

### 8.3 토스트 정책

M1 exclusion 토스트는 최종 scene launch에서 실제로 적용되는 최종 M1 결과에 대해 한 번만 표시한다.

표시하지 않는 경우:

- M2 모달 confirm 상태
- targeted ref batch 성공
- targeted 정상 noop
- postcondition 실패
- scene batch가 시작되지 않은 failure/stopped

표시하는 경우:

- "제외하고 씬만 생성"에서 최종 M1 exclusion이 존재
- "먼저 생성" 성공 후에도 프롬프트 없는 카드 또는 새 unusable ref가 남아 최종 M1이 제외
- sync 이후 final launch 재계산에서 새 exclusion이 생김

---

## 9. 전체 실행 순서

### 9.1 공통 이미지 배치 진입

1. `handleStart`/`startInFlightRef` 중복 진입 차단
2. `text`/`list` 이미지 배치 여부 확인
3. 최초 대상 계산
   - force: prompt 있는 씬
   - non-force: `filterPendingScenes`
4. `initialTargetSceneIds` 저장
5. 기존 mention/tag merge 수행
6. auth/folder/Flow-ready/style preflight 수행
7. StylePicker가 필요하면 force/context를 보존하고 재진입
8. TagValidation 오류가 있으면 context만 보존하고 모달 표시
9. direct 또는 TagValidation Proceed가 동일한 `continueImageBatchWithM2` 호출
10. live scenes/live refs로 target과 빈카드 재계산
11. 빈카드가 있을 때만 subscription 사전 gate
12. gate 통과 후 `hasPendingBatch=true`, M2 모달 open
13. 사용자 선택 처리
14. M1/sync continuation
15. final live target과 final M1 재계산
16. `finalStartOptions.sceneIds`와 `batchIntent:'full'` 확정
17. scene batch 시작
18. promise `finally`에서 latch 해제

### 9.2 direct 경로

TagValidation 오류가 없으면 기존 코드에서 바로 M1/sync/start로 가지 않고 `continueImageBatchWithM2(context)`로 진입한다.

### 9.3 TagValidation Proceed 경로

Proceed 시 다음을 재검증한다.

- mode
- project
- auth
- Flow-ready
- live target
- live references
- 빈카드
- M1
- sync 후보

과거 `pendingStartOptions`에 저장된 M1 map, ref 배열 또는 scene 객체를 재사용하지 않는다.

### 9.4 "먼저 생성" 이후

```text
targeted ref batch
  → batchResult
  → App postcondition
  → live M1
  → optional sync gate
  → final live M1
  → final sceneIds
  → scene batch
```

### 9.5 "제외하고 진행" 이후

```text
live refs/live scenes
  → live M1
  → optional sync gate
  → final live M1
  → final sceneIds
  → scene batch
```

---

## 10. Fail-closed postcondition

### 10.1 원칙

`batchResult.ok === true`만으로 씬 배치를 시작하지 않는다.

App은 empty-ref 모달을 닫기 전에 독립 postcondition을 수행한다.

### 10.2 검사 소스

- refs: `batchResult.currentRefs`
- scenes: postcondition 실행 시점 `scenesRef.current`
- targets: `resolveLiveTargetScenes(context, liveScenes)`
- matcher: `(scene) => getMatchingReferences(scene, batchResult.currentRefs)`

### 10.3 unresolved target 계산

```js
const liveEmptyResult = collectReferencedEmptyCards(
  liveTargetScenes,
  scene => scenesHook.getMatchingReferences(
    scene,
    batchResult.currentRefs
  )
)

const requestedKeySet = new Set(batchResult.requestedKeys)

const unresolvedGeneratedTargets =
  liveEmptyResult.cards.filter(card =>
    requestedKeySet.has(card.key)
  )
```

다음 중 하나라도 있으면 postcondition 실패다.

- `batchResult.failed.length > 0`
- `outcome === 'stopped'`
- 요청한 ref가 여전히 빈카드로 참조됨
- batch가 성공으로 끝났지만 target ref가 사라졌거나 결과 확인 불가
- ref prompt가 batch 중 삭제돼 `missing-prompt`로 skip됐고 여전히 빈카드로 참조됨

### 10.4 postcondition failure 결과

Failure 항목 예:

```js
{
  key,
  stage: 'postcondition',
  error:
    'still-empty' |
    'missing-prompt' |
    'not-found'
}
```

처리:

- empty-ref 모달을 닫지 않음
- `phase:'failure'`
- `hasPendingBatch=true` 유지
- scene batch 시작 금지
- 확인/close에서 latch 해제

### 10.5 생성 대상이 아니었던 빈카드

처음부터 프롬프트가 없어 `requestedKeys`에 들어가지 않은 카드는 postcondition 실패 조건이 아니다.

그 카드는 최종 M1에서 제외되고, M1 토스트로 안내된다.

Targeted batch 이후 기존 대상 씬에 새로 추가된 빈카드 역시 targeted 결과의 실패로 간주하지 않고 최종 M1에서 제외한다. 단, 요청했던 카드가 여전히 비어 있으면 fail-closed다.

---

## 11. 엣지케이스

### 11.1 프롬프트 없는 빈카드만 존재

- 모달 표시
- 카드에 `⚠` 표시
- "먼저 생성" 비활성화
- 제외 또는 취소만 가능

### 11.2 모달 도중 target이 모두 채워짐

"먼저 생성" 클릭 시 targeted 정상 noop:

- `ok:true`
- `outcome:'noop'`
- `allRefsGenerated` 토스트 없음
- postcondition 통과 후 씬 continuation

### 11.3 ref 삭제·정렬 변경

Index가 아닌 stable key로 추적한다.

- 삭제된 target은 structured `not-found`
- requested target의 not-found가 성공으로 위장되지 않게 결과 또는 postcondition에서 실패 처리
- 다른 ref가 같은 index로 이동해도 잘못 생성하지 않음

### 11.4 부분 실패·timeout·auth·quota

하나라도 실패하면 scene batch를 시작하지 않는다.

현재 ref batch는 timeout과 auth stop을 별도 상태로 정리한다: `src/hooks/useReferenceGeneration.js:670-708`.

### 11.5 Flow character coordinator busy

`runFlowCharacterOperation`이 busy면:

- 해당 target failure
- `stage:'busy'`
- M2 failure 모달
- scene batch 시작 금지

### 11.6 사용자 Stop

Targeted ref batch 중 Stop:

- `stopGenerateAllRefs` 실행
- 결과 `outcome:'stopped'`
- M2 failure 모달 유지
- `hasPendingBatch=true`
- failure 모달 확인 전까지 새 scene start 차단

### 11.7 모달/ref batch 중 mode 또는 project 변경

어떤 continuation에서도 mode/project가 context와 다르면 scene batch를 시작하지 않는다.

Targeted batch가 이미 끝났더라도 다른 프로젝트에 결과를 이어서 제출하지 않는다.

### 11.8 StylePicker 재진입

StylePicker가 열렸다가 `handleStart`로 재진입해도 다음을 보존한다.

- `force`
- initial target 의도
- 빈카드 guard를 다시 통과해야 한다는 사실

StylePicker Proceed가 M2 빈카드 가드를 우회하면 안 된다.

### 11.9 Subscription gate

빈카드가 없으면 기존 scene start 내부 gate 타이밍을 유지한다.

빈카드가 있을 때만 모달 직전 사전 gate를 실행하며 login/paywall/loading에서는 ref generation을 시작하지 않는다.

### 11.10 targeted ref style

M2는 scene `effectiveStyleId`를 targeted ref batch에 전달하지 않는다.

Ref 탭 수동 배치와 같은 selected-style/auto-fallback 의미를 사용한다.

### 11.11 ref 이미지 저장 실패

Folder 저장이 실패해도 base64 `data`가 남아 실제 이미지가 사용 가능하면 성공으로 볼 수 있다.

현재 `_processAndSaveImage`는 저장 실패 시 base64를 유지한다: `src/hooks/useReferenceGeneration.js:180-205`.

최종 판정은 status가 아니라 `data/filePath/imagePath/mediaId`로 한다.

### 11.12 API 모드

이번 M2에서는 빈카드 모달을 노출하지 않는다. 기존 API 씬 배치 동작을 유지한다.

### 11.13 targeted ref batch 중 MCP scene batch 요청

MCP `app_start_scene_batch`는 `isRunning`이면 기존 작업을 stop하고 종료를 polling한 뒤 scene batch를 재시작한다.

- App이 MCP에 전달하는 running 값: scene/video/refBatch — `src/App.jsx:1912-1942`
- Stop은 ref batch도 중단: `src/App.jsx:1919-1923`
- MCP wait는 50ms polling: `src/hooks/useMcpServer.js:446-459`
- scene stop-restart: `src/hooks/useMcpServer.js:483-504`

기대 동작:

1. MCP가 targeted ref batch를 Stop
2. targeted 결과는 `stopped`
3. empty-ref gate는 failure 상태
4. scene batch는 시작하지 않음

### 11.14 MCP stop-restart와 pending latch

`useMcpServer`가 보는 `isRunning`에는 `hasPendingBatch`가 포함되지 않는다: `src/App.jsx:1942`.

Ref batch의 `preparingRefs/stoppingRefs`는 promise resolve 전에 `finally`에서 해제된다: `src/hooks/useReferenceGeneration.js:734-739`.

따라서 latch가 없으면 다음 경로가 가능하다.

```text
MCP stop
→ refBatchRunning false
→ waitForStopped 성공
→ MCP handleStart 재호출
→ M2 failure 모달이 열려 있는데 새 scene batch 시작
```

M2는 빈카드 모달을 연 순간부터 failure 모달 close까지 `hasPendingBatch=true`를 유지한다.

MCP가 wait 종료 후 `handleStart`를 재호출해도 현재 handleStart 초입 guard에 막힌다: `src/App.jsx:1314-1318`.

정확한 기대 동작:

1. M2 confirm 시점부터 `hasPendingBatch=true`
2. MCP가 ref batch를 stop
3. ref batch flags가 false가 되어 `waitForStopped` 종료
4. MCP가 `handleStart` 호출
5. `hasPendingBatch` guard로 no-op
6. M2는 stopped failure 모달 유지
7. 사용자가 failure 모달을 닫으면 `hasPendingBatch=false`
8. 이미 끝난 MCP 호출은 자동 재시도하지 않음
9. 이후의 새 사용자/MCP Start만 가능

### 11.15 게이트 중 scene/ref 변경

#### 새 씬 추가

MCP가 모달/ref batch 중 새 씬을 추가해도 `initialTargetSceneIds`에 없으므로 이번 배치에 포함하지 않는다.

MCP scene merge/update 경로: `src/hooks/useMcpServer.js:310-417`.

#### 기존 대상 씬 완료

Non-force 배치에서 기존 대상 씬이 게이트 중 완료되면 최종 `filterPendingScenes`에서 제거해 재생성하지 않는다.

#### 기존 대상 씬 prompt/tag 변경

실행 시점 live scene으로 빈카드, M1, sync 후보를 다시 계산한다. Stale prompt를 사용하지 않는다.

#### 새 빈카드 참조 추가

Targeted batch가 끝난 뒤 기존 대상 씬에 새 빈카드 참조가 추가되면 M2 모달을 두 번째로 열지 않는다. Final M1에서 제외한다.

### 11.16 동명 카드

`resolveMentions`는 name map을 만들 때 같은 이름의 마지막 ref가 앞 ref를 덮는다: `src/utils/mentionParser.js:84-85`.

반면 태그 매칭 loop는 동명 ref를 모두 push할 수 있다: `src/hooks/useScenes.js:602-632`.

따라서 동명 카드가 존재하면:

- 생성한 카드와 mention engine이 실제 해석하는 카드가 다를 수 있음
- 생성했는데도 최종 M1에서 다른 동명 빈카드가 제외될 수 있음
- fail-closed와 M1 안전성은 유지되지만 UX가 혼란스러울 수 있음

이번 M2에서 이름 중복 정책 자체는 변경하지 않는다. 목록에는 가능하면 type과 ID를 함께 표시한다.

---

## 12. 변경 대상 파일

### `src/utils/refImageGuard.js`

- `isReferenceImageEmpty`
- `referenceGuardKey`
- `collectReferencedEmptyCards`
- 기존 M1 술어와 key 정책 재사용

### `src/hooks/useScenes.js`

- `getMatchingReferences(scene, referencePool = references)`
- 초입 guard를 `referencePool.length` 기준으로 변경
- 태그 loop 및 `resolveMentions`에 referencePool 사용

### `src/hooks/useReferenceGeneration.js`

- `_executeBatchRefs(overrideStyleId, options)` 시그니처
- `targetRefKeys`
- structured batch result
- currentRefs 반환
- failure stage 집계
- targeted noop 토스트 억제
- queue 경유 overrideStyleId pass-through
- manual/MCP global batch 호환 보존

### `src/hooks/useAutomation.js`

- `batchIntent` 옵션
- M2 `sceneIds`를 full batch로 처리
- subscription reuse와 batch ID 판정에 동일한 partial/full 의미 사용

### `src/App.jsx`

- `scenesRef`, `automationStartRef`
- `emptyRefGate` 상태
- M2 pending latch lifecycle
- direct/tag-proceed 공통 continuation
- subscription 사전 gate
- batchResult/postcondition 처리
- final live target 및 final sceneIds 확정
- sync gate `onCancel`
- Proceed 시 `patchedRefs = referencesRef.current`
- 최종 M1 토스트 정책

### UI

권장 분리:

- `src/components/EmptyReferenceGateModal.jsx`
- 기존 `Modal` 스타일 재사용
- 리스트형 3버튼
- confirm/busy/failure 렌더 분기

### i18n

최소 문자열:

- 모달 제목/설명
- 먼저 생성
- 제외하고 생성
- 취소
- 프롬프트 없음
- 생성 가능 카드 없음
- ref 생성 중
- ref 생성 실패
- ref 생성 중단
- scene batch 미시작
- postcondition 실패

---

## 13. TDD 계획

### Task 1. 빈카드 순수 함수

테스트:

- `data`만 존재 → 빈카드 아님
- `filePath`만 존재 → 빈카드 아님
- `imagePath`만 존재 → 빈카드 아님
- `mediaId`만 존재 → 빈카드 아님
- 네 필드 전부 없음 → 빈카드
- status done/entityId만 존재 → 빈카드
- mention+tag 중복 → 카드 1건
- 여러 씬 참조 → occurrences 누적
- prompt 유무 분리
- id 우선 key, legacy fallback

### Task 2. `getMatchingReferences` referencePool

테스트:

- hook closure references가 비어 있고 override pool이 있으면 정상 매칭
- 초입 guard가 `referencePool.length`를 사용
- character/scene/style 태그 override
- mention override
- App 1인자 wrapper가 authoritative refs를 전달

### Task 3. targeted ref batch

테스트:

- target 외 pending ref 생성 안 함
- target style → target non-style 순서
- target already-filled → silent noop
- global noop → 기존 토스트 유지
- missing prompt structured skip
- deleted target `not-found`
- partial failure `ok:false`
- stop `outcome:'stopped'`
- timeout failure
- Flow character coordinator busy → `failed(stage:'busy')`
- `currentRefs`가 최종 refs
- M2 targeted batch가 `overrideStyleId=null`
- M2가 scene effectiveStyleId를 전달하지 않음
- Ref 탭과 동일한 auto-fallback 스타일 해석
- no-queue 경로 overrideStyleId pass-through
- queue 경로 overrideStyleId pass-through
- MCP 명시 style 및 `'none'` 보존
- 기존 global manual batch 동작 보존

### Task 4. 모달 상태 reducer/handler

테스트:

- detect → confirm
- confirm → busy
- batch fail → failure, latch 유지
- stopped → failure, latch 유지
- batch ok + postcondition fail → failure, latch 유지
- success → close, latch ownership 이전
- exclude → close, M1 continuation
- cancel → close, latch 해제
- failure 확인 → latch 해제
- prompt 없는 카드만 있을 때 primary disabled
- busy 중 중복 클릭 차단

### Task 5. continuation live-source

테스트:

- stale closure refs가 아니라 `batchResult.currentRefs` 사용
- exclude 경로는 클릭 시점 `referencesRef.current` 사용
- stale scenes가 아니라 `scenesRef.current` 사용
- ref batch 중 MCP scene prompt 변경 반영
- 빈카드 재확인에 currentRefs 사용
- M1 재계산에 currentRefs 사용
- sync 후보 선정에 currentRefs 사용
- sync Proceed seed가 `referencesRef.current`
- `syncGate.currentRefs`를 저장하지 않음
- sync loop의 개별 live 재조회 보존
- final launch는 patchedRefs 사용
- MCP가 게이트 중 추가한 씬은 final sceneIds에 없음
- 게이트 중 완료된 원래 씬은 non-force final sceneIds에서 제거
- force는 최초 ID 중 live prompt가 있는 씬만 포함
- 스캔 집합과 final sceneIds가 동일
- mode 변경 후 scene start 금지
- project 변경 후 scene start 금지
- `batchIntent:'full'` 전달
- M2 sceneIds가 기존 batch ID를 retry로 재사용하지 않음

### Task 6. App 통합 시나리오

#### 시나리오 A: direct + 먼저 생성 성공

- 빈카드 감지
- 모달 1회
- target ref만 생성
- postcondition 통과
- Flow character entity patch 반영
- final M1
- scene batch 1회

#### 시나리오 B: TagValidation Proceed

- tag modal 이후 동일 M2 guard 진입
- stale pendingStartOptions의 scene/ref 사용 금지
- live target 및 live refs 사용

#### 시나리오 C: 제외하고 진행

- ref batch 호출 0회
- 실행 시점 M1 재계산
- M1 exclusion map 적용
- M1 토스트 1회
- scene batch 시작

#### 시나리오 D: fail-closed

- target 일부 실패
- postcondition 실패
- scene start 0회
- failure 모달 유지
- latch 유지
- 확인 후 latch 해제

#### 시나리오 E: MCP stop-restart 인터리빙

1. M2 targeted ref batch busy
2. MCP scene batch 요청
3. MCP handleStop → ref batch stopped
4. refBatch flags false
5. MCP waitForStopped 성공
6. MCP handleStart 시도
7. failure 모달이 열린 동안 `hasPendingBatch=true`
8. MCP start no-op
9. failure 모달 close
10. `hasPendingBatch=false`
11. 기존 MCP 호출은 재시도하지 않음
12. 새 Start 시도만 가능

#### 시나리오 F: live membership

- 게이트 중 MCP가 새 scene 추가
- 새 scene은 생성하지 않음
- 원래 target이 게이트 중 완료
- non-force에서 재생성하지 않음
- final sceneIds와 M1/empty scan 집합 동일

### Task 7. 회귀 및 UX

테스트:

- StylePicker 재진입 시 빈카드 guard 보존
- StylePicker 재진입 시 force 보존
- subscription pre-gate login
- subscription pre-gate paywall
- subscription pre-gate loading
- 빈카드 없을 때 기존 subscription gate 타이밍 유지
- refBatchRunning 중 Start disabled
- `hasPendingBatch` 중 Start disabled
- mode/project 변경 UI 차단
- targeted noop에서 `allRefsGenerated` 토스트 없음
- 최종 M1 토스트 1회
- failure에서 M1 토스트 없음
- 새 빈카드는 final M1에서 제외
- 프롬프트 없는 빈카드는 경고 표시
- 동명 카드 목록에 type/ID 표시

---

## 14. 역할 분담

### 역할 A: guard/domain

담당:

- `refImageGuard.js`
- 빈카드 술어
- stable key
- collector
- M1과 공통 술어 정합성
- Task 1

### 역할 B: reference orchestration

담당:

- `useReferenceGeneration.js`
- targeted selection
- structured result
- completion wait
- style pass-through
- noop 토스트
- Flow character busy/failure
- Task 3

### 역할 C: scene matcher 및 automation

담당:

- `useScenes.js` referencePool
- `useAutomation.js` batchIntent
- final sceneIds/full batch 의미
- Task 2 및 관련 Task 5

### 역할 D: App/UI orchestration

담당:

- `App.jsx`
- M2 모달
- live-source contract
- pending latch
- direct/tag continuation
- subscription pre-gate
- M1/sync/final launch
- postcondition
- Task 4~7

### 통합 리뷰 체크

- target ref 외 생성 여부
- scene effectiveStyleId 누수 여부
- queue overrideStyleId 누락 여부
- stale scene/ref closure 여부
- failure 모달 중 latch 유지 여부
- scan set과 final sceneIds 일치 여부
- M2 sceneIds가 partial retry로 오인되는지
- M1 토스트 중복 여부
- Flow character 이중 sync 여부

---

## 15. 수용 기준

1. Flow `text/list` 이미지 배치에서만 M2 빈카드 모달이 열린다.
2. 개별 씬 재생성은 M2 모달을 우회한다.
3. 빈카드는 `data/filePath/imagePath/mediaId`가 모두 없는 ref다.
4. 멘션과 세 태그 필드의 ref를 모두 수집한다.
5. 같은 ref는 한 번만 표시·생성한다.
6. 프롬프트 없는 빈카드는 경고 표시되고 targeted batch에서 제외된다.
7. 프롬프트 없는 카드만 있으면 "먼저 생성"이 비활성화된다.
8. Targeted batch는 참조된 target만 생성한다.
9. Targeted batch는 Ref 탭 수동 배치와 동일한 스타일 해석을 사용한다.
10. Scene effectiveStyleId를 targeted ref batch에 전달하지 않는다.
11. Queue 경유 여부와 무관하게 overrideStyleId가 보존된다.
12. Targeted 정상 noop은 `allRefsGenerated` 토스트를 표시하지 않는다.
13. Ref batch 완료를 기존 polling promise로 기다린다.
14. Ref 실패·중단·timeout·busy가 하나라도 있으면 scene batch를 시작하지 않는다.
15. Batch `ok=true`라도 App postcondition 실패면 scene batch를 시작하지 않는다.
16. Postcondition은 empty-ref 모달을 닫기 전에 실행한다.
17. Postcondition 실패는 failure 모달로 표시한다.
18. Failure/stopped 모달이 열린 동안 `hasPendingBatch=true`다.
19. Failure 모달 close에서만 latch를 해제한다.
20. MCP stop-restart의 scene start는 failure 모달 latch에 의해 차단된다.
21. Targeted 성공 후 ref 판정은 `batchResult.currentRefs`를 사용한다.
22. Sync Proceed seed는 Proceed 시점 `referencesRef.current`다.
23. 모든 scene 판정은 실행 시점 live scenes를 사용한다.
24. Final sceneIds는 최초 target ID 집합에 force/pending 필터를 재적용해 확정한다.
25. 빈카드/M1 스캔 집합과 실제 생성 sceneIds가 동일하다.
26. 게이트 중 추가된 새 씬은 이번 배치에서 생성하지 않는다.
27. 게이트 중 완료된 씬은 non-force에서 재생성하지 않는다.
28. M2 sceneIds는 `batchIntent:'full'`로 처리한다.
29. "제외하고 씬만 생성"은 기존 M1 exclusion 동작과 동일하다.
30. 최종 M1 exclusion 토스트는 실제 scene launch 직전에 한 번만 표시한다.
31. Flow character 생성 후 별도 M2 sync를 실행하지 않는다.
32. 모달/ref batch 중 mode 또는 project가 바뀌면 scene batch를 시작하지 않는다.
33. Ref batch 실행 중 Start 버튼과 관련 project/mode 작업이 busy로 차단된다.
34. 기존 manual/MCP global ref batch 스타일·force 동작이 유지된다.
35. 기존 retry sceneIds의 batch ID 재사용 의미는 유지된다.

---

## 16. 리뷰 finding 추적표

| 구분 | Finding | 해소 위치 | 핵심 테스트 |
|---|---|---|---|
| 기존 MAJOR | Continuation이 수 분 뒤 stale closure를 사용할 수 있음 | §4.5~4.6, §6.2~6.5, §8.2, §10 | Task 5 stale refs/live scenes |
| 기존 MAJOR | Targeted ref batch 스타일 의미 미확정 | §5.3, §6.5, §11.10 | Task 3 Ref 탭 auto-fallback |
| 기존 MINOR | `getMatchingReferences` override가 초입 `references.length` guard에 막힘 | §4.5 | Task 2 empty closure + override |
| 기존 MINOR | Collector 1인자 호출과 reference override 계약 불명확 | §4.6 | Task 2 App wrapper |
| 기존 MINOR | Subscription gate 순서 불일치 | §6.6, §9.1 | Task 6/7 login/paywall/loading |
| 기존 MINOR | MCP 호출이 targeted ref batch를 stop할 수 있음 | §11.13 | Task 6 시나리오 E |
| 기존 MINOR | Targeted noop에서 전체 ref 완료 토스트 노출 | §5.6, §5.9, §8.3 | Task 3/7 toast |
| 기존 MINOR | TDD 공백: StylePicker, subscription, mode/project, busy 등 | §13 Task 5~7 | 각 회귀 테스트 |
| 기존 MINOR | 동명 카드의 mention/tag 해석 차이 | §11.16 | Task 1/7 동명 UX |
| 신규 MAJOR | MCP `isRunning`에 pending latch가 없어 failure 모달 중 restart 가능 | §7.2~7.3, §11.14 | Task 6 시나리오 E exact interleaving |
| 신규 MAJOR | `_executeBatchRefs(null, options)`가 MCP overrideStyleId를 드랍 | §5.3, §5.8 | Task 3 queue/no-queue pass-through |
| 신규 MAJOR | Final scene membership 미확정으로 새 씬 fail-open 또는 완료 씬 재생성 | §6.3, §6.7~6.8, §9, §15 | Task 5/6 live membership |
| 신규 MINOR | `syncGate.currentRefs`가 Proceed 시점에는 stale | §6.2, §7.4, §8.2 | Task 5 Proceed-time referencesRef |
| 신규 MINOR | Batch ok 후 postcondition 실패 UX가 silent dead-end | §2.6, §7.2~7.3, §10 | Task 4/6 postcondition failure modal |

---

## 최종 설계 결론

M2는 Flow 씬 배치의 최초 대상 ID를 잠근 뒤, 매 continuation에서 live scenes와 authoritative refs로 판정을 다시 수행한다.

"먼저 생성"은 참조된 생성 가능 빈카드만 기존 Ref 탭 의미로 targeted 생성하고, structured batch 결과와 App postcondition이 모두 성공한 경우에만 M1/sync/scene 파이프라인을 이어간다.

"제외하고 씬만 생성"은 M1 기존 동작 그대로다.

Failure/stopped/postcondition failure에서는 모달과 pending latch를 유지해 UI와 MCP 양쪽의 scene start를 차단한다. 최종 scene batch는 스캔에 사용한 live target을 force/pending 조건으로 다시 필터한 명시적 `sceneIds`만 생성하며, `batchIntent:'full'`로 새 full batch 의미를 보존한다.
