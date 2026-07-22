# 세션 핸드오프 — 2026-07-22

워크트리 `~/workspace/AutoFlowCut-bugfix` (현재 **main** 체크아웃).
⚠️ `~/workspace/AutoFlowCut` 은 건드리지 말 것(다른 브랜치 워크트리).

## 1. Flow 프로젝트 바인딩 회복 — **끝. main 에 머지·푸시됨**

`origin/main` = `30e888f8`. 상세는 `docs/plans/2026-07-22-flow-adopt-handoff.md`.
남은 건 실앱 눈검증뿐(모달 닫은 뒤 Flow 뷰가 0×0 에서 복구되는지).

## 2. 미동기화 @멘션 복구(문지기 버그) — **코드 완료, 로컬 커밋 14개, 미푸시**

`b7d3e2ee..83f69beb`. 전체 스위트 **6912 green**, 앱 빌드 확인.

**증상**: '부자와 빈자' 6번 씬이 `Unresolved @mention(s): 문지기` 로 영구 실패.
문지기만 `flowNameSyncStatus:'failed'`(entityId/workflowId/mediaId 는 있음)였고, 그 씬은 synced
캐릭터와 섞여 있어 이미지 폴백도 못 탔다. 사용자가 Flow 에서 직접 고쳤는데 앱이 옛 판정을 다시
보지 않았고, **배치(Start)에는 동기화 게이트가 있는데 씬 카드 개별 생성에는 없었다**(같은
프롬프트가 경로에 따라 되고 안 됨).

**고친 것**
- `planMentionRouting` → `errorKind:'unresolved-mentions'` + `unresolvedNames`(문자열 파싱 금지)
- `useSceneGeneration`: 생성 전 프리플라이트 게이트 + 거절 시 강제 재등록 후 **1회** 재시도 +
  Flow 의 `staleMention` 신호도 같은 복구로
- `utils/mentionSyncTargets.js`: 대상 선정을 **엔진과 같은 파서**(`parseSceneMentions`)로,
  대소문자 구분. 배치·T2V·개별 씬 **세 경로가 이제 이 셀렉터 하나**를 쓴다
  (`selectUnsyncedMentionedRefs` 는 제거됨)
- `hooks/useSyncGateHost.js`: 게이트 소유권(identity·busy latch·supersede/abort/cancel/unmount 정산)
- `services/mentionSyncRequest.js` / `services/syncGateRun.js`: 판정과 실행을 App 밖으로 —
  **App 안에 있을 땐 통째로 되돌려도 6894개 전체 스위트가 초록불이었다**(Fable 뮤테이션 실측)
- main: `flowProjectId` 는 merge 전용 키, merge 는 없으면 생성/깨졌으면 실패
- `tests/packaging/sourcesParse.test.js`: src 전체 파싱 + App import 그래프 — 중복 `const` 로
  앱이 빌드조차 안 되는데 6889개가 초록불이던 사고 이후 추가

**리뷰**: Codex(gpt-5.6-sol, xhigh) 8라운드 → findings 0 / GO. 그 뒤 Fable 5 3라운드 → Go.
(Codex GO 이후 Fable 이 실질 findings 를 낸 게 이 브랜치에서만 두 번이다.)

**남은 것**: 실앱 눈검증 — 6번 씬 생성 시 문지기 동기화 모달이 뜨고, 동기화 후 생성되는지.
확인되면 push.

### 스타일 관련 별건 (조사만 끝남, 코드 변경 없음)
2번 씬이 실사로 나온 건 **버그가 아니다**. `resolveSceneStyle` 을 실데이터로 돌려보면
`", Korean anime style, vibrant colors, detailed characters"` 가 정상적으로 붙는다. 원인은 씬
프롬프트 11개가 전부 `Cinematic` + `35mm` + `film grain` 을 달고 있어서 짧은 스타일 꼬리를
이기는 것. 대본 생성 단계에서 다룰 문제.

## 3. 신규 UI 2건 — **설계 단계. 구현 미착수**

스펙: `docs/plans/2026-07-22-ref-peek-and-gutter-spinner-design.md` (커밋 `83f69beb`)

1. 배치가 실제로 ref 를 동기화/업로드하는 동안 레퍼런스 패널을 자동으로 펼치고, 끝나면 되돌린다.
   단 **사용자가 그 사이 패널을 직접 건드렸으면 되돌리지 않는다**.
2. 프롬프트 거터의 씬 번호 **둘레에 금색 링**이 돈다(숫자는 그대로). 그 씬의 이미지 또는
   비디오가 생성 중일 때.

사용자 결정 사항은 스펙에 반영돼 있다(배치당 1회 + 복귀, 둘 중 하나라도 생성 중, 숫자 유지).

