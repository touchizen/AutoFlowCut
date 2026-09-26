# Codex whole-branch review — 3 blocking findings 수정 리포트

브랜치: `feature/story-pipeline` · 방식: TDD (RED → GREEN)

## Finding 1 (Blocking) — 프로젝트 전환 시 StoryView 상태 누수
- 원인: `src/App.jsx`의 `<StoryView pipeline={storyPipeline} />`가 `projectPath` key 없이 재사용 →
  프로젝트 A(editor)→B(빈) 전환 시 StoryView의 scriptPhase/title/genre/... 로컬 state가 리셋 안 됨.
- 수정: `src/App.jsx:2293` → `<StoryView key={storyProjectPath} pipeline={storyPipeline} />`.
  key 변경 = 새 인스턴스 마운트 → 로컬 state가 새 프로젝트의 pipeline.scriptText/state.input 기준 초기값으로 재계산.
- 근거/테스트: App 통합 렌더는 무겁고 세팅 의존이 커 단위로 대체. StoryView는 마운트마다 phase/폼을
  독립 계산한다는 것을 `tests/components/story/StoryView.phase.test.jsx`의 신규
  "재마운트 격리 (App key={storyProjectPath} 근거)" 테스트로 고정 — editor 프로젝트를 unmount 후
  빈 프로젝트를 새로 마운트하면 setup + 기본폼(제목 빈값 / genre bespoke)로, A의 제목/장르가 누수되지 않음.
  rerender(같은 인스턴스)로는 리셋 안 되지만 key 변경은 이 독립 마운트와 동치이므로 App key가 정확한 처방.

## Finding 2 (Blocking) — 임포트/붙여넣기 시작이 현재 설정을 버림
- 원인: `StoryView.handlePasteStart`가 `options: { language, model }`만 실어 genre/lengthValue/lengthUnit/title 누락;
  `stepMachine` pastedScript 분기도 title 미보존 → 재오픈 hydrate 시 기본값으로 회귀.
- 수정:
  - `src/components/story/StoryView.jsx handlePasteStart`:
    `start('script', { pastedScript: scriptText, input: { type:'pasted', title }, options: { genre: genre||undefined, language, model, lengthValue: length, lengthUnit } })`.
  - `electron/story/stepMachine.js` pastedScript 분기:
    `state.input = { type:'pasted', title: params.input?.title, options: params.options }`.
- 테스트:
  - `tests/components/story/StoryView.setup.test.jsx` — pastedScript 경로가 전체 옵션+제목을 실어 start.
  - `tests/components/story/StoryView.test.jsx` — 기본 폼값(genre bespoke, title '')로 전체 payload.
  - `tests/electron/story/stepMachine.scriptRedesign.test.js` — pastedScript 후 getState().input.title/options 보존.

## Finding 3 (Blocking) — 분리시작 제목 자동생성 결과 버림
- 원인: `StoryView.handleSplit`이 `resolveTitle()` 결과를 `start('scenes', ...)` payload에 안 실어 main에 커밋 안 됨;
  `stepMachine` scenes scriptOverride 처리부도 title 미반영.
- 수정:
  - `handleSplit`: `start('scenes', { scriptOverride: scriptText, options: currentOptions(), title: resolved })`.
  - `stepMachine.js` scenes scriptOverride 처리부: `if (params.title) state.input.title = params.title`.
  - handleRewrite는 이미 `input:{type:'title',title:resolved}`로 title을 넘기므로 변경 없음(확인 완료).
- 테스트:
  - `tests/components/story/StoryView.editor.test.jsx` — 분리시작 payload에 title 포함(기존 제목/자동 제목 두 케이스).
  - `tests/electron/story/stepMachine.scriptRedesign.test.js` — scenes scriptOverride+title 후 getState().input.title 저장.

## 검증 결과
- RED: 대상 5개 신규/수정 테스트가 먼저 실패함을 확인(5 failed).
- GREEN(대상): `npx vitest run tests/electron/story/ tests/components/story/ tests/hooks/` → 128 files, 1056 tests 전부 통과.
- GREEN(전체): `npm run test:run` → 390 files, 3826 tests 전부 통과.

---

