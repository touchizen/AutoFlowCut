# 스펙 v2 — 실제 Ref 작업에서만 레퍼런스 패널 자동 펼침

작성 2026-07-23 / 브랜치 `main` / `b818c763` 및 작성 시점 워크트리 기준

이 문서는 `2026-07-22-ref-peek-and-gutter-spinner-design.md`의 **기능 1만** 처음부터 다시 쓴다.
기능 2(프롬프트 거터 진행 링)는 이미 리뷰를 통과했으므로 기존 문서에 남기고 여기서는 다루지 않는다.

작성 시점 워크트리에는 업로드 중 Stop 고착을 고친 별도 변경
(`tests/hooks/useAutomation.uploadStopHang.test.jsx`, `useAutomation`의 `settleIfDone`)이 아직 커밋되지 않은
상태로 존재한다. 이 스펙은 그 수정이 먼저 들어간 것을 전제로 하며, 그 문제를 다시 설계하거나 변경하지
않는다. 이 삽입 때문에 리뷰가 확인한 clean-tree 앵커인 씬 큐 직전
`setStatus('running')` 766줄/`setProgress` 767줄은 현재 워크트리에서 각각 780/781줄이다. 아래 링크는
작성 시점 워크트리의 실제 줄을 기준으로 한다.

---

## 1. 제품 결정

받아들임의 기준은 하나다.

> 배치가 돌 때 Ref 탭을 실제로 쓰게 되면 펼쳐졌으면 좋겠다.

따라서 **배치 시작은 여는 조건이 아니다.** 빈 레퍼런스 이미지를 만들거나, 캐릭터를 동기화하거나,
Flow에 비-character 레퍼런스를 업로드하는 실제 작업이 확인됐을 때만 닫힌 패널을 연다. 작업 여부를
아직 모르는 폴더·토큰 프리플라이트는 패널을 새로 열 수 없다.

동기화도 Ref 작업으로 센다. 이미지 배치와 T2V 배치의 생성 전 동기화뿐 아니라, 개별 씬 생성의
프리플라이트 동기화와 생성 중 사후복구 동기화까지 같은 규칙을 적용한다. 동기화 모달이 화면을 덮기
때문에 이 구간의 시각적 이득이 0이라는 사실을 알고도, 경로마다 규칙이 달라지지 않게 하려는 제품
결정이다.

이번 스펙은 연속성을 보장하는 정공법을 선택한다. 그 대가로 이미지 배치의 상태 어휘와 ref 배치
라이프사이클을 바꾸고, 이미 외부로 노출된 MCP 상태 경계도 함께 손본다. 축소 MVP와 잃는 것은
13절에서 따로 비교한다.

## 2. 범위와 비범위

이 문서가 설계하는 것은 다음뿐이다.

- 실제 Ref 작업이 시작되면 닫힌 Ref 패널을 자동으로 연다.
- 앱이 연 패널은 그 Ref 작업의 연속 구간이 끝나면 원래대로 닫는다.
- 사용자가 닫거나 열면 그 의도를 자동 동작보다 우선한다.
- 이미지 배치 준비 상태를 내부에서 관측 가능하게 만들되 MCP 외부 상태 계약은 보존한다.
- 개별 씬 생성과 Start가 공유 큐에서 인터리브되는 경로를 막는다.

거터 링, Ref 패널 내부 UI 재설계, sync 모달 디자인, 업로드 Stop 고착 수정, 큐 전체 재설계는 범위가
아니다. `useVideoAutomation`의 상태 머신도 바꾸지 않는다.

## 3. 확인한 현재 구조

### 3.1 Ref 패널과 프로젝트 수명

