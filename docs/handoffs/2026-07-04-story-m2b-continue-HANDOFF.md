# Story M2b(SFX) 이어가기 — 핸드오프 (M2b-2 LLM + M2b-5 UI)

**날짜**: 2026-07-04
**BASE**: `524d9a9` (feature/story-pipeline) — M2b 백엔드(어댑터/audio생성/export) 완성, 전체 4033 pass
**spec**: `docs/superpowers/specs/2026-07-04-story-m2b-sfx-design.md` (⚠️ gitignore=로컬 파일, tracked 아님)
**진행 원장**: `.superpowers/sdd/progress.md` (맨 아래 "M2b 백엔드 완성" 섹션)
**Codex 방향 리뷰**: thread `019f2d38-370e-74b2-911b-602d35c868ae` (방향 OK + 보정)

---

## 0. 한 줄 요약

SFX 백엔드는 완성됐다: **sfx 세그먼트가 있으면** sfxFor로 생성 → 실측 타임라인 배치 → manifest → export `sfx_timed`. 남은 건 (2) **LLM이 대본에서 sfx 세그먼트를 자동으로 만들게** + (5) **UI에 sfx 표시/소스선택**.

---

## 1. 이미 완성 (BASE에 커밋됨)

- **M2b-0**: ElevenLabs SFX API 확정 — `POST https://api.elevenlabs.io/v1/sound-generation`, header `xi-api-key`, body `{ text, model_id:'eleven_text_to_sound_v2', duration_seconds?:0.5~30(null=자동), prompt_influence:0.3, loop }`, query `output_format`, resp mp3 octet-stream.
- **M2b-1**(`6251e23`): `electron/api/sfx/` — `createSfxAdapter(provider,{getKey,fetch})` → elevenlabs 생성 어댑터 + library stub. `generate({description, durationSeconds?}) → {audio, format}`.
- **M2b-3**(`d3029af`): `stepMachine.audio()`가 sfx 세그먼트도 `sfxFor(sourceMode).generate(...)`로 생성 → 실측 durationMs → narration과 `results` 공유 → `buildSegmentTimeline` 자리잡기 → manifest. reuse 지문 `sfxKey`=`${source}:${description}:${durationHint??'auto'}`. main.js `sfxFor` 라우팅(elevenlabs 키 재사용) + story-api → createStepMachine 주입.
- **M2b-4**(`524d9a9`): `prepareCloudRequest` storyAudio 분기가 sfx 세그먼트 → `sfx_timed` audioTrack(`timecodeMs=startMs, durationMs, category:'story'`) + audioFiles/pathMap. GCF 무변경(기존 sfx_timed 처리).

**segment 계약(확정)**: `{ id, type:'narration'|'sfx' }`. sfx=`{ description, sourceMode?, durationHint? }`(speaker/text 없음). audio 후 공통 `{ startMs, durationMs, audioPath, status }`. sfx reuse=`sfxKey`, narration=`voiceKey`.

---

## 2. 남은 slice

### M2b-2 — LLM sfx 세그먼트 자동 추출 (⚠️ 큰 작업, fresh context 권장)
씬 분리 단계(`llm.splitScenes`)에서 LLM이 대본의 효과음 큐를 `type:'sfx', description` 세그먼트로 뽑게 한다.
- **착수 전 재확인**:
  - `electron/api/llm/schemas.js` — `SCENES_SCHEMA` (segment가 현재 `speaker`+`text` required).
  - `electron/api/llm/llmClaude.js` — structured output validator(~L87). **Codex 확인: Claude validator는 oneOf/discriminated union 미지원.** → segment를 **loose(speaker/text/description 모두 optional) + `type` 필드** 로 두고, splitScenes 반환 후 **post-validation**(type='sfx'면 description 필수, narration이면 speaker+text 필수)으로 검증.
  - `electron/api/llm/prompts.js` (또는 metaPrompts) — splitScenes 프롬프트에 "효과음 큐를 type:'sfx', description 세그먼트로 시퀀스 자리에 삽입" 지시 추가. word-level 금지(세그먼트 단위). 과추출 주의(불필요한 효과음이 pause/씬그룹 왜곡).
  - `electron/story/stepMachine.js` scenes 스텝(splitScenes 호출부, ~L211) + segment id 발급(sfx도 id 필요 — `assignSegmentIds`/`SAFE_SEGMENT_ID` 검사가 sfx 포함하는지 확인. 현재 `assertSegmentIdsValid`가 narration만 검사할 수 있음 → **오디오 보유 세그먼트 전부 검사로 확장** 필요, path traversal 방어).
- **주의(Codex High)**: 분리(M2b-2)는 audio 생성(M2b-3, 완료)이 이미 있으니 sfx가 나와도 durationMs=0으로 안 깨진다(audio가 생성/측정). 즉 M2b-2는 이제 안전하게 붙일 수 있음.
- **TDD**: splitScenes mock이 sfx 세그먼트 반환 → scenes.json에 type:'sfx' 저장 + post-validation(narration은 speaker/text, sfx는 description). 실제 LLM 품질은 실호출로 눈검증(자동 테스트 밖).

### M2b-5 — UI (상대적으로 작음, TDD 쉬움)
- **`src/utils/storyAudioPackage.js`**: `buildStoryAudioPackage`가 현재 narration만(`sfx: []`). **sfx 세그먼트를 `pkg.sfx`로 반영** → AudioTimeline이 sfx 트랙으로 그림(useAudioTimeline이 `pkg.sfx` 처리: `[{ category, files:[{path,filename,timecodeMs,durationMs}] }]`). `withStoryAudio`도 sfx 합류.
- **`src/components/story/StoryView.jsx`**: audio 패널 세그먼트 테이블이 이미 `sc.segments` 전부 렌더 → **sfx 행은 `seg.description` 표시**(narration은 seg.text), 재생/재생성 버튼은 sfx도(audioPath 있으면). 소스 선택 드롭다운(sourceMode: elevenlabs/library) — 화자 매핑 드롭다운 패턴 참고(providerBySpeaker처럼 sfx sourceMode 로컬 state → buildAudioParams에 실어 audio 스텝으로).
- **TDD**: buildStoryAudioPackage sfx 변환(순수), StoryView sfx 행 표시.

---

## 3. 순서/방식

M2b-2(LLM, 크고 신중) → M2b-5(UI). 또는 M2b-5 먼저(수동 sfx로 검증 쉬움) → M2b-2. 각 slice TDD RED→GREEN + **마일스톤 끝 Codex 리뷰(gpt-5.5/xhigh, findings 0)**. GCF 변경 없음(sfx_timed 기존 처리). 커밋은 slice별.

## 4. 참고
- [[codex-review-per-milestone]] findings 0까지. [[autoflowcut-story-m2a-audio]] 메모리.
- 실호출 눈검증: ElevenLabs 키 `~/.elevenlabs/credentials`(readCredentialsKey 폴백 됨). sfx 생성은 비용 발생.
