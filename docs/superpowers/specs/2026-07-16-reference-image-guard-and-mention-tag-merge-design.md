# 이미지 없는 레퍼런스 가드 + 멘션→태그 자동 병합

작성일: 2026-07-16
상태: 설계 확정 · 구현 전
기준 코드: `b799ce7` (`main`, v3.0.4)
개정 이력: Codex와 Fable 5의 독립 코드 리뷰 findings 및 오케스트레이터 확정 결정을 반영한 전면 개정판

## 1. 배경 / 문제

씬의 레퍼런스 사용 경로는 두 가지다.

- 태그 필드: `characters` / `scene_tag` / `style_tag`
- 프롬프트 본문의 `@멘션`: 이 설계에서는 character 멘션을 뜻한다.

현재 두 경로는 이미지 준비 상태, Flow entity 동기화 상태, 제출 가능 상태를 서로 다른 기준으로 판정한다. 그 결과 같은 "사용할 수 없는 레퍼런스"가 진입 경로에 따라 HTTP 오류, unresolved 오류, syncGate 데드락으로 다르게 나타난다.

또한 사용자가 프롬프트에 `@멘션`만 쓰면 `characters` 상태에는 반영되지 않아 SceneList의 캐릭터 뱃지와 실제 프롬프트 의도가 어긋난다.

### 1.1 Flow 태그 참조의 null `mediaId` 제출 경로

HTTP 500 가능 경로는 모든 이미지 없는 멘션이 아니라, **Flow image route로 제출되는 태그 참조**다.

1. `getMatchingReferences(scene)`가 태그 ref를 반환한다.
2. 씬 제출 필터는 `r.name`만 있어도 ref를 통과시킨다.
3. 매핑 결과는 `mediaId: null`이 된다.
4. Flow image route가 이를 `referenceImages`로 IPC에 전달한다.
5. 페이지 주입부가 `{ imageInputType, name: ref.mediaId }`, 즉 `{ name: null }`을 `imageInputs`에 추가한다.

근거:

