# feature/story-pipeline 최종 whole-branch 리뷰 findings 일괄 수정 보고

리뷰(내부+Codex 교차) 8건, 전부 TDD(실패 테스트 선작성 → 최소 구현 → 통과)로 수정.
항목별 커밋 8개, 모두 `feature/story-pipeline` 브랜치에 순서대로 적용됨.

## 1. [Critical] StoryView→stepMachine 입력 shape 불일치

- 커밋: `ff7ddf2` fix(story): StoryView→stepMachine 시작 파라미터 shape 정정
- 원인: `start('script', { input: { title, genre, length, language } })`로 genre/length/language를
  input에 섞어 보내 stepMachine이 이를 `params.options`로 읽지 못해 LLM opts에서 무시됨
  (한국어 입력에도 영어 대본).
- 수정: `src/components/story/StoryView.jsx` `handlePrimaryAction`을
  `start('script', { input: { type: 'title', title }, options: { genre: genre || undefined, targetMinutes: Number(length) || undefined, language } })`로 분리.
- 테스트: `tests/components/story/StoryView.test.jsx` — start 호출 인자 shape를 `toHaveBeenCalledWith`
  정확 일치로 단언(부분 매칭 제거) + 미입력 시 undefined 필드 케이스 추가.

## 2. [Important] push payload의 sceneNo 제거

- 커밋: `a4fe8a8` fix(story): push payload에서 sceneNo 제거 — 스펙 §4-④ 확장 필드 위반
- 원인: `electron/story/stepMachine.js` `mapScene`이 `sceneNo`를 포함해 push, `importStoryScenes`가
  push 객체를 통째로 merge하면서 project.json 씬에 그대로 영속(스펙 §4-④ 허용 확장 필드 5개
  storyId/stalePrompt/stalePromptAt/staleVideo/staleVideoAt 위반).
- 수정: `mapScene`에서 `sceneNo` 필드 제거.
- 테스트: `tests/electron/story/stepMachine.test.js`(`not.toHaveProperty('sceneNo')`),
  `tests/integration/storyPipelineM1.test.js`에 동일 회귀 단언 추가.

## 3. [Important] Story 뷰 ②/④ 패널 실데이터

- 커밋: `c2ceb4d` fix(story): ②/④ 패널 실데이터 배선 (scenes.json 파생 데이터 전달)
- 원인: `state.scenes`/`state.prompts`는 존재한 적 없는 필드라 패널이 영구 빈 화면.
- 수정:
  - `electron/story/stepMachine.js`: `loadScenesForPayload()` 헬퍼로 scenes.json을 읽어
    `open()`/`getState()`/스텝 완료 시 `send('story:state', ...)` payload에 `scenes` 필드로 실음.
    story.json(내부 `state` 변수)에는 절대 쓰지 않음(파생 데이터, flush 대상 아님).
  - `src/hooks/useStoryPipeline.js`: `scenes`를 `state`와 별도 state로 보관, open()/이벤트 수신 시 갱신, 반환값에 추가.
  - `src/components/story/StoryView.jsx`: ② 패널은 `scenes[].segments[]`(speaker/text)를 행으로,
    ④ 패널은 `scenes[].imagePrompt`/`videoPrompt`를 표시하도록 재작성.
- 테스트: stepMachine(open/getState/스텝완료 payload.scenes + story.json에 미저장 확인),
  훅(story:state 이벤트·open() 반환 scenes 반영), StoryView(씬 행/프롬프트 행 렌더).

## 4. [Important] 대본 붙여넣기 진입점 (M1 스펙 §1 2번 경로)

- 커밋: `c813d9f` feat(story): 대본 붙여넣기 진입점 (M1 스펙 §1 2번 경로)
- 수정:
  - `electron/story/stepMachine.js` `steps.script`: `params.pastedScript`가 있으면 LLM 호출 없이
    그대로 `script.md`로 저장하고 done 처리(`state.input = { type: 'pasted', options }`).
  - `src/components/story/StoryView.jsx`: 대본 붙여넣기 textarea + "대본으로 시작" 버튼 추가
    (`start('script', { pastedScript, options: { language } })`), 텍스트 비어있으면 버튼 비활성화.
    버튼 시각 라벨은 스테퍼의 "대본" 텍스트와 겹치지 않도록 아이콘 문구, 접근성 이름은
    aria-label로 "대본으로 시작" 유지.
- 테스트: stepMachine(LLM mock 미호출 + script.md에 원문 그대로 저장 확인),
  StoryView(붙여넣기 → 호출 shape, 빈 텍스트 시 버튼 disabled).

## 5. [HIGH/Codex] push emit 전 상태 flush

- 커밋: `70d5d51` fix(story): pushScenes emit을 flush 완료 후로 이동 (재발신 안전성)
- 원인: `prompts()`가 revision 증가 + push emit을 메모리 상태로만 수행 후 `start()` 래퍼의
  flush 전에 크래시하면, 재발신 조건(`pendingPushRevision > lastPushedRevision`)이 디스크에
  반영되지 않아 복구 불가능.
