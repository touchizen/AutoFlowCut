# Story V2 — 캐릭터 레퍼런스 자동 등록 설계

**날짜**: 2026-07-05
**맥락**: 스토리 씬 이미지의 캐릭터 외형 일관성. 현재 스토리는 외형을 imagePrompt에 plain text로만 박고(레퍼런스 금지, prompts.js:93), 씬이 `characters:''`로 push돼 기존 레퍼런스 conditioning을 전혀 안 탄다. **일반 플로우는 이미** `getMatchingReferences`→inline base64→`gemini-2.5-flash-image`로 캐릭터 레퍼런스 conditioning을 함. → V2 = 스토리 캐릭터를 **기존 Ref 시스템에 다리 놓기**(새 이미지 API 없음).

## 0. 목표 / 비목표

- **목표**: 스토리 speaker별로 외형(appearance)을 뽑아 **Ref 탭에 character 카드로 정확히 등록** + 스토리 씬에 `characters` 태그를 실어, 사용자가 기존 [레퍼런스 생성] → [씬 생성]을 돌리면 캐릭터가 씬마다 일관되게 나오게 한다.
- **비목표(YAGNI)**: 캐릭터 레퍼런스 이미지 자동 생성(사용자가 기존 배치 버튼으로). 프롬프트 @mention 문법(태그 매칭으로 충분). 성격/말투 페르소나(대본·TTS 영역). 스토리 뷰 전용 캐릭터 편집 UI(기존 Ref 탭 재사용).

## 1. 확정 결정 (brainstorm)

| 항목 | 결정 |
|---|---|
| 외형 소스 | **씬분리 통합** — SCENES_SCHEMA speakers에 `appearance` 추가(splitScenes가 함께 산출). |
| 이미지 생성 시점 | **카드만 자동 등록**(pending), 실제 이미지는 기존 Ref 탭 [레퍼런스 생성] 배치. |
| 프롬프트 외형 | **plain text 외형 유지**(레퍼런스 미생성이어도 씬이 그럴듯). 레퍼런스는 conditioning으로 일관성 **추가**(상호보강, 표준 방식). prompts.js 지시 변경 최소. |
| 기존 카드 보존 | speaker→카드 upsert는 **updateExisting=false**(이미 있는 카드=사용자 생성/편집분은 안 건드림). |
| narrator | 카드/태그 제외 — LLM이 narrator엔 appearance를 안 주게 지시 → **appearance 빈 speaker는 스킵**. |

## 2. 데이터 계약

- **speaker**: 기존 `{ id, name, voice? }` → `{ id, name, appearance?, voice? }`. appearance = 이미지 생성용 영어 외형 묘사(얼굴·헤어·의상·스타일). narrator 등 비가시 화자는 appearance 없음.
- **⚠️ segment.speaker는 id(식별자), 카드 name은 speaker.name**(Codex-High2): audio가 `speakers.find(s=>s.id===spk)`로 매핑하듯(stepMachine.js:270), 씬 characters 태그·카드 name은 반드시 **speaker.name으로 변환**해서 쓴다. 카드 name과 scene.characters 태그를 둘 다 같은 `speaker.name`에서 뽑아 정확 일치시킨다(매칭키 일원화).
- **SCENES_SCHEMA.speakers.items**(schemas.js:32): `{ id, name, appearance }`, required는 `[id, name]` 유지(appearance optional-loose).
- **불일치 방지 = omit(Codex-Med4, throw 아님)**: scene.characters 태그·storyCharacters는 **appearance가 있는 non-narrator speaker에서만** 뽑는다. appearance 없는 단역은 태그/카드에서 제외(plain-text 외형으로 폴백) → 태그만 있고 카드 없는 불일치가 원천적으로 안 생기고, LLM이 외형을 빠뜨려도 하드 실패 없음. narrator 판정은 **정규화 id/name === 'narrator'/'내레이터'**.
- **push 페이로드(mapScene/sendPush)**: 씬별 `characters` = 그 씬 세그먼트 speaker id들을 speaker.name으로 변환, non-narrator·유일, 콤마조인. push에 `storyCharacters: [{ name, appearance }]`(appearance 있는 non-narrator speaker) 동봉.
- **character 카드**: `{ name: speaker.name, type:'character', category:'MEDIA_CATEGORY_SUBJECT', prompt: appearance, status:'pending' }`(REFERENCE_TYPES/defaults.js:99 일치). 브리지가 status:'pending' 명시(mergeReferences는 status 미설정 — Codex-Low7).