**진행 상태**: Fable 5 스펙 리뷰 **완료(8건)**, 지적 사항은 스펙에 **반영 커밋됨**(`ad53693f`).
앵커는 전부 정확했고, 틀린 건 **신호 의미론**이었다:
- "`uploading` 은 배치당 한 번뿐"은 **추론으로 쓴 문장이고 실제로 틀렸다** — 캐릭터 동기화가 있는
  flow 배치는 두 번 펄스가 뜨고, 두 번째가 사용자가 닫은 패널을 다시 연다.
- API 모드는 `uploadReference` 가 스텁이라 `mediaId` 가 영영 안 채워져 **모든** 배치가 헛되이
  `'uploading'` 에 들어간다.
- `syncGateBusy` 구간은 전체화면 모달 뒤라 패널을 펼쳐도 안 보인다.
→ 신호를 `mode === 'flow' && status === 'uploading'` **하나로** 줄였다(세 문제가 함께 사라진다).
기능 2 는 "이미지 또는 비디오" 문장이 받아들임 기준과 모순이라 탭별 상태로 확정했다.

**다음**: 스펙은 구현 준비 완료. 구현 Codex(gpt-5.6-sol, xhigh) → 리뷰 Fable 5 → 검증 Opus.

방식은 스펙 확정 → **구현은 Codex(gpt-5.6-sol)** → **리뷰는 Fable 5** → 검증은 Opus.

---

# 이어진 세션 — 2026-07-22 (2차)

`origin/main` 대비 **로컬 31커밋 미푸시.** 전체 스위트 **675파일 / 6978테스트 통과**
(기존 `VideoDetailModal.generateButton.test.jsx` 의 unhandled rejection 2건은 이 작업과 무관한 기존 문제).

## 끝난 것

**1. 업로드 중 Stop 고착 버그 — 별건으로 수정 완료** (`91abb635`)

토큰 IPC 대기 중 Stop 을 누르면 배치가 **영구히 멈춰** 앱이 다시는 배치를 못 돌렸다. 업로드
코디네이터의 유일한 `resolve()` 가 투입된 업로드의 `finally` 안에만 있는데, `tryLaunch` 는 stop
상태면 하나도 투입하지 않고 interval 은 `clearInterval` 후 그냥 return 한다. `settleIfDone()` 이
정산을 소유하도록 고쳤다. TDD — 수정을 되돌리면 테스트가 타임아웃으로 행하는 것까지 실측 확인.

**2. 기능 1(Ref 패널 자동 펼침) — 스펙 확정 + 구현 완료**

스펙: `docs/plans/2026-07-23-ref-peek-spec-v2.md`. **저자는 Codex** — 내가 쓴 초안이 R1·R2·R3
리뷰에서 계속 BLOCKER 를 맞고 수렴하지 않아 저자를 교체했다(그 판단은 메모리
`swap-the-author-when-spec-wont-converge` 에 남겼다).

핵심 설계:
- **여는 신호 = 실제 ref 작업 증거**(`refBatchActive` / `generatingRefs` / `syncGate` / flow `uploading`),
  `preparing` 은 **유지 신호로만**. "배치 시작"은 여는 조건이 아니다.
- `refBatchActive` 신규 — 배치가 아이템마다 auth 토큰을 재추출하는 동안 기존 ref 플래그가 **전부
  꺼져서** 레퍼런스 개수만큼 패널이 깜빡였다. `startGuard.js:7-13` 주석이 이미 그 창을 적어놨었다.
- `useAutomation` 에 `'preparing'` 상태 신설, **MCP 경계에서 `running` 으로 정규화**해 외부 계약 유지.
- `isStartBlocked` 에 `generatingSceneId` + `refBatchRunning` 추가, `useSceneGeneration` preflight 를
  outer try/finally 로 감싸 busy flag 고착 차단.

리뷰: Fable 5 스펙 2라운드 → GO, 구현 1라운드 → **GO(블로커 없음)**.

**이 기능의 진짜 근거**(3라운드 내내 아무도 못 찾다가 마지막에 나옴): `EmptyReferenceGateModal.jsx:91-95`
가 busy 동안 `null` 을 반환하며 *"진행 상황은 레퍼런스 카드의 기존 spinner 가 담당한다"* 고 적어놨다.
그 카드가 접힌 패널 안에 있어서 아무도 못 봤을 뿐이다. 모달 뒤인 구간은 **동기화 하나뿐**이고
(`.modal-overlay` = `rgba(0,0,0,0.7)`), 빈카드 생성과 업로드는 온전히 보인다.

## 뮤테이션에서 나온 것 — 전체 초록불이 못 잡은 구멍 2개

10종을 돌려 8종은 바로 죽었고 **2종이 살아남았다. 둘 다 테스트 이름이 약속한 걸 몸이 안 했다.**

1. `bridge 신호만으로는 닫힌 패널을 열지 않는다` — 테스트가 패널을 **먼저 열어놓고** 시작해 "유지"
   절반만 지나갔다. → `36dc2aca`
2. `사용자 open 이 억제를 해제한다` — `setOpenByUser(true)` 는 억제와 무관하게 패널을 열기 때문에
   그 뒤 `isOpen === true` 를 봐도 해제 여부를 관측 못 한다. 억제가 남아 있어도 통과했다. → `b885269a`

