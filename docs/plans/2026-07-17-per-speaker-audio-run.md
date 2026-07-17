# 화자별 개별 실행 — "이 화자만 생성"

**상태**: 설계만(구현 대기). 사용자 결정 = "이 화자만 생성"(파일·상태 저장, 다른 화자는 안 건드림).
**연관**: `2026-07-17-speaker-audio-source-followups.md`(화자별 오디오 출처)의 후속. 문서엔 없던 요구.

---

## 문제

⑤ 오디오의 **진행 버튼은 전 화자를 한꺼번에** 처리한다(`buildAudioParams()`가 필터 없이 전
세그먼트). 그래서 **나레이터 mp3 자르기만 먼저 확인**하고 싶어도 그럴 방법이 없다:

- 진행 버튼: 전체. 시작 전에 [모든 TTS 화자에 성우가 배정됐는지 검증](../../electron/story/stepMachine.js) →
  등장인물 성우를 다 정하기 전엔 나레이터만 확인하려 해도 진행 자체가 막힌다.
- 세그먼트 단위 재생성/미리듣기는 있지만 **세그먼트 1개** 단위이고, 미리듣기(`testSegment`)는
  **TTS 전용**이라 import 나레이터(mp3 자르기)는 프리뷰가 안 된다.
- `regenerateSegment(segId)`도 `start('audio', buildAudioParams([segId]))` → **전체 단계를 돌리며**
  그 세그먼트만 강제 재합성한다. 즉 부분 강제일 뿐, 다른 화자 검증·재조립은 여전히 전체를 요구한다.

**원하는 것**: 나레이터(또는 임의의 한 화자) 행 버튼 하나로 **그 화자 세그먼트만** 생성/자르고
파일·상태를 저장해, 전체를 돌리기 전에 결과(예: 227→230 자르기)를 확인.

---

## 현재 오디오 단계 구조 (근거)

`electron/story/stepMachine.js` audio 스텝:

1. `allNarration` = narration 세그먼트 전부. `importSpeakers` = voice.provider==='import'인 화자.
2. 화자별 정렬(`alignSegmentsToSource`) → `imported` = srcStart/End 붙은 세그먼트, `narration` =
   나머지(TTS 대상).
3. **검증**: `narration`의 모든 화자에 voiceId 있어야 함. 없으면 `voice not assigned`로 throw.
4. **import 화자**: 출처별로 `cutAudio`로 잘라 `audio/segments/{id}.wav` + 실측 durationMs.
5. **TTS**: `narration`을 화자 voice로 합성(동시성 제한). 6. **sfx**: `sfxFor(source).generate`.
6. **all-or-nothing 조립**: `audioBearing = narration+imported+sfx`. 하나라도 results에 없으면
   → **부분재시도**: 성공분 status:'done', 실패분 'error'로 scenes.json에 영속 후 **throw**.
   전부 성공해야 → 타임라인(startMs)·SRT·재그룹·storyId·manifest 생성 + step **done** 확정.

> 핵심 제약: **성공 경로가 전 화자 완성**을 전제한다. 그래서 "한 화자만"은 이 조립을 건너뛰는
> 별도 경로여야 한다 — 안 그러면 미완 화자 때문에 매번 throw 나거나, 반쪽 타임라인이 만들어진다.

---

## 설계

### A. 백엔드 계약 — `params.onlySpeakers`

audio 스텝에 선택 파라미터 `onlySpeakers: string[]`를 추가한다. 있으면 **부분 materialize 모드**:

- **범위 한정**: `imported`·`narration`·(sfx는 화자가 없으니 제외)를 `speaker ∈ onlySpeakers`로 필터.
  범위 밖 세그먼트는 **처리도, 실패 집계도 안 한다**(상태 그대로 보존).
- **검증 한정**: `voice not assigned` 검증을 범위 안 TTS 화자에만 적용. 다른 화자 미배정이어도 진행.
- **조립 건너뜀**: 타임라인·SRT·재그룹·storyId·manifest를 **만들지 않는다**(프로젝트가 아직
  전부 생성된 게 아니다). 범위 안 세그먼트의 `status/audioPath/durationMs/voiceKey`만 scenes.json에
  영속한다(부분재시도 경로가 이미 하는 것과 같은 병합, 단 **throw 안 함**).
- **step 상태**: 이 모드는 audio 스텝을 **done으로 확정하지 않는다**. 완료 후 원래 상태로
  되돌린다(부분 실행이 "전체 완료"로 보이면 안 된다 — 그러면 사용자가 전체 진행을 건너뛴다).
  → stepMachine이 이 모드를 알아 상태 전이를 다르게 처리해야 한다(아래 "열린 질문 1").
