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

## 이 세션에서 값비싸게 배운 것

- **미커밋 상태에서 `git checkout <file>` 을 네 번 쳐서 방금 쓴 구현을 날렸다.** 뮤테이션 확인
  루프에서 매번 같은 모양으로. 규칙: **워킹트리가 dirty 면 `git checkout` 금지**(먼저 커밋).
- **전체 스위트 초록불이 앱이 뜬다는 뜻이 아니다** — App.jsx 를 import 하는 테스트가 사실상
  없어서 빌드 실패가 숨었다. 사용자가 앱을 띄워서 잡았다.
- **"findings 0" 은 리뷰어마다 다른 것을 본 결과다.** Codex 는 경로·레이스, Fable 은 사용자가
  겪는 상태와 *테스트가 진짜 무는지*. 둘 다 돌려야 한다.