**3. 기능 2(프롬프트 거터 진행 링) — 구현 완료** (`370acf1b`, `+` SM1 테스트)

스펙은 `2026-07-22-ref-peek-and-gutter-spinner-design.md` 의 `## 기능 2` 절(리뷰 통과본).
`src/utils/promptBusyLines.js` 가 씬마다 `split('\n').length` 를 누적해 **문단 오프셋**을 계산한다 —
프롬프트에 개행이 든 씬이 앞에 있어도 뒤 씬의 링이 안 밀린다(이 기능의 핵심 함정).
`PromptInput` 의 `BusyLinesPlugin` 은 prop 변경과 Lexical 재조정 **양쪽**에서 클래스를 다시 붙인다.
`@keyframes spin` 중복 정의 둘을 하나로 정리. Fable 리뷰 GO-with-fixes → fixes 반영 완료.

**부수 성과: 이 저장소 최초의 App 렌더 테스트 하네스**가 생겼다
(`tests/components/App.promptBusyLines.test.jsx`, 모듈 ~50개 mock). 그전까지 App 을 import 하는
테스트 4개는 전부 `fs.readFileSync` 소스 문자열 방식이었고, 리뷰어 둘 다 전체 렌더는 불가능하다고
판정했었다. 앞으로 App 배선 검증은 이 하네스를 확장해서 쓸 것.

## 뮤테이션에서 또 나온 것

기능 2 도 8종을 돌려 전부 죽었는데, Fable 이 **추가로 4종**을 지목했고 그중 하나가 진짜였다:

- **`useMemo` 의존성 `[scenes]` → `[]`** — 6978개 전부 통과하는데 **실앱에선 기능이 죽는다**
  (씬이 빈 배열로 시작하므로 링이 영영 안 뜸). 배선 테스트가 **1회 렌더만** 해서 재계산 경로를
  안 지나갔다. 새 배열로 교체 후 다시 렌더하는 케이스를 추가해 죽였다.
- ⚠️ **뮤테이션 하네스 자체를 먼저 검증할 것.** 이 건은 처음에 `perl` 이 문법을 깨서 테스트가
  실패한 걸 내가 "killed" 로 읽었다. 정확히 적용해 보니 살아남고 있었다. 뮤턴트를 적용한 뒤
  **`git diff --stat` 으로 정말 1줄만 바뀌었는지** 확인하고 판정할 것.

## 남은 것

- **실앱 눈검증 3건** (푸시 게이트):
  1. 문지기 동기화 — repro 프로젝트를 깔아뒀다: `~/Documents/AutoFlowCut/_syncgate_repro`
     (정도준 ref 가 `entityId`+`workflowId`+`mediaId` 는 있는데 `flowNameSyncStatus:'failed'`,
     씬1 프롬프트 `@정도준 …`, 원본 Flow 프로젝트를 안 건드리게 바인딩 제거). Flow 모드로 열고
     씬1 카드 생성 → `🔄 Flow 동기화 필요` 모달에 정도준 → `동기화 후 생성` → 생성 진행.
  2. 기능 1 — App 어댑터 배선은 이 기능 구현 당시 테스트 밖이었으므로(App 렌더 하네스는 그
     뒤에 기능 2 에서 생겼다) 눈검증이 실질 게이트다. 스펙 §11 의 실앱 시나리오 6개 참조.
     여력이 되면 새 하네스로 그 배선도 실행 검증으로 옮길 것.
  3. 기능 2 — 씬 생성 중 거터 씬 번호 둘레에 금색 링이 도는지, 프롬프트를 두 줄로 편집한 뒤
     아래 씬을 생성했을 때 링이 **맞는 줄**에 도는지(밀리면 버그), 타이핑해도 안 사라지는지,
     이미지 탭에서 봐도 그 씬의 비디오 생성 중이면 도는지. 배치 중에는 편집기가
     `opacity: 0.6` 이라 링도 흐려 보인다 — 그 체감도 확인.
- 별건 기록: `VideoDetailModal.jsx:163` 이 `meta` 가 null 인데 `meta.seed` 를 읽는다.

## 이 세션에서 값비싸게 배운 것

- **미커밋 상태에서 `git checkout <file>` 을 네 번 쳐서 방금 쓴 구현을 날렸다.** 뮤테이션 확인
  루프에서 매번 같은 모양으로. 규칙: **워킹트리가 dirty 면 `git checkout` 금지**(먼저 커밋).
- **전체 스위트 초록불이 앱이 뜬다는 뜻이 아니다** — App.jsx 를 import 하는 테스트가 사실상
  없어서 빌드 실패가 숨었다. 사용자가 앱을 띄워서 잡았다.
- **"findings 0" 은 리뷰어마다 다른 것을 본 결과다.** Codex 는 경로·레이스, Fable 은 사용자가
  겪는 상태와 *테스트가 진짜 무는지*. 둘 다 돌려야 한다.