Ref 패널은 `showReferences` state로 접고 편다
([App.jsx:248](../../src/App.jsx#L248)). 사용자 토글은
[App.jsx:2151-2157](../../src/App.jsx#L2151), 실제 패널 렌더는
[App.jsx:2173-2199](../../src/App.jsx#L2173), 레퍼런스 CSV 임포트의 강제 열기는
[App.jsx:1173-1176](../../src/App.jsx#L1173)에 있다.

프로젝트 전환은 App을 언마운트하지 않는다. `Shell`은 같은 `<App />`을 유지하고
([Shell.jsx:35-55](../../src/Shell.jsx#L35)), 전환 완료 시 같은 훅 트리의
`settings.projectName`을 바꾼다
([useProjectData.js:1398-1405](../../src/hooks/useProjectData.js#L1398)). 따라서 컨트롤러가 프로젝트
경계를 알려면 명시적인 key가 필요하다.

이 스펙의 `projectKey`는 별도 ID가 아니라 **`settings.projectName`** 이다. 설정 화면의 Rename도
성공 후 `onProjectChange(newName)`을 호출하므로
([StorageTab.jsx:95-134](../../src/components/settings/StorageTab.jsx#L95)) 같은 물리 프로젝트의 이름만
바꿔도 자동 열기 소유권과 억제가 초기화된다. 이 부작용은 의도적으로 받아들인다.

### 3.2 실제 Ref 작업 producer

빈카드 생성은 `runEmptyRefGateFlow`가 실제 타깃을 찾고 사용자가 `generate-first`를 고른 뒤
`generateRefs`를 호출하는 경로다
([emptyRefGate.js:244-287](../../src/services/emptyRefGate.js#L244)). Ref 배치 훅은 먼저 실제 타깃을
`allTargets`로 확정한다
([useReferenceGeneration.js:586-615](../../src/hooks/useReferenceGeneration.js#L586)). 그러나 현재는
타깃 0건 조기 반환보다 먼저 `setPreparingRefs(true)`를 호출한다
([useReferenceGeneration.js:695-715](../../src/hooks/useReferenceGeneration.js#L695)). 그대로 열기 신호로
쓰면 noop Ref 배치도 패널을 잠깐 열 수 있다.

동기화 게이트를 여는 실경로는 세 종류다.

- 이미지 배치: 미동기화 멘션이 있으면 `openSyncGate`를 기다린다
  ([emptyRefGate.js:181-198](../../src/services/emptyRefGate.js#L181)).
- T2V: 같은 selector로 대상을 구한 뒤 게이트를 연다
  ([App.jsx:1715-1732](../../src/App.jsx#L1715)).
- 개별 씬: 생성 전 프리플라이트에서 요청하고
  ([useSceneGeneration.js:64-73](../../src/hooks/useSceneGeneration.js#L64)), 엔진이 unresolved/stale 멘션을
  반환하면 이미 `status:'generating'`인 생성 도중 다시 요청한다
  ([useSceneGeneration.js:75-77](../../src/hooks/useSceneGeneration.js#L75),
  [useSceneGeneration.js:135-149](../../src/hooks/useSceneGeneration.js#L135)).

이미지 배치의 비-character 업로드 여부는 폴더·토큰 await가 끝난 뒤에야 계산된다.
`refsToUpload`는 [useAutomation.js:603-620](../../src/hooks/useAutomation.js#L603)에서 만들어지고, 1건
이상일 때만 `status:'uploading'`이 된다
([useAutomation.js:621-625](../../src/hooks/useAutomation.js#L621)). API 모드의 `uploadReference`는
`mediaId:null`을 돌려주는 no-op이다
([useGenAPI.js:187-190](../../src/hooks/useGenAPI.js#L187).) 그러므로 업로드 신호로 패널을 여는 것은
Flow 모드로 한정한다.

### 3.3 이미지 배치 준비 구간과 공유 큐

현재 `useAutomation.start()`는 실제 실행에 들어온 직후 `status:'running'`을 세팅하고
([useAutomation.js:498-513](../../src/hooks/useAutomation.js#L498)), 구독·폴더·토큰 프리플라이트를 지난다
([useAutomation.js:536-594](../../src/hooks/useAutomation.js#L536)). `refsToUpload` 계산 전에 이미 상태를
세우므로 이 지점을 `preparing`으로 바꾸더라도 **실제 Ref 작업이 있다는 증거는 아니다.** 씬 큐 직전의
`running` 복귀 지점은 현재 워크트리 기준 [useAutomation.js:778-782](../../src/hooks/useAutomation.js#L778)다.

`start` 자체도 바로 실행된다는 보장이 없다. 공개된 `start`는 `startQueued`이고
([useAutomation.js:856-884](../../src/hooks/useAutomation.js#L856)), 개별 씬·Ref·영상과 같은
`useGenerationQueue`를 쓴다. 큐는 한 항목의 `execute()`가 끝날 때까지 다음 항목을 시작하지 않는다
([useGenerationQueue.js:11-42](../../src/hooks/useGenerationQueue.js#L11)). 따라서 `preparing`을 enqueue
앞으로 옮기면 안 된다. quota-block 즉시 거부
([useGenerationQueue.js:45-63](../../src/hooks/useGenerationQueue.js#L45))와 `clearQueue` 거부
([useGenerationQueue.js:65-78](../../src/hooks/useGenerationQueue.js#L65))는 이미지 자동화 status를
복구하지 않으므로, 큐에 들어가지 못한 배치가 영원히 `preparing`에 고착된다.

개별 씬 생성은 프리플라이트 await 전에 `generatingSceneId`를 올리지만
([useSceneGeneration.js:42-48](../../src/hooks/useSceneGeneration.js#L42)), 현재 Start 가드는 이 값을 받지
않는다
([startGuard.js:1-5](../../src/services/startGuard.js#L1),
[App.jsx:1447-1456](../../src/App.jsx#L1447)). 실제 Start 버튼 disabled도 `hasPendingBatch`까지만 보고
`generatingSceneId`는 보지 않는다
([App.jsx:2408-2419](../../src/App.jsx#L2408)). 이 때문에 개별 씬 생성 중 Start가 먼저 ref 게이트를
통과한 뒤 공유 큐에서 수십 초 대기하면, 게이트가 닫힌 뒤 `preparing`이 뜰 때까지 패널이 닫혔다 다시
열릴 수 있다.

### 3.4 상태는 MCP 외부 계약이다

`automation.status`는 화면 전용 값이 아니다. App이 `automationState`로 넘기고
([App.jsx:1990-2008](../../src/App.jsx#L1990)), `useMcpServer`가 그대로 batch status에 넣는다
([useMcpServer.js:550-580](../../src/hooks/useMcpServer.js#L550)). Electron의
`GET /api/batch-status`가 그 값을 반환하며
([electron/main.js:1112-1123](../../electron/main.js#L1112)), MCP의 `app_batch_status`와
`app_wait_batch`가 같은 endpoint를 소비한다
([mcp-server/index.js:1401-1436](../../mcp-server/index.js#L1401)). 따라서 새 `preparing` 문자열을 내부에
추가하는 일은 대응 없이 하면 외부 enum을 늘리는 계약 변경이다.

### 3.5 테스트 현실

이 저장소에는 App을 렌더하는 테스트가 없다. App을 직접 대상으로 삼는 네 테스트는 모두
`fs.readFileSync`로 소스 문자열을 자른다.
[App.emptyRefGateWiring.test.js:1-16](../../tests/components/App.emptyRefGateWiring.test.js#L1),
[App.referenceGuardM1.test.js:1-15](../../tests/components/App.referenceGuardM1.test.js#L1),
[App.storyVoiceReload.test.js:16-25](../../tests/components/App.storyVoiceReload.test.js#L16),
[App.syncGateCoordinator.test.js:1-12](../../tests/components/App.syncGateCoordinator.test.js#L1)가 그 네 개다.
이 프로젝트가 이미 택한 해법은 판단과 수명을 작은 실행 단위로 추출하는 것이다. 동기화 소유권은
`useSyncGateHost`로 빠져 실제 훅 테스트가 붙어 있고
([useSyncGateHost.test.js:1-27](../../tests/hooks/useSyncGateHost.test.js#L1)), 빈카드 흐름은
`runEmptyRefGateFlow`로 빠져 서비스 테스트가 붙어 있다. 이 기능도 같은 방식으로 간다.

## 4. 신호 모델: 여는 신호와 유지 신호를 분리한다

### 4.1 용어

- **여는 신호(opening signal)**: 지금 실제 Ref 작업이 있음을 증명한다. 패널이 닫혀 있고 억제되지
  않았으면 이 신호만 새 자동 열기를 시작할 수 있다.
- **유지 신호(bridge signal)**: 이미 앱이 연 패널을 짧은 준비·정리 구간 동안 계속 열어 둔다. 이
  신호만으로는 닫힌 패널을 절대 열지 않는다.
- **배치 경계 신호(boundary signal)**: 억제 수명을 구분한다. 패널을 열거나 유지하지 않는다.
- **자동 소유(owned)**: 현재 열린 패널을 앱이 열었다는 기억이다. 사용자가 원래 열어 둔 패널은
  자동 소유가 아니다.

### 4.2 원신호의 정확한 정의

먼저 `preparingRefs`의 producer 의미를 고친다. `allTargets.length === 0` 조기 반환과 queued Stop
조기 반환을 모두 지난 뒤에만 `setPreparingRefs(true)`를 실행하게 옮긴다. 변경 후
`preparingRefs === true`는 “실행 시점에 실제 Ref target이 1건 이상 확정됐고, 그 Ref 배치가 큐에서
꺼내져 preflight를 시작했다”는 뜻이다. noop과 실행 전에 취소된 batch는 한 렌더도 true가 되면 안
된다.

그 위에서 컨트롤러가 계산하는 신호는 다음과 같다.

```js
openingSignal =
     preparingRefs
  || generatingRefsCount > 0
  || syncGate != null
  || syncGateBusy
  || (mode === 'flow' && automationStatus === 'uploading')

bridgeSignal =
     stoppingRefs
  || (mode === 'flow' && automationStatus === 'preparing')

boundarySignal = hasPendingBatch
```

`preparing`은 `refsToUpload` 계산 전에도 뜨므로 opening 식에 들어가지 않는다. 이 분리가 R3와 가장 큰
차이다. `hasPendingBatch`도 실제 Ref 여부를 말하지 않고 씬/영상 생성 내내 유지되므로 opening이나
bridge에 넣지 않는다.

여는 신호 사이에 React commit 또는 마이크로태스크 한 번짜리 false 구간이 생길 수 있다. 앱이 자동
소유 중이고 opening과 bridge가 모두 false가 되면 `setTimeout(0)`으로 닫기를 한 번 예약하고, 같은
틱에 어느 신호든 돌아오면 취소한다. 이 타이머가 약속하는 것은 **마이크로태스크 틈만** 덮는 것이다.
폴더·토큰 IPC와 공유 큐 지연은 `preparing` bridge와 7절의 인터리브 차단이 각각 책임진다.

### 4.3 경로별 신호 발생표

| 경로 | 새 자동 열기를 시작하는 신호 | 유지 신호 | 언제 발생하고 언제 발생하지 않는가 |
|---|---|---|---|
| Flow 이미지 배치 | 실제 빈카드 생성의 `preparingRefs`/`generatingRefsCount`, 실제 sync의 `syncGate`/`syncGateBusy`, 실제 비-character 업로드의 `uploading` | `preparing`, ref 중지 정리의 `stoppingRefs`, 한 틱 닫기 예약 | 빈카드 확인 모달만 띄운 상태, ref가 없는 폴더·토큰 검사, 곧바로 씬 큐로 가는 배치는 열지 않는다. 이미 빈카드/sync로 열렸다면 `preparing`이 씬 큐 직전까지 이어 준다. |
| API 이미지 배치 | 배치가 직접 수행하는 Ref gate가 없으므로 없음 | 없음 | API `uploadReference`는 no-op이어서 `uploading`만으로 열지 않는다. 내부 status가 `preparing`이어도 mode 조건 때문에 bridge가 아니며, bridge는 애초에 새 창을 열 수도 없다. |
| 개별 씬 생성(UI) | 프리플라이트와 생성 중 사후복구의 `syncGate`/`syncGateBusy` | 한 틱 닫기 예약 | 동기화 대상이 없으면 열리지 않는다. 사후복구는 씬 status가 이미 `generating`인 중간에도 새 opening signal이다. 생성 자체는 Ref 작업이 아니므로 sync 종료 뒤에는 닫힌다. |
| T2V 배치 | 생성 전 `syncGate`/`syncGateBusy` | 한 틱 닫기 예약 | 미동기화 멘션이 있을 때만 연다. sync 뒤의 영상 preflight/생성은 Ref 작업이 아니므로 패널을 유지하지 않는다. |
| I2V/F2V 배치 | 없음 | 없음 | 현재 경로에 Ref sync/upload 단계가 없다. `hasPendingBatch`만으로는 열지 않는다. |
| MCP `app_start_scene_batch` | UI 배치와 같은 실제 `uploading`; 향후 headless ref 작업이 추가되면 그 실제 producer | 이미지 배치의 `preparing` | MCP 빈카드 gate는 `exclude`, sync gate는 `proceeded:false`인 비대화식 경로다([emptyRefGate.js:9-24](../../src/services/emptyRefGate.js#L9)). 그래서 현재 MCP scene batch는 빈카드 생성/sync로 열리지 않고, 실제 비-character 업로드가 있을 때만 열린다. |
| MCP `app_generate_scene` | UI 개별 생성과 같은 두 sync gate | 한 틱 닫기 예약 | HTTP는 fire-and-forget이지만 renderer에서는 같은 `handleGenerateScene`을 호출한다([useMcpServer.js:428-434](../../src/hooks/useMcpServer.js#L428)). 실제 sync target이 있으면 사람용 모달과 패널이 함께 열린다. |
| Ref 패널 직접 생성 / MCP `app_generate_reference`, `app_start_ref_batch` | 실제 target이 있는 `preparingRefs`/`generatingRefsCount` | `stoppingRefs` | UI 직접 생성은 시작점부터 패널이 사용자 소유로 열려 있으므로 자동 소유하지 않는다. MCP처럼 패널이 닫힌 진입점에서는 실제 Ref 작업이 시작될 때 연다. noop Ref batch는 열지 않는다. |

`useVideoAutomation`은 같은 `status` 단어를 쓰지만 별개 인스턴스다
([App.jsx:842-849](../../src/App.jsx#L842),
[useVideoAutomation.js:925-933](../../src/hooks/useVideoAutomation.js#L925)). 이 훅에는 `preparing`을 추가하지
않고 영상 쪽 준비/실행을 기존 `running` 전이로 계속 표현한다. 이미지와 영상 status 어휘의 비대칭은
의도적이다.

## 5. 컨트롤러와 상태 전이

App의 거대한 컴포넌트 안에 effect 묶음을 직접 넣지 않는다. `useRefPanelVisibility`라는 작은
컨트롤러 훅을 만들고 `showReferences` state도 이 훅이 소유한다.

```js
const {
  isOpen: showReferences,
  setOpenByUser, // (nextOpen: boolean) => void
} = useRefPanelVisibility({
  preparingRefs,
  generatingRefsCount: generatingRefs.length,
  stoppingRefs,
  syncGate,
  syncGateBusy,
  mode,
  automationStatus: status,
  hasPendingBatch,
  projectKey: settings.projectName,
})
```

가장 늦게 선언되는 입력은 현재 `useReferenceGeneration`의 반환값
([App.jsx:884-891](../../src/App.jsx#L884))이다. 훅을 그 뒤에 두면 TDZ가 없다. `settings.projectName`은
이미 [App.jsx:220-221](../../src/App.jsx#L220)에서 선언돼 있다.

컨트롤러 전이는 다음과 같다.

| 전이 | 결과 |
|---|---|
| opening true, 닫힘, 억제 없음 | 패널을 열고 `owned=true`로 기록한다. edge뿐 아니라 억제 해제와 같은 렌더에서 이미 true인 경우도 포함한다. |
| opening true, 이미 열림 | 소유권을 바꾸지 않는다. 사용자 소유(`owned=false`)를 앱이 빼앗지 않고, 직전 렌더에서 앱이 연 `owned=true`도 잃지 않는다. |
| opening true, 억제됨 | 열지 않는다. |
| bridge true, `owned=true` | 예약된 닫기를 취소하고 계속 연다. |
| bridge true, `owned=false` | 아무것도 하지 않는다. 닫힌 패널을 bridge가 열 수 없다. |
| opening/bridge 모두 false, `owned=true` | 한 틱 뒤 닫기를 예약한다. 그 전에 어느 신호든 돌아오면 취소한다. |
| 닫기 예약 만료, 여전히 무신호, `owned=true` | 패널을 닫고 소유권을 버린다. |
| 프로젝트 key 변경 또는 언마운트 | 소유권·억제·타이머를 버리되 현재 패널 open state는 바꾸지 않는다. |

React StrictMode에서 effect setup/cleanup이 두 번 실행돼도 열기·닫기 횟수가 늘거나 stale timer가 남지
않아야 한다. 타이머 ID와 소유권/억제의 즉시 판정값은 ref로 관리하고, 화면 state만 React state로
노출한다.

## 6. 사용자 억제 규칙

무인자 `onUserToggle()`은 금지한다. 열기와 닫기를 구분할 수 있는 단일 진입점
`setOpenByUser(nextOpen: boolean)`을 쓴다.

- Ref 버튼은 `setOpenByUser(!showReferences)`를 호출한다.
- 레퍼런스 CSV 임포트 완료는 `setOpenByUser(true)`를 호출한다.
- `nextOpen === true`면 자동 소유와 닫기 예약을 버리고 억제를 해제한다. 사용자가 명시적으로 연
  패널은 작업 종료 뒤에도 열려 있어야 한다.
- `nextOpen === false`이고 `hasPendingBatch`, opening, bridge, `owned` 중 하나라도 true면 억제를
  세팅한다. 신호 사이의 한 틱 틈에서 닫아도 같은 창에 대한 닫기 의사로 기록된다.
- 아무 배치·Ref 창도 아닌 평상시에 사용자가 닫는 것은 억제를 만들지 않는다.

억제 해제 조건은 세 가지뿐이다.

1. 사용자가 `setOpenByUser(true)`로 다시 연다.
2. `hasPendingBatch`가 false→true가 되는 **다음 배치 경계**다.
3. `projectKey`가 바뀐다.

`hasPendingBatch`의 full-start producer는 다섯 논리 경로다. API 이미지 direct
([App.jsx:1622-1623](../../src/App.jsx#L1622)), T2V
([App.jsx:1662-1666](../../src/App.jsx#L1662)), I2V
([App.jsx:1777-1781](../../src/App.jsx#L1777)), API tag-proceed
([App.jsx:1923-1926](../../src/App.jsx#L1923)), Flow coordinator다. Flow coordinator는 빈카드 없는
분기와 있는 분기에 각각 call site가 있다
([emptyRefGate.js:230-249](../../src/services/emptyRefGate.js#L230),
[emptyRefGate.js:253-260](../../src/services/emptyRefGate.js#L253)). 각 경로는 배치당 rising edge를 한 번만
만든다. 에러 전체 재시도와 ResultsTable 단건 재시도도 각각 true→finally false로 감싸져 있다
([App.jsx:2467-2501](../../src/App.jsx#L2467),
[App.jsx:2591-2612](../../src/App.jsx#L2591),
[App.jsx:2691-2712](../../src/App.jsx#L2691)); 이들도 새 retry 배치 경계로 취급한다.

중요한 타이밍 예외가 있다. 빈카드가 없는 Flow 배치는 sync gate를 다 처리한 뒤에야
`setPendingLatch(true)`를 호출한다
([emptyRefGate.js:189-232](../../src/services/emptyRefGate.js#L189)). T2V도 sync가 끝난 뒤
`startVideoTextWith` 안에서 latch를 올린다. 따라서 이전 개별 생성에서 세팅된 억제는 다음 배치의 sync
gate 동안 아직 살아 있다가 sync 종료 뒤에 풀릴 수 있다. sync 구간은 어차피 전면 모달 뒤라 시각적
손실이 0이고, latch를 더 이르게 옮기면 배치 경계 소유권을 넓히므로 현재 순서를 유지한다. 빈카드가
있는 Flow 배치는 확인 모달 전에 latch를 올리므로 실제 빈카드 생성 전에 억제가 풀린다.

개별 씬 생성만 연속으로 실행하면 `hasPendingBatch` rising edge가 없다. 한 번 닫아 억제한 뒤의 다음
개별 sync는 열리지 않고, 다음 배치 시작·명시적 사용자 열기·프로젝트 변경 중 하나에서 풀린다. 이것도
의식적인 규칙이다.

## 7. 공유 큐 지연은 Start 인터리브를 막아 해결한다

검토된 두 선택지 중 “알려진 한계로 둔다”가 아니라 `isStartBlocked`에 개별 씬 생성 신호를 추가한다.

```js
isStartBlocked({
  isRunning,
  videoRunning,
  hasPendingBatch,
  retryInFlight,
  generatingSceneId,
})
```

App은 `generatingSceneId`를 전달하고, Start 버튼도 같은 값이 있으면 disabled가 된다. 이 가드는 UI와
MCP가 공유하는 `handleStartImpl` 초입에 있으므로 개별 씬 프리플라이트·sync·생성·사후복구가 끝나기
전에는 새 배치를 enqueue하지 않는다.

이 선택의 근거는 다음과 같다.

- 문제를 만든 경로는 개별 씬의 `generatingSceneId`가 이미 전체 수명을 정확히 덮는데 Start만 그 값을
  무시하던 비대칭이다.
- 비디오 배치는 기존 `videoAutomation.isRunning`/`hasPendingBatch`로, 대화식 Ref 생성은 이미 열린
  패널 또는 ref lifecycle 신호로 관측된다. 검토에서 재현된 “sync gate가 닫힌 뒤 수십 초 대기”의 빈
  구간은 개별 씬과 Start의 인터리브를 막으면 사라진다.
- `setStatus('preparing')`을 enqueue 앞으로 옮기지 않으므로 quota reject와 clearQueue reject에서 상태가
  고착되지 않는다.

MCP의 batch start HTTP 응답은 원래 fire-and-forget이라 실제 enqueue 성공을 보장하지 않는다. 개별 씬이
진행 중이면 공유 가드에서 요청이 무시되는 기존 형식은 유지한다. 이 기능에서 MCP 응답 프로토콜까지
acknowledged/blocked로 바꾸지는 않는다.

## 8. 이미지 배치 상태와 MCP 계약

`useAutomation.start()`가 큐에서 실제 실행될 때 현재의 첫 `setStatus('running')`을
`setStatus('preparing')`으로 바꾼다. 위치는 그대로 `start()` 내부, `setIsRunning(true)` 다음이다.
씬 큐 직전에는 명시적으로 `setStatus('running')`을 둔다. 전이는 다음과 같다.

```text
ready → preparing → uploading(실제 업로드가 있을 때만) → running → done/stopped/error
                  └──────────────────────────────→ running
```

이 상태는 두 역할을 한다. 첫째, 앱이 이미 빈카드 생성이나 sync로 패널을 열었다면 무조건 실행되는
폴더·토큰 IPC 동안 bridge가 된다. 둘째, StatusBar가 프리플라이트 중 완료 통계로 되돌아가지 않고 진행
중임을 표시할 수 있다. `preparing` 자체는 opening signal이 아니다.

외부 계약은 **새 상태 추가가 아니라 MCP 응답에서 정규화**하는 쪽으로 결정한다.

```js
externalStatus = internalStatus === 'preparing' ? 'running' : internalStatus
```

정규화는 `useMcpServer`가 `window.__mcpBatchStatus` 응답을 만들 때 한 번만 한다. renderer 내부 훅과
StatusBar는 `preparing`을 그대로 보고, `/api/batch-status`, `app_batch_status`, `app_wait_batch`는 기존
`running`을 본다. `app_wait_batch`의 완료 판정은 원래도 `status` 문자열이 아니라 `isRunning`을 보므로
([mcp-server/index.js:1423-1435](../../mcp-server/index.js#L1423)) 동작은 바뀌지 않는다. 외부 문서와 MCP
서버 enum을 늘리지 않는다.

StatusBar의 21~28줄은 라벨 맵이 아니라 클래스 맵이다
([StatusBar.jsx:21-28](../../src/components/StatusBar.jsx#L21)). CSS에는
`.status-bar.uploading` 규칙만 있고
([App.css:1669-1672](../../src/App.css#L1669)), `.status-bar.running` 규칙도 없다. 따라서
`preparing` 클래스나 CSS를 추가하지 않는다. 실질 필수 변경은
[StatusBar.jsx:32](../../src/components/StatusBar.jsx#L32)의 `isActive`에 `preparing`을 포함해 진행률
텍스트를 표시하는 한 줄뿐이다.

## 9. 구현 구조와 변경 범위

구현자는 다음 경계를 유지한다.

1. `src/hooks/useRefPanelVisibility.js`를 새로 만든다. 신호 합성, 자동 소유, 한 틱 닫기, 억제,
   프로젝트 경계, 방향 있는 사용자 setter를 모두 이 훅이 소유한다.
2. `src/App.jsx`는 기존 `showReferences` state를 제거하고 훅의 `isOpen`과 `setOpenByUser`를 사용한다.
   Ref 버튼과 CSV 임포트 모두 같은 방향 있는 setter를 쓴다. 원신호 OR나 억제 판정은 App에 복제하지
   않는다.
3. `src/hooks/useReferenceGeneration.js`는 noop과 queued Stop 판정을 모두 지난 뒤에만
   `preparingRefs`를 올리도록 lifecycle 의미를 교정한다.
4. `src/hooks/useAutomation.js`는 큐 안의 이미지 배치 상태를 `preparing → uploading? → running`으로
   만든다. 기존 업로드 Stop 정산 코드는 건드리지 않는다.
5. `src/services/startGuard.js`와 `src/App.jsx`는 `generatingSceneId`를 Start 차단 입력에 추가한다.
6. `src/hooks/useMcpServer.js`는 외부 batch status에서만 `preparing → running`으로 정규화한다.
7. `src/components/StatusBar.jsx`는 `preparing`을 active progress로만 취급한다. CSS 변경은 없다.
8. `src/hooks/useVideoAutomation.js`, `src/services/emptyRefGate.js`, MCP 서버·Electron route는 변경하지
   않는다.

## 10. 받아들임 기준

아래 항목은 모두 화면, DOM, 공개 상태 응답 또는 버튼 상태로 관측할 수 있어야 한다.

1. Ref 패널을 닫고, 빈카드·미동기화 멘션·비-character 업로드 대상이 전혀 없는 Flow 이미지 배치를
   시작하면 폴더/토큰 검사와 씬 큐 진입 사이에 `ReferencePanel`이 한 번도 mount되지 않는다.
2. 빈카드 확인에서 “먼저 생성”을 누르면 confirm 모달이 사라진 뒤 Ref 패널이 mount되고 해당 카드의
   기존 진행 표시가 보인다. 이어지는 sync, 폴더/토큰 preflight, 실제 업로드가 있더라도 첫 씬 큐
   시작 전까지 패널이 중간에 unmount되지 않는다.
3. 빈카드와 sync는 없고 비-character 업로드만 있는 Flow 배치는 폴더/토큰 검사 동안 닫혀 있다가
   `status:'uploading'`이 되는 렌더에서 처음 열린다. 첫 씬 큐가 시작돼 status가 `running`이 되면 한
   틱 뒤 닫힌다.
4. 실제 target이 0건인 UI/MCP Ref batch는 `preparingRefs`가 true인 렌더를 만들지 않고 닫힌 패널을
   열지 않는다.
5. 이미지 배치, T2V, 개별 씬 프리플라이트, 개별 씬 사후복구에서 실제 sync target이 있으면 sync
   모달이 열린 동안 DOM에 `ReferencePanel`도 mount돼 있다. target이 없으면 어느 경로에서도 sync
   때문에 패널이 열리지 않는다.
6. I2V/F2V 배치와 API 이미지 배치는 `hasPendingBatch` 또는 내부 `preparing`만으로 Ref 패널을 열지
   않는다. API 모드에서 no-op `uploading` 상태가 생겨도 열리지 않는다.
7. 앱이 연 패널을 Ref 창 도중 사용자가 닫으면 같은 배치의 뒤쪽 sync·preparing·uploading 신호에서도
   다시 mount되지 않는다. 다음 배치 rising edge 뒤 실제 opening signal이 오면 다시 mount된다.
8. 사용자가 작업 전부터 패널을 열어 둔 경우 Ref 창이 끝나도 열린 채 남는다. 앱이 자동으로 연 도중
   사용자가 명시적으로 다시 열기 방향을 보낸 경우도 사용자 소유로 전환돼 남는다.
9. 패널을 억제한 뒤 프로젝트를 전환하거나 이름을 바꾸면 현재 open/closed 화면 상태는 즉시 바뀌지
   않지만, 다음 실제 Ref 작업은 옛 억제에 막히지 않는다.
10. `generatingSceneId`가 있는 동안 Start 버튼은 disabled이고 UI/MCP의 `handleStartImpl`은 새 batch를
    enqueue하지 않는다. 개별 씬이 끝난 뒤 자동으로 뒤늦은 `preparing` 상태나 패널 재열림이 나타나지
    않는다.
11. 내부 이미지 자동화가 `preparing`일 때 StatusBar는 완료 개수 대신 `current / total (percent%)`를
    표시한다. 같은 시점의 `GET /api/batch-status`와 `app_batch_status` 응답의 `status`는
    `"running"`, `isRunning`은 `true`다.
12. React StrictMode에서 같은 opening transition이 effect 재실행 때문에 두 번 열리거나, 작업 종료 후
    stale timer가 사용자 소유 패널을 닫는 현상이 없다.

## 11. 실행 가능한 검증 계획

App을 통째로 렌더하거나 `PromptInput`만 mock하면 된다고 가정하지 않는다. 새 테스트는 다음처럼 실제
추출 단위를 import해 실행한다.

| 대상 | 실행 검증 |
|---|---|
| `useRefPanelVisibility` | `tests/hooks/useRefPanelVisibility.test.jsx`에서 `renderHook`으로 opening/bridge의 분리 진리표, bridge 단독 비개방, 한 틱 F→T, 자동 소유/사용자 소유, `setOpenByUser(true/false)`, 같은 배치 억제, 다음 rising edge 해제, 늦은 sync 해제 타이밍, `projectKey` 변경, rename과 같은 key 변경, unmount, StrictMode를 fake timer로 실행한다. |
| Ref batch lifecycle | 기존 `tests/hooks/useReferenceGeneration.targetedBatch.test.jsx`에 deferred preflight와 렌더 상태 log를 사용해 target 1건은 `preparingRefs:true`, target 0건/noop과 queued Stop은 log에 true 렌더가 없음을 검증한다. 기존 batch stop 테스트도 함께 돌려 cleanup false를 보존한다. |
| 이미지 status | `tests/hooks/useAutomation.preparingStatus.test.jsx`를 추가해 deferred folder/token 동안 `preparing`, 실제 upload에서 `uploading`, 첫 scene submit 직전 `running` 순서를 관측한다. quota reject와 `clearQueue` reject에서는 status가 `ready`에서 바뀌지 않는 케이스를 반드시 넣어 status를 enqueue 앞으로 옮기는 회귀를 막는다. |
| Start 인터리브 | `tests/components/App.handleStart.test.js`가 실제 import하는 `isStartBlocked` 진리표에 `generatingSceneId` true를 추가하고, false일 때만 통과함을 확인한다. 버튼의 최종 disabled와 실경로는 아래 실앱 시나리오에서도 확인한다. |
| MCP 계약 | `tests/hooks/useMcpServer.test.js`에서 `automationState.status:'preparing', isRunning:true`로 훅을 렌더한 뒤 `window.__mcpBatchStatus()`가 `status:'running'`을 반환하는지 실행한다. `uploading`, `running`, `done`, 별도 video status는 그대로 통과하는 표도 둔다. |
| StatusBar | `tests/components/StatusBar.test.jsx`에서 `status="preparing"`이 active progress 텍스트를 표시하고 별도 `preparing`/`running` CSS class에 의존하지 않는지 렌더한다. |
| 기존 sync 경로 | `tests/hooks/useSceneGeneration.mentionSync.test.js`, `tests/hooks/useSyncGateHost.test.js`, `tests/services/emptyRefGate.test.js`를 회귀 실행해 프리플라이트/사후복구/배치 gate 수명이 그대로인지 확인한다. |
| 업로드 Stop 전제 | `tests/hooks/useAutomation.uploadStopHang.test.jsx`를 그대로 실행한다. 이 스펙 구현이 `settleIfDone`을 되돌리거나 status 변경으로 고착을 재발시키면 안 된다. |

App 배선에 기존과 같은 소스 문자열 assertion을 더하지 않는다. 컨트롤러가 `showReferences` state와
방향 있는 setter까지 소유하게 해 핵심 동작은 훅 테스트에서 실행한다. App에 남는 얇은 어댑터—Ref
버튼이 `!showReferences`, CSV 임포트가 `true`, 원신호가 훅 인자로 전달되는 부분—는 다음 실앱
시나리오로 확인한다.

1. Flow 이미지 배치에서 ref 없음 / 빈카드 생성 / sync만 / 업로드만 네 프로젝트를 각각 실행한다.
2. 개별 씬을 한 번은 프리플라이트 sync, 한 번은 unresolved 응답 뒤 사후복구 sync로 실행한다.
3. 개별 씬 생성 중 Start 버튼이 disabled인지 확인하고, 완료 뒤 유령 batch가 시작되지 않는지 본다.
4. T2V sync와 I2V 무신호를 비교한다.
5. 자동으로 열린 패널을 닫고 같은 배치에서 다음 Ref 단계가 와도 안 열리는지, 다음 배치에서는 다시
   열리는지 확인한다.
6. `curl http://127.0.0.1:3210/api/batch-status`로 내부 `preparing` 구간의 외부 status가 `running`인지
   확인한다.

자동 테스트의 최소 실행 명령은 다음과 같다.

```bash
npx vitest run \
  tests/hooks/useRefPanelVisibility.test.jsx \
  tests/hooks/useReferenceGeneration.targetedBatch.test.jsx \
  tests/hooks/useReferenceGeneration.batchStop.test.jsx \
  tests/hooks/useAutomation.preparingStatus.test.jsx \
  tests/hooks/useAutomation.uploadStopHang.test.jsx \
  tests/components/App.handleStart.test.js \
  tests/components/StatusBar.test.jsx \
  tests/hooks/useMcpServer.test.js \
  tests/hooks/useSceneGeneration.mentionSync.test.js \
  tests/hooks/useSyncGateHost.test.js \
  tests/services/emptyRefGate.test.js
```

그 뒤 `npm run test:run`으로 전체 회귀를 확인한다.

## 12. 알려진 한계

- sync gate는 언제나 자기 `Modal`의 전면 overlay 뒤에 있다. 공통 Modal은 body portal의
  `.modal-overlay`를 렌더한다
  ([Modal.jsx:22-49](../../src/components/Modal.jsx#L22)). 따라서 이미지 배치·T2V·개별 생성의 sync
  구간에서 패널을 mount해도 사용자가 보는 시각적 이득은 **0**이다. 특히 개별 씬은 sync 외에 이
  기능이 관측하는 Ref 단계가 없어서 눈에 보이는 이득이 전혀 없다. 그래도 사용자가 명시한 일관성
  때문에 프리플라이트와 사후복구를 모두 포함한다.
- `projectKey`가 `settings.projectName`이라 Rename은 프로젝트 전환과 똑같이 소유권·억제를 초기화한다.
  같은 프로젝트의 이름만 바꾼 것이라도 예외를 두지 않는다.
- 이번에 막는 공유 큐 지연은 개별 씬 생성과 Start의 인터리브다. MCP ref batch처럼 별도 Ref 작업을
  직접 큐에 넣는 기능 자체를 직렬 큐 밖으로 빼지는 않는다. 다만 그 경로는 기다리는 동안 opening
  signal이 없고, 실제 Ref 실행이 시작된 뒤에만 패널을 열므로 검토된 닫힘→재열림 창을 만들지 않는다.
- MCP `app_generate_scene`은 현재 사람용 sync 모달을 열 수 있고 HTTP 응답은 fire-and-forget이다. 이
  스펙은 headless auto-sync나 blocked acknowledgment를 추가하지 않는다.
- 영상 자동화는 별도 status 인스턴스라 `preparing`을 얻지 않는다. 영상 preflight/실행이 기존
  `running` 어휘를 쓰는 비대칭을 유지한다.
- 한 틱 닫기 예약은 마이크로태스크 틈만 보장한다. 임의의 장시간 gap을 타이머로 숨기지 않는다. 새
  장시간 gap이 생기면 producer/라이프사이클을 관측 가능하게 만드는 별도 수정이 필요하다.

## 13. 정공법과 MVP 대안 비교

| 항목 | 선택한 정공법 | 축소 MVP |
|---|---|---|
| 여는 조건 | 실제 target이 보장된 `preparingRefs`, sync, Flow `uploading` | 기존 `generatingRefsCount`, sync, Flow `uploading`만 사용 |
| 구간 연속성 | 이미지 배치 내부 `preparing` bridge와 ref lifecycle 의미 교정으로 빈카드/sync부터 씬 큐 직전까지 유지 | sync/ref 생성이 끝난 뒤 폴더·토큰 IPC에서 닫히고, upload가 있으면 다시 열릴 수 있음 |
| 공유 큐 | `generatingSceneId`를 Start 가드에 넣어 검토된 수십 초 인터리브 차단 | 현행 유지. 개별 씬 중 Start를 누르면 닫힘→지연→재열림 가능 |
| MCP | 새 내부 status를 외부 경계에서 `running`으로 정규화하고 계약 테스트 추가 | 새 status가 없으므로 MCP 변경 없음 |
| 변경 비용 | 컨트롤러 훅 외에 `useReferenceGeneration`, `useAutomation`, `startGuard`, App, `useMcpServer`, StatusBar를 건드림 | 컨트롤러 훅과 App 중심. lifecycle·외부 경계 변경이 적음 |
| 잃는 것 | — | “실제 Ref 작업 창 동안 한 번 열린 패널이 끊기지 않는다”는 보장, 큐 지연 재현의 제거, ref preflight 가시성 |

MVP도 “업로드가 시작되면 연다”는 최소 문장은 만족할 수 있다. 그러나 빈카드 생성과 sync 뒤에 패널이
닫혔다가 업로드에서 다시 열리는 R2/R3의 핵심 실패를 알려진 한계로 되돌린다. 이번에는 사용자가
가급적 정공법을 요청했고, 상태 외부 노출과 큐 reject까지 확인했으므로 정공법을 본안으로 확정한다.

## 14. R3와 달라진 결정

- 기능 2를 완전히 분리했다.
- `preparing`을 opening OR에서 제거하고 **bridge 전용**으로 내렸다. ref가 없는 배치는 더 이상
  `preparing` 때문에 열리지 않는다.
- `preparingRefs`를 무조건 신뢰하지 않고 noop과 queued Stop보다 뒤에서만 true가 되도록 producer
  계약을 고친다.
- 사용자 callback을 무인자 토글에서 `setOpenByUser(nextOpen)`으로 바꿨다.
- 개별 씬과 Start의 공유 큐 지연을 알려진 한계로 두지 않고 `generatingSceneId` 가드로 막는다.
- `preparing`이 MCP 외부로 새는 경로를 인정하고, 외부 계약을 늘리는 대신 batch status 경계에서
  `running`으로 정규화하기로 결정했다.
- StatusBar 변경을 `isActive` 한 줄로 줄였다. 존재하지 않는 라벨 맵이나 `.status-bar.running` CSS를
  전제로 하지 않는다.
- App 렌더 테스트가 있다는 가정을 버렸다. 새 컨트롤러를 실제 `renderHook`으로 검증하고 App의 얇은
  배선은 구체적인 실앱 시나리오로 확인한다.
- 동기화의 시각적 이득이 0이라는 사실, `settings.projectName` Rename의 초기화 부작용,
  `useVideoAutomation`의 상태 비대칭을 명시했다.