## Follow-up (Blocking) — 프로젝트 전환 격리 타이밍 (key 재마운트가 옛 값을 읽는 문제)
- 원인: Finding 1의 `<StoryView key={storyProjectPath}>`는 전환을 감지한 그 render의 pipeline 반환값으로 즉시 재마운트되는데, `useStoryPipeline`이 그 render에서 아직 옛 프로젝트의 `state`/`scriptText`/`scenes`를 반환했다(실제 리셋은 effect의 다음 tick). 그래서 새 프로젝트가 옛 editor/title/options로 떴다.
- 수정: `src/hooks/useStoryPipeline.js` — if 블록 앞에서 `const justSwitched = prevPathRef.current !== projectPath` 계산, 그 값이 true인 render에서는 return을 `{ state: null, scenes: [], scriptText: '', openError: null, ... }`로 override. 기존 tokenRef 무효화/effect 리셋(부수효과)은 그대로 유지.
- 테스트: `tests/hooks/useStoryPipeline.switchIsolation.test.js` — render 콜백으로 매 render의 반환값을 수집해, projectPath가 '/B'로 바뀐 **첫 render**(effect 이전)에서 `scriptText===''`, `state===null`, `scenes===[]`인지 검증 (RED: '복원대본' → GREEN).
- 커밋: `5cb455e`
- 검증: `tests/hooks/`+`tests/components/story/` 123파일 1009테스트 통과, `npm run test:run` 391파일 3827테스트 통과.

---

# Voice-picker final review — 2 correctness findings 수정 (후속)

브랜치: `feature/story-pipeline` · 방식: TDD (RED → GREEN)

## Finding 1 (Important, merge-blocker) — hidden saved voice shown as "기본 성우"
- 원인: `src/components/story/StoryView.jsx`의 화자별 버튼 라벨이
  `selectedVoiceObj = voices.find(...)`가 null이면(현재 preload에 없는 저장된 voiceId — 예: 이전
  세션의 ElevenLabs shared voice) 무조건 "기본 성우"로 표시. `buildAudioParams()`는 여전히 저장된
  voiceId를 그대로 내보내므로 UI가 "미선택"이라 주장하는 채로 실제로는 그 음성을 사용하는 불일치.
  `VoicePicker.jsx` footer(`selectedVoice`)도 동일한 패턴의 버그.
- 수정:
  - `src/components/story/StoryView.jsx`: `voiceLabel`을 3분기로 재작성
    (없음 → 기본 성우 / 있고 찾음 → 이름 / 있는데 못 찾음 → `story.audio.voiceUnloaded`
    "저장된 성우 (미로드) · {id}"). `shortVoiceId()` 헬퍼로 긴 id(ElevenLabs 해시 등) 표시용 축약.
  - `src/components/story/VoicePicker.jsx`: footer 선택 요약을 `selectedSummaryLabel()` 헬퍼로
    분리해 동일한 3분기 로직 적용, `story.voicePicker.unloadedVoice` 키 신설.
  - `src/locales/ko.js` / `src/locales/en.js`: `story.audio.voiceUnloaded`,
    `story.voicePicker.unloadedVoice` 키 추가 (KO: "저장된 성우 (미로드) · {id}",
    EN: "Saved voice (not loaded) · {id}").
- 테스트 (RED 확인 후 구현):
  - `tests/components/story/StoryView.test.jsx` — "저장된 성우가 현재 voices 목록에 없으면
    '기본 성우'가 아니라 미로드 라벨을 보여준다": speaker.voice가 `elevenlabs:el_missing_123`인데
    voices 목록엔 `el_other`만 있을 때 버튼 텍스트가 "기본 성우"를 포함하지 않고 "미로드"를 포함.
  - `tests/components/story/VoicePicker.test.jsx` — footer가 동일 케이스에서 "기본 성우"가 아니라
    구분된 라벨(미로드/voiceId)을 보여줌.
  - 두 테스트 모두 구현 전 RED("기본 성우"로 나와 실패) → 구현 후 GREEN 확인.