## 3. 흐름

```
scenes 단계(stepMachine):
  splitScenes → { scenes, speakers:[{id,name,appearance}] }
  post-validation: 등장 non-narrator speaker appearance 필수(§2)
  speakers 병합: voice 승계처럼 appearance도 정규화이름 일치 승계(재실행 보존)
  state.speakers = 병합결과(appearance 포함)

prompts 단계:
  writePrompts에 speakers[].appearance를 컨텍스트로 전달(Codex-Med5) — LLM이 씬마다
    외형을 새로 지어내지 않고 정본 appearance로 일관 서술.
  push(mapScene/sendPush):
    speakerById = state.speakers의 id→{name,appearance} 맵
    각 씬 characters = 그 씬 세그먼트 speaker id → speaker.name, non-narrator, 유일, 콤마조인
    storyCharacters = appearance 있는 non-narrator speaker [{name, appearance}]

renderer onPushScenes(App.jsx:477):
  { nextScenes, nextSrtTrack } = importStoryScenes(payload)   # ← characters 보존(현재 '' 덮음)
  const { references: nextReferences, collisions } = upsertStoryCharacterRefs(references, payload.storyCharacters)  # §3.1
  setReferences(nextReferences)
  if (collisions.length) toast.warn(동명 비-character ref 있어 카드 스킵됨)
  # Codex-High1: push 트랜잭션에서 refs도 함께 영속 — autosave 디바운스 전에 crash 시
  #   story.json은 pushRevision 기록됐는데 project.json엔 카드 없음(재발신도 복구 못함).
  await saveCurrentProjectWithPayload({ scenes: nextScenes, srtTrack: nextSrtTrack, references: nextReferences })
  # ack는 저장 성공 후(기존 onPushScenes 계약)

이후(사용자, 무변경):
  Ref 탭 [레퍼런스 생성] → 캐릭터 이미지 생성(Flow 또는 API)
  [씬 생성] → getMatchingReferences(scene.characters↔ref.name) → inline base64 conditioning
```

### 3.1 upsertStoryCharacterRefs(existing, storyCharacters) — 순수함수, type-aware(Codex-High3)

캐릭터 카드는 mergeReferences를 직접 쓰지 않고 **type 인지 upsert**로 충돌을 명시 처리:
- 각 storyCharacter(name, appearance):
  - existing에 **같은 name + type==='character'** 있으면 → 그대로 둔다(사용자 생성/편집 이미지·status·filePath 보존).
  - 같은 name인데 **type≠character**(scene/style) 있으면 → **추가 안 하고 collision 경고**(로그/토스트). 조용히 스킵 금지(Codex-High3: 태그는 있는데 카드 없어 conditioning 실패).
  - 없으면 → **전체 기본 필드로** 추가(Codex-R2 High): `{ id, name, type:'character', category:'MEDIA_CATEGORY_SUBJECT', prompt:appearance, imagePath:'', data:null, mediaId:null, caption:'', status:'pending', errorMessage:null }`.
    - **`id`는 numeric·유일**(Codex-R3 High: 앱이 ref.id를 숫자로 가정 — ReferencePanel.jsx:128 `Math.max(...refs.map(r=>r.id||0))`, PromptInput/promptLexicalAdapter의 `Number(ref.id)`. 문자열 id면 NaN 전파). 앱 자체 신규 id 컨벤션을 따른다: `base = Math.max(0, ...existing 숫자 id) ; 신규 카드 i번째 = base + 1 + i`(numeric, 유일, 테스트 결정적). **idempotency는 id가 아니라 name-기반 보존**으로 확보(같은 name 재push → 기존 카드 유지, 새 id 미발급). mergeReferences의 `Date.now()+index`(비결정적)는 안 씀.
- 반환: `{ references, collisions }`. collision은 동명 비-character 목록(App이 토스트).

## 4. 변경 지점(파일)

