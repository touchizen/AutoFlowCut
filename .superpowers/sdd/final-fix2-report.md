# feature/story-pipeline 최종 하드닝 fix 웨이브(마지막) 보고

7건, 전부 TDD(실패 테스트 선작성 → 최소 구현 → 통과)로 수정. 커밋 4개(관련 항목끼리 논리
단위로 묶음), 모두 `feature/story-pipeline` 브랜치에 순서대로 적용됨.

## 1~3. stepMachine 하드닝 (abort race / 중복 start / pushAck revision)

- 커밋: `7a52bc7` fix(story): stepMachine abort race/중복실행/pushAck revision 하드닝
- 파일: `electron/story/stepMachine.js`, `tests/electron/story/stepMachine.test.js`

### 1. [HIGH] abort 후 늦은 done/push 차단
- 원인: `abort()`는 running 스텝을 동기적으로 error 마킹하지만 `controller` 참조 자체는
  교체하지 않는다. 기존 `start()` 결과 처리 가드는 `controller === myController`만 확인해서,
  signal을 무시하는 LLM mock이 뒤늦게 resolve하면 abort의 error 마킹을 done으로 덮어쓰고
  push까지 발신했다.
- 수정: `isStale = () => controller !== myController || myController.signal.aborted`로 가드를
  강화. 각 스텝(`script`/`scenes`/`prompts`)의 `store.saveText` 호출 직전에도
  `if (signal?.aborted) return` 가드를 추가해 파일 쓰기 자체를 막음.
- 테스트: signal 무시하는 mock LLM으로 abort 후 resolve → `steps.prompts.status`가 `error`
  (aborted) 유지 + `story:pushScenes` 미발신 + scenes.json에 새 내용 미반영 확인.

### 2. [HIGH] 중복 start 거부
- 수정: `start()` 진입 시 `Object.values(state.steps).some(s => s.status === 'running')`이면
  `{ error: 'busy' }` 반환, 아무것도 실행하지 않음. abort는 동기 error 마킹이라 이후에는
  running이 없어 정상 재시작 가능(기존 abort 테스트들이 회귀 없이 통과로 확인).
- 테스트: 실행 중 재호출 → busy + LLM 1회만 호출 + 첫 실행 정상 완료(done).

### 3. [MED] pushAck revision 검증
- 수정: `ackPush(ok:true)`가 `Number.isInteger(pushRevision) && pushRevision > lastPushedRevision
  && pushRevision <= pendingPushRevision`일 때만 성공 처리, 아니면 조용히 무시(상태 불변).
- 테스트: future revision(999) ack → `lastPushedRevision`/`pushedAt` 불변.

## 4. [HIGH 부분] projectPath workFolder 검증

- 커밋: `e97606f` fix(story): story:open projectPath를 activeWorkFolder 하위로 제한
- 파일: `electron/ipc/story-api.js`, `electron/main.js`, `tests/electron/ipc/story-api.test.js`
- 원인: 절대경로/traversal/존재 검증(이전 웨이브)을 통과해도 활성 작업 폴더 밖의 임의
  디렉토리를 지정하면 그쪽에 script.md/scenes.json을 쓸 수 있었다.
- 수정: `main.js`가 `app:project-activated`로 받는 `workFolder`를 모듈 변수
  `activeWorkFolder`로 보관하고, `registerStoryIPC`에 `getActiveWorkFolder` dep으로 주입.
  `story:open`은 `activeWorkFolder`가 있으면 `path.relative` 검사로 그 하위(`..`로 시작하지
  않음, 비-절대)인지 확인해 아니면 `{ error: 'invalid-project-path' }`. `activeWorkFolder`를
  아직 모르면(활성화 전) 기존 검증만 적용해 하위호환 유지.
- 테스트: workFolder 설정 후 외부 경로 거부, 하위 경로 허용, workFolder 미설정 시 기존 동작
  유지(3케이스).

## 5~6. useStoryPipeline 하드닝 (in-flight open 부활 가드 / scenes 클리어 방지)

