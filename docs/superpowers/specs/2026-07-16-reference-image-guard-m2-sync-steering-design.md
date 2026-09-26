# M2a — via별 reference sync steering + fresh refs 반영 + mention composer 검증

작성일: 2026-07-16  
상태: 설계 확정 · 구현 전  
기준 코드: `7bf2e7e` (`feature/ref-image-guard-m1`, M1 완료)  
상위 스펙: [2026-07-16-reference-image-guard-and-mention-tag-merge-design.md](2026-07-16-reference-image-guard-and-mention-tag-merge-design.md) §3, §8  
이번 구현 범위: **M2a만**  
후속 범위: M2b/M2c는 개요만 정의하며 이번 구현에 포함하지 않는다.

---

## 1. 배경

M1은 다음을 구현했다.

- Flow image payload의 null/empty `mediaId` 최종 방어
- `sourceAvailable` / `flowImageInjectable` / `flowMentionEligible` / `flowSyncable` / `flowTagCharacterNeedsSync` 술어
- character 멘션 → `characters` 태그 영속 병합
- 사용할 수 없는 참조의 exclusion과 집계 토스트
- API 제출에서 `imagePath`를 `filePath`로 보존

M2 전체를 한 번에 구현하지 않는다.

- **M2a**: text/list 배치 생성의 sync steering과 same-run fresh refs
- **M2b**: 순수 matcher, merged-scene overlay, 범용 via preflight
- **M2c**: API detailed resolver, 2단계 enforcement, late toast, 4경로 coordinator

### 1.1 tag-only character가 syncGate에 들어오지 않는다

현재 생성 전 syncGate selector는 character `@멘션`만 검사한다.