| 파일 | 변경 |
|---|---|
| `electron/api/llm/schemas.js` | SCENES_SCHEMA.speakers.items.properties에 `appearance:{type:'STRING'}`. validateScenesSegments 인접에 speaker appearance 후검증(등장 non-narrator appearance 필수) 추가 or splitScenes 후검증. |
| `electron/api/llm/prompts.js` | buildSplitPrompt: "가시 등장인물마다 appearance(이미지 생성용 짧은 영어 외형 묘사)를 speakers에 넣어라. narrator/비가시 화자는 appearance 생략." **buildPromptsPrompt: speakers[].appearance를 컨텍스트로 포함**(Codex-Med5). (기존 plain-text 외형 지시 유지.) |
| `electron/story/stepMachine.js` | scenes 병합에 appearance 승계(정규화 이름 일치, voice 패턴). writePrompts 호출에 speakers 전달. mapScene(97)/sendPush(142): speakerById로 id→name 변환한 씬 characters 태그 + storyCharacters. narrator=정규화 id/name 판정. |
| `electron/story/storyStore.js` | defaultStoryState speakers shape 주석(appearance optional). |
| `src/hooks/useScenes.js` | importStoryScenes(675)/normalizeScene(322,491): push `characters` 보존(빈 문자열로 안 덮음). |
| `src/utils/storyCharacterRefs.js`(신규) | `upsertStoryCharacterRefs(existing, storyCharacters) → { references, collisions }` 순수함수(§3.1). |
| `src/App.jsx` | onPushScenes(477): upsertStoryCharacterRefs → setReferences + **saveCurrentProjectWithPayload에 references 실어 push 트랜잭션에서 영속**(Codex-High1). collision 있으면 토스트. |
| `src/hooks/useProjectData.js` | saveCurrentProjectWithPayload(1120)에 `references` override 추가(현재 scenes/srtTrack만, stale closure references 사용 — Codex-High1). |

**무변경**: genai.js(이미지/conditioning), useSceneGeneration, referenceResolver, getMatchingReferences, Ref 탭 UI, mergeReferences, GCF.

## 5. 재실행/멱등

- appearance 승계로 재실행 시 speaker identity 안정(voice 승계 미러).
- upsertStoryCharacterRefs는 기존 character 카드(생성완료/사용자편집) 안 덮음(status/data/filePath 보존). 새 캐릭터만 추가.
- scene.characters 태그는 push마다 재계산(wholesale) — story 씬 필드로 관리(기존 자막/타이밍 push 계약과 일관).
- **orphan 카드(Codex-Low6)**: speaker 이름이 재실행 간 바뀌면(LLM 리네임) 옛 이름 카드가 남는다. **자동 삭제 안 함**(사용자 편집분 파괴 방지) — 사용자가 Ref 탭에서 정리. 카드 name·태그를 둘 다 speaker.name에서 뽑아 매칭키 일원화(정규화는 tagMatch.js 소문자화 — 한글 이름은 정확일치라 무관, 내부공백 차이만 유의).

## 6. 테스트 (TDD)

- **schemas/prompts**: SCENES_SCHEMA speakers appearance 필드; buildSplitPrompt appearance 지시; **buildPromptsPrompt가 speakers appearance 포함**(Med5).
- **splitScenes(claude+gemini)**: speakers appearance 통과. **후검증: 등장 non-narrator인데 appearance 없으면 throw**(Med4).
- **stepMachine**: (a) scenes 병합 appearance 승계(재실행 보존), (b) **mapScene가 seg.speaker(id)→speaker.name 변환**해 씬 characters(non-narrator·등장·유일)(High2), (c) sendPush storyCharacters(appearance 있는 non-narrator, narrator=id/name 판정 제외).
- **useScenes**: importStoryScenes가 push characters 보존.
- **upsertStoryCharacterRefs(순수함수)**: (a) 신규 캐릭터 카드 추가(status pending), (b) 기존 character 동명 카드 보존(status/data/filePath 불변)(High3), (c) **동명 비-character(scene/style) 있으면 추가 안 하고 collision 반환**(High3).
- **saveCurrentProjectWithPayload**: references override가 저장 payload에 반영(High1, stale closure 아님).
- 실이미지 일관성은 실호출 눈검증(사용자).

## 7. 리스크/오픈 (Codex R1 반영 완료)

- references 영속: **push 트랜잭션에서 saveCurrentProjectWithPayload({references}) 명시 저장**으로 해결(§3, High1).
- **까다로운 서브문제(있으면) → Fable 5 위임**([[use-fable5-for-hard-problems]]).