- 커밋: `be78ab1` fix(story): useStoryPipeline in-flight open 부활 가드 + scenes 클리어 방지
- 파일: `src/hooks/useStoryPipeline.js`, `tests/hooks/useStoryPipeline.test.js`

### 5. [Minor] in-flight open 토큰 부활 가드
- 원인: `open()` 호출 시점의 `projectPath`를 클로저로 캡처한 채 대기 중, 사용자가 다른
  프로젝트로 빠르게 전환하면 늦게 resolve된 옛 open() 응답이 새 프로젝트 화면 위로
  tokenRef/state를 덮어쓸 수 있었다.
- 수정: 호출 시점 `projectPath`(`requestedPath`)를 캡처해두고, resolve 시점에 프로젝트 전환
  effect가 최신화하는 `prevPathRef.current`와 비교. 다르면 tokenRef/state 반영을 skip하고
  반환된 토큰으로 `storyAbort`를 fire-and-forget 발신.
- 테스트: open() 대기 중 projectPath 변경 → 늦은 resolve가 state/scenes를 갱신하지 않음 +
  반환 토큰으로 abort 호출 + 그 토큰으로 도착하는 이후 이벤트도 drop.

### 6. [Minor] running emit의 scenes 클리어 방지
- 원인: `stepMachine.start()`가 스텝을 running으로 전환할 때 보내는 `story:state`는 scenes
  필드가 없다(하류 리셋 알림 전용). 훅이 매번 `p.scenes || []`로 덮어써서 이미 표시 중이던
  씬 목록이 running 전환 순간 화면에서 사라졌다.
- 수정: `story:state` 핸들러에서 `p.scenes !== undefined`일 때만 `setScenes` 호출, 없으면
  기존 값 유지.
- 테스트: scenes 수신 후 scenes 없는 state 이벤트 수신 → scenes 유지.

## 7. [Minor] ② 패널 도달성 + invalid-project-path 피드백

- 커밋: `0ac081d` fix(story): ② 패널 도달성(스텝퍼 클릭 네비게이션) + open 실패 안내 배너
- 파일: `src/components/story/StoryStepper.jsx`, `src/components/story/StoryView.jsx`,
  `src/hooks/useStoryPipeline.js`, 관련 테스트 2개

### ⑴ 스텝퍼 클릭 네비게이션
- 수정: `StoryStepper`에 `onStepClick` prop 추가 — done 상태 스텝만 `role="button"` +
  클릭/Enter/Space로 활성화, 미완료(audio 포함) 스텝은 클릭 불가(요소 자체가 button 역할이
  아님). `StoryView`는 `viewedStep` state + `displayStep`(viewedStep이 여전히 done이면 그
  값, 아니면 currentStep)으로 패널 전환만 분리 — 실행 버튼/러닝 판정 등 액션은 여전히 실제
  진행 단계(`currentStep`) 기준.
- 테스트: done 스텝(대본/씬 분리) 클릭 → 해당 패널 표시, 미완료(오디오) 스텝은
  `getByRole('button')`로 찾을 수 없음.

### ⑵ open 실패 피드백
- 수정: `useStoryPipeline.open()`이 `story:open` 응답의 `{ error }`를 `openError` state로
  노출(성공 시 이전 값 초기화), tokenRef/state는 건드리지 않음. `StoryView`가 `openError`가
  있으면 "프로젝트 폴더를 열 수 없습니다: ..." 배너를 렌더.
- 테스트: 훅 — error 응답 시 openError 노출 + storyGetState 미호출, 성공 시 초기화.
  StoryView — openError 있을 때/없을 때 배너 렌더 여부.

## 검증

- `npm run test:run`: 3708 passed / 1 failed (`tests/packaging/appxAssets.test.js` — 이번
  웨이브와 무관한 pre-existing 버전 동기화 실패, 지시된 제외 대상).
- `npx vite build` (renderer) + `dist-electron` main 빌드: 성공.