## Finding 2 (Minor) — manual gender lost to in-flight F0 race
- 원인: `App.jsx handleTagGender`의 stale-f0 방어선이 `ttsVoicesRef.current`(useEffect로 다음
  render에 갱신되는 패시브 ref)의 `genderSource==='manual'` 여부만 봤다. 미확정 성우 미리듣기로
  F0 추정이 in-flight인 상태에서 사용자가 즉시 수동으로 성별을 지정하면, 뒤이어 도착하는 stale f0
  결과가 아직 반영 전인 ref를 보고 통과해 manual을 덮어쓸 수 있는 race (renderer-only; main 캐시
  영속화는 이미 안전).
- 수정:
  - `src/services/genderGuard.js` (신규) — 순수 함수 `shouldSkipStaleF0Gender({ source, voiceKey,
    manualGenderKeys, existingGenderSource })`. `startGuard.js`(App.handleStart 가드 분리)와 동일한
    패턴: App.jsx는 렌더 테스트가 무겁고 electron IPC 의존이 많아 로직만 순수 함수로 분리해 단위
    테스트로 검증.
  - `src/App.jsx`: `manualGenderKeysRef`(Set, useRef) 신설 — `handleTagGender`에서 `source ===
    'manual'`이면 **동기적으로** `voiceKey`(`${provider}:${voiceId}`)를 add한 뒤 merge+persist(기존
    동작 유지). `source === 'f0'`이면 `shouldSkipStaleF0Gender()`로 skip 여부 판정(같은 tick에
    도착한 stale f0도 동기 ref라 항상 최신 상태를 봄) — 기존 `ttsVoices` 기반
    `genderSource==='manual'` 체크는 그대로 두 번째 방어선으로 유지.
- 테스트:
  - `tests/services/genderGuard.test.js` (신규, 5 케이스) — manual은 항상 통과 / f0 + manualKeys에
    key 있음 → skip / f0 + 기존 genderSource manual → skip(기존 방어선 유지) / f0 + manual 흔적
    없음 → 통과 / 다른 voiceKey의 manual은 영향 없음.
  - App.jsx 자체는 이 하네스에서 렌더 테스트 대상이 아니라서(다른 App 테스트도 `computeGuardAvailable`
    처럼 추출된 순수 함수만 테스트) `handleTagGender`를 직접 렌더 테스트하진 않음 — 대신 로직을
    `shouldSkipStaleF0Gender`로 추출해 App.jsx가 호출하는 동일 코드 경로를 커버. 인용에 의한 검증:
    `handleTagGender`의 `if (source === 'manual') manualGenderKeysRef.current.add(voiceKey)`가
    merge보다 먼저 실행되므로, 동일 tick에서 manual 다음 stale f0가 연달아 호출돼도 두 번째 호출
    시점에 Set에 key가 이미 있음 → skip 확정.

## 검증 결과
- RED: Finding 1 신규 테스트 2건이 구현 전 실패함을 확인(둘 다 "기본 성우"로 나와 어서션 실패).
- GREEN(대상): `npx vitest run tests/components/story tests/hooks tests/services/genderGuard.test.js`
  → 141 files, 1162 tests 전부 통과.
- GREEN(전체): `npm run test:run` → 460 files, 4381 tests 전부 통과 (기존 테스트 회귀 없음).

## Concerns / 참고
- `voiceUnloaded`/`unloadedVoice` id 축약은 12자 초과 시 앞 10자+"…"로 표시(`shortVoiceId`/
  `shortVpId`) — ElevenLabs shared voice 해시처럼 긴 id가 라벨에 그대로 붙어 UI가 깨지는 것을 방지.
- Finding 2는 App.jsx 전체를 렌더하는 하네스가 없어(다른 App.jsx 로직도 동일 패턴으로 서비스 추출 후
  단위 테스트) `handleTagGender`를 직접 통합 테스트하진 못했다. 순수 함수 추출 + App.jsx에서의 호출
  순서(동기 add → skip 판정)를 코드 리뷰 수준에서 재확인함.

---

# Final structure review — 6 dedup/consistency fixes (voice-picker)

브랜치: `feature/story-pipeline` · commit: `e99510682426207a265d4b348b4e4693575eeecb`