- selector: [flowCharacterSync.js:72-83](../../../src/utils/flowCharacterSync.js#L72-L83)
- completion policy: [flowCharacterSync.js:85-90](../../../src/utils/flowCharacterSync.js#L85-L90)
- text/list direct gate: [App.jsx:1494-1511](../../../src/App.jsx#L1494-L1511)
- tag-validation proceed gate: [App.jsx:1803-1818](../../../src/App.jsx#L1803-L1818)

로컬 이미지 소스는 있지만 `mediaId`가 없는 tag-only character는 현재 다음처럼 처리된다.

1. `characters` 태그에는 매칭된다.
2. mention-only selector에는 잡히지 않는다.
3. M1 exclusion에는 잡힌다.
4. 최종 Flow image payload에서는 `mediaId`가 없어 제거된다.

관련 현재 코드:

- guard 술어: [refImageGuard.js:5-28](../../../src/utils/refImageGuard.js#L5-L28)
- M1 collector: [refImageGuard.js:35-90](../../../src/utils/refImageGuard.js#L35-L90)
- character image-use 분기: [refImageGuard.js:63-73](../../../src/utils/refImageGuard.js#L63-L73)

M2a는 local-only 태그 캐릭터를 exclusion과 sync candidate에 중복 분류하지 않고 syncGate로 유도한다.

### 1.2 sync 성공분이 같은 배치의 태그 매칭에 반영되지 않는다

현재 `handleSyncGateProceed`는 성공 patch를 `patchedRefs`에 누적하고 `proceed(patchedRefs)`로 전달한다.

- sync proceed 전체: [App.jsx:1835-1908](../../../src/App.jsx#L1835-L1908)
- plan-time target index 계산: [App.jsx:1845-1853](../../../src/App.jsx#L1845-L1853)
- live ref 조회: [App.jsx:1862-1864](../../../src/App.jsx#L1862-L1864)
- 성공 `proceed(patchedRefs)`: [App.jsx:1905](../../../src/App.jsx#L1905)
- `start()`의 `currentRefs` 수신: [useAutomation.js:449-473](../../../src/hooks/useAutomation.js#L449-L473)
- run-local `currentRefs`: [useAutomation.js:574-580](../../../src/hooks/useAutomation.js#L574-L580)
- queue의 `effectiveRefs`: [useAutomation.js:97-104](../../../src/hooks/useAutomation.js#L97-L104)

하지만 씬 루프의 태그 매칭은 hook closure를 사용한다.

- stale 호출과 Flow image filter: [useAutomation.js:284-297](../../../src/hooks/useAutomation.js#L284-L297)
- closure matcher: [useScenes.js:597-647](../../../src/hooks/useScenes.js#L597-L647)

멘션 해석과 `submitGeneration(..., { references: effectiveRefs })`는 fresh refs를 보지만, 태그 매칭과 `matchedRefs`는 이전 렌더의 ref 객체를 볼 수 있다.

M2a는 matcher에 refs 인자를 추가하는 최소 변경만 수행한다. 순수 matcher 분리와 scene overlay는 M2b로 미룬다.

### 1.3 composer 검증은 mention에만 필요하다

현재 `handleSyncGateProceed`는 `syncRefToFlow` 결과로 성공 수를 계산한 뒤 `refreshFlowComposer()` 결과를 무시한다.

- 현재 성공 판정: [App.jsx:1890-1892](../../../src/App.jsx#L1890-L1892)
- 현재 refresh 결과 무시: [App.jsx:1894](../../../src/App.jsx#L1894)
- refresh 필요 판정: [flowCharacterSync.js:117-122](../../../src/utils/flowCharacterSync.js#L117-L122)
- sync 실행: [flowCharacterSync.js:200-219](../../../src/utils/flowCharacterSync.js#L200-L219)

다만 composer 이름 반영은 모든 candidate의 공통 후조건이 아니다.

Flow 태그 이미지 제출은 `mediaId`를 가진 ref만 image payload로 주입한다.

- scene matcher 결과: [useAutomation.js:284](../../../src/hooks/useAutomation.js#L284)
- Flow `flowImageInjectable` filter: [useAutomation.js:286-287](../../../src/hooks/useAutomation.js#L286-L287)

따라서:

- `mention` via는 Flow composer/mention picker의 이름 반영이 중요하다.
- `characters` tag-only via는 `mediaId` protobuf 주입이 핵심이며 composer 이름과 무관하다.
- tag-only candidate를 composer refresh 성공에 종속시키면 `mediaId`가 생겼는데도 영구적으로 생성하지 못하는 루프가 생길 수 있다.

M2a는 `needsComposerRefresh` 기반 pending/failure 처리를 **`candidate.vias`에 `mention`이 포함된 경우에만** 적용한다.

### 1.4 기존 refresh coalescing은 게이트의 fresh refresh를 보장하지 않는다

현재 refresh IPC는 같은 projectId의 refresh가 진행 중이면 기존 promise를 반환한다.

- handler와 same-pid coalescing: [character.js:1087-1099](../../../electron/ipc/character.js#L1087-L1099)
- 실제 `doRefreshComposer`: [character.js:1100-1132](../../../electron/ipc/character.js#L1100-L1132)
- `{ success: !!ready }` 반환: [character.js:1127](../../../electron/ipc/character.js#L1127)
- preload 전달: [preload.js:195](../../../electron/preload.js#L195)

패널이나 카드의 fire-and-forget refresh가 sync PATCH 전에 시작됐을 수 있다. 게이트가 그 promise에 합류하면 다음 순서가 가능하다.

```text
기존 refresh 시작
→ syncGate가 character registration PATCH 완료
→ syncGate refresh 호출
→ 기존 same-pid promise 반환
→ success:true
```

이 경우 반환된 refresh는 방금 등록한 이름보다 먼저 시작됐으므로 새 이름 반영을 보장하지 못한다.

M2a는 게이트 refresh가 기존 in-flight refresh에 합류하지 않고 새 refresh를 queue에 넣는 IPC 옵션을 추가한다.

`success:true`가 코드상 보장하는 것은 composer editor ready까지다. 실제 mention picker에 canonical 이름이 보이는지는 실앱 검증 게이트로 확인한다.

### 1.5 실패 통지는 명시적 모달 상태 전환이어야 한다

현재 fail-closed 정책은 유지되지만 실패는 toast로만 알린다.

- 현재 `toast.error`: [App.jsx:1899](../../../src/App.jsx#L1899)
- 현재 sync 필요 modal: [App.jsx:2912-2939](../../../src/App.jsx#L2912-L2939)

실패 시 기존 `syncGate`를 닫지 않고 failure modal만 추가하면 두 모달과 기존 `proceed` closure가 함께 남는다.

M2a는 다음 상태 전환을 고정한다.

```text
실패 상세 캡처
→ setSyncGate(null)
→ setSyncFailureModal(...)
→ batch 중단
```

---

## 2. 확정 UX

### 2.1 트리거

M2a image sync steering은 Flow 모드의 이미지 배치 생성에만 적용한다.

- `text` 탭 전체 생성
- `list` 탭 전체 생성
- 같은 `handleStart`를 타는 전체 강제 재생성

다음 경로는 M2a 범위 밖이다.

- video-text
- retryErrors
- text/list 개별 retry
- frame-to-video
- API mode reference resolver

### 2.2 정상 흐름

1. 사용자가 text/list 배치 생성을 시작한다.
2. 대상 씬의 reference use를 via별로 판정한다.
3. exclusion과 sync candidate를 하나의 plan에서 계산한다.
4. sync candidate가 있으면 시작 시도당 sync 필요 modal을 1회 표시한다.
5. 사용자가 확인하면 candidate를 직렬 처리한다.
6. 각 candidate가 자신의 via 후조건을 만족하는지 확인한다.
7. `mention` candidate 중 필요한 대상이 있으면 composer refresh를 한 번 새로 enqueue하고 결과를 검증한다.
8. 모든 candidate가 최종 성공하면 fresh refs로 배치를 시작한다.
9. 기존 생성 완료 흐름까지 자동으로 진행한다.

tag-only candidate만 있는 경우 composer refresh는 성공 조건이 아니며, 해당 candidate 때문에 refresh를 호출하지 않는다.

### 2.3 실패 흐름

다음은 image syncGate 실패다.

- candidate ref가 삭제됐거나 identity를 안전하게 재해석할 수 없음
- 다른 sync 작업이 진행 중
- `syncRefToFlow` 실패
- candidate가 via별 제출 후조건을 만족하지 못함
- `mention` candidate에 필요한 composer refresh API가 없음
- `mention` candidate의 composer refresh가 throw하거나 `{ success:false }`를 반환함

composer refresh 실패는 `mention` candidate에만 적용한다. tag-only candidate는 `flowImageInjectable(ref) === true`이면 refresh 결과와 무관하게 최종 성공이다.

실패 시:

1. 성공 patch는 reference state에 보존한다.
2. refresh가 필요한 mention 대상만 재시도 가능한 `refresh-failed` 상태로 둔다.
3. 실패 상세를 로컬 변수에 캡처한다.
4. 기존 sync 필요 modal을 닫는다.
5. failure modal을 표시한다.
6. failure modal 확인은 해당 modal만 닫는다.
7. 원래 `proceed` closure는 폐기한다.
8. 이번 배치는 시작하지 않는다.

### 2.4 via별 최종 성공 정의

| candidate via | 최종 성공 후조건 | composer refresh 관여 |
|---|---|---|
| `mention` | `flowMentionEligible(ref) === true` | 해당 sync 결과에 `needsComposerRefresh === true`이면 forced fresh refresh 성공 필요 |
| `characters` | `flowImageInjectable(ref) === true` | 관여하지 않음 |
| `mention + characters` | 위 두 조건 모두 true | mention 후조건에 대해서만 refresh 적용 |
| 이전 mention refresh 복구 | forced fresh refresh 성공 후 `flowMentionEligible(ref) === true` | 필수 |
| tag-only `refresh-failed` ref | 현재 tag use가 injectable이면 성공 | 복구 대상으로 올리지 않음 |

핵심 조건:

```js
// normal sync candidate(syncRefToFlow 를 탄 경우) 한정 — res.result 가 있어야 한다.
// refresh-only recovery candidate 는 res.result 가 없어 needsComposerRefresh(ref, undefined) 가
//   !result 로 false 를 반환한다(flowCharacterSync.js:118). 그 경로는 §4.7 의
//   requiresComposerRecovery 로 별도 판정한다.
const mentionNeedsComposerRefresh =
  candidate.vias.includes('mention') &&
  needsComposerRefresh(effectiveRef, res.result)
```

다음은 금지한다.

```js
// 금지: via와 무관하게 모든 candidate를 refresh pending으로 만듦
needsComposerRefresh(effectiveRef, res.result)
```

### 2.5 fail-closed 정책

기존 `planSyncGateCompletion` 정책은 유지한다.

```js
fail > 0
  ? { proceed: false, outcome: 'incomplete' }
  : { proceed: true, outcome: 'complete' }
```

부분 성공이어도 배치를 시작하지 않는다.

이미지나 동기화 소스가 없는 use는 sync 실패가 아니라 exclusion이다. 해당 use만 제외하고 나머지 입력으로 생성한다.

---

## 3. 경로 매트릭스

| 진입 경로 | 현재 앵커 | M2a guard | sync 필요 modal | image failure modal | 정책 |
|---|---:|---:|---:|---:|---|
| text/list direct | [App.jsx:1411-1517](../../../src/App.jsx#L1411-L1517) | 적용 | 적용 | 적용 | M2a 주 경로 |
| direct image gate | [App.jsx:1494-1511](../../../src/App.jsx#L1494-L1511) | 공통 router로 교체 | 적용 | 적용 | via별 candidates |
| tag-validation proceed | [App.jsx:1743-1827](../../../src/App.jsx#L1743-L1827) | 현재 refs로 재계산 | 적용 | 적용 | direct와 같은 helper |
| tag-proceed gate | [App.jsx:1803-1818](../../../src/App.jsx#L1803-L1818) | 공통 router로 교체 | 적용 | 적용 | stale pending plan 사용 금지 |
| image sync proceed | [App.jsx:1835-1908](../../../src/App.jsx#L1835-L1908) | 계산된 candidate 소비 | 기존 modal 확인 | 적용 | via 후조건 + mention refresh 검증 |
| video-text batch | [App.jsx:1520-1623](../../../src/App.jsx#L1520-L1623) | 미적용 | 기존 동작 | 미적용 | `kind:'video'` |
| video mention selector | [App.jsx:1612-1619](../../../src/App.jsx#L1612-L1619) | mention-only 유지 | 기존 동작 | 미적용 | tag 후보 확장 금지 |
| retryErrors | [App.jsx:2401-2437](../../../src/App.jsx#L2401-L2437) | 미적용 | 미적용 | 미적용 | M2c에서 정책 결정 |
| text 개별 retry | [App.jsx:2523-2545](../../../src/App.jsx#L2523-L2545) | 미적용 | 미적용 | 미적용 | `handleStart` 우회 |
| list 개별 retry | [App.jsx:2623-2645](../../../src/App.jsx#L2623-L2645) | 미적용 | 미적용 | 미적용 | `handleStart` 우회 |
| API mode 이미지 생성 | 동일 text/list 진입 | 미적용 | 미적용 | 미적용 | M2c detailed resolver 범위 |

M2a에서 `syncGate.kind`를 도입한다.

- `kind:'image'`: M2a candidate contract, via 후조건, mention-only composer 검증, failure modal
- `kind:'video'`: 기존 mention-only selector와 기존 실패 toast 유지

video candidate 선정과 실패 UX를 M2a image 정책으로 확장하지 않는다.

---

## 4. M2a 설계

### 4.1 구현 범위와 대상 파일

M2a에 포함한다.

1. via별 character 후보 판정
2. M1 exclusion과 sync candidate의 단일 plan
3. direct/tag-proceed 공통 image routing
4. `syncGate.kind`와 candidate metadata
5. plan-time index를 현재 refs에서 안전하게 재해석
6. fresh refs를 matcher/preupload/scene loop에 전달
7. mention-only composer refresh 성공 판정
8. 게이트 전용 forced fresh refresh IPC
9. mention refresh 실패 상태
10. image failure modal 상태 전환
11. ko/en i18n
12. 관련 TDD와 실앱 검증

주요 변경 파일:

- `src/utils/refImageGuard.js`
- `src/App.jsx`
- `src/hooks/useScenes.js`
- `src/hooks/useAutomation.js`
- `electron/ipc/character.js`
- `src/locales/ko.js`
- `src/locales/en.js`
- 관련 unit/integration/component/electron IPC tests

`electron/preload.js`는 이미 payload를 그대로 IPC에 넘긴다: [preload.js:195](../../../electron/preload.js#L195). 별도 preload 계약 변경은 필요하지 않다.

M2a에 포함하지 않는다.

- 순수 matcher 파일 분리
- 타입 무관 name dedup 제거
- merged-scene overlay
- 범용 `planReferencePreflight`
- API detailed resolver
- preupload 이후 2단계 enforcement
- late exclusion toast
- retry를 포함한 4경로 coordinator
- retry에서 sync modal을 열지 여부
- video selector/실패 UX 확장
- 패널·상세 모달·카드 sync completion 통합

### 4.2 via별 판정과 mention-only composer 상태

현재 M1 술어는 유지한다.

```js
sourceAvailable(ref)
  = !!(ref?.data || ref?.filePath || ref?.imagePath)

flowImageInjectable(ref)
  = !!ref?.mediaId

flowMentionEligible(ref)
  = isRefSynced(ref)

flowRegistrationRepairable(ref)
  = !!(ref?.entityId && ref?.workflowId)

flowSyncable(ref)
  = flowRegistrationRepairable(ref)
    || (!flowImageInjectable(ref) && sourceAvailable(ref))

flowTagCharacterNeedsSync(ref)
  = !flowImageInjectable(ref) && sourceAvailable(ref)
```

단일 candidate predicate로 `flowSyncable`을 사용하지 않는다.

`flowSyncable`은 **mention needs-sync 판정에만** 사용한다. `characters` via는 `flowTagCharacterNeedsSync`를 사용한다.

#### via별 character 판정

| via | 상태 | 결정 |
|---|---|---|
| `mention` | `flowComposerRefreshPending` | `refresh-composer` |
| `mention` | `flowMentionEligible` | keep |
| `mention` | eligible 아님 + `flowSyncable` | needs-sync |
| `mention` | eligible 아님 + sync 불가 | exclude mention |
| `characters` | `flowImageInjectable` | keep image |
| `characters` | `flowTagCharacterNeedsSync` | needs-sync |
| `characters` | mediaId 없음 + source 없음 | exclude tag |

중요 조건:

- `characters` 판정에 `!isRefSynced`를 사용하지 않는다.
- `characters` 판정에 범용 `flowSyncable`을 사용하지 않는다.
- `characters` 판정은 `flowNameSyncStatus`가 `failed` 또는 `refresh-failed`인지 보지 않는다.
- tag-only ref에 `mediaId`가 있으면 정상 image use다.
- `refresh-failed` 복구 예외는 현재 use에 `mention`이 있을 때만 적용한다.
- 같은 ref가 tag와 mention 양쪽에 쓰이면 각 via를 먼저 독립 판정한 뒤 결과를 합친다.

#### composer refresh 복구 상태

다음 상태를 추가한다.

```js
flowNameSyncStatus: 'refresh-failed'
```

의미:

- backend sync patch는 성공했다.
- 현재 image syncGate의 mention use에 이름 반영이 필요했다.
- composer fresh refresh가 성공하지 않았다.
- 이번 mention sync 작업은 완료되지 않았다.

보조 술어:

```js
flowComposerRefreshPending(ref)
  = ref?.flowNameSyncStatus === 'refresh-failed'
```

적용 범위:

```text
current candidate에 mention 있음
+ ref가 refresh-failed
→ refresh-composer 복구 candidate
```

tag-only use에서는:

```text
ref가 refresh-failed
+ mediaId 있음
→ keep image
→ refresh candidate 아님
```

refresh 실패 시 `refresh-failed`로 되돌리는 것도 mention candidate에만 적용한다. tag-only candidate는 이 상태로 보내지 않는다.

기존 `isRefSynced`는 `flowNameSyncStatus === 'synced'`만 성공으로 본다: [flowCharacterSync.js:29-38](../../../src/utils/flowCharacterSync.js#L29-L38).

### 4.3 단일 M2a guard plan

`src/utils/refImageGuard.js`에 다음 순수 planner를 둔다.

```js
planM2aFlowReferenceGuard(
  scenes,
  references,
  {
    targetSceneIds,
    getMatchingReferences,
  }
)
  -> {
       syncCandidates: [
         {
           ref,
           refKey,
           refIndex,
           vias,
           sceneIds,
           viaDecisions,
           action,
           requiresComposerRecovery,
         }
       ],
       exclusions: [
         {
           sceneId,
           sceneIndex,
           refId,
           refKey,
           refName,
           vias,
         }
       ],
       mentionNamesBySceneId: {
         [sceneId]: string[]
       }
     }
```

`refIndex`는 plan-time snapshot 정보다. proceed 시 patch 위치로 직접 사용하지 않는다.

#### character use 수집

1. `references`에서 character ref와 plan-time `refIndex`를 수집한다.
2. `scene.characters`는 `splitTags`로 파싱한다.
3. prompt mention은 character refs만 넘겨 `resolveMentions`한다.
4. 같은 ref가 여러 씬 또는 여러 via에 쓰였으면 `sceneIds`와 `vias`를 합친다.
5. 각 via를 keep / needs-sync / refresh-composer / exclude로 독립 판정한다.
6. 같은 via를 candidate와 exclusion 양쪽에 넣지 않는다.

현재 유틸 앵커:

- `resolveMentions`: [mentionParser.js:80-103](../../../src/utils/mentionParser.js#L80-L103)
- `normalizeTagKey`: [tagMatch.js:8-10](../../../src/utils/tagMatch.js#L8-L10)
- `splitTags`: [tagMatch.js:13-16](../../../src/utils/tagMatch.js#L13-L16)

character mention 해석에는 character refs만 전달한다. 동명 scene/style ref가 character mention을 가리는 문제를 만들지 않는다.

#### candidate action 병합

한 ref의 via decision이 다를 수 있으므로 candidate에 `viaDecisions`를 보존한다.

예:

```js
{
  vias: ['mention', 'characters'],
  viaDecisions: {
    mention: 'refresh-composer',
    characters: 'needs-sync',
  },
  action: 'sync',
  requiresComposerRecovery: true,
}
```

action 우선순위:

```text
어느 via든 needs-sync → action:'sync'
그 외 mention refresh 복구 필요 → action:'refresh-composer'
```

`action:'sync'`라도 `requiresComposerRecovery:true`이면 sync 후 forced composer refresh가 필요하다.

candidate의 `vias`에는 exclusion되지 않은 현재 character use를 보존한다. 최종 성공 판정은 이 `vias`의 후조건을 모두 확인한다.

#### stable identity와 proceed 재해석

ID가 있으면 ID를 우선한다.

ID가 없는 ref는 다음 snapshot 정보로 `refKey`를 만든다.

```text
type
+ normalized name
+ source/entity/media fingerprint
+ 동일 fingerprint 안의 snapshot ordinal
```

snapshot ordinal은 planner dedup과 modal key를 위한 값이지 현재 배열 index를 선택하는 권한이 아니다.

proceed에서는 다음 helper로 현재 ref를 다시 찾는다.

```js
resolveCurrentM2aCandidate(candidate, currentRefs)
  -> { ref, refIndex } | { error: 'gone' | 'identity-ambiguous' }
```

재해석 순서:

1. ID가 있으면 현재 refs에서 동일 ID 검색
2. ID-less면 snapshot object identity 검색
3. identity가 없으면 snapshot fingerprint로 검색
4. 정확히 한 건이면 현재 `refIndex` 반환
5. 0건이면 `gone`
6. 여러 건이면 `identity-ambiguous`

금지:

```js
referencesRef.current[candidate.refIndex]
```

plan-time index는 modal이 열린 사이 ref가 추가·삭제되면 다른 ref를 가리킬 수 있다.

각 state/run-local patch도 현재 list에서 candidate identity를 다시 해석한 뒤 적용한다. 첫 sync patch로 새 entity/workflow/media ID를 얻으면 runtime binding에 반영해 후속 refresh 상태 patch의 식별력을 높인다.

해석이 모호하면 잘못된 ref를 패치하지 않고 fail-closed 처리한다.

#### 기존 M1 collector 처리

`collectM1FlowReferenceExclusions`는 M2a planner로 **대체 후 삭제**한다.

- export 삭제
- App import/호출 삭제
- 새 planner가 character via 판정과 기존 non-character exclusion을 함께 산출
- `applyM1MentionExclusions`와 exclusion toast builder는 유지

현재 collector:

- 구현: [refImageGuard.js:35-90](../../../src/utils/refImageGuard.js#L35-L90)
- integration import: [referenceImageGuardM1.test.jsx:7](../../../tests/integration/referenceImageGuardM1.test.jsx#L7)
- integration 호출: [referenceImageGuardM1.test.jsx:70](../../../tests/integration/referenceImageGuardM1.test.jsx#L70)

`tests/integration/referenceImageGuardM1.test.jsx`도 새 planner contract로 갱신한다. collector만 삭제하고 테스트 import를 남기면 테스트 로딩 단계에서 실패한다.

#### non-character M1 동작

scene/style refs의 기존 M1 정책은 유지한다.

- `flowImageInjectable`이면 keep
- source가 있어 기존 preupload 경로를 탈 수 있으면 keep
- source와 mediaId가 모두 없으면 exclusion
- style preset token은 ref가 아니므로 candidate/exclusion 대상이 아님

planner는 `getMatchingReferences(scene, references)`를 사용하되 character via는 직접 판정한다.

### 4.4 App routing과 M1 exclusion 통합

현재 App은 M1 collector와 mention-only selector를 분리해 호출한다.

- 현재 M1 plan 생성: [App.jsx:1323-1350](../../../src/App.jsx#L1323-L1350)
- direct exclusion toast 구성: [App.jsx:1443](../../../src/App.jsx#L1443)
- direct toast/gate: [App.jsx:1480-1511](../../../src/App.jsx#L1480-L1511)
- tag-proceed toast/gate: [App.jsx:1785-1818](../../../src/App.jsx#L1785-L1818)

M2a에서는 direct와 tag-proceed가 같은 App-level helper를 사용한다.

```js
routeM2aImageBatchStart({
  targetSceneIds,
  startOptions,
  onStart,
})
```

동작:

```text
Flow mode가 아니면 onStart(startOptions)
→ 현재 scenes/refs로 planM2aFlowReferenceGuard
→ exclusions 집계 toast 1회
→ mentionNamesBySceneId를 startOptions에 반영
→ syncCandidates 있으면 kind:'image' syncGate 설정 후 return
→ 없으면 onStart(guardedStartOptions)
```

```js
const guardedStartOptions = {
  ...startOptions,
  m1ExcludedMentionNamesBySceneId: guard.mentionNamesBySceneId,
}
```

sync 성공 proceed:

```js
proceed: (patchedRefs) => onStart({
  ...guardedStartOptions,
  currentRefs: patchedRefs,
})
```

#### direct 경로

현재 [App.jsx:1494-1511](../../../src/App.jsx#L1494-L1511)의 mention-only gate를 공통 router 호출로 교체한다.

초기 `handleStartImpl`에서 `collectM1FlowReferenceExclusions`를 미리 계산하지 않는다. 실제 image routing 시점에 exclusion과 sync candidate를 한 번에 계산한다.

#### tag-validation proceed

현재 [App.jsx:1803-1818](../../../src/App.jsx#L1803-L1818)의 mention-only gate를 같은 router 호출로 교체한다.

modal이 열린 사이 scene/ref가 바뀔 수 있으므로 proceed 시점의 현재 상태로 plan을 다시 계산한다.

기존 pending option의 `__m1ExclusionToast`는 제거한다. stale plan이나 stale toast를 authoritative 입력으로 사용하지 않는다.

mode/project/auth/Flow-ready 재검증은 유지한다: [App.jsx:1750-1784](../../../src/App.jsx#L1750-L1784).

#### mention merge와 same-tick 범위

M1 mention→tag 병합은 현재처럼 `handleStartImpl` 초기에 state에 영속 반영한다: [App.jsx:1328-1340](../../../src/App.jsx#L1328-L1340).

M2a는 merged-scene overlay를 만들지 않는다.

- direct plan은 원본 prompt mention을 통해 candidate를 찾는다.
- tag-proceed는 재렌더된 `characters`를 볼 수 있다.
- direct same-tick에서 새 tag use까지 authoritative하게 합치는 것은 M2b 범위다.
- 구체적인 same-tick media gap은 §6에 기록한다.

### 4.5 syncGate와 failure state 계약

현재 상태:

- [App.jsx:119-120](../../../src/App.jsx#L119-L120)

M2a 상태:

```js
const [syncGate, setSyncGate] = useState(null)
const [syncGateBusy, setSyncGateBusy] = useState(false)
const [syncFailureModal, setSyncFailureModal] = useState(null)
```

`syncGate` shape:

```js
{
  kind: 'image' | 'video',
  candidates: [
    {
      ref,
      refKey,
      refIndex,
      vias,
      sceneIds,
      viaDecisions,
      action,
      requiresComposerRecovery,
    }
  ],
  proceed: (patchedRefs) => void,
}
```

image direct/tag-proceed는 `kind:'image'`를 사용한다.

video는 기존 mention-only selector를 유지하면서 shape만 정규화한다.

```js
{
  kind: 'video',
  candidates: unsyncedMentioned.map(ref => ({
    ref,
    refKey,
    vias: ['mention'],
  })),
  proceed,
}
```

modal list key는 `candidate.refKey`를 사용한다. 현재 `r.id` 기반 key는 ID-less ref에서 충돌할 수 있다.

`syncFailureModal` shape:

```js
{
  failures: [
    {
      refKey,
      id,
      name,
      vias,
      reason,
      detail,
      recoveryAction,
    }
  ]
}
```

### 4.6 stale refs 최소 해소

M2a에서는 순수 matcher 파일이나 merged-scene overlay를 도입하지 않는다.

#### `useScenes.getMatchingReferences`

현재 matcher: [useScenes.js:597-647](../../../src/hooks/useScenes.js#L597-L647)

contract를 다음처럼 확장한다.

```js
getMatchingReferences(scene, refs = references)
```

내부의 다음 사용을 모두 `refs`로 변경한다.

- 빈 배열 검사
- character loop
- scene loop
- style loop
- `resolveMentions(scene.prompt, refs)`

기존 caller가 두 번째 인자를 생략하면 현재 closure 동작을 유지한다.

현재 타입 무관 name dedup은 변경하지 않는다. 순수 matcher 분리와 dedup 교정은 M2b 범위다.

#### `useAutomation` preupload

현재 run-local refs와 stale preupload matcher:

- [useAutomation.js:574-592](../../../src/hooks/useAutomation.js#L574-L592)

M2a:

```js
for (const scene of targetScenes) {
  for (const ref of getMatchingReferences(scene, currentRefs)) {
    if (ref?.id != null) usedRefIds.add(ref.id)
  }
}

let refsToUpload =
  selectRefsToRegister(currentRefs, usedRefIds, mode)
```

preupload 진단 로그도 `references`가 아니라 `currentRefs`를 사용한다.

#### `useAutomation` scene loop

현재:

```js
const allMatched = getMatchingReferences(scene)
```

위치: [useAutomation.js:284](../../../src/hooks/useAutomation.js#L284)

M2a:

```js
const allMatched =
  getMatchingReferences(scene, effectiveRefs)
```

이 `allMatched`가 다음 경로에 그대로 사용돼야 한다.

- Flow `flowImageInjectable` filter
- `matchedRefs` mapping
- `resolveSceneStyle`
- 최종 `submitGeneration`

같은 scene 제출에서 다음 세 경로가 같은 refs snapshot을 사용한다.

```text
getMatchingReferences(scene, effectiveRefs)
resolveMentions(scene.prompt, effectiveRefs)
submitGeneration(..., { references: effectiveRefs })
```

tag-only sync로 얻은 fresh `mediaId`가 같은 배치의 `matchedRefs`에 포함돼야 한다.

### 4.7 image sync 실행과 mention composer 검증

현재 handler: [App.jsx:1835-1908](../../../src/App.jsx#L1835-L1908)

`kind:'image'`에 다음 strict pipeline을 적용한다. `kind:'video'`는 기존 mention-only 동작과 failure toast를 유지한다.

#### 유지할 기존 동작

- `syncGateBusy` 중복 실행 방지
- candidate 직렬 처리
- `resolveSyncTarget`으로 live 상태 재판정
- project/scope 전달
- `publishResult`를 operation flight 안에서 실행
- 성공 여부와 무관하게 유효 patch 보존
- `planSyncGateCompletion` fail-closed
- 성공 시 fresh refs를 proceed에 전달

#### 결과 record

즉시 카운터만 증가시키지 않고 record를 수집한다.

```js
finalSuccesses = [
  {
    candidate,
    ref,
    result,
  }
]

mentionRefreshPending = [
  {
    candidate,
    ref,
    result,
    recoveryOnly,
  }
]

failures = [
  {
    refKey,
    id,
    name,
    vias,
    reason,
    detail,
    recoveryAction,
  }
]
```

failure reason 최소 집합:

```text
gone
identity-ambiguous
in-flight
sync-failed
postcondition-failed
composer-refresh-unavailable
composer-refresh-failed
```

#### current ref 재해석

handler 시작 시 run-local refs는 현재 state를 기준으로 잡는다.

```js
let patchedRefs = referencesRef.current
```

각 candidate 직전에 `resolveCurrentM2aCandidate(candidate, referencesRef.current)`로 현재 ref와 현재 index를 구한다.

현재 [App.jsx:1845-1853](../../../src/App.jsx#L1845-L1853)의 plan-time `gateTargets`와 [App.jsx:1862-1864](../../../src/App.jsx#L1862-L1864)의 ID-less `referencesRef.current[refIndex]` 사용은 제거한다.

다음에 전달하는 `refIndex`는 재해석된 현재 index다.

- `syncRefToFlow(..., { refIndex })`
- `updateReferences` patch
- run-local `patchedRefs` patch

삭제 또는 ambiguity이면 잘못된 대상을 패치하지 않고 failure로 기록한다.

#### via 후조건

```js
function candidatePostconditions(candidate, ref) {
  if (
    candidate.vias.includes('mention') &&
    !flowMentionEligible(ref)
  ) return false

  if (
    candidate.vias.includes('characters') &&
    !flowImageInjectable(ref)
  ) return false

  return true
}
```

`already-synced`도 무조건 성공으로 계산하지 않는다.

- mention-only + eligible → 성공 가능
- characters 포함 + mediaId 없음 → postcondition failure
- mention+characters → 두 조건 모두 검사

#### normal sync candidate

```text
현재 candidate 재해석
→ resolveSyncTarget(live)
→ action:'sync'이면 syncRefToFlow
→ patch를 state와 patchedRefs에 반영
→ res.ok 확인
→ effective ref로 via 후조건 확인
→ mention에 한해서 needsComposerRefresh 확인
```

분기:

```js
if (!res.ok) {
  failure('sync-failed')
} else if (!candidatePostconditions(candidate, effectiveRef)) {
  failure('postcondition-failed')
} else if (
  candidate.vias.includes('mention') &&
  (
    candidate.requiresComposerRecovery ||
    needsComposerRefresh(effectiveRef, res.result)
  )
) {
  mentionRefreshPending.push(...)
} else {
  finalSuccesses.push(...)
}
```

tag-only candidate는 `needsComposerRefresh`로 pending 처리하지 않는다.

```js
candidate.vias.every(via => via === 'characters')
```

이면 `flowImageInjectable(effectiveRef)` 후조건을 통과하는 즉시 최종 성공이다.

#### refresh-only recovery candidate

`action:'refresh-composer'`는 현재 candidate에 mention이 있을 때만 허용한다.

이 candidate는 `syncRefToFlow`를 다시 호출하지 않는다. mention refresh pending 집합에 추가한다.

refresh-failed ref는 `isRefSynced`가 false라 `resolveSyncTarget(live)`가 항상 `{ action:'sync' }`를 돌려준다([flowCharacterSync.js:138-142](../../../src/utils/flowCharacterSync.js#L138-L142)). 그래서 recovery candidate에서는 `resolveSyncTarget`의 `gone`/`in-flight`/`already-synced` 판정만 사용하고 `sync` 결과는 무시한다 — 재업로드 없이 composer refresh 복구만 수행하기 위해서다. (`already-synced`면 via 후조건 재검사로 간다.)

tag-only candidate에 `action:'refresh-composer'`가 생성되면 planner 버그다.

#### forced fresh refresh IPC

mention refresh pending이 하나 이상일 때 한 번 호출한다.

```js
const refreshResult =
  await window.electronAPI?.refreshFlowComposer?.({
    projectId: syncFlowProjectId,
    force: true,
  })
```

여기서 `force:true`의 의미는 navigation 직렬화를 우회한다는 뜻이 아니다.

- 기존 refresh queue 뒤에 새 refresh를 enqueue
- 같은 PID의 기존 active promise에 coalesce하지 않음
- 게이트가 호출한 새 refresh 자신의 결과를 반환
- panel/card의 기본 호출은 기존 coalescing 유지

`electron/ipc/character.js`의 현재 handler를 다음 의미로 변경한다.

```js
const force = opts.force === true

if (
  !force &&
  refreshActivePromise &&
  refreshActivePid === pid
) {
  return refreshActivePromise
}

const prev = refreshChain
const p = (async () => {
  await prev.catch(() => {})
  return doRefreshComposer({
    ...opts,
    projectId: pid,
  })
})()

// tail bookkeeping — forced/non-forced 모두 동일하게 수행한다.
refreshChain = p.catch(() => {})
refreshActivePid = pid
refreshActivePromise = p
return p
```

`force:true`도 `refreshChain` 뒤에서 직렬 실행된다. 차이는 기존 promise를 반환하지 않고 새 `p`를 만든다는 점이다.

forced 분기도 위 tail 3종(`refreshChain` / `refreshActivePid` / `refreshActivePromise`)을 반드시 갱신해야 한다. 빠뜨리면 forced refresh 진행 중 발행된 후속 기본 refresh가 옛 chain 뒤에 붙어 동시 navigation(ERR_ABORTED, `#R34-fix`가 막은 그 버그)이 재발한다.

App은 모든 sync PATCH와 patch publish를 끝낸 뒤 forced refresh를 호출한다. 따라서 해당 refresh는 sync 이전에 시작된 same-pid refresh 결과를 성공으로 오인하지 않는다.

#### refresh 성공

성공 조건:

```js
refreshResult?.success === true
```

성공 시:

- normal mention pending은 최종 success
- refresh-only recovery는 다음 patch를 state와 run-local refs에 적용

```js
{
  flowNameSyncStatus: 'synced',
  registered: true,
}
```

그 뒤 mention via 후조건을 다시 확인한다.

```js
flowMentionEligible(ref) === true
```

#### refresh 실패

다음은 모두 실패다.

- API 없음
- throw
- `{ success:false }`
- truthy 객체지만 `success !== true`

실패 대상은 `mentionRefreshPending`에 있는 candidate만이다.

normal mention candidate:

```js
{
  flowNameSyncStatus: 'refresh-failed',
  registered: false,
}
```

보존할 필드:

- `entityId`
- `workflowId`
- `mediaId`
- 이미지 source
- caption
- 기타 성공 patch

refresh-only recovery candidate는 `refresh-failed`를 유지한다.

tag-only success는 refresh 실패 때문에 failure 또는 `refresh-failed`로 바꾸지 않는다. 다만 다른 mention candidate가 실패했으므로 전체 배치는 fail-closed로 중단될 수 있다.

#### entity-synced + mediaId 없는 tag candidate

현재 `resolveSyncTarget`은 synced ref를 `already-synced`로 skip한다: [flowCharacterSync.js:138-142](../../../src/utils/flowCharacterSync.js#L138-L142).

또한 entity/workflow가 있는 ref가 sync로 들어가더라도 `planCharacterSync`는 `repair-registration`을 선택한다: [flowCharacterSync.js:160-172](../../../src/utils/flowCharacterSync.js#L160-L172). registration repair만으로 새 `mediaId`가 생긴다고 단정할 수 없다.

따라서 다음 상태는 자동 반복으로 해결하지 않는다.

```text
flowMentionEligible === true
flowImageInjectable === false
characters use 존재
```

처리:

- `postcondition-failed`
- batch 중단
- failure modal에 이미지 재등록 복구 안내 표시
- M2a에서 기존 IDs를 자동 삭제하거나 새 entity upload를 강제하지 않음

복구 안내:

```text
Ref 탭에서 해당 캐릭터 이미지를 다시 등록한 뒤 배치 생성을 다시 시도하세요.
```

#### 최종 completion

모든 sync와 mention refresh 처리를 끝낸 뒤 계산한다.

```js
const ok = finalSuccesses.length
const fail = failures.length
const completion = planSyncGateCompletion(ok, fail)
```

`fail > 0`이면 `proceed`를 호출하지 않는다.

### 4.8 failure modal과 상태 전환

image 실패 시 먼저 상세를 캡처한다.

```js
const failuresForModal = failures.map(item => ({
  ...item,
}))
```

그 뒤 상태를 전환한다.

```js
setSyncGate(null)
setSyncFailureModal({
  failures: failuresForModal,
})
return
```

의미:

1. sync 필요 modal 제거
2. state에 저장된 원래 `proceed` closure 제거
3. failure modal만 표시
4. batch 미시작

failure modal 확인:

```js
setSyncFailureModal(null)
```

확인 시 다음을 하지 않는다.

- `proceed` 호출
- `start()` 호출
- 성공 patch rollback
- 실패 candidate 자동 제외 후 생성
- sync 필요 modal 재오픈

성공분 patch는 보존한다. 다음 batch에서는 이미 via 후조건을 충족한 성공분이 candidate에서 빠진다.

video 실패는 image failure modal로 전환하지 않는다. 현재 [App.jsx:1899](../../../src/App.jsx#L1899)의 기존 toast 정책을 유지한다.

### 4.9 modal과 i18n

현재 sync modal은 hardcoded ko/en이며 mention만 설명한다: [App.jsx:2912-2939](../../../src/App.jsx#L2912-L2939).

M2a에서는 locale key로 옮긴다.

현재 인접 locale:

- sync toast: [ko.js:1402-1403](../../../src/locales/ko.js#L1402-L1403), [en.js:1403-1404](../../../src/locales/en.js#L1403-L1404)
- top-level modal group 인접 위치: [ko.js:1494-1499](../../../src/locales/ko.js#L1494-L1499), [en.js:1495-1500](../../../src/locales/en.js#L1495-L1500)

신규 group:

```js
syncGate: {
  imageNeededTitle,
  imageNeededBody,
  videoNeededTitle,
  videoNeededBody,
  syncAndGenerate,
  syncing,

  failureTitle,
  failureBody,
  failureConfirm,

  reasonGone,
  reasonIdentityAmbiguous,
  reasonInFlight,
  reasonSyncFailed,
  reasonPostconditionFailed,
  reasonComposerRefreshUnavailable,
  reasonComposerRefreshFailed,

  reasonTagMediaMissing,
  recoveryReattachImage,
}
```

문구 계약:

- image body는 tag와 mention을 모두 포괄한다.
- image body에 `{count}`를 포함한다.
- failure body는 생성이 시작되지 않았음을 명시한다.
- failure 목록에 캐릭터 이름과 localized reason을 표시한다.
- `characters` 후조건의 mediaId가 없으면 이미지 재등록 안내를 표시한다.
- 확인 버튼은 failure modal만 닫는다.
- 기존 `toast.flowSyncIncomplete`는 video 호환을 위해 유지한다.

예시:

```js
// ko
imageNeededBody:
  '이번 생성에 필요한 캐릭터 {count}개를 먼저 Flow에 동기화해야 합니다.',
failureBody:
  '다음 캐릭터를 동기화하지 못해 생성을 시작하지 않았습니다.',
reasonTagMediaMissing:
  'Flow 이미지 참조를 만들지 못했습니다.',
recoveryReattachImage:
  'Ref 탭에서 이미지를 다시 등록한 뒤 다시 시도하세요.',

// en
imageNeededBody:
  '{count} character(s) used by this generation must be synced to Flow first.',
failureBody:
  'Generation was not started because the following character(s) could not be synced.',
reasonTagMediaMissing:
  'A Flow image reference could not be created.',
recoveryReattachImage:
  'Re-register the image in the Ref tab, then try again.',
```

### 4.10 실행 순서

#### direct

```text
handleStart
→ image target scenes 결정
→ mention→tag 영속 병합
→ 기존 auth/folder/Flow-ready/style 검증
→ collectTagErrors
→ 오류 없으면 routeM2aImageBatchStart
→ 현재 scenes/refs로 단일 guard plan
→ exclusion toast
→ candidates 있으면 kind:image syncGate
→ 없으면 start
```

#### tag-proceed

```text
TagValidationModal proceed
→ mode/project/auth/Flow-ready 재검증
→ 현재 scenes/refs와 target IDs 재계산
→ routeM2aImageBatchStart
→ 단일 guard plan 재계산
→ exclusion toast
→ candidates 있으면 kind:image syncGate
→ 없으면 start
```

#### image sync-proceed

```text
syncGate 확인
→ candidate refKey를 현재 refs에서 재해석
→ candidates 직렬 처리
→ via 후조건 검사
→ tag-only 성공은 즉시 확정
→ mention refresh pending만 수집
→ pending 있으면 force:true composer refresh 1회
→ refresh 자신의 결과 검증
→ mention failures만 refresh-failed 처리
→ failures 있으면 syncGate 제거 + failure modal + batch 중단
→ 전부 성공이면 patchedRefs로 start
→ matcher/preupload/scene loop가 current/effective refs 사용
```

#### composer IPC

```text
게이트가 force:true refresh 요청
→ 기존 same-pid active promise에 합류하지 않음
→ refreshChain 뒤에 새 refresh enqueue
→ 새 doRefreshComposer 실행
→ 새 실행 자신의 {success} 반환
```

### 4.11 M2a 불변식

1. 같은 character use가 동일 via에서 exclusion과 sync candidate 양쪽에 들어가지 않는다.
2. `mention`과 `characters`는 독립 판정한다.
3. `mention` needs-sync에만 `flowSyncable`을 사용한다.
4. `characters` needs-sync는 `flowTagCharacterNeedsSync`로 판정한다.
5. `characters` 판정에 `!isRefSynced`를 사용하지 않는다.
6. candidate dedup 뒤 모든 `vias`와 `sceneIds`를 보존한다.
7. ID-less ref를 name-only로 dedup하지 않는다.
8. plan-time `refIndex`를 proceed patch index로 사용하지 않는다.
9. current identity가 없거나 모호하면 잘못된 ref를 패치하지 않는다.
10. sync 성공은 candidate의 모든 via 제출 후조건을 만족해야 한다.
11. tag-only 성공은 `flowImageInjectable`만으로 확정할 수 있다.
12. composer refresh는 mention 후조건에만 관여한다.
13. tag-only candidate를 `refresh-failed`로 보내지 않는다.
14. `refresh-composer` recovery candidate에는 mention via가 반드시 있다.
15. mention forced refresh는 기존 in-flight refresh promise에 합류하지 않는다.
16. forced refresh도 기존 navigation queue 뒤에서 직렬 실행한다.
17. mention refresh 실패가 하나라도 있으면 batch를 시작하지 않는다.
18. partial success patch는 state에 보존한다.
19. image failure 전환 뒤 이전 `proceed` closure에 접근하지 않는다.
20. 같은 scene 제출의 matcher/mention resolver/submit references는 같은 `effectiveRefs`를 사용한다.
21. video selector는 mention-only로 유지한다.
22. video 실패는 image failure modal을 열지 않는다.
23. retry는 M2a syncGate를 타지 않는다.
24. M1 Flow null-mediaId 최종 방어선을 유지한다.
25. composer IPC `success:true`만으로 실제 mention picker 이름 표시를 단정하지 않는다.

### 4.12 리뷰 finding 해소 추적표

| 리뷰 finding | 해소 위치 |
|---|---|
| `[BLOCKER] flowSyncable을 태그 후보에 공통 적용` | §4.2 via별 판정, §4.3 viaDecisions |
| `[MAJOR] M1 exclusion과 M2 candidate 중복` | §4.3 단일 planner, §4.4 공통 routing |
| `[MAJOR] composer refresh 실패가 성공 처리` | §2.3, §4.7 mention refresh 검증 |
| `[MAJOR] failure modal 추가 시 syncGate 잔존` | §4.8 명시적 상태 전환 |
| `[MAJOR] stale refs에 순수 matcher/overlay 과도입` | §4.6 optional refs 최소 변경 |
| `[MAJOR] text/list와 video/retry 범위 충돌` | §3 경로 매트릭스, §5 단계 분리 |
| `[MINOR] 기존 line anchor 오류` | 전 문서 M1 HEAD 앵커 교정 |
| `[Fable MAJOR] composer refresh를 tag-only에도 적용해 영구 루프` | §2.4 via 성공표, §4.2 mention-only 상태, §4.7 실행 분기, §4.11 불변식 |
| `[Fable MAJOR] 게이트 refresh가 pre-sync in-flight promise에 합류` | §1.4, §4.1 대상 파일, §4.7 forced fresh IPC, §7.5 IPC 테스트 |
| `[Fable MINOR] 패널/상세/카드가 refresh-failed를 synced로 세탁 가능` | §4.1 범위 제외, §6 알려진 수동 sync 우회 |
| `[Fable MINOR] M1 collector 삭제/보존 불명확 및 integration import 파손` | §4.3 collector 삭제 명시, §7.1·§7.8 integration 갱신 |
| `[Fable MINOR] proceed에서 plan-time refIndex를 live index로 오인` | §4.3 identity resolver, §4.7 current 재해석, §7.5 삭제/삽입 테스트 |
| `[Fable MINOR] already-synced tag ref의 mediaId 후조건 영구 실패 복구 없음` | §4.7 복구 정책, §4.9 안내 문구, §6 edge |
| `[Fable MINOR] mention merge same-tick tag image gap` | §4.4 범위, §6 구체 사례, §5.1 M2b overlay |
| `[Fable MINOR] character.js/tagMatch line anchor 교정` | §1.4 `1100-1132`·`1127`, §4.3 `13-16` |

---

## 5. 후속 단계 — 이번 구현 범위 밖

### 5.1 M2b — 순수 matcher와 authoritative scene plan

M2b는 별도 설계 검토 후 구현한다.

포함 예정:

- `collectSceneReferenceUses(scene, references)`
- 순수 `getMatchingReferences(scene, references)`
- stable ref identity를 matcher 전체로 확장
- 타입 무관 name dedup 제거
- 동일 이름·다른 타입 ref 보존
- `applyScenePatches`
- mention→tag 병합의 merged-scene overlay
- `effectiveScenes`를 검증/matcher/scene loop의 authoritative 입력으로 사용
- via별 범용 `planReferencePreflight`

M2a의 optional refs matcher는 M2b 순수 matcher로 교체할 수 있다.

M2b에서 결정할 것:

- ID-less ref의 장기 identity 계약
- 동일 타입·동일 이름 duplicate의 all-match 의미
- overlay가 style guard와 tag validation에 미치는 범위
- same-tick mention merge 뒤 새 tag image use 처리
- M2a guard planner를 범용 preflight로 마이그레이션하는 방법

### 5.2 M2c — detailed resolver와 모든 생성 진입 경로

M2c도 별도 설계 검토 후 구현한다.

포함 예정:

- API `resolveReferenceImageDetailed`
- name→disk fallback 결과를 포함한 API preflight
- preupload 전 preliminary plan
- preupload/API 해석 후 final plan
- final plan 기반 prompt strip과 allowed refs
- late exclusion 집계 toast
- direct / tag-proceed / sync-proceed / retry coordinator
- `usedRefKeys` 기반 preupload
- retry에서 현재 scene/ref snapshot 재계산
- Flow payload 직전 final validation

M2c에서 별도로 결정할 정책:

- retry에서 sync modal을 열 것인가
- retry에서 sync가 필요하면 중단할 것인가
- video-text를 범용 coordinator에 포함할 것인가
- 배치 도중 ref 변경을 snapshot으로 고정할 것인가
- 패널/상세 모달/카드의 refresh 결과를 같은 completion contract에 포함할 것인가

M2a 구현에서 이 정책을 미리 가정하지 않는다.

---

## 6. 엣지케이스와 알려진 한계

1. 같은 캐릭터가 tag와 mention 양쪽에 쓰이면 ref candidate는 한 건으로 dedup하고 vias를 보존한다.
2. 같은 캐릭터가 여러 씬에 쓰이면 sync는 한 번만 실행하고 `sceneIds`를 합친다.
3. tag-only + source 있음 + mediaId 없음이면 sync candidate다.
4. tag-only + mediaId 있음 + name status failed이면 sync candidate가 아니다.
5. tag-only + mediaId 있음 + `refresh-failed`이면 composer 복구 candidate가 아니다.
6. tag-only + mediaId 없음 + source 없음 + repairable IDs만 있으면 tag use exclusion이다.
7. mention + eligible이면 image source/mediaId가 없어도 mention use는 유지한다.
8. mention + 미동기화 + repairable이면 sync candidate다.
9. mention + mediaId만 있고 repair/source가 없으면 mention use만 exclusion이다.
10. tag keep + mention exclude 또는 tag exclude + mention sync가 같은 ref에서 발생할 수 있다.
11. 서로 다른 via 결과이므로 같은 ref가 candidate와 exclusion 양쪽에 있을 수 있지만 동일 via 중복은 금지한다.
12. `sourceAvailable`이 true여도 실제 파일이 stale할 수 있다. read 실패는 sync failure다.
13. sync 결과에 mediaId가 없으면 `characters` 후조건 실패다.
14. sync 결과가 mention eligible이 아니면 `mention` 후조건 실패다.
15. tag-only sync 결과가 `nameApplied:false`여도 mediaId 후조건을 통과하면 성공이다.
16. tag-only candidate 때문에 composer refresh를 호출하지 않는다.
17. mention+characters candidate는 mediaId와 mention eligibility를 모두 검사한다.
18. 여러 mention candidate가 refresh를 필요로 해도 forced refresh는 한 번만 호출한다.
19. 기존 같은 PID refresh가 진행 중이어도 게이트 forced refresh는 새로 enqueue된다.
20. forced refresh는 이전 refresh와 동시에 navigation하지 않고 queue 뒤에서 실행된다.
21. refresh API 없음/throw/`success:false`는 mention pending failure다.
22. refresh 실패 시 mention candidate만 `refresh-failed`가 된다.
23. refresh 실패 candidate는 entityId/workflowId/mediaId를 보존한다.
24. 다음 image batch의 mention use에서 `refresh-failed` candidate가 recovery로 다시 나타난다.
25. 같은 ref가 다음 batch에서 tag-only로만 쓰이면 mediaId가 있는 한 recovery modal을 열지 않는다.
26. partial success/partial failure이면 성공 patch를 보존하고 batch는 시작하지 않는다.
27. 다음 시도에서 완전히 성공한 ref는 해당 via candidate에서 빠진다.
28. `already-synced` live race라도 candidate via 후조건을 재검사한다.
29. entity-synced + mediaId 없음 + characters use는 postcondition failure와 이미지 재등록 안내를 표시한다.
30. M2a는 이 상태를 해결하려고 IDs를 자동 삭제하거나 새 entity upload를 강제하지 않는다.
31. modal이 열린 사이 candidate가 삭제되면 `gone`으로 실패하며 다른 index의 ref를 패치하지 않는다.
32. unrelated ref가 앞에 삽입돼 index가 바뀌어도 current identity로 다시 찾는다.
33. ID-less fingerprint가 여러 현재 ref와 일치하면 `identity-ambiguous`로 실패한다.
34. sync 필요 modal 취소 시 batch는 시작하지 않는다.
35. failure modal 확인 후 이전 syncGate는 다시 나타나지 않는다.
36. M1 mention→tag 영속 병합은 modal 취소나 실패 뒤에도 유지된다.
37. direct와 tag-proceed가 같은 current scene/ref snapshot을 받으면 같은 guard 결정을 내린다.
38. video-text는 기존 mention-only 후보를 사용한다.
39. video 실패는 image failure modal을 열지 않는다.
40. retryErrors와 개별 retry는 M2a sync modal을 열지 않는다.
41. M1 Flow null-mediaId 방어선은 그대로 유지한다.
42. style preset token은 candidate/exclusion 대상이 아니다.

### 6.1 수동 sync 경로의 `refresh-failed` 세탁 우회

`refresh-failed`는 `isRefSynced`가 false이므로 현재 `selectUnsyncedRefs`에 다시 잡힌다: [flowCharacterSync.js:99-107](../../../src/utils/flowCharacterSync.js#L99-L107).

현재 수동 sync 경로는 refresh 반환값을 최종 성공 판정에 포함하지 않는다.

- ReferencePanel sync-all: [ReferencePanel.jsx:165](../../../src/components/ReferencePanel.jsx#L165)
- ReferenceDetailModal rename: [ReferenceDetailModal.jsx:287](../../../src/components/ReferenceDetailModal.jsx#L287)
- ReferenceDetailModal sync: [ReferenceDetailModal.jsx:425-426](../../../src/components/ReferenceDetailModal.jsx#L425-L426)
- ReferenceCard upload: [ReferenceCard.jsx:195](../../../src/components/ReferenceCard.jsx#L195)

따라서 사용자가 M2a failure 뒤 패널/상세 모달/카드 경로를 실행하면 refresh 결과를 무시한 채 `synced` 상태로 덮을 수 있다.

이 우회는 M2a에서 허용하는 알려진 한계다.

- M2a의 fail-closed 보증은 image syncGate 경로에 한정한다.
- 수동 sync 경로의 completion contract 통합은 후속 범위다.
- 이번 구현에서 해당 컴포넌트 동작을 확장하지 않는다.

### 6.2 same-tick mention merge와 tag image gap

가능한 순서:

```text
원본 scene은 mention-only
→ handleStart가 이름을 characters state에 영속 병합
→ direct guard plan은 현재 tick의 prompt mention으로 candidate 판정
→ candidate vias에는 mention만 포함
→ repair-registration 성공
→ mediaId는 없음
→ 생성 시점 scene에는 병합된 characters tag가 보일 수 있음
→ tag image use는 flowImageInjectable filter에서 빠짐
```

결과:

- mention route는 계속 해석될 수 있다.
- null mediaId는 M1 방어선에서 차단된다.
- 현재 batch의 tag image payload가 빠질 수 있다.
- HTTP 500을 다시 만들지는 않지만 tag image 의도는 완전히 충족되지 않을 수 있다.

M2a는 merged-scene overlay를 도입하지 않으므로 이 gap을 허용한다. M2b의 authoritative overlay와 via preflight에서 해소한다.

---

## 7. TDD 계획

모든 구현 변경은 현재 M1 코드에서 실패하는 테스트를 먼저 작성한다.

### 7.1 via별 guard planner와 collector 교체

신규:

`tests/utils/refImageGuard.m2a.test.js`

필수 matrix:

- tag-only local source + no mediaId → sync
- tag-only mediaId + name failed → keep
- tag-only mediaId + refresh-failed → keep, refresh recovery 아님
- tag-only repairable IDs + no source/mediaId → exclude
- mention unsynced + local source → sync
- mention unsynced + registration repairable → sync
- mention unsynced + mediaId only + repair 불가 → mention exclude
- mention eligible + no mediaId → keep mention
- mention refresh-failed → refresh-composer
- tag keep + mention exclude 독립 판정
- tag exclude + mention sync 독립 판정
- tag+mention 동시 sync → candidate 한 건, vias 두 개
- mention refresh recovery + tag sync → action sync + composer recovery 보존
- 여러 씬 동일 ref → candidate 한 건, sceneIds 합집합
- ID-less 동명 refs → 별도 candidate keys
- 동일 via가 candidate와 exclusion 양쪽에 없음
- source 없는 mention → `mentionNamesBySceneId`
- local-only tag candidate가 exclusions에 없음
- non-character M1 exclusion 유지
- 원본 scenes/refs mutate 없음

기존 테스트 갱신:

- [tests/utils/refImageGuard.test.js:120-153](../../../tests/utils/refImageGuard.test.js#L120-L153)
- [tests/integration/referenceImageGuardM1.test.jsx:7](../../../tests/integration/referenceImageGuardM1.test.jsx#L7)
- [tests/integration/referenceImageGuardM1.test.jsx:70](../../../tests/integration/referenceImageGuardM1.test.jsx#L70)

`collectM1FlowReferenceExclusions` import와 호출을 새 planner로 교체한다.

### 7.2 direct/tag-proceed 공통 routing

신규:

`tests/components/App.syncSteeringM2a.test.jsx`

필수:

- text direct tag-only local character → image syncGate
- list direct 동일 동작
- force regenerate 동일 동작
- direct local tag character에 exclusion toast 없음
- no-source tag character → exclusion toast, syncGate 없음
- exclusion과 sync candidate가 함께 있을 때 candidate가 toast에 섞이지 않음
- tag-validation proceed가 같은 planner/router 사용
- tag modal 사이 refs 변경 뒤 현재 refs로 재계산
- stale `__m1ExclusionToast` 사용 없음
- direct/tag-proceed가 동일 입력에서 같은 candidate keys 생성
- video gate는 `kind:'video'`
- video selector는 mention-only
- retryErrors/개별 retry는 image syncGate를 열지 않음

기존 source wiring test의 `.filter(flowSyncable)` 기대는 제거한다: [App.referenceGuardM1.test.js:47-60](../../../tests/components/App.referenceGuardM1.test.js#L47-L60).

### 7.3 explicit refs matcher

신규:

`tests/hooks/useScenes.explicitRefs.test.jsx`

필수:

- 두 번째 인자를 생략하면 hook references 사용
- 두 번째 인자를 넘기면 explicit refs 사용
- character/scene/style loops가 explicit refs 객체 반환
- mention resolver가 explicit refs 사용
- closure ref에는 mediaId가 없고 explicit ref에는 있을 때 explicit ref 반환
- 기존 name dedup 의미 유지

### 7.4 useAutomation fresh refs 회귀

확장 또는 신규:

- `tests/hooks/useAutomation.imagelessRefs.test.jsx`
- `tests/hooks/useAutomation.currentRefsMatching.test.jsx`

필수:

- closure tag character는 `mediaId:null`
- `startOptions.currentRefs`의 같은 ref는 fresh mediaId 보유
- scene matcher가 `effectiveRefs`와 함께 호출됨
- Flow payload에 fresh mediaId 포함
- `resolveSceneStyle`도 fresh `allMatched` 사용
- preupload matcher가 `currentRefs` 사용
- `selectRefsToRegister`가 `currentRefs` 사용
- tag-only는 composer 이름 없이 mediaId로 제출 가능
- Flow null-mediaId 최종 방어 회귀 없음
- API `imagePath → filePath` 회귀 없음

### 7.5 image gate completion, identity, forced refresh

확장:

- `tests/components/App.syncGateCoordinator.test.js`
- `tests/electron/ipc/refreshComposerCoalesce.test.js`

신규 behavior test:

`tests/components/App.syncGateCompletionM2a.test.jsx`

#### via별 completion

- mention + `nameApplied:true` → refresh 없음
- mention + `nameApplied:false` → forced refresh 1회
- mention+characters → 두 후조건 검사
- tag-only + mediaId + `nameApplied:false` → refresh 없음, proceed
- tag-only 성공을 `refresh-failed`로 바꾸지 않음
- 여러 mention candidate가 refresh 필요 → refresh 한 번
- tag-only success + mention refresh failure → tag patch 보존, 전체 batch 중단
- refresh `{success:true}` → mention proceed
- refresh `{success:false}` → proceed 없음
- refresh throw → proceed 없음
- refresh API 없음 → proceed 없음
- refresh payload에 고정 projectId와 `force:true`
- mention refresh 실패 → `flowNameSyncStatus:'refresh-failed'`
- refresh 실패 시 IDs/mediaId 보존
- refresh-only mention recovery 성공 → synced
- refresh-only mention recovery 실패 → refresh-failed 유지
- refresh-only recovery candidate는 `syncRefToFlow`를 재호출하지 않음 (`resolveSyncTarget`이 `sync`를 반환해도 무시하고 composer refresh만 검증)
- tag-only refresh-failed + mediaId → recovery candidate 아님
- tag candidate 결과에 mediaId 없음 → postcondition failure
- mention candidate 결과가 eligible 아님 → postcondition failure
- entity-synced + mediaId 없음 → failure와 이미지 재등록 recovery
- 부분 성공/부분 실패 → `planSyncGateCompletion` proceed false
- 모든 최종 성공 → `proceed(patchedRefs)` 정확히 한 번

#### current identity 재해석

- modal이 열린 사이 unrelated ref 앞에 추가 → 올바른 candidate 패치
- modal이 열린 사이 candidate 삭제 → `gone`, 다른 ref 패치 없음
- ID-less ref 삭제 뒤 같은 index에 다른 ref 위치 → 잘못된 패치 없음
- ID-less fingerprint가 여러 개로 모호 → `identity-ambiguous`
- sync 도중 state list가 교체돼도 stored plan index 직접 사용 없음
- `syncRefToFlow`에 현재 재해석된 `refIndex` 전달

#### refresh IPC coalescing

기존 default coalescing 회귀:

- 동일 PID 기본 호출 3건 → navigation 1회
- 기존 promise 완료 뒤 새 기본 호출 → 새 navigation

게이트 forced refresh:

- 같은 PID 기본 refresh가 in-flight인 상태에서 `{force:true}` 호출
- forced 호출이 기존 promise를 반환하지 않음
- 기존 refresh 완료 뒤 새 `doRefreshComposer`가 실행됨
- navigation/ensure 호출이 총 2회
- 기존 refresh가 success여도 forced refresh 자신의 failure를 success로 세탁하지 않음
- forced refresh도 다른 PID/기존 queue와 직렬 실행
- forced refresh가 in-flight인 동안 발행된 기본 refresh는 forced promise에 coalesce(또는 그 뒤 직렬)되어 동시 navigation이 없음
- forced 분기가 `refreshChain`/`refreshActivePid`/`refreshActivePromise` tail 3종을 모두 갱신함

기존 source test [App.syncGateCoordinator.test.js:7-27](../../../tests/components/App.syncGateCoordinator.test.js#L7-L27)은 보조 wiring 검증으로만 유지한다.

### 7.6 failure modal

신규:

`tests/components/App.syncFailureModalM2a.test.jsx`

필수:

- image sync 실패 상세 캡처
- failure 전 기존 syncGate 제거
- failure modal만 표시
- 실패 캐릭터 이름과 reason 표시
- tag media 후조건 실패 시 이미지 재등록 안내
- failure modal 확인 → failure modal만 닫힘
- 확인 뒤 start/proceed 호출 없음
- 성공 patch state 보존
- 다음 batch에서 성공분 스킵
- mention refresh-failed는 다음 mention batch에서 recovery
- tag-only refresh-failed + mediaId는 recovery modal 없음
- video 실패 → image failure modal 없음
- video 실패 → 기존 toast 유지
- busy 중 cancel/proceed 중복 실행 차단

### 7.7 i18n

신규:

`tests/locales/syncGateM2aKeys.test.js`

필수:

- ko/en `syncGate` 키 집합 동일
- image body placeholder 집합 동일
- `{count}` 존재
- 모든 failure reason key 존재
- tag media recovery key 존재
- hardcoded ko/en image modal 본문 제거
- 기존 video toast key 유지

### 7.8 실행 명령

파일별 red→green:

```bash
npx vitest run tests/utils/refImageGuard.m2a.test.js
npx vitest run tests/integration/referenceImageGuardM1.test.jsx
npx vitest run tests/hooks/useScenes.explicitRefs.test.jsx
npx vitest run tests/hooks/useAutomation.currentRefsMatching.test.jsx
npx vitest run tests/electron/ipc/refreshComposerCoalesce.test.js
npx vitest run tests/components/App.syncSteeringM2a.test.jsx
npx vitest run tests/components/App.syncGateCompletionM2a.test.jsx
npx vitest run tests/components/App.syncFailureModalM2a.test.jsx
npx vitest run tests/locales/syncGateM2aKeys.test.js
```

관련 회귀:

```bash
npx vitest run \
  tests/utils/refImageGuard.test.js \
  tests/utils/refImageGuard.m2a.test.js \
  tests/utils/flowCharacterSync.test.js \
  tests/utils/flowCharacterSync.repair.test.js \
  tests/integration/referenceImageGuardM1.test.jsx \
  tests/hooks/useScenes.explicitRefs.test.jsx \
  tests/hooks/useAutomation.imagelessRefs.test.jsx \
  tests/hooks/useAutomation.currentRefsMatching.test.jsx \
  tests/electron/ipc/refreshComposerCoalesce.test.js \
  tests/components/App.referenceGuardM1.test.js \
  tests/components/App.syncGateCoordinator.test.js \
  tests/components/App.syncSteeringM2a.test.jsx \
  tests/components/App.syncGateCompletionM2a.test.jsx \
  tests/components/App.syncFailureModalM2a.test.jsx \
  tests/locales/syncGateM2aKeys.test.js
```

최종 회귀:

```bash
npm run test:run
```

### 7.9 실앱 검증 게이트 — 최우선 리스크

코드 테스트만으로 Flow mention picker의 이름 반영을 확정하지 않는다.

#### 시나리오 A — tag-only local character

1. Flow IDs가 없는 local character를 만든다.
2. text/list scene의 `characters` 태그로만 참조한다.
3. batch start를 누른다.
4. sync 필요 modal에 한 건으로 표시되는지 확인한다.
5. 동기화 뒤 fresh `mediaId`가 state와 same-run refs에 반영되는지 확인한다.
6. tag-only candidate 때문에 composer refresh를 요구하지 않는지 확인한다.
7. 동일 batch가 자동 시작되는지 확인한다.
8. Flow image payload에 fresh mediaId가 포함되는지 로그로 확인한다.
9. 생성 이미지에 의도한 character가 반영되는지 눈검증한다.

tag-only 시나리오에서는 composer mention picker 이름 표시를 성공 조건으로 요구하지 않는다.

#### 시나리오 B — mention character

1. 미동기화 local character를 `@멘션`으로 참조한다.
2. sync 필요 modal을 확인한다.
3. `nameApplied:false` 경로면 forced fresh refresh가 실행되는지 확인한다.
4. composer mention picker 또는 segment에 canonical 이름이 실제로 반영되는지 확인한다.
5. 동일 batch가 자동 시작되는지 확인한다.
6. mention route가 성공하는지 확인한다.

#### 시나리오 C — mention refresh 실패

개발 환경에서 게이트 forced refresh가 `{success:false}`를 반환하도록 재현한다.

확인:

- 성공 toast 없음
- batch 미시작
- sync 필요 modal 제거
- failure modal 표시
- mention ref가 `refresh-failed`
- 다음 mention batch에서 recovery candidate
- entityId/workflowId/mediaId 보존
- tag-only 성공 ref는 `refresh-failed`로 바뀌지 않음

#### 시나리오 D — 기존 in-flight refresh와 게이트 refresh

가능한 개발 환경에서 다음 순서를 재현한다.

1. 패널/카드 경로의 refresh를 시작한다.
2. 해당 refresh가 끝나기 전에 mention sync PATCH를 완료한다.
3. 게이트 forced refresh를 요청한다.
4. 기존 promise에 합류하지 않고 두 번째 refresh가 실행되는지 로그로 확인한다.
5. 두 번째 refresh 뒤 canonical 이름이 picker에 보이는지 확인한다.

#### 마일스톤 게이트

다음 조건을 만족하기 전 M2a 완료로 보지 않는다.

- unit/integration/electron IPC 회귀 통과
- tag-only fresh mediaId same-run 제출 확인
- tag-only가 composer refresh에 종속되지 않음
- mention forced refresh가 이전 in-flight promise에 합류하지 않음
- composer 실제 이름 반영 확인
- mention 생성 성공 확인
- refresh 실패 fail-closed 확인
- 독립 코드 리뷰 findings 0

실앱에서 mention 이름 반영이 실패하면 App routing을 확장하기 전에 `flowCharacterSync`와 composer refresh 하단을 먼저 검증한다.

---

## 8. 역할 분담

### 구현

Codex가 M2a만 구현한다.

구현 순서:

1. via별 guard planner red→green
2. M1 collector 삭제와 integration test 갱신
3. direct/tag 공통 routing
4. current ref identity 재해석
5. explicit refs matcher
6. same-run fresh refs 회귀
7. mention-only completion 판정
8. forced fresh refresh IPC와 coalescing 회귀
9. refresh-failed mention 복구
10. failure modal 상태 전환
11. i18n
12. 관련 회귀
13. 전체 회귀

M2b/M2c 코드는 이번 구현에서 시작하지 않는다.

### 리뷰

Codex 구현 뒤 Fable 5가 독립 리뷰하고 Opus가 총괄한다.

검증 항목:

- 태그 후보가 단일 `flowSyncable`로 축약되지 않았는가
- local tag candidate가 exclusion toast에 섞이지 않는가
- direct/tag-proceed가 같은 planner/router를 쓰는가
- 기존 collector export/import/call이 남지 않았는가
- plan-time refIndex가 현재 ID-less ref 패치에 사용되지 않는가
- tag-only 성공이 composer refresh에 종속되지 않는가
- `refresh-failed`가 mention candidate에만 적용되는가
- forced refresh가 기존 same-pid promise에 합류하지 않는가
- composer refresh 결과가 mention completion 전에 반영되는가
- failure 전 syncGate가 제거되는가
- 성공 patch가 failure 뒤에도 보존되는가
- entity-synced/mediaId-missing 상태에 복구 안내가 있는가
- video/retry 범위가 확장되지 않았는가
- matcher가 실제 `effectiveRefs`를 쓰는가
- §6의 수동 sync 우회와 same-tick gap을 해결된 것으로 과장하지 않았는가

### 실앱 검증

사용자 또는 총괄이 §7.9를 실제 Flow 앱에서 검증한다.

코드 리뷰와 unit test만으로 다음을 확정하지 않는다.

- Flow composer mention picker의 실제 이름 표시
- Flow 내부 캐시 갱신 안정성
- 생성 이미지의 character 반영 품질

### 후속 설계

M2a 구현과 실앱 검증 뒤 M2b 설계를 별도로 확정한다.

M2b 완료 뒤 M2c의 4경로 coordinator와 retry sync 정책을 결정한다.

패널/상세 모달/카드의 refresh completion 통합도 후속 설계에서 범위를 별도로 확정한다.