- 현재 필터 및 매핑: [useAutomation.js:264-274](../../../src/hooks/useAutomation.js#L264-L274)
  - 느슨한 필터: 266행
  - `mediaId: null` 매핑: 269행
  - `imagePath` 유실 지점: 273행
- Flow image route 전달: [engineFlow.js:456-467](../../../src/engine/engineFlow.js#L456-L467)
  - 실제 `flowGenerateImage` 호출: 457행
  - `referenceImages` 전달: 464행
- IPC 주입 상태 설정: [flow-api.js:387-395](../../../electron/ipc/flow-api.js#L387-L395)
- 최종 protobuf `imageInputs` 추가: [flow-page-injection.js:109-123](../../../electron/flow-page-injection.js#L109-L123)

`uploadOne`이 소스 데이터를 읽지 못한 ref를 건너뛰는 동작은 업로드만 중단하며, 씬 제출을 막지 않는다: [useAutomation.js:585-595](../../../src/hooks/useAutomation.js#L585-L595).

> 저장소에는 `{ name:null } → HTTP 500`을 직접 재현한 테스트나 실제 서버 응답 로그가 없다. 따라서 확정 가능한 회귀 기준은 "이미지 없는 태그 ref가 `mediaId:null`로 제출 payload에 들어간다"까지다. HTTP 500은 관찰된 증상과 일치하는 유력 인과로 기록하되, 테스트 없이 서버 인과를 확정하지 않는다.

### 1.2 이미지 없는 `@멘션`의 실제 실패 경로

이미지 없는 character `@멘션`은 위 image route의 null 주입과 다른 경로로 실패한다.

#### 정상 배치 시작 경로

`selectUnsyncedMentionedRefs`는 프롬프트의 character 멘션 중 `isRefSynced`가 false인 ref를 syncGate 대상으로 고른다: [flowCharacterSync.js:72-82](../../../src/utils/flowCharacterSync.js#L72-L82).

이미지 소스가 없는 ref를 "동기화 후 생성"하면 `syncRefToFlowUnlocked`가 `no image data`를 반환한다: [flowCharacterSync.js:263-272](../../../src/utils/flowCharacterSync.js#L263-L272).

그 실패는 `planSyncGateCompletion`의 fail-closed 정책에 따라 배치 전체를 막는다: [App.jsx:1821-1826](../../../src/App.jsx#L1821-L1826).

#### handleStart를 우회한 경로

재시도나 엔진 직접 호출에서 이미지 없는 character 멘션은 `planMentionRouting`의 unresolved error가 되어 IPC 전에 종료된다: [engineFlow.js:98-109](../../../src/engine/engineFlow.js#L98-L109), [engineFlow.js:394-396](../../../src/engine/engineFlow.js#L394-L396).

따라서 기능1은 다음 세 증상을 같은 UX로 통일한다.

- 태그 image route의 null `mediaId` 제출 가능성
- 이미지 없는 멘션의 unresolved error
- 이미지 없는 멘션의 syncGate 데드락

세 경우 모두 해당 레퍼런스 사용만 그 씬에서 제외하고, 나머지 입력으로 생성을 계속한다.

### 1.3 태그-only character 동기화와 stale refs 문제

현재 Flow 생성 전 syncGate는 `@멘션`만 검사한다. `characters` 태그만 가진 character는 검사하지 않는다: [App.jsx:1433-1450](../../../src/App.jsx#L1433-L1450).

동시에 Flow 배치 프리업로드는 character를 명시적으로 제외한다: [useAutomation.js:568-573](../../../src/hooks/useAutomation.js#L568-L573).

따라서 로컬 이미지는 있지만 `mediaId`가 없는 character가 `characters` 태그로만 사용되면 다음 상태가 된다.

- syncGate가 열리지 않는다.
- 배치 프리업로드도 하지 않는다.
- 태그 매칭에는 포함된다.
- `mediaId:null` image input으로 이어질 수 있다.

새 syncGate가 태그-only character를 동기화하더라도 현재 코드에는 추가 문제가 있다.

- sync 결과는 `currentRefsOverride`에 반영된다.
- `runConcurrentQueue`는 이를 `effectiveRefs`로 받아 멘션 해석에 사용한다: [useAutomation.js:82-86](../../../src/hooks/useAutomation.js#L82-L86).
- 하지만 태그 매칭은 여전히 이전 렌더의 `getMatchingReferences(scene)` 클로저를 호출한다: [useAutomation.js:264](../../../src/hooks/useAutomation.js#L264).
- `getMatchingReferences` 자체도 hook state의 `references`를 캡처한다: [useScenes.js:597-647](../../../src/hooks/useScenes.js#L597-L647).

syncGate 패치는 새 ref 객체를 state에 넣으므로 기존 클로저의 ref에는 새 `mediaId`가 없다. 이 상태에서는 방금 동기화한 tag-only character가 같은 배치에서 다시 제외될 수 있다.

이 문제는 merged-scene overlay와 `effectiveRefs` 기반 순수 매칭으로 해결한다.

### 1.4 Flow 모드 도달성

Flow 분기는 dead code가 아니다.

- renderer 유효 모드: `['api', 'flow']` — [useAppMode.js:7-12](../../../src/hooks/useAppMode.js#L7-L12)
- 최초 실행 기본값: 저장 모드가 없으면 `null`, 이후 ModeSelector 표시
- ModeSelector에 Flow 카드 존재 — [ModeSelector.jsx:33-47](../../../src/components/ModeSelector.jsx#L33-L47)
- `mode === 'flow'`이면 실제 Flow 엔진 선택 — [useGenerationEngine.js:14-29](../../../src/engine/useGenerationEngine.js#L14-L29)
- Electron main의 초기 mode는 `api`지만 `mode:set('flow')`이 Flow view를 attach한다 — [mode.js:14-30](../../../electron/ipc/mode.js#L14-L30)

루트 `CLAUDE.md`의 "Flow 웹 역공학 경로는 제거됨" 주장은 현재 코드와 맞지 않는다: [CLAUDE.md:12](../../../CLAUDE.md#L12). 해당 문서 정리는 후속 문서 작업으로 남긴다.

## 2. 요구사항

### 기능1 — 사용할 수 없는 레퍼런스 사용 자동 제외

- 사용할 수 없는 ref를 카드 전체가 아니라 **그 씬의 해당 사용(via)** 에서만 제외한다.
- `via`는 `characters`, `scene_tag`, `style_tag`, `mention` 중 하나다.
- 같은 ref가 태그와 멘션 양쪽에 쓰이면 두 사용을 독립 판정한다.
  - 태그 사용은 유지하면서 멘션 사용만 제거할 수 있다.
  - 사용자 표시에서는 같은 씬/ref를 한 건으로 집계하되 내부에는 모든 `via`를 보존한다.
- 제외된 character 멘션은 `stripMentionsForNames`로 해당 `@`만 제거하고 일반 텍스트 이름은 남긴다.
- 다른 정상 태그와 멘션은 그대로 유지한다.
- 제외 후 ref가 0개여도 plain prompt로 생성을 진행한다.
- 이미지/주입 불가 때문에 배치를 하드 블록하지 않는다.
- 미해결 오타 멘션이나 존재하지 않는 태그는 ref가 없으므로 기능1 대상이 아니다. 기존 unresolved/TagValidation 경고가 담당한다.

#### 토스트 계약

- 프리업로드 및 API source resolution이 끝난 뒤, 첫 씬 제출 전에 최종 exclusion plan을 집계해 경고 토스트 1회를 표시한다.
- 배치 제출 도중 최종 방어선에서 새 exclusion이 발견되면 정상 토스트를 수정하지 않는다.
- late exclusion은 배치 종료 시 별도의 집계 토스트를 최대 1회 표시한다.
- 정상 경로에서는 토스트 1회, late exclusion이 실제 발생한 경우에만 최대 2회다.

#### sync 실패와의 구분

이미지나 주입 가능성 부족으로 판정된 ref는 자동 제외한다. 반면 사용자가 syncGate에서 "동기화 후 생성"을 선택한 뒤 네트워크/등록 동기화가 실패한 경우에는 기존 fail-closed 정책을 유지한다. 이것은 이미지 없음으로 인한 하드 블록이 아니라 명시적 동기화 작업 실패다.

### 기능2 — character 멘션을 `characters` 태그에 자동 병합

- 이미지 배치 시작 버튼을 누른 뒤 대상 씬의 character `@멘션`을 `characters`에 append한다.
- append 값은 resolve된 ref의 canonical `ref.name`이다.
- 기존 태그 문자열은 재직렬화하지 않는다.
- 새 이름만 기존 문자열 뒤에 `, `로 append한다.
- 사용자가 직접 쓴 태그를 덮어쓰거나 제거하지 않는다.
- 입력 객체를 mutate하지 않는다.
- 동일 입력에 반복 적용해도 결과가 같은 멱등 함수여야 한다.
- 변경 없는 씬에는 `updateScene`을 호출하지 않는다.
- 병합 결과는 현재 배치의 merged-scene overlay에도 즉시 반영한다.
- 병합은 UI-only 변경이 아니다. current batch의 검증과 ref 매칭에도 영향을 주는 authoritative input이다.

#### 영속화 UX 계약

병합 결과는 `updateScene`으로 즉시 state에 반영되고 오토세이브 대상이 된다.

따라서 다음 경우에도 병합된 `characters`는 유지된다.

- 스타일 피커가 열린 뒤 사용자가 생성을 시작하지 않음
- TagValidationModal에서 취소
- syncGate에서 취소
- 후속 인증/Flow 준비 검증 실패
- 실제 `start()` 호출 전 중단

이는 롤백 대상 임시 patch가 아니라 사용자의 프롬프트 의도를 씬 메타데이터에 반영한 영구 편집으로 취급한다.

### 스코프 결정

이번 범위에 포함:

- Flow 이미지 배치의 태그 null `mediaId` 방어
- 이미지 없는 character 멘션 자동 제외
- 태그-only local character의 syncGate 유도
- syncGate 패치가 같은 배치의 태그 매칭에 반영되도록 stale refs 제거
- API mode의 name→disk fallback 보존
- direct / tag-proceed / sync-proceed / retry의 동일 reference enforcement
- Flow 엔진 및 페이지 주입의 최종 non-empty `mediaId` 방어

이번 범위 밖:

- `video-text` 경로의 동일한 이미지 없는 멘션 데드락 수정
- 배치 도중 ref 편집 잠금 또는 완전한 live-state 추적
- `clearedImageFields`에 `imagePath:null`을 추가하는 행동 변경
- 중복 reference name 자체를 금지하는 데이터 모델 변경
- stale `CLAUDE.md` 정리

## 3. 설계

### 3.1 판정 축 분리

단일 `hasUsableImage(ref, mode, phase)`는 폐기한다. 태그와 멘션은 필요한 Flow 자격이 다르므로 하나의 boolean으로 합치지 않는다.

`src/utils/refImageGuard.js`에 다음 순수 술어를 둔다.

```js
sourceAvailable(ref)
  = !!(ref?.data || ref?.filePath || ref?.imagePath)

flowImageInjectable(ref)
  = !!ref?.mediaId

flowMentionEligible(ref)
  = isRefSynced(ref)
  // character: entityId && flowNameSyncStatus === 'synced'

flowRegistrationRepairable(ref)
  = !!(ref?.entityId && ref?.workflowId)

flowSyncable(ref)
  = flowRegistrationRepairable(ref)
    || (!flowImageInjectable(ref) && sourceAvailable(ref))

flowTagCharacterNeedsSync(ref)
  = !flowImageInjectable(ref) && sourceAvailable(ref)
```

`sourceAvailable`은 메타데이터상 읽을 소스가 있다는 뜻이지 실제 파일 읽기 성공을 보장하지 않는다. `filePath` 또는 `imagePath`가 stale할 수 있으므로 최종 판정은 업로드/파일 해석 결과 뒤에 다시 수행한다.

#### Flow via별 판정

| via | ref 상태 | 계획 단계 |
|---|---|---|
| `mention` + character | `flowMentionEligible` | 멘션 유지 |
| `mention` + character | eligible 아님 + `flowSyncable` | syncGate 후보 |
| `mention` + character | eligible 아님 + sync 불가 | 멘션 사용 제외 + `@` strip |
| `characters` | `flowImageInjectable` | image ref로 유지; `isRefSynced`는 보지 않음 |
| `characters` | `!mediaId && sourceAvailable` | syncGate 후보 |
| `characters` | `!mediaId && !sourceAvailable` | 태그 사용 제외 |
| `scene_tag` / `style_tag` | `flowImageInjectable` | image ref로 유지 |
| `scene_tag` / `style_tag` | `!mediaId && sourceAvailable` | 프리업로드 후보 |
| `scene_tag` / `style_tag` | `!mediaId && !sourceAvailable` | 태그 사용 제외 |

태그-only character 후보는 `!ref.mediaId && sourceAvailable(ref)`로 고정한다. `!isRefSynced(ref)`를 사용하지 않는다.

이유:

- `mediaId`가 있으면 Flow image input으로 주입 가능하다.
- `flowNameSyncStatus:'failed'`여도 태그 image route에는 entity 이름 동기화가 필요 없다.
- 이런 ref를 태그 사용만으로 syncGate에 끌어들이면 불필요한 동기화와 새 데드락이 생긴다.

#### 주요 상태 고정

- entity-only synced character:
  - `flowMentionEligible === true`
  - `flowImageInjectable === false`
  - 멘션은 유지하고 image input에는 넣지 않는다.
- local-only tag character:
  - `flowTagCharacterNeedsSync === true`
  - syncGate 성공 뒤 같은 run에서 새 `mediaId`를 사용해야 한다.
- mediaId-only unsynced character:
  - 태그 사용은 유지한다.
  - 멘션 사용은 `flowMentionEligible === false`다.
  - repair 가능한 IDs가 없으면 멘션 사용만 제외한다.
- `entityId + workflowId`가 있는 unsynced character:
  - 멘션은 registration repair 후보가 될 수 있다.
  - 태그는 `mediaId`가 있으면 별도 sync 없이 사용할 수 있다.

#### `clearedImageFields` 불변식 범위

`clearedImageFields`는 현재 다음 필드를 비운다: [refEntityRegistration.js:121-125](../../../src/utils/refEntityRegistration.js#L121-L125).

- `data`
- `filePath`
- `mediaId`
- `caption`
- `dataStorage`
- `entityId`
- `workflowId`
- `registered`
- `flowNameSyncStatus`

따라서 이미지 제거 뒤 보장되는 불변식은 다음으로 한정한다.

- `flowImageInjectable(ref) === false`
- `flowMentionEligible(ref) === false`
- entity registration repair 정보가 제거됨

`imagePath`는 비우지 않는다. CSV reference는 실제로 `imagePath`를 보유할 수 있다: [parsers.js:790-807](../../../src/utils/parsers.js#L790-L807).

따라서 `clearedImageFields` 적용 후 `sourceAvailable(ref) === false`라고 단정하지 않는다. `imagePath:null` 추가는 디스크 경로 및 기존 CSV 동작에 영향을 줄 수 있으므로 이번 구현에 포함하지 않고 별도 검토한다.

### 3.2 태그 정규화, 멘션 병합, 순수 매칭

#### 공통 태그 정규화

`src/utils/tagMatch.js`에 공통 함수를 추가한다.

```js
normalizeTagKey(value)
  = String(value ?? '').trim().toLowerCase()
```

현재 `splitTags`의 의미와 동일하게 유지한다: [tagMatch.js:9-11](../../../src/utils/tagMatch.js#L9-L11).

- trim
- lowercase
- 빈 값 제거
- 내부 연속공백은 축약하지 않음

다음 세 경로가 반드시 같은 `normalizeTagKey`를 사용한다.

- 멘션→characters 병합 dedup
- `collectTagErrors` / `checkTagMatch`
- `getMatchingReferences`의 태그 매칭

#### `mentionTagMerge.js`

```js
mergeMentionsIntoCharacters(scene, characterRefs) -> string | null
```

계약:

- character ref만으로 `resolveMentions`를 수행한다.
- `null`은 변경 없음을 뜻한다.
- 조사 붙은 멘션은 resolve된 canonical `ref.name`을 append한다.
- 기존 `characters` 문자열은 그대로 보존한다.
- 새 token만 `, `로 append한다.
- 비교는 `normalizeTagKey`를 사용한다.
- 내부공백을 축약하지 않는다.
- 입력을 mutate하지 않는다.
- 멱등이다.

```js
planMentionTagMerges(scenes, references, { filter })
  -> {
       patches: [
         { sceneId, sceneIndex, characters, addedNames }
       ],
       scenePatchesById: {
         [sceneId]: { characters }
       }
     }
```

- `sceneIndex`는 원본 `scenes` 배열 인덱스다.
- 변경 없는 씬은 `patches`에서 제외한다.
- `filter`는 `collectTagErrors`와 같은 계약을 사용한다.

#### merged-scene overlay

```js
applyScenePatches(scenes, scenePatchesById) -> effectiveScenes
```

`effectiveScenes`는 다음 경로의 authoritative scene 배열이다.

- `collectTagErrors`
- reference-use 계획
- `getMatchingReferences`
- 스타일 자동 매칭
- 최종 scene loop

React state가 같은 tick에 갱신되기를 기다리지 않는다.

#### 순수 reference matcher

현재 hook closure 기반 `getMatchingReferences(scene)`를 순수 매칭 함수로 분리한다.

```js
collectSceneReferenceUses(scene, references)
  -> [
       {
         ref,
         refKey,
         vias: ['characters' | 'scene_tag' | 'style_tag' | 'mention', ...]
       }
     ]

getMatchingReferences(scene, references)
  -> collectSceneReferenceUses(...).map(use => use.ref)
```

`useScenes`는 기존 소비자를 위해 현재 `references`를 기본 인자로 넘기는 얇은 wrapper만 제공한다. 배치 경로는 반드시 명시적인 `effectiveRefs`를 전달한다.

dedup 규칙:

- 같은 ref가 태그와 멘션 양쪽에서 발견되면 한 ref use로 합치고 `vias`를 모두 보존한다.
- ref identity는 ID가 있으면 ID를 우선한다.
- ID가 없는 ref는 타입, 정규화 이름, 배열 위치를 포함한 run-local key를 사용한다.
- 타입이 다른 동명 ref는 같은 ref로 dedup하지 않는다.
- 현재의 타입 무관 name dedup은 제거한다: [useScenes.js:633-643](../../../src/hooks/useScenes.js#L633-L643).
- 동일 타입·동일 이름의 중복 카드는 별도 ref로 유지한다. 태그가 이들을 모두 매칭하는 기존 의미는 이번 스코프에서 바꾸지 않는다.

기능2 병합은 current batch에 영향을 준다. 이것은 더 이상 "UI 뱃지만 갱신하는 무영향 변경"으로 취급하지 않는다.

동명 character와 scene/style이 공존해도 stable ref identity dedup을 사용하므로 character 추가가 기존 비-character ref를 이름 충돌로 삭제하지 않는다.

### 3.3 reference preflight plan

`src/utils/refImageGuard.js`에 use 단위 planning 함수를 둔다.

```js
planReferencePreflight(
  scenes,
  references,
  mode,
  {
    targetSceneIds,
    apiResolutionByRefKey = null
  }
)
  -> {
       bySceneId: {
         [sceneId]: {
           uses: [
             { refKey, refId, type, name, vias }
           ],
           decisions: [
             {
               refKey,
               via,
               action:
                 'keep-image'
                 | 'keep-mention'
                 | 'needs-upload'
                 | 'needs-sync'
                 | 'exclude',
               reason:
                 'no-source'
                 | 'not-mention-eligible'
                 | 'upload-failed'
                 | 'api-resolve-failed'
             }
           ],
           excludedUses: [
             { refKey, refId, type, name, vias, reasons }
           ],
           excludedMentionNames: [],
           allowedImageRefKeys: [],
           allowedMentionRefKeys: []
         }
       },
       usedRefKeys: [],
       uploadCandidates: [],
       syncCandidates: [],
       removals: [
         {
           sceneId,
           sceneIndex,
           refs: [
             { refKey, refId, name, type, vias, reasons }
           ]
         }
       ]
     }
```

같은 ref의 via는 독립 판정한다.

예:

- mediaId가 있지만 entity sync가 안 된 character가 태그와 멘션 양쪽에 쓰임
  - `characters`: `keep-image`
  - `mention`: `exclude` 또는 `needs-sync`
  - 최종 image ref는 유지
  - 해당 이름의 `@`만 제거 가능

`removals`는 토스트용 집계 구조다. 같은 scene/ref는 한 건으로 합치되 `vias`와 `reasons`는 배열로 보존한다.

### 3.4 API mode source resolution

API mode에서는 `sourceAvailable(ref)`만으로 제외 여부를 정하지 않는다.

공식 API reference resolver는 다음 순서로 이미지를 찾는다: [referenceResolver.js:57-102](../../../src/utils/referenceResolver.js#L57-L102).

1. `ref.data`
2. `ref.filePath`
3. `ref.name + projectName`을 이용한 `references/{name}` fallback

따라서 name-only ref도 실제 디스크 이미지로 해석될 수 있다. 반대로 truthy `filePath`도 파일 읽기 실패가 가능하다.

기존 단일-ref 해석 로직을 공통화한다.

```js
resolveReferenceImageDetailed(ref, { projectName, fs })
  -> {
       ok: boolean,
       inlineData?: { mimeType, data },
       source?: 'data' | 'filePath' | 'name-fallback',
       error?: 'not-found' | 'read-failed' | 'empty-data'
     }
```

기존 `resolveReferenceImages`는 이 함수를 이용하는 호환 wrapper로 유지한다.

배치 API preflight는 사용되는 고유 ref를 한 번씩 상세 해석해 `apiResolutionByRefKey`를 만든다. 최종 plan은 실제 `ok` 결과로 keep/exclude를 결정한다.

최소 보장:

- name-only + `readReference(projectName, name)` 성공 → 유지
- stale `filePath`지만 name fallback 성공 → 유지
- stale `filePath` + name fallback 실패 → 제외
- `data` 성공 → 유지

현재 씬 제출 매핑에서 `imagePath`가 유실되는 문제도 수정한다.

```js
filePath: r.filePath || r.imagePath || null
```

실제 현재 누락 위치: [useAutomation.js:267-274](../../../src/hooks/useAutomation.js#L267-L274).

### 3.5 진입 경로와 실행 순서

#### App 공통 이미지 preflight coordinator

현재 direct start, tag proceed, sync proceed, retry가 서로 다른 경로로 `start()`에 도달한다.

- direct: [App.jsx:1307-1457](../../../src/App.jsx#L1307-L1457)
- tag proceed: [App.jsx:1682-1753](../../../src/App.jsx#L1682-L1753)
- sync proceed: [App.jsx:1759-1831](../../../src/App.jsx#L1759-L1831)
- retryErrors: [App.jsx:2341-2359](../../../src/App.jsx#L2341-L2359)
- 개별 retry: [App.jsx:2457-2461](../../../src/App.jsx#L2457-L2461), [App.jsx:2557-2561](../../../src/App.jsx#L2557-L2561)

이 네 경로가 공유하는 App-level coordinator를 둔다.

```js
prepareImageBatchStart({
  entry,
  targetScenes,
  startOptions,
  persistMentionMerge,
  currentRefs
})
```

- direct full batch는 `persistMentionMerge:true`
- tag/sync proceed는 저장된 overlay를 재사용
- retry는 기능2의 영속 병합을 새로 수행하지 않지만, reference preflight와 sync 후보 판정은 동일하게 수행
- 모든 경로가 최종적으로 같은 `start()` enforcement를 통과

#### `handleStart` 순서

```text
기존 busy/auth/folder/Flow-ready 검증
→ targetScenes 계산
→ planMentionTagMerges
→ 변경 씬 updateScene 반영(영구 state)
→ scenePatchesById 적용한 effectiveScenes 생성
→ 스타일 가드 / startOptions 생성
→ collectTagErrors(effectiveScenes, effectiveRefs, filter)
→ TagValidationModal 필요 시 pending options에 overlay/preflight 보존
→ preliminary planReferencePreflight
→ Flow syncCandidates 분리
   · character mention: flowSyncable
   · character tag: !mediaId && sourceAvailable
   · source 없는 use: exclusion
→ syncCandidates 있으면 syncGate
→ 없으면 start(startOptions)
```

`collectTagErrors`는 원본 배열 인덱스를 유지하도록 전체 `effectiveScenes`와 filter를 받는다: [tagMatch.js:49-85](../../../src/utils/tagMatch.js#L49-L85), [App.jsx:1420-1429](../../../src/App.jsx#L1420-L1429).

#### syncGate proceed

syncGate 성공 뒤에는 `patchedRefs`를 authoritative refs로 사용한다.

기존 코드는 patched refs를 `currentRefs`로 넘기지만 태그 matcher가 이를 사용하지 않는다: [App.jsx:1765-1831](../../../src/App.jsx#L1765-L1831).

개정 후:

1. sync 결과를 `patchedRefs`에 누적
2. `planReferencePreflight(effectiveScenes, patchedRefs, ...)` 재계산
3. `startOptions.currentRefs = patchedRefs`
4. 갱신된 preflight plan을 `startOptions.referencePreflight`에 저장
5. `start()`와 scene loop가 모두 `patchedRefs`로 순수 매칭

#### `startOptions` 계약

```js
{
  // 기존 옵션
  projectName,
  saveMode,
  imageBatchCount,
  imageUpscale,
  aspectRatio,
  imageModel,
  selectedStyleRefId,
  seed,
  force,
  sceneIds,
  currentRefs,

  // 신규
  referencePreflight: {
    targetSceneIds,
    scenePatchesById,
    preUploadPlan
  } | null
}
```

`referencePreflight.targetSceneIds`는 reference plan의 적용 범위만 나타낸다. 기존 `sceneIds`의 partial retry/과금 의미를 대체하거나 오버로드하지 않는다.

정상 direct/tag/sync 경로는 preliminary plan을 전달한다.

재시도는 이전 실행의 plan을 재사용하지 않는다. `referencePreflight`가 없거나 대상 scene/ref snapshot이 다르면 `start()`가 plan을 다시 계산한다.

#### `start()` 내부 2단계 enforcement

##### 단계 A — 프리업로드 전 plan

```text
targetScenes resolve
→ scenePatchesById를 적용해 effectiveScenes 생성
→ currentRefsOverride || references로 effectiveRefs 생성
→ getMatchingReferences(scene, effectiveRefs)
→ preUploadPlan 계산 또는 전달 plan 재검증
→ pre-excluded use를 usedRefKeys에서 제거
→ keep / needs-upload use만 usedRefKeys에 포함
→ Flow non-character uploadCandidates 결정
```

Flow character sync는 App syncGate에서 먼저 처리한다. `start()`에서 새 character sync 후보가 발견되면 조용히 제출하지 말고 공통 preflight coordinator로 되돌리거나, 해당 진입의 syncGate를 열 수 있는 명시적 결과를 반환한다. direct와 retry가 서로 다른 정책을 사용하면 안 된다.

`selectRefsToRegister`도 hook closure의 `usedRefIds`에만 의존하지 않고 plan의 `usedRefKeys`를 소비하도록 조정한다: [refEntityRegistration.js:68-87](../../../src/utils/refEntityRegistration.js#L68-L87).

##### 단계 B — 프리업로드/API 해석 후 final plan

```text
Flow upload 실행
→ 성공 patch를 currentRefs에 누적
→ API면 resolveReferenceImageDetailed 결과 수집
→ effectiveScenes + 최신 currentRefs로 매칭 재실행
→ final planReferencePreflight 계산
→ excludedMentionNames로 prompt strip
→ primary exclusion toast 1회
→ runConcurrentQueue(final plan)
```

`uploadOne`은 현재 ref 객체의 `mediaId`와 `caption`을 직접 변이한다: [useAutomation.js:598-620](../../../src/hooks/useAutomation.js#L598-L620).

개정 구현은 직접변이에만 의존하지 않는다. 모든 성공 patch를 run-local `currentRefs`에도 누적하고 scene loop가 이 배열을 사용한다.

#### scene loop

각 씬은 final plan을 사용한다.

```text
effectiveScene 선택
→ getMatchingReferences(effectiveScene, effectiveRefs)
→ final plan의 allowedImageRefKeys / allowedMentionRefKeys 적용
→ excludedMentionNames에 대해서만 stripMentionsForNames
→ 제외 반영된 prompt와 refs로 resolveSceneStyle
→ mode별 payload mapping
→ submitGeneration
```

`stripMentionsForNames`는 다른 멘션을 보존하고 지정한 이름의 `@`만 제거한다: [mentionParser.js:114-129](../../../src/utils/mentionParser.js#L114-L129).

스타일 자동 적용도 excluded ref를 제거한 `allMatched`를 사용한다. 이미지 없는 style ref를 image input에서만 빼고 style prompt는 계속 적용하는 식의 부분 적용을 만들지 않는다.

#### late exclusion

final plan 뒤 제출 직전에 ref가 invalid해진 경우:

- 해당 use를 최종 payload에서 제거
- character mention이면 해당 `@`만 strip
- `lateRemovals`에 누적
- 배치 종료 시 late 집계 토스트를 최대 1회 표시

배치 도중 state 교체를 완전히 live하게 추적하는 것은 이번 범위 밖이다. late 방어는 현재 run-local 객체에서 관찰 가능한 변경과 제출 payload 검증을 대상으로 한다.

### 3.6 최종 방어선

계획 단계가 잘못되거나 프리업로드 뒤 값이 유실돼도 invalid Flow image input이 서버로 나가면 안 된다.

다음 세 곳에서 non-empty `mediaId`를 재검증한다.

1. `useAutomation`의 Flow `matchedRefs` 매핑
2. `engineFlow`가 `flowGenerateImage` IPC를 호출하기 직전
3. `flow-page-injection`이 `req.imageInputs`에 push하기 직전

페이지 주입부의 현재 push 위치: [flow-page-injection.js:115-120](../../../electron/flow-page-injection.js#L115-L120).

최종 불변식:

```text
Flow imageInputs에 들어가는 모든 항목은 !!ref.mediaId === true
null / undefined / '' mediaId는 imageInputs에 들어가지 않음
```

이 방어선은 UX exclusion plan을 대신하지 않는다. 서버 오류 방지를 위한 마지막 안전장치다.

### 3.7 리뷰 finding 추적표

| 리뷰 finding | 해소 위치 |
|---|---|
| 단일 술어가 via를 구분하지 못함 | §3.1 판정 축 분리 |
| entity-only 멘션이 `!!mediaId` 필터에서 제거됨 | §3.1 via별 판정, §3.5 scene loop |
| 태그-only sync 성공 patch가 stale matcher에 안 보임 | §3.2 순수 matcher, §3.5 sync proceed/currentRefs |
| "멘션 병합은 배치 무영향" 가정이 거짓 | §2 기능2, §3.2 authoritative overlay |
| 타입 무관 name dedup이 기존 비-character ref를 삭제 | §3.2 stable ref identity dedup |
| enforcement가 usedRefIds 계산보다 늦음 | §3.5 start 내부 2단계 enforcement |
| retry가 handleStart를 우회 | §3.5 공통 coordinator + start 재계산 |
| API name→disk fallback을 hasLocal이 오판 | §3.4 detailed resolver |
| `clearedImageFields`가 `imagePath`를 안 비움 | §3.1 불변식 범위 한정, §4 엣지 |
| 내부공백 정규화가 기존 tag matcher와 불일치 | §3.2 `normalizeTagKey` 공통화 |
| 배치 중 제거가 live object에 반영된다는 주장 | §3.5 late 정책, §4 비대칭 명시 |
| i18n 키 위치 오류 | §6 기존 `toast` 블록 내부로 교정 |
| 잘못된 라인 앵커 | 전 섹션 실제 코드 라인으로 교정 |

## 4. 엣지케이스

### 기능2 — 멘션 병합

1. `@queen이`처럼 조사가 붙은 멘션은 `queen이`가 아니라 resolve된 `ref.name`을 append한다.
2. 대소문자만 다른 기존 태그는 중복 삽입하지 않는다.
3. 내부 연속공백은 축약하지 않는다. `Mary Jane`과 `Mary  Jane`은 현재 tag 계약상 다른 key다.
4. character ref만 feature2 병합 대상으로 해석한다.
5. 동명 scene/style ref가 있어도 character가 병합되며, 기존 비-character ref는 stable identity dedup 때문에 삭제되지 않는다.
6. 동일 이름의 character 카드가 여러 개면 태그는 기존 의미대로 모두 매칭할 수 있다. 중복 이름 금지는 별도 스코프다.
7. 미해결 오타 멘션은 병합하지 않는다.
8. 기존 `characters`의 콤마/세미콜론/콜론 표현을 재직렬화하지 않는다.
9. prompt가 없거나 `characters`가 null이어도 안전하다.
10. 스타일 피커 또는 modal 재진입에도 멱등이다.
11. 변경 없는 씬에는 `updateScene`을 호출하지 않는다.
12. 병합 뒤 실제 생성이 시작되지 않아도 변경은 오토세이브로 영구 커밋된다.

### 기능1 — 제외 및 동기화

13. 병합 뒤에도 unmatched인 태그는 ref가 없으므로 기능1 대상이 아니다.
14. 제외 후 ref가 0개면 plain prompt로 진행한다.
15. local-only tag character는 syncGate 후 같은 run에서 fresh `mediaId`로 매칭돼야 한다.
16. mediaId-only unsynced character의 태그 사용은 syncGate 없이 유지한다.
17. entity-only synced character 멘션은 image input 없이 Flow mention segment로 유지한다.
18. `entityId + workflowId`가 있는 unsynced character 멘션은 registration repair 후보가 된다.
19. mediaId는 있지만 mention eligible이 아니고 repair도 불가능한 character는 멘션 사용만 제외한다. 같은 ref의 태그 사용은 유지할 수 있다.
20. `@synced + @사용불가` 혼합 멘션은 사용할 수 없는 쪽만 strip하고 synced 멘션은 유지한다.
21. 같은 ref가 태그와 멘션 양쪽에 쓰이면 via별 결정을 독립 적용한다.
22. 프리업로드 실패 ref는 단계 B final plan에서 제외하고 primary toast에 포함한다.
23. API name fallback 성공 ref는 로컬 필드가 비어 있어도 유지한다.
24. API stale filePath와 name fallback이 모두 실패하면 제외한다.
25. `imagePath`가 있는 CSV ref는 `sourceAvailable === true`다.
26. `clearedImageFields`를 적용해도 기존 `imagePath`가 남을 수 있다. 이를 자동으로 "이미지 없음"이라 단정하지 않는다.
27. style preset token은 ref가 아니므로 제외 대상이 아니다: [tagMatch.js:25-33](../../../src/utils/tagMatch.js#L25-L33).
28. `video-text` syncGate 경로는 이번 스코프 밖이다: [App.jsx:1548-1559](../../../src/App.jsx#L1548-L1559).

### 배치 도중 ref 변경

29. 프리업로드의 `uploadOne` 성공은 현재 객체를 직접 변이하므로 같은 run에서 관찰 가능하다.
30. UI/MCP 이미지 제거는 일반적으로 `setReferences`로 새 객체를 만들기 때문에 이미 시작된 closure가 옛 non-empty `mediaId`를 계속 볼 수 있다.
31. UI 이미지 추가 등 객체 교체 경로도 모두 live하다고 보장하지 않는다.
32. 이번 구현은 preupload 성공 patch를 run-local `currentRefs`에 명시 반영하지만, 배치 전체의 live-state 정책은 해결하지 않는다.
33. 배치 snapshot 또는 ref 편집 잠금 정책은 후속 설계로 남긴다.
34. final plan 뒤 관찰된 신규 invalid use는 late exclusion으로 누적하고 후속 토스트를 최대 1회 표시한다.

## 5. TDD 계획

모든 버그 수정은 현재 코드에서 실패하는 red를 먼저 재현한 뒤 구현한다.

### 5.1 태그 정규화 및 병합

`tests/utils/mentionTagMerge.test.js`

- 조사 붙은 멘션
- character-only 해석
- 대소문자 dedup
- 내부공백 비축약
- 빈 prompt / null characters
- append-only 문자열 보존
- 멱등성
- 변경 없는 씬 제외
- filter 및 원본 sceneIndex
- state 반영용 `scenePatchesById`

`tests/integration/referenceTagNormalization.test.js`

- `normalizeTagKey`를 병합, `collectTagErrors`, `getMatchingReferences`가 동일하게 사용
- 동일 입력에 세 함수 결과가 어긋나지 않음

### 5.2 순수 matcher 및 overlay

`tests/utils/sceneReferenceMatching.test.js`

- `(scene, explicitRefs)`가 hook closure refs를 사용하지 않음
- 태그+멘션 via 합집합
- 동일 ref의 다중 via 보존
- 타입이 다른 동명 ref를 name으로 dedup하지 않음
- ID 없는 ref의 run-local identity
- 동일 타입·동일 이름 중복 태그의 기존 all-match 의미
- merged-scene overlay 적용 전/후 결과를 명시적으로 고정

### 5.3 판정 술어와 plan

`tests/utils/refImageGuard.test.js`

매트릭스:

- `sourceAvailable`: data / filePath / imagePath / 없음
- `flowImageInjectable`: mediaId 있음/없음
- `flowMentionEligible`: entityId + synced 조합
- `flowRegistrationRepairable`: entityId + workflowId
- `flowSyncable`
- `flowTagCharacterNeedsSync`

필수 상태:

- entity-only synced mention
- local-only tag character
- mediaId-only unsynced tag character
- mediaId-only unsynced mention
- repair 가능한 unsynced mention
- same ref tag+mention의 독립 decision
- source 없는 non-character tag
- style preset 비대상

`clearedImageFields` 테스트는 다음으로 고정한다.

- mediaId/entityId/workflowId/sync 상태는 false
- 기존 imagePath는 현재 helper가 제거하지 않음
- 따라서 sourceAvailable false를 기대하지 않음

### 5.4 API resolver

`tests/utils/referenceResolver.test.js`

- name-only fallback 성공
- stale filePath 뒤 name fallback 성공
- stale filePath + name fallback 실패
- data 우선
- 빈 base64 실패
- detailed 결과의 ref별 성공/실패 대응

### 5.5 useAutomation 회귀 본체

`tests/hooks/useAutomation.imagelessRefs.test.jsx`

red:

- Flow 이미지 없는 태그 ref가 현재 `submitGeneration` payload에 `mediaId:null`로 들어감

green:

- pre-excluded ref는 `usedRefKeys`와 제출 refs에서 빠짐
- upload candidate는 used set에 포함되고 성공 뒤 final plan에서 유지
- upload 실패 ref는 final plan에서 제외
- excluded character mention의 `@`만 제거
- 다른 멘션은 보존
- 제외 후 ref 0개여도 prompt 제출
- `filePath: r.filePath || r.imagePath || null`
- primary toast 정확히 1회
- 여러 씬 exclusion 집계
- late exclusion은 배치 종료 시 후속 토스트 최대 1회

stale refs 회귀:

- syncGate가 만든 `currentRefsOverride`의 fresh mediaId를 태그 matcher가 사용
- closure references에는 mediaId가 없더라도 같은 run payload에는 fresh mediaId 포함
- matcher와 `submitGeneration(..., { references: effectiveRefs })`가 같은 refs snapshot 사용

### 5.6 App preflight 및 네 진입 경로

`tests/components/App.referencePreflight.test.jsx`

- 병합 state 반영 후 `collectTagErrors(effectiveScenes)` 실행
- TagValidationModal 취소 시 start/toast 없음
- 취소해도 병합 state는 유지
- local-only tag character만 syncGate 후보
- mediaId가 있는 unsynced tag character는 syncGate 후보 아님
- 이미지 없는 mention ref는 syncGate 후보가 아니라 exclusion
- sync 성공 뒤 patched refs로 plan 재계산
- tag proceed와 sync proceed에서 overlay 유실 없음

`tests/integration/referencePreflightEntryPaths.test.jsx`

동일한 effective scene/ref 입력에 대해 다음 네 경로의 최종 결과를 비교한다.

- direct
- tag-proceed
- sync-proceed
- retry

비교 항목:

- 최종 prompt
- 제출 ref IDs/mediaIds
- excluded use
- `@` strip 결과
- primary toast 횟수
- invalid Flow image input 부재

retry는 이전 plan을 재사용하지 않고 현재 scene/ref로 다시 계산해야 한다.

### 5.7 Flow 엔진 및 페이지 최종 방어

`tests/engine/engineFlow.test.jsx`

- image route에서 null/undefined/빈 mediaId 제거
- 유효 mediaId는 유지
- entity-only synced mention은 image ref가 없어도 scene route 유지
- 이미지 없는 unresolved mention은 IPC 전에 error라는 기존 인과 고정

`tests/electron/flow-page-injection.test.js`

`FLOW_PAGE_INJECTION`을 VM에서 실제 실행해 다음을 검증한다.

- null mediaId 미추가
- undefined mediaId 미추가
- 빈 문자열 mediaId 미추가
- 유효 mediaId만 `imageInputs`에 추가
- 기존 `req.imageInputs` 보존

### 5.8 i18n

`tests/locales/referenceExclusionKeys.test.js`

- ko/en 키 존재
- placeholder 집합 일치
- primary/late key 모두 존재
- `count`, `details`, `more` 치환 일치

### 5.9 실행 순서

각 파일별 red→green:

```bash
npx vitest run <test-file>
```

관련 묶음 회귀:

```bash
npx vitest run \
  tests/utils/mentionTagMerge.test.js \
  tests/utils/sceneReferenceMatching.test.js \
  tests/utils/refImageGuard.test.js \
  tests/utils/referenceResolver.test.js \
  tests/hooks/useAutomation.imagelessRefs.test.jsx \
  tests/components/App.referencePreflight.test.jsx \
  tests/integration/referencePreflightEntryPaths.test.jsx \
  tests/engine/engineFlow.test.jsx \
  tests/electron/flow-page-injection.test.js \
  tests/locales/referenceExclusionKeys.test.js
```

최종 전체 회귀:

```bash
npm run test:run
```

## 6. i18n

키는 `tagValidation` 옆이 아니라 기존 `toast` 객체 내부에 추가한다.

- 한국어 `toast` 블록: [ko.js:1374-1376](../../../src/locales/ko.js#L1374-L1376)
- 영어 `toast` 블록: [en.js:1375-1377](../../../src/locales/en.js#L1375-L1377)

```js
// ko.js — toast: { ... }
unusableRefsExcluded:
  '이번 생성에서 사용할 수 없는 레퍼런스 사용 {count}건을 제외했습니다: {details}',
unusableRefsExcludedMore:
  '이번 생성에서 사용할 수 없는 레퍼런스 사용 {count}건을 제외했습니다: {details} 외 {more}건',
unusableRefsExcludedLate:
  '생성 도중 사용할 수 없게 된 레퍼런스 사용 {count}건을 추가로 제외했습니다: {details}',
unusableRefsExcludedLateMore:
  '생성 도중 사용할 수 없게 된 레퍼런스 사용 {count}건을 추가로 제외했습니다: {details} 외 {more}건',

// en.js — toast: { ... }
unusableRefsExcluded:
  'Excluded {count} unusable reference use(s) from this generation: {details}',
unusableRefsExcludedMore:
  'Excluded {count} unusable reference use(s) from this generation: {details}, plus {more} more',
unusableRefsExcludedLate:
  'Excluded {count} additional reference use(s) that became unusable during generation: {details}',
unusableRefsExcludedLateMore:
  'Excluded {count} additional reference use(s) that became unusable during generation: {details}, plus {more} more',
```

집계 기준:

- `count`: scene/ref 사용 건수
- 같은 scene에서 같은 ref가 태그+멘션 양쪽에 있어도 1건
- 다른 scene에서 같은 ref가 제외되면 scene별 별도 건
- `details` 예: `#1: 민수, 숲 · #3: 민수`
- 표시 한도를 넘으면 `More` 키 사용
- 내부 `vias`와 `reasons`는 로그/테스트에 보존하지만 기본 토스트에는 노출하지 않음

## 7. 역할 분담 및 검증 방식

- 구현은 위 TDD 순서대로 진행한다.
- 각 BLOCKER/MAJOR 해소는 §3.7 추적표와 대응 테스트를 함께 확인한다.
- 코드 리뷰는 line anchor가 아니라 실제 raw code와 테스트 결과를 기준으로 한다.
- 마일스톤마다 Codex 독립 리뷰를 수행하고 findings 0까지 반복한다.
- 서버의 `{ name:null } → HTTP 500` 인과는 실제 로그 또는 재현 테스트를 확보하기 전까지 유력 원인으로만 표현한다.
- `CLAUDE.md`의 Flow 제거 주장은 별도 문서 정리 작업으로 추적한다.

## 8. 마일스톤 분할 (단계적 구현)

전체를 한 번에 구현하지 않고 M1(즉효) → M2(정밀)로 나눈다. M1은 사용자 핵심 고통(HTTP 500, 멘션-태그 혼동)을 빠르게 해소하고, M2가 stale refs·via별 정밀 판정·동기화 유도를 완성한다.

### M1 — 500 원천 차단 + 두 기능 기본형

포함:

- **§3.6 최종 방어선** — Flow `matchedRefs` 매핑 / `engineFlow` IPC 직전 / `flow-page-injection` push 직전에서 non-empty `mediaId`만 통과. `name:null`을 서버로 보내지 않는다. **이것이 M1의 500 차단 핵심이며, handleStart를 우회하는 재시도 경로까지 자동 커버한다.**
- **§3.1 순수 술어** — `sourceAvailable` / `flowImageInjectable` / `flowMentionEligible` / `flowSyncable` / `flowTagCharacterNeedsSync`. 판정 기반 유틸.
- **§3.2 멘션→태그 병합** — `normalizeTagKey`, `mergeMentionsIntoCharacters`, `planMentionTagMerges`. `handleStart` 초입에서 대상 씬에 `updateScene` 반영(영구 state). 기능2.
- **기능1 기본형** — `handleStart`에서 이미지 주입 불가(`!flowImageInjectable && !flowSyncable`) 참조를 감지해 그 씬에서 제외 + 집계 토스트. 이때 **기존 `getMatchingReferences(scene)`를 그대로 사용**하고 overlay/순수-matcher 리팩터는 하지 않는다.
- **§3.4 imagePath 유실 수정** — `filePath: r.filePath || r.imagePath || null`.
- **§6 i18n** — primary 토스트 키(ko/en). late 키는 M2.

M1의 알려진 제약(모두 M2에서 해소):

- **overlay 없음**: 병합은 state/뱃지/검증 표시용이다. 배치는 `getMatchingReferences`가 멘션을 합집합하므로 대체로 동일하게 동작하지만, **동명 scene/style shadowing 엣지(엣지 5)와 direct-vs-재진입 경로 미세 불일치는 M1에서 미해결**로 남긴다.
- **동기화 유도 없음**: 이미지가 있으나 미동기화인 태그-only character는 M1에서 `mediaId`가 없으면 **제외 처리**(토스트)된다. syncGate로 끌어 동기화시키는 흐름은 M2. (사용자가 택한 "동기화 케이스 포함"은 M2에서 완성된다.)
- **via별 정밀 독립판정·2단계 enforcement·4경로 coordinator 없음**: M1은 "주입 불가면 그 씬에서 제외" 수준. 프리업로드 실패 late exclusion, usedRefIds 정합은 M2.

M1 테스트 범위: §5.1 병합, §5.3 술어(매트릭스 일부), §5.7 최종 방어(engineFlow + flow-page-injection), §5.8 i18n(primary), 그리고 useAutomation의 "이미지 없는 태그 ref가 제출 payload에 mediaId:null로 안 들어간다" 회귀(§5.5 red 본체의 M1 부분).

### M2 — 정밀 preflight

포함:

- **§3.2 순수 matcher 분리** — `collectSceneReferenceUses` / `getMatchingReferences(scene, references)`, stable ref identity dedup(타입 무관 name dedup 제거).
- **§3.2 merged-scene overlay** — `applyScenePatches` → `effectiveScenes`가 검증·매칭·scene loop의 authoritative 입력.
- **§3.3 `planReferencePreflight`** — via별 독립 decision, `removals` 집계.
- **§3.4 API detailed resolver** — `resolveReferenceImageDetailed`, name→disk fallback 보존.
- **§3.5 2단계 enforcement + 4경로 coordinator + syncGate 동기화 유도(태그-only character 포함) + stale refs 완전 해결**.
- **§6 late 토스트 키**.

M2 테스트 범위: §5.2, §5.4, §5.5(stale refs 회귀 포함 전체), §5.6(네 진입 경로 동일성), §5.8(late).

### 마일스톤 게이트

- M1 완료 후 사용자 실앱 눈검증(Flow 모드에서 이미지 없는 태그 참조 배치 → 500 없이 제외+토스트, 멘션→태그 뱃지 반영)을 거친 뒤 M2 착수.
- 각 마일스톤 종료 시 Codex 독립 리뷰 findings 0까지 반복.