## 적용한 6건
1. **공유 `voiceKey` 헬퍼** — `src/utils/voiceKey.js` 신규(`voiceKey(provider, voiceId) => \`${provider}:${voiceId}\``).
   기존 6곳의 인라인 `${provider}:${voiceId}` 중복 제거하고 이 헬퍼로 교체:
   `electron/api/tts/genderOverlay.js`, `electron/api/tts/voiceGenderCache.js:16`,
   `electron/main.js`(voiceMeta getter + voiceMetaCache fill loop), `src/App.jsx`(mergeTtsVoices +
   handleTagGender — 로컬 `voiceKey` 변수명이 import와 충돌해 `vKey`로 리네임),
   `src/components/story/VoicePicker.jsx`(카드 React key). electron 파일이 `src/utils`를 import하는
   기존 패턴(`storyTtsProviders` 등)을 그대로 따름. `voicePreviewService.js`의 sha256 캐시 키(언어
   포함)는 지시대로 손대지 않음 — `stepMachine.js`의 `ttsVoiceKey`(emotion 포함, 3-part)도 스코프 밖.
2. **미리듣기 state에 provider 식별자 추가** — `src/hooks/useVoicePreview.js`의 `state`가 `voiceId`만
   갖고 있어 provider가 다른데 voiceId가 같은 두 성우가 미리듣기 상태를 공유하던 문제. `play()`의 모든
   `setState` 호출에 `provider` 필드 추가. `VoicePicker.jsx`의 `previewStatus` 판정을
   `previewState?.provider === v.provider && previewState?.voiceId === v.id`로 변경(voiceId 단독 비교 제거).
3. **confidence 타입 정합성** — 계약은 `'high' | 'low' | null'`(`src/utils/voiceGender.js` 기준)인데
   `electron/ipc/tts-api.js` JSDoc이 `confidence: ?number`로 드리프트 — `'high'|'low'|null`로 수정.
   런타임 검증 로직은 원래 없어(그대로 pass-through) 코드 변경 없음.
   `tests/electron/ipc/tts-api.test.js`의 `confidence: 0.9` → `confidence: 'high'`로 수정.
4. **죽은 onVoiceSearch 배선 제거** — 드롭다운→모달 리라이트 후 호출되지 않던
   `handleTtsVoiceSearch`(`src/App.jsx`)와 그 `onVoiceSearch` prop(App.jsx→StoryView,
   `src/components/story/StoryView.jsx`의 함수 시그니처)을 제거. `ttsListVoices` 최초 로딩(라이브
   ElevenLabs 목록)은 그대로 유지 — grep으로 다른 참조 없음 확인.
5. **voicePreviewService 테스트가 주장을 실제로 검증하도록 수정** — "synthesize not called again"
   주석이 있었지만 스파이가 매 `ttsFor()` 호출마다 새로 생성돼 실제로는 검증되지 않던 문제.
   `deps()`에서 `synthesize`를 한 번만 생성한 안정적 `vi.fn()`으로 만들고(`ttsFor`가 항상 같은 어댑터
   객체 반환), 두 번째 `getPreview` 후 `expect(d.synthesize).toHaveBeenCalledTimes(1)`로 캐시 히트를
   실제로 단언.
6. **공백뿐인 화자 제외** — `electron/story/stepMachine.js`의 `characterSpeakers()` 필터가
   `(sp?.name || sp?.id)` truthiness만 봐서 `{id:'  ', name:'  '}` 같은 공백뿐인 화자가 통과해
   blank Ref/storyCharacters 엔트리를 만들 수 있었음. trim 후 비교하도록
   `(String(sp?.name||'').trim() || String(sp?.id||'').trim())`로 변경.
   `tests/electron/story/stepMachine.characterRefs.test.js`에 회귀 테스트 추가("id/name이 공백뿐인
   화자는 캐릭터 후보(storyCharacters)에서 제외된다") — 공백 화자 + narration만 있을 때
   `storyCharacters`가 빈 배열임을 확인.

## 검증 결과
- `npx vitest run tests/electron tests/hooks tests/components/story` → 245 test files, 2031 tests 전부 통과.
- 스코프 확인: 변경된 파일이 지시된 목록(6개 소스 + `src/utils/voiceKey.js` 신규 + 3개 테스트 파일)과
  정확히 일치(`git status --short`로 재확인). App.jsx/StoryView.jsx는 지시대로 최소 변경만.

## Concerns
- 없음. 6건 모두 기계적 치환/정합성 수정이며 기존 테스트 회귀 없이 통과, 지시된 파일 범위를 벗어나지
  않음.