- **진행 이벤트**: `story:progress {kind:'audio-segment', segId, status}`는 그대로 emit →
  화자별 진행 배지(227/230)와 세그먼트 목록이 실시간 갱신된다(이미 있는 배선 재사용).
- **부분 실패**: 범위 안에서 일부 실패면 성공분 done·실패분 error로 영속하고, 사용자에게 실패를
  알린다(로그+상태). 전체 모드처럼 throw할지, 조용히 부분 성공으로 둘지는 "열린 질문 2".

### B. 프런트엔드 — 화자 행 "이 화자만 생성" 버튼

- 각 `.story-voice-row`에 버튼 추가(성우 버튼 옆 또는 출처 옆). 클릭 →
  `start('audio', buildAudioParams({ onlySpeakers: [sp.id] }))` 형태로 호출.
  (`buildAudioParams` 시그니처를 확장하거나 별도 헬퍼 `buildSpeakerRunParams(spId)`.)
- 실행 중(`steps.audio.status==='running'`)엔 성우 맵이 숨겨지는 현 설계상, 실행 중에는 버튼도
  안 보인다 → **한 번에 한 화자**. 완료 후 맵이 돌아오며 화자별 배지로 결과 확인.
- 결과 확인 경로(추가 UI 없이 재사용):
  - 세그먼트 목록 테이블: 그 화자 행들이 status:'done' + 세그먼트 재생/미리듣기.
  - 타임라인 프리뷰(`buildStoryAudioPackage`): scenes.json의 audioPath를 읽으므로 그 화자
    오디오가 채워진다(다른 화자는 빈 채).
  - 화자별 진행 배지: `227/230`.
- import 화자의 세그먼트에도 **미리듣기(재생)** 가 되게 한다 — 지금 `testSegment`는 TTS 전용이라
  잘라 저장된 wav를 재생하는 경로가 필요(파일이 이미 있으니 `playAudio(audioPath)`로 충분).

### C. 라벨/로케일

- ko: `story.audio.runThisSpeaker` = "이 화자만 생성" / en = "Generate this speaker".
- 실행 로그: `import-cut`/`import-align`이 이미 화자 접두사로 나온다 — 그대로 활용.

---

## 열린 질문 (구현 전 확정)

1. **step 상태 전이**: 부분 실행이 끝난 뒤 audio 스텝 상태를 무엇으로 둘까?
   - (a) 이전 상태 유지(예: pending) — 전체 진행이 아직 필요함을 유지. **추천**.
   - (b) 'partial' 같은 새 상태 도입 — UI가 "일부 생성됨"을 표시. 더 명확하지만 상태머신·표시 확장.
2. **부분 실패 처리**: 범위 안 일부 실패 시 throw(오류 배너)로 강하게 알릴지, 상태만 error로
   두고 조용히 둘지. 전체 모드와 일관성 vs "확인" 목적의 가벼움.
3. **버튼 노출 조건**: 모든 화자에 항상 보일지, 출처(import) 화자에만 우선 보일지. 나레이터
   확인이 주 용도지만 TTS 화자도 개별 생성이 유용할 수 있음.
4. **재조립 시점**: 개별 생성만 반복하다 마지막에 전체 진행 한 번으로 타임라인·manifest를
   완성하는 흐름을 문서/UI로 안내할지(부분 생성 ≠ 최종 산출물).

---

## 영향 파일 (예상)

- `electron/story/stepMachine.js` — audio 스텝에 `onlySpeakers` 분기(범위 필터·검증 한정·조립 건너뜀·
  상태 전이). 부분 materialize 헬퍼로 기존 병합 로직 재사용.
- `src/components/story/StoryView.jsx` — 화자 행 버튼 + `buildAudioParams` 확장 + import 세그먼트 재생.
- `src/components/story/StoryView.css` / `SpeakerAudioSource.*` — 버튼 배치.
- `src/locales/ko.js`,`en.js` — 라벨.
- 테스트: `stepMachine.audioImport.test.js`(onlySpeakers 범위·검증 스킵·조립 스킵·상태),
  `StoryView.*`(버튼 → onlySpeakers 파라미터, import 세그먼트 재생).

---

## 비고 — 왜 지금 구현 안 하고 문서만인가

부분 실행은 audio 스텝의 **성공=전체완성** 전제를 건드린다(조립·상태·검증 세 곳). 잘못 손대면
반쪽 타임라인·manifest가 생기거나, 부분 실행이 "완료"로 보여 전체 진행을 건너뛰는 사고가 난다.
그래서 위 열린 질문(특히 1·2)을 먼저 확정한 뒤 구현한다.