- 수정: `prompts()`는 revision 증가만 하고 `{ pushScenes: scenes }`를 반환. `start()` 래퍼가
  status=done 설정 → `await flush()` → `sendPush()` 순서로 실행.
- 테스트: 커스텀 emit으로 `story:pushScenes` emit 시점에 동기적으로 story.json을 읽어
  `pendingPushRevision`이 이미 1로 flush돼 있음을 확인(수정 전에는 0으로 실패 재현됨).

## 6. [HIGH/Codex] storyStore tmp 파일명 + 저장 직렬화

- 커밋: `3b44c16` fix(story): storyStore tmp 파일명 랜덤화 + save 직렬화
- 원인: tmp 파일명이 `{target}.tmp-${pid}`로 pid만 사용해 같은 프로세스 내 동시 save가 같은
  tmp 경로에서 경합 → 두 번째 rename이 ENOENT.
- 수정: `electron/story/storyStore.js` tmp 이름에 `randomUUID().slice(0,8)` suffix 추가 +
  인스턴스 내 promise 큐(`enqueueWrite`)로 save/saveText 직렬화.
- 테스트: `store.save`/`store.saveText` 20개 병렬 호출 → 수정 전 ENOENT로 reject 재현,
  수정 후 최종 파일 유효 + tmp 잔재 없음 확인.

## 7. [HIGH/Codex] Story 뷰 밖 프로젝트 전환 시 stale 토큰

- 커밋: `904a313` fix(story): Story 뷰 밖 프로젝트 전환 시 stale 토큰 drop
- 원인: `useStoryAutoOpen`은 story 뷰에서만 동작하는데 `useStoryPipeline`은 App 레벨에 항상
  마운트돼 있어, 뷰 밖에서 프로젝트를 전환해도 `tokenRef`가 옛 프로젝트 토큰을 유지 → 늦은
  pushScenes가 토큰 일치로 새 프로젝트에 잘못 적용될 위험.
- 수정: `useStoryPipeline`에 `projectPath` 변경 감지 effect 추가 — 변경 시 즉시
  `tokenRef.current = null`(이후 이벤트 drop) + 옛 토큰으로 `storyAbort` fire-and-forget +
  state/scenes/streamingText 초기화.
- 테스트: path 변경 후 옛 토큰의 pushScenes가 drop됨 + storyAbort 호출 확인,
  path 불변 시에는 초기화되지 않음 확인(회귀 방지).

## 8. [HIGH/Codex] story:open projectPath 검증

- 커밋: `2c7306c` fix(story): story:open projectPath 검증 (절대경로/traversal/존재 확인)
- 원인: `electron/ipc/story-api.js`가 renderer가 준 `projectPath`를 무검증 사용.
- 수정: `validateProjectPath()` 추가 — 절대경로 필수 + 원본 문자열의 `..` 세그먼트 거부
  (정규화가 조용히 흡수하기 전에 원본에서 차단, `path.normalize` 후에도 재확인) +
  `fs.stat().isDirectory()` 확인. 실패 시 `{ error: 'invalid-project-path' }`, machine 생성 안 함.
- 테스트: 상대경로/traversal/존재하지 않는 경로/파일(디렉토리 아님)/경로 누락 각각 거부 확인 +
  정상 절대경로는 그대로 통과하는 회귀 커버.

## 검증

```
npm run test:run
  Test Files  1 failed | 366 passed (367)
  Tests       1 failed | 3695 passed (3696)
```
- 유일한 실패는 pre-existing `tests/packaging/appxAssets.test.js`(패키지 버전 동기화, 본
  작업과 무관 — 베이스라인에서도 동일하게 실패, 허용 범위).
- 베이스라인 대비 3673 → 3695 통과(+22, 이번 작업에서 추가한 회귀/신규 테스트).

```
npx vite build
✓ built in 2.44s (renderer)
✓ built in 1.75s (electron main)
```
빌드 성공(청크 크기 경고는 기존부터 있던 것, 무관).

## 커밋 목록 (순서대로)

1. `ff7ddf2` fix(story): StoryView→stepMachine 시작 파라미터 shape 정정
2. `a4fe8a8` fix(story): push payload에서 sceneNo 제거 — 스펙 §4-④ 확장 필드 위반
3. `70d5d51` fix(story): pushScenes emit을 flush 완료 후로 이동 (재발신 안전성)
4. `c2ceb4d` fix(story): ②/④ 패널 실데이터 배선 (scenes.json 파생 데이터 전달)
5. `c813d9f` feat(story): 대본 붙여넣기 진입점 (M1 스펙 §1 2번 경로)
6. `3b44c16` fix(story): storyStore tmp 파일명 랜덤화 + save 직렬화
7. `904a313` fix(story): Story 뷰 밖 프로젝트 전환 시 stale 토큰 drop
8. `2c7306c` fix(story): story:open projectPath 검증 (절대경로/traversal/존재 확인)
