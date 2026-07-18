# Story — 시놉시스(줄거리+등장인물 게이트) → 시나리오 (Spec)

**날짜**: 2026-07-06 (v1) · **2026-07-07 v2 개정**
**브랜치**: `feature/story-pipeline` (base `b9b62a5`)
**상태**: v1 설계 확정 · Codex 방향리뷰 2R 통과 · **v2 확정**(2026-07-07) — 아래 §v2가 v1을 오버라이드. **Fable 5 리뷰 5R loop 완료(findings 0, 진행 가능)**. §v2.8~v2.11이 리뷰 해소 이력. 구현 대기.
**핸드오프**: `docs/handoffs/2026-07-06-story-synopsis-before-script-HANDOFF.md`

> **읽는 법**: §v2(바로 아래)가 최신 확정본이다. §1~§6(v1)은 스텝머신/IPC/op-lifecycle의 정교한 세부(Codex 2R 반영)를 위한 **참조 베이스**이며, §v2가 명시적으로 바꾼 항목은 §v2가 우선한다. v1과 v2가 충돌하면 v2.

---

## §v2. 2026-07-07 개정 (B안 + 등장인물 통합 + 리네임)

### v2.0 목표 (한 줄)

시놉시스 스텝을 **모든 경로**에서 거치게 하고(제목·붙여넣기 공통), 시놉시스에서 **줄거리 + 등장인물을 한 곳에서 확정**한 뒤 그 등장인물을 시나리오·씬 분리가 그대로 물려받게 한다. 등장인물의 **사후 추출(현재 scenes 스텝)을 폐지**해 "리안=강리안" 류의 캐릭터 어긋남을 원천 차단한다.

### v2.1 v1 대비 변경 결정

| 항목 | v1 (2026-07-06) | **v2 (2026-07-07)** | 근거 |
|---|---|---|---|
| 경로 | (A) 제목 전용 — 붙여넣기는 시놉시스 없음 | **(B) 항상** — 제목·붙여넣기 모두 시놉시스 게이트 | 붙여넣기 경로에도 등장인물 사후추출 문제가 남지 않게 |
| 시놉시스 내용 | 줄거리(로그라인+개요)만 | **줄거리 + 등장인물[]** | 등장인물을 한 곳에서 확정(단일 소스) |
| 등장인물 표현 | (해당 없음) `{name, appearance}` 자유텍스트 | **구조화 `{name, gender, age, role, appearance}`** (아이디어②) | 오디오 성우 추천이 성별을 추측 안 하고 확정값 사용 |
| Ref 카드 생성 시점 | scenes done 후 `story:pushCharacters` | **시놉시스 확정 시** upsert (아이디어①) | 등장인물 확정 지점 = Ref 생성 지점 통일, 씬 이미지 초반부터 일관 |
| scenes 등장인물 추출 | scenes 스텝이 speaker 생성 | **폐지** — scenes는 확정 speakers만 사용 | 캐릭터 단일 소스화 |
| 스텝 라벨 | `script`="대본" | **`script`="시나리오"** (키 불변, 라벨만) | 시놉시스→시나리오 개념 정리 |
| 시놉시스 배치 | 게이트 탭(script pre-phase) | **게이트 탭 유지** (v1과 동일) | 스텝머신 코어(STEP_ORDER/DOWNSTREAM) 무손상 — v1 아키텍처 존중 |

> **경로 (B)에서 게이트 탭 유지 근거**: 붙여넣기도 시놉시스를 거치지만, 시놉시스는 여전히 "실행 스텝"이 아니라 script의 pre-phase(게이트 탭)로 둔다. 달라지는 건 **표시 조건**뿐 — v1은 `input.type==='title'`일 때만 게이트 노출, v2는 **항상 노출**(§v2.5).

### v2.2 등장인물 데이터 계약 (신규 — 이 개정의 핵심)

**구조화 캐릭터 스키마** (`storyCharacter`):
```
{ name: string, gender: 'male'|'female'|'unknown', age: string, role: string, appearance: string }
```
- `appearance`는 이미지 프롬프트용 영어 자유텍스트(현행 유지). `gender/age/role`은 신규 구조화 필드.
- **하위호환**: 기존 project.json의 speaker/reference는 `gender/age/role`이 없을 수 있음 → 로드 시 `unknown`/`''` 기본값. 마이그레이션 스크립트 없음(읽을 때 채움).
- `gender`는 오디오 탭 성우 추천(`guessGenderFromAppearance`)의 **상위 소스**가 된다: 캐릭터에 확정 `gender`가 있으면 그걸 쓰고, `unknown`이면 기존 `guessGenderFromAppearance(appearance)`로 폴백. (이미 구현된 성우 추천과 접합)

**생성/역추출 (시놉시스 스텝, LLM):**
- **제목 경로**: `{줄거리, 등장인물[]}`를 함께 생성. 프롬프트가 등장인물을 구조화 필드로 뽑도록 지시.
- **붙여넣기 경로**: 붙여넣은 대본에서 **등장인물[]만 역추출**(줄거리 생성은 생략/요약 옵션). 대본 텍스트를 입력으로 같은 스키마 산출.

**확정 → 다운스트림:**
- 시놉시스 확정 시 등장인물[] → `state.speakers`에 반영(narrator는 별도 유지) **AND** `upsertStoryCharacterRefs`로 Ref 카드 upsert(`storyCharacterRefs.js` 재사용, idempotent).
- `stepMachine.characterSpeakers()`/`sendCharacters()`/`sendPush().storyCharacters`는 **확정 speakers를 소스로** 하도록 전환(현재는 scenes 파생).
- **명단 vs 배정 구분(중요)**: 시놉시스는 "누가 등장하나"(등장인물 명단)를 확정한다. scenes 스텝은 여전히 "이 씬의 이 대사를 누가 말하나"(씬별 화자 배정)를 담당하되, **명단에 없는 새 인물을 만들지 않는다**(배정은 확정 명단 안에서). 명단=시놉시스, 씬별 배정=scenes.
- `pushScenes.storyCharacters`와 `pushCharacters` payload를 `{name, appearance}` → **`{name, gender, age, role, appearance}`**로 확장(renderer/Ref가 구조화 필드 보존).

### v2.3 시놉시스 스텝 로직 델타 (v1 §3.3 위에)

- v1의 `generateSynopsis` side action(전용 opId, `story:synopsis-delta`, busy/abort, `synopsis.md`+`state.input` 저장, hydrate payload)은 **그대로 유지**.
- **추가**: 산출물이 `{ synopsisMd, characters[] }` (v1은 `synopsisMd`만). `characters`는 §v2.2 스키마. 저장: `synopsis.md` + **`characters.json`**(신규) 또는 `state`에 characters 필드. hydrate payload에 `characters` 포함.
- **붙여넣기 경로 지원**: v1은 title 전용이었으나 v2는 `generateSynopsis`가 `{ type:'title'|'pasted', title?, pastedScript? }`를 받아 분기. pasted면 등장인물 역추출 모드(줄거리 요약은 옵션).

### v2.4 프롬프트 델타 (v1 §3.2 위에)

- `buildSynopsisPrompt`: 줄거리 + **등장인물[] 구조화 필드(name/gender/age/role/appearance)**를 JSON으로 산출하도록 지시. 언어/장르/metaPrompt 반영은 v1 유지.
- **붙여넣기용** `buildCharacterExtractPrompt(pastedScript, opts)` 신규(또는 buildSynopsisPrompt에 pasted 분기): 대본에서 등장인물만 같은 스키마로 역추출.
- **품질이 결과를 좌우하는 핵심 지점** — 시놉시스/등장인물 프롬프트 설계는 Fable 5 검토 대상.

### v2.5 UI 델타 (v1 §3.5 위에)

- **리네임**: `STEP_META.script.label` "대본"→"시나리오", `src/locales/{ko,en}.js`의 `story.step.script` 및 관련 라벨. (키 `script` 불변)
- **표시 조건 변경 (A→B)**: v1의 "`input.type==='title'`일 때만 synopsis 탭" 규칙 → **항상 노출**. 붙여넣기 경로도 setup "시작" 후 synopsis phase로 진입(줄거리 요약 또는 등장인물 확인 중심). v1 §3.5의 `showSynopsis` 조건/폴백/hydrate 분기에서 "title 한정" 부분을 "항상"으로 완화.
- **시놉시스 패널에 등장인물 편집 추가**: 줄거리 텍스트(편집) + **등장인물 카드 목록**(name/gender/age/role/appearance 필드 편집, 추가/삭제). 확정 게이트 버튼 [이 시놉시스로 시나리오 생성]은 v1 유지(라벨만 시나리오).
- 씬 분리 화면: 등장인물이 이미 확정돼 있으므로, 기존 "씬에서 speaker 추출" 표시/로직 제거 또는 read-only.

### v2.6 TDD 슬라이스 (v1 §4에 추가/수정)

1. **캐릭터 스키마 + 성우 추천 접합** (순수, 먼저): `storyCharacter` 스키마 기본값(`gender:'unknown'` 등) + 오디오 탭이 캐릭터 `gender` 확정값 우선, `unknown`이면 `guessGenderFromAppearance` 폴백. (기존 appearanceGender 테스트 확장)
2. **프롬프트**: `buildSynopsisPrompt`가 등장인물 구조화 JSON 지시 포함 / 붙여넣기 역추출 프롬프트. (prompts 단위)
3. **스텝머신**: `generateSynopsis`가 `{synopsisMd, characters}` 반환·저장·hydrate, pasted 분기. `characterSpeakers/sendCharacters/sendPush`가 확정 speakers 소스. scenes 스텝 speaker 미생성(회귀). payload 구조화 필드 확장.
4. **Ref 연동**: 시놉시스 확정 → `upsertStoryCharacterRefs` 호출(idempotent, 동명 보존), 구조화 필드 보존.
5. **UI**: synopsis 항상 노출(B), 등장인물 카드 편집, script→시나리오 리네임, 붙여넣기도 synopsis phase 진입.

### v2.7 비목표 (v2에서도 YAGNI)

- 아이디어③ **일관성 가드 UI**(명단 밖 인물 등장 시 사용자 경고 배너/수정 UI) — **후속 spec**. 단, **명단 밖 speaker의 최소 폴백**(§v2.8 B2: narrator 폴백 + 로그)은 audio 하드실패를 막기 위해 **이번 범위에 포함**한다.
- 캐릭터 필드의 다국어화(gender enum은 내부값 male/female/unknown, 표시만 i18n) — 표시 라벨만, 저장은 enum.
- project.json 마이그레이션 스크립트 — 안 함(읽을 때 기본값 채움).

### v2.8 Fable 5 리뷰 해소 (2026-07-07) — BLOCKER/MAJOR 반영

> Fable 5 설계리뷰가 실제 코드(stepMachine.js 등) 대조로 BLOCKER 3·MAJOR 5·MINOR 5를 지적. 아래가 확정 해소안이며 **§v2.2~v2.6을 오버라이드**한다.

**B1 — 붙여넣기 확정 흐름 (대본 유실/덮어쓰기 방지)**
- 붙여넣기 setup "시작" → **즉시 `start('script', { pastedScript, input:{type:'pasted'} })`** (현행 유지): 대본을 `script.md`에 영속 + script step done. 그 **직후 synopsis phase로 전환**해 등장인물을 역추출한다.
- synopsis phase(pasted)는 **등장인물 역추출·확인 전용**(줄거리 편집은 비노출/옵션). 확정 버튼은 **`story:confirm-synopsis`만 호출 — script를 재생성/덮어쓰지 않는다**(title 경로의 [이 시놉시스로 시나리오 생성]=LLM 재생성과 **다른 버튼/동작**).
- **hydrate 규칙 추가**: `steps.script.status==='done'`이라도 **characters 미확정**이면 synopsis phase 복원(기존 "script done→editor"보다 우선). 확정 플래그는 hydrate payload의 `charactersConfirmed`(또는 characters 존재+확정표시)로 판단.
- generateSynopsis(pasted)는 `state.input`을 덮어쓰지 않는다(script 분기가 이미 `{type:'pasted'}` 저장 — 순서: start('script') 먼저 → 그 뒤 역추출).

**B2 — 배정을 명단에 묶기 (buildSplitPrompt 로스터 주입 + 최소 폴백)**
- **`buildSplitPrompt`/`splitScenes` 확장**(v2.4에 추가): 확정 speakers(`id/name/role`)를 프롬프트에 주입하고 **"이 명단의 id만 사용, 새 인물 생성 금지"** 지시. 시그니처: `splitScenes(scriptMd, opts, { roster })`.
- **`ensureReferencedSpeakers`**(stepMachine.js:187): 명단 밖 speaker를 *새로 생성*하던 동작 **폐지** → 검증으로 전환. 단 **narrator 시딩은 유지**(세그먼트가 narrator 참조 시).
- **명단 밖 speaker 발견 시 최소 폴백**(가드 UI는 후속, 폴백은 이번 범위): 정규화 매칭(공백/대소문자 + 근접) 시도 → 실패하면 그 세그먼트를 **narrator로 폴백 + 경고 로그**(`story:progress` warn). **audio 사전검증(stepMachine.js:607) 하드실패 방지**가 목적.

**B3 — scenes의 state.speakers 파괴 방지 + narrator 보존**
- scenes 스텝은 `state.speakers`를 **전체 교체하지 않는다**. 확정 명단이 base(single source). `mergeSpeakers`(stepMachine.js:172)를 **확정명단 우선 superset 병합**으로 변경: ①확정 `gender/age/role/appearance` 보존, ②LLM 참조 인물의 `voice` 승계, ③**씬에서 미참조된 확정 인물도 삭제 금지**.
- **narrator 시딩 지점 확정**: 시놉시스 확정 시 `state.speakers`에 `{id:'narrator', name:'나레이션'}` 포함(캐릭터 목록엔 안 보이되 speakers엔 존재). open-time heal은 유지(방어). → 모든 나레이션 세그먼트 voice 배정 보장.

**M1 — 확정 커밋 채널(IPC 신규)**
- **`story:confirm-synopsis { synopsisMd, characters }`** 핸들러 신규(§3.4 델타): main이 characters→`state.speakers` 반영(구조화 필드 포함) + `flush()` + **`story:pushCharacters` emit**. Ref upsert는 기존 renderer 경로(App.jsx `story:pushCharacters` 수신)가 처리 → **시점만 시놉시스 확정으로 앞당김**. `maybeSendCharacters` 게이트(scenes done)를 "characters 확정됨"으로 조정.

**M2 — storyCharacter `id` + 재확정 정책**
- 스키마에 **`id` 추가**: `{ id, name, gender, age, role, appearance }`. id는 기존 speaker id 규칙(slug/영속 id)으로 파생·고정(React key `sp.id`, 세그먼트 매칭 `chars.get(g.speaker)` 소비).
- 재확정(이름변경/삭제): `mergeSpeakers`로 `voice` 배정 보존. scenes/audio done 이후 재확정 시 세그먼트 speaker 고아 가능 → v1 "수동 갱신" 정책 준용(자동 무효화 안 함) + 명단-scenes 불일치는 §B2 폴백이 흡수.

**M3 — 시나리오 프롬프트에 확정 등장인물 주입**
- **`buildScriptPrompt(input, opts)`에 `opts.characters` 컨텍스트 블록 추가**: "아래 인물 명단과 **정확한 이름만** 사용하라". `opts.synopsis`(줄거리)와 별도. → 대본 첫 소비자부터 이름 어긋남 차단.

**M4 — pasted 역추출 스트리밍 계약**
- `synopsisMd`만 `story:synopsis-delta`로 스트리밍. **`characters[]`는 완료 시 최종 payload/state로 전달**(JSON 파편을 편집기에 노출 안 함). **pasted 모드는 non-streaming**(줄거리 생략, 등장인물만 최종 반환).
- **§3.4 IPC 시그니처 오버라이드**: `story:generate-synopsis`는 `{ type:'title'|'pasted', title?, pastedScript?, options }` 수용.

**M5 — Ref 카드는 구조화 필드 불필요(정정)**
- 성우 추천은 **`state.speakers`의 `gender`를 읽으므로**(오디오 탭, StoryView) Ref 카드엔 gender/age/role이 **필요 없다**. §v2.2의 "Ref가 구조화 필드 보존" 문구는 **철회** — `upsertStoryCharacterRefs`는 현행(`name`/`appearance`)대로 재사용, 변경 없음.

**MINOR 반영**
- **m1**: `guessGenderFromAppearance`는 `null` 반환(‘unknown’ 아님). 접합 규칙: 캐릭터 `gender`가 `male/female`면 그것, `unknown`이면 `guessGenderFromAppearance(appearance)`(→ null 가능). UI의 null=배지 없음 + genderMismatch 경고 우선순위 동일. (v2.6-1 테스트에 명시)
- **m2 리네임 파급 목록(구체화)**: `ko/en.js`의 `story.step.script`, **`story.review.target.script`("대본"→"시나리오")**, **`story.action.generateScript`("대본 생성")**, form.paste/scriptPlaceholder, `StoryStepper.jsx` STEP_META 폴백, **`useStoryPipeline.js:150` 하드코딩 `'대본 검수'`(i18n 미경유 — 반드시 수정)**, 그리고 '대본' 문자열 단언 테스트 ~19개 파일. ("검수/시나리오" 문맥 구분: script 산출물=시나리오, 검수 라벨도 그에 맞춤.)
- **m3**: characters 저장은 **`state.speakers`(story.json) 단일 저장**, 별도 `characters.json` 안 만듦(desync 방지). hydrate는 speakers에서 파생. 씬 화면의 speaker 표시는 **read-only**(추출 UI 제거).
- **m4**: v1 §3.x의 라인 앵커(preload 화이트리스트 등)는 현 코드와 일부 drift(예: pushCharacters 이미 포함) — 구현 착수 시 앵커 재검증.
- **m5 TDD 추가 회귀**: narrator 시딩, mergeSpeakers의 구조화필드 승계, buildSplitPrompt 로스터 주입+명단밖 폴백, 재확정 voice 보존, pasted 확정 후 script.md 비파괴, buildScriptPrompt characters 주입.

**판정**: Fable "조건부 진행" → 위 B1/B2/B3 + M1~M5 해소로 조건 충족. 착수 전 사용자 확인 대기.

### v2.9 Fable 5 리뷰 R2 잔여 해소 (2026-07-07) — 잔여 BLOCKER1/MAJOR2/MINOR2

> R2에서 §v2.8이 B3·M4·M5·m1~m5를 완전 해소 확인. 잔여 5건의 뿌리는 "confirm-synopsis를 pasted 전용으로 좁게 정의"한 것. 아래로 최종 해소. **§v2.8을 오버라이드.**

**[BLOCKER 해소] confirm-synopsis를 두 경로 공통 커밋 채널로 일반화**
- `story:confirm-synopsis { synopsisMd, characters }`는 **title·pasted 공통**. 두 경로 모두 시놉시스 확정 시 이걸 먼저 호출해 characters→`state.speakers` 반영 + `charactersConfirmed=true` + `flush()` + `story:pushCharacters` emit(Ref 앞당김).
- 경로별 확정 버튼 동작(§v2.8 B1 정정):
  - **title** [이 시놉시스로 시나리오 생성] = `confirm-synopsis` **→ 이어서** `start('script', { input:{type:'title'}, synopsis, /* characters는 state.speakers에서 파생 */ })`. 즉 커밋이 재생성보다 **선행**한다.
  - **pasted** [등장인물 확정] = `confirm-synopsis`만(script는 이미 done, 재생성 안 함).
- 이로써 title 경로에서도 `state.speakers`가 채워져 **§v2.8 B2의 roster 주입 소스 확보 + M3 buildScriptPrompt `opts.characters` 출처 확보**(= state.speakers 파생) + Ref 앞당김이 성립 → v2 핵심 목표(리안 차단)가 주 경로에서 작동.

**[MAJOR 해소①] showSynopsis 항상 노출 + charactersConfirmed 실 필드**
- v1 §3.5 `showSynopsis` 조건("`input.type==='title'`일 때만") **명시 오버라이드**: **항상 노출**(B안). 단 재오픈 시 "이미 확정 완료"면 게이트를 통과 표시(pill은 보이되 phase는 editor).
- **`charactersConfirmed`를 durable state 필드로 신설**: `state.charactersConfirmed`(boolean). hydrate payload(§3.3 open/getState/story:state)에 **명시 포함**. open-heal이 speakers를 채우는 것과 무관한 **독립 확정 마커** — legacy 프로젝트는 false로 시작(재확정 유도). 재오픈 phase 판정: `charactersConfirmed===false` → synopsis phase, `true`면 기존 규칙(script done→editor 등).

**[MAJOR 해소②] 명단밖 speaker = seg.speaker 재기록(fuzzy 제거)**
- 폴백은 **voice 해석만이 아니라 `scenes.json`의 `seg.speaker`를 `'narrator'`로 재기록**한다(audio 사전검증 stepMachine.js:607이 seg.speaker 원값을 보므로 데이터 자체를 고쳐야 하드실패 방지).
- **소유 스텝/시점**: scenes 스텝의 **최종 정규화 단계**(검토루프 `reviseScenes` **이후**, `sendPush` 전)에서 roster 대조 → 명단밖 seg.speaker를 narrator로 재기록 + `story:progress` warn. 검토루프가 다시 명단밖을 만들어도 이 최종 단계가 다시 흡수.
- **fuzzy 근접 매칭 제거**(오매칭 위험): 매칭은 `findSpeakerByRef`의 기존 정규화(공백/대소문자)만. 실패 = 즉시 narrator 폴백(추측 매칭 안 함).

**[MINOR 해소①] storyCharacter id 규칙 확정**
- `id = normalizeSpeakerId(name)` — 기존 코드가 `seg.speaker`를 `String(x).trim()`으로 쓰는 것과 정합하게 **name의 trim 값**을 id로 사용(별도 slug 함수 신설 안 함, YAGNI). roster 주입 시 LLM에 "speaker id = 이 name 문자열 그대로" 지시 → `seg.speaker`가 name과 일치 → `chars.get(g.speaker)`(L346)·audio·React key 매칭 성립.
- 재확정 시 **이름 변경 = 신규 인물 취급**(단순). 옛 이름 세그먼트는 §MAJOR② 최종 정규화가 narrator로 흡수(고아 방지).

**[MINOR 해소②] roster 제약을 검토루프에도 적용**
- `buildScenesRevisePrompt`/`reviseScenes`(stepMachine.js:245)에도 roster + "명단 id만, 새 인물 금지" 지시 주입(초기 `buildSplitPrompt`와 동일). 검토 중 명단밖 재유입 1차 차단(+ §MAJOR② 최종 정규화가 2차 안전망).

**R2 잔여 판정**: BLOCKER 1 → 해소, MAJOR 2 → 해소, MINOR 2 → 해소. R3 재리뷰로 확인 예정.

### v2.10 Fable 5 리뷰 R3 잔여 해소 (2026-07-07) — 과교정 정정

> R3에서 R2 잔여 4건 해소 확인. 단 §v2.9 MAJOR①이 **과교정**되어 legacy 재오픈 회귀(신규 BLOCKER) + 본문 미동기화(MINOR2). 아래로 정정. **§v2.9 MAJOR① 및 §3.5/§4 title-only 문구를 오버라이드.**

**[BLOCKER 정정] 재오픈 phase 판정 — legacy 회귀 차단 (§v2.9 "무조건 false→synopsis" 폐기)**
- `state.charactersConfirmed`는 신규 필드라 **기존 project.json엔 없다(undefined)**. "false→synopsis 무조건"은 prompts까지 끝난 legacy 프로젝트를 게이트 뒤로 숨긴다. 정정 판정(우선순위):
  1. `input.type ∉ {title, pasted}`(imported/continue/manual) → **synopsis 미적용, 현행 그대로**(§0 유지). showSynopsis pill도 미렌더.
  2. `charactersConfirmed === true` → 기존 규칙(script done→editor 등).
  3. `charactersConfirmed === undefined`(**legacy**): `steps.script.status==='done'`이면 **확정된 것으로 간주(migrate: 이후 flush 시 true 기록)** → editor. 아니면 기존 scriptText 기반 규칙(setup/editor). **legacy를 synopsis로 강제하지 않는다.**
  4. `charactersConfirmed === false`(**신규 프로젝트, confirm 전**) `且` `type ∈ {title, pasted}` `且` script 미완 → **synopsis phase**.
- **"항상 노출" 정정 → "title·pasted 경로 한정"**: §v2.9 MAJOR①의 "showSynopsis 항상 노출"은 부정확. B안 범위(§v2.1)는 **title+pasted만**이고 imported/continue/manual은 아님. `showSynopsis = type ∈ {title, pasted}`.

**[MINOR 정정①] 하위 본문/TDD 슬라이스 동기화**
- **§3.5(L216-217) title-only showSynopsis 조건** 및 **§4 슬라이스4(L257) "input.type==='title'일 때만 synopsis 탭"**은 **v2.10으로 오버라이드됨**: `type ∈ {title, pasted}`일 때 렌더, imported/continue/manual 미렌더, legacy(script done) 미강제. TDD 슬라이스4 테스트는 이 정정된 조건(title·pasted 노출 / imported·continue·legacy-done 미노출)으로 작성 — 옛 title-only로 고정 금지.

**[MINOR 정정②] confirm-synopsis 동시성 가드**
- `story:confirm-synopsis`는 **running step이 없을 때만** 수행(busy 반환) — generateSynopsis op / 스텝 실행과 상호배제. title 경로의 `confirm → start('script')` 연속 호출은 **confirm 완료(flush) 후 start**(순차). start()의 기존 running 가드(stepMachine.js:961)와 정합.

**R3 잔여 판정**: BLOCKER 1 → 해소(legacy 회귀 차단), MINOR 2 → 해소(본문 동기화 + confirm 가드). R4 재리뷰로 확인 예정.

### v2.12 사용자 피드백 반영 (2026-07-07, 구현/리뷰 후) — 인종 필드 + 시놉시스 정식 스텝화

> 실앱 확인 중 사용자 요청: (A) 등장인물 인종/출신 구분(한국 스타일 보장), (B) 시놉시스가 설정 탭에서 사라지는 문제 → 게이트 탭을 정식 번호 스텝(항상 표시)으로.

**A. `ethnicity`(출신/인종) 필드 추가**
- storyCharacter 스키마 확장: `{ id, name, gender, age, role, ethnicity, appearance }`. `ethnicity` 기본값 `''`. 하위호환: 기존 speaker에 없으면 `''`.
- `buildSynopsisPrompt`/`buildCharacterExtractPrompt`의 characters JSON에 `ethnicity` 포함(LLM이 "한국인"/"East Asian"/"Korean" 등 자유값으로 채움). 국가명 별도 필드는 안 만듦(ethnicity에 "한국" 등으로 표기).
- `CharacterCards`에 "출신" 자유입력 칸(성별 옆).
- **이미지 프롬프트 반영(핵심)**: Ref 카드 prompt 및 씬 이미지 프롬프트 생성 시 ethnicity를 appearance와 조합 — 예: 카드/씬 prompt = `${ethnicity ? ethnicity + ', ' : ''}${appearance}`. `upsertStoryCharacterRefs`(Ref prompt)와 `mapScene`/캐릭터 멘션 조합 지점에서 반영. (성우추천의 gender 접합과 동일 패턴 — 구조화 필드를 소비처에서 조합)
- locales ko/en.

**B. 시놉시스 정식 스텝화 (게이트탭 → 번호 스텝, UI만 — 스텝머신 코어 불변)**
- **스텝머신 STEP_ORDER/DOWNSTREAM 불변**(§v2.1 게이트 탭 방식 유지 — 코어 무손상). **UI 표시만** 정식 번호로.
- StoryStepper 번호: `SYNOPSIS_META` icon `①`, `script`(시나리오) `②`, `scenes` `③`, `audio` `④`, `prompts` `⑤`. (setup은 `0` 유지)
- **시놉시스 자리는 항상 렌더**(숨기지 않음). 활성/비활성 분리:
  - `type ∈ {title, pasted}` 신규(charactersConfirmed ≠ undefined) → **활성**(클릭 가능, 기존 showSynopsis 활성 조건).
  - imported/continue/manual(`type ∉ {title,pasted}`) 또는 legacy(charactersConfirmed === undefined) → **회색 비활성**(자리만, 클릭 불가).
- 이로써 "설정 탭 진입 시 시놉시스 사라짐"(showSynopsis가 phase에만 묶여 조건 미충족) 근본 해결 — 자리가 항상 있고 클릭 가능 여부만 상태로 판단.
- 회귀: hydrate phase 판정(§v2.11 4분기)·게이트(§FIX-2)·라우팅(§FIX-6)은 불변. 표시(pill 렌더/번호/활성)만 변경.

### v2.11 Fable 5 리뷰 R4 잔여 해소 (2026-07-07) — charactersConfirmed 3-state 확정

> R4에서 legacy 회귀 BLOCKER + MINOR 2 해소 확인. 잔여 MAJOR 1: `charactersConfirmed`의 **false durable write 시점 누락** → undefined(legacy)와 false(신규 미확정) 구분 불가 → 4단계 dead + 신규 pasted 재오픈 게이트 유실. 아래로 확정. **§v2.10 재오픈 판정 3·4단계를 오버라이드.**

**[MAJOR 해소] `charactersConfirmed` 3-state 명확화 + false 기록 시점**
- 3-state 의미 확정:
  - **`undefined`** = legacy(필드가 없던 기존 project.json).
  - **`false`** = 신규 프로젝트, **등장인물 미확정**.
  - **`true`** = `confirm-synopsis` 완료.
- **false durable write 시점(신규 결함의 핵심)**:
  - **title 경로**: `generateSynopsis({type:'title'})` 진입 시 `state.charactersConfirmed=false` 기록(+flush). (title은 항상 synopsis를 거치므로 이 지점 보장)
  - **pasted 경로**: `start('script',{pastedScript})` 분기(stepMachine.js:494-501)에서 `state.charactersConfirmed=false` 기록. (script done이 되더라도 미확정 마커가 durable)
  - `defaultStoryState()`(storyStore.js)는 건드리지 않는다(빈 신규는 아직 type 미정 → setup). 오직 위 두 진입점에서 write.
- **재오픈 phase 판정 재정정(§v2.10 3·4단계 대체)** — false면 script done이어도 synopsis(pasted 게이트 보존):
  1. `input.type ∉ {title, pasted}` → 현행(synopsis 미적용).
  2. `charactersConfirmed === true` → 기존 규칙(script done→editor 등).
  3. **`charactersConfirmed === false` → synopsis phase** (script done 여부 **무관** — pasted가 script done이어도 미확정이면 역추출 게이트 유지. §v2.10의 "script 미완" 조건 제거).
  4. `charactersConfirmed === undefined`(**legacy**): `steps.script.status==='done'`이면 migrate(editor + 이후 flush 시 `true` 기록), 아니면 기존 scriptText 규칙. **legacy만 migrate** — 신규(false)는 3단계로 게이트 유지.
- 이로써 `undefined=legacy` / `false=신규 미확정`이 구분되고, 4단계 dead 제거, 신규 pasted 재오픈 게이트 보존(B1 계약 충족).

**R4 잔여 판정**: MAJOR 1 → 해소. R5 재리뷰로 확인 예정.

---


## 0. 목표 (한 줄)

**제목만 입력**해 대본을 생성하는 경로에서, **대본 생성 전에 시놉시스를 먼저 보여주고** 사용자가 확인/편집한 뒤 그 시놉시스로 대본을 쓰게 한다. **임포트/붙여넣기/이어쓰기 대본은 현행 그대로** (시놉시스 단계 없음).

## 1. 확정된 설계 결정 (brainstorm 결과)

| 결정 | 선택 | 근거 |
|---|---|---|
| 시놉시스 배치 | **게이트 탭** (setup 패턴) | 스텝머신 코어(STEP_ORDER/DOWNSTREAM/computeCurrentStep) 무손상. 스텝퍼엔 보이되 실행 스텝 아님. |
| 대본 stale 처리 | **수동 갱신** | 시놉시스 재편집해도 기존 대본 자동 무효화 X. 사용자가 [대본 생성] 다시 눌러야 갱신. 단순·예측가능. |
| skip 옵션 | **없음** | 제목 경로는 항상 시놉시스 게이트를 거침. "확인 게이트" 의도에 부합. |
| synopsis pill 배지 | **무배지** | setup과 동일한 순수 게이트 탭. 일관성. |
| 스트리밍 델타 채널 | **전용 `story:synopsis-delta`** | 대본 스트리밍(`story:delta`)과 UI 타겟이 달라 섞이면 편집기/시놉시스 패널 델타 충돌. |
| script→synopsis 전달 | **명시 전달 우선, 저장본 폴백(title 경로 한정)** | `params.synopsis`(편집본) 우선 → 없으면 저장된 `synopsis.md` 폴백 → 없으면(임포트/이어쓰기) 현행. **폴백은 effective input type이 `title`일 때만** — pasted/manual에 stale synopsis.md 누출 금지. |
| op lifecycle | **synopsis 전용 operationId + started 이벤트** | side action은 running step을 안 만들어 기존 `activeOpRef`(story:state 기반) 필터를 못 탐. 전용 op 라이프사이클/abort/busy guard 필요 (Codex 방향리뷰 #1). |

## 2. 아키텍처 (핵심 원칙)

시놉시스는 스텝퍼에 보이는 **게이트 탭**이지만 실제로는 `script` 스텝의 **pre-phase**다. 스텝머신의 실행 스텝 배열은 건드리지 않는다.

```
setup(제목) --시작--> [synopsis phase: 생성/편집] --"이 시놉시스로 대본 생성"--> [editor: 대본 스트리밍] --분리시작--> scenes...
                     (제목 경로만)                                                          (기존)
임포트/붙여넣기/이어쓰기: setup --> editor (시놉시스 건너뜀, 현행)
```

기존 패턴 미러 (앵커):
- `generateTitle`: side action (스텝 아님), `machine.generateTitle` (stepMachine.js:900), `story:generate-title` IPC (story-api.js:113). **단, generateTitle은 non-streaming — generateSynopsis는 streaming이라 델타 필요.**
- `generateScript`: streaming, `onDelta: (text) => send('story:delta', {text}, opId)` (stepMachine.js:450,474). `store.saveText('script.md', ...)` / `store.loadText('script.md')`.
- 스텝퍼 게이트 탭: `setup`이 "실행 스텝 아닌 진입 탭"으로 배지 없이 0번 (StoryStepper.js:11-13, SETUP_KEY/SETUP_META).

## 3. 컴포넌트별 변경

### 3.1 LLM 엔진 (electron/api/llm/{llmClaude,llmGemini,llmCodex}.js)
- **신규** `generateSynopsis(input, opts = {}, { onDelta, signal, ... } = {}) → { synopsisMd }`
  - **공개 계약**은 `generateScript`와 동일: `(input, opts, { onDelta, signal }) → 스트리밍 델타 누적 → { synopsisMd }`.
  - **주입 지점은 엔진마다 다름** (Codex #8): Claude `queryImpl`, Gemini `fetchImpl`, Codex `runText`. 각 어댑터는 자기 파일의 기존 injection 패턴을 따르고, 테스트도 그 패턴으로 mock.
  - **프로덕션 router는 claude/codex만** 배선(main.js:258). Gemini(`llmGemini`) 구현은 **호환/테스트용**(라우팅 대상 아님) — Codex R2 #5. Gemini를 프로덕션 대상으로 올리는 건 이 spec 범위 밖.

### 3.1b Story LLM Router (electron/api/llm/storyLlmRouter.js) — **Codex #6 (BLOCKER)**
- 프로덕션은 `createStoryLlmRouter({ claude: llmClaude, codex: llmCodex })` (main.js:258)를 통해 dispatch. router는 `METHOD_OPTION_INDEX` 테이블에 있는 메서드만 노출한다.
- **`METHOD_OPTION_INDEX`에 `generateSynopsis: 1` 추가** (opts가 2번째 인자 = index 1). 누락 시 `machine`이 `llm.generateSynopsis`를 부를 때 router에 그 키가 없어 프로덕션에서 무조건 실패.
- 테스트: router가 `generateSynopsis`를 노출하고 engine(claude/codex)으로 올바르게 dispatch, 미구현 어댑터엔 명확한 에러.

### 3.2 프롬프트 (electron/api/llm/prompts.js)
- **신규** `buildSynopsisPrompt(input, opts)`
  - "당신은 유튜브 스토리 채널 작가다. 아래 제목으로 로그라인 1줄 + 도입/전개/전환/결말 방향을 담은 3~5문장 시놉시스를 `{language}`(ko→한국어, en→영어)로 써라. 장르/톤/길이 반영. **대사·씬 번호 없이 줄글 개요만.**"
  - `opts.metaPrompt`(장르) 있으면 `buildScriptPrompt`처럼 CUSTOM INSTRUCTIONS 블록 포함.
  - `input.title` 사용.
- **확장** `buildScriptPrompt(input, opts)`
  - `opts.synopsis`(문자열) 있으면 프롬프트에 "아래 시놉시스를 따라 대본을 작성하라:\n{synopsis}" 컨텍스트 블록 주입. 없으면 현행 그대로.

### 3.3 스텝머신 (electron/story/stepMachine.js)
- **신규 side action** `async generateSynopsis({ title, options = {} })` — generateTitle 단순 미러가 **아님** (Codex #1/#2/#7):
  - **옵션 빌드는 script처럼**: `loadMetaPrompt({ genre, wave:'script', language })`로 metaPrompt 로드해 opts에 포함 (generateTitle은 metaPrompt 미로드). **wave는 `'script'` 재사용으로 확정** (Codex R2 #3) — 현재 loader는 `wave==='script'`만 반환하므로 신규 `'synopsis'` wave/guide는 만들지 않음(YAGNI). 나중에 synopsis 전용 지침이 필요해지면 그때 metaPrompts에 wave 추가.
  - **op lifecycle** (Codex R2 #1/#2): 전용 operationId 발급. delta 전 **started 신호를 단일 계약으로 고정** — `story:synopsis-delta { phase:'started', operationId, text:'' }`(별도 이벤트 미신설, preload는 synopsis-delta만 화이트리스트). renderer는 이 started로 `synopsisActiveOpRef`를 세팅.
  - **busy/abort 대칭** (Codex R2 #2): `generateSynopsis()`는 step/preview/synopsis 중 하나라도 active면 busy 반환. `start()`는 synopsis active 중이면 busy 반환(기존 previewing/running 가드에 synopsis 추가). `machine.abort()` 및 프로젝트 전환/open cleanup은 synopsis 전용 controller도 abort.
  - 스트리밍: `llm.generateSynopsis({ type:'title', title }, opts, { onDelta: (text) => send('story:synopsis-delta', { text }, opId), signal })`.
  - **상태 저장**: `store.saveText('synopsis.md', synopsisMd)` **AND** `state.input = { type:'title', title, options }` 저장 후 `flush()` — **step status는 안 건드림** (게이트 후 script 전 종료해도 title/options 유실 방지, Codex #2).
  - 반환 `{ synopsisMd }`.
- **확장** `script` 스텝 (제목 생성 분기, ~L468-478)
  - synopsis 결정 (Codex #5, R2 #4): **`params.synopsis`의 present 여부로 분기**(값 유무가 아니라 키 존재). present(≠undefined)면 그 값만 신뢰 → `trim()`해서 비었으면 synopsis 없이 진행(폴백 안 함, blank가 stale 로드로 새지 않게), 비지 않았으면 `store.saveText('synopsis.md', eff)` 후 사용. `params.synopsis`가 **absent(undefined)이고 effective input type이 `title`일 때만** `store.loadText('synopsis.md')` 폴백. pasted/manual/continue는 폴백 금지.
  - 결정된 synopsis를 `opts.synopsis`로 실어 `llm.generateScript(input, opts, ...)` 호출. 없으면 미설정(현행).
  - `params.continue`/`params.pastedScript` early-return 분기는 무변경 (synopsis 미관여).
- **hydrate payload 확장**: `open()`/`getState()` 반환·`story:state` emit에 `synopsisText`(= `store.loadText('synopsis.md')||''`) 또는 `hasSynopsis` 추가 (Codex #2). 재오픈 시 renderer가 synopsis phase 복원 판단에 사용.
- **STEP_ORDER/DOWNSTREAM/computeCurrentStep/PROGRESSABLE_STEPS/AUTO_ORDER 무변경.**

### 3.4 IPC 배선
- **story-api.js**: `ipcMain.handle('story:generate-synopsis', guarded(({ title, options }) => machine.generateSynopsis({ title, options: options || {} })))`
- **preload.js**:
  - `storyGenerateSynopsis: (params) => ipcRenderer.invoke('story:generate-synopsis', params)`
  - onStoryEvent valid 화이트리스트에 `'story:synopsis-delta'` 추가 (현재 `['story:state','story:delta','story:progress','story:pushScenes']`, preload.js:128).
- **useStoryPipeline.js** (Codex #1 — 전용 op lifecycle):
  - `generateSynopsis(title, options)` = `api.storyGenerateSynopsis({ title, options })` 호출; 로컬 `synopsisGenerating`/`synopsisError` 상태 관리.
  - `story:synopsis-delta` 구독 → 별도 `synopsisStreamingText` 누적. 필터는 **전용 `synopsisActiveOpRef`** — 기존 `activeOpRef`(running step 기반)는 side action에 안 잡히므로 재사용 금지. started 신호/operationId로 synopsisActiveOp 세팅.
  - `story:state`의 `synopsisText`/`hasSynopsis`를 상태로 노출(hydrate용).
  - 반환 객체에 `generateSynopsis`, `synopsisStreamingText`, `synopsisGenerating`, `synopsisText`/`hasSynopsis` 추가.

### 3.5 UI (src/components/story/StoryView.jsx + StoryStepper.jsx)  ← **.jsx** (Codex #8)
- **scriptPhase**: `'setup' | 'synopsis' | 'editor'` (기존 setup|editor 확장).
- **StoryStepper.jsx**: `showSynopsis` prop.
  - true면 setup 뒤·script 앞에 synopsis 게이트 탭 렌더(무배지, `SYNOPSIS_KEY`/`SYNOPSIS_META` = { icon:'◈'(또는 유사), label:'시놉시스' }, setup pill 렌더 로직 미러). false면 미렌더.
  - 클릭 시 `onStepClick('synopsis')`.
- **표시 조건 — durable state 기반** (Codex #4, "paste mode flag"는 실존 안 함):
  - 기존/재오픈 프로젝트: `state.input?.type === 'title'`일 때만 true. pasted/imported면 false — **leftover `synopsis.md`가 pill을 강제하지 못하게** (input.type 우선).
  - start 전 로컬 setup: `handleSetupStart`의 seed 판단(`shouldUsePastedScript`)과 동일 로직으로 제목 모드면 true, 붙여넣기면 false.
- **라우팅 leak 차단** (Codex #3 — BLOCKER):
  - `handleStepClick`에 `key === 'synopsis'` 명시 분기 추가: `setViewedStep('script')` + `setScriptPhase('synopsis')` (generic path로 새서 scriptPhase가 clear되지 않게, setup 분기 미러).
  - `stepperActive`: `scriptPhase==='synopsis'`이면 synopsis 탭 active (StoryView:237 setup 처리 미러).
  - **bottom generic controls suppress**: 현재 `!(displayStep==='script' && scriptPhase==='editor')`일 때 하단 컨트롤 렌더(StoryView:1298) → synopsis phase에서도 "start script from title" 액션이 노출돼 게이트를 우회할 수 있음. synopsis phase에선 generic 컨트롤을 숨기고 synopsis 전용 버튼만 노출.
- **흐름**:
  - setup "시작"(제목만, `handleSetupStart`→제목 분기) → `setScriptPhase('synopsis')` + `pipeline.generateSynopsis(title, options)` 호출. 스트리밍 텍스트를 편집 가능 PromptInput에 표시(대본 편집기 UX 미러).
  - synopsis 패널 버튼:
    - **[이 시놉시스로 대본 생성]** → `start('script', { input:{type:'title',title}, options, synopsis: 편집본 })` + `setScriptPhase('editor')`. **편집본이 공백이면 비활성**(hidden skip 방지, Codex #5).
    - **[시놉시스 다시]** → `pipeline.generateSynopsis` 재호출(regenerate).
    - **[설정으로]** → `setScriptPhase('setup')` (0번 설정 탭).
  - 붙여넣기(`handlePasteStart`)/이어쓰기 → `setScriptPhase('editor')` 직행 (synopsis skip, 현행).
- **재오픈 hydrate**:
  - `steps.script.status==='done'` → editor (현행).
  - script 미완 + `hasSynopsis`(hydrate payload) + `state.input.type==='title'` → `scriptPhase='synopsis'` 복원.
  - 임포트/pasted(`input.type!=='title'`) → editor.
- **i18n** (src/locales/{ko,en}.js):
  - `story.step.synopsis` = 시놉시스 / Synopsis.
  - `story.synopsis.*`: 패널 제목, 3버튼 라벨, 생성 중/placeholder 안내. (스토리 기능은 이미 `story:` 객체로 로컬라이즈 — inline 폴백 아님.)

## 4. TDD 슬라이스 (RED → GREEN 순서)

각 슬라이스는 실패 테스트 먼저 작성 → 최소 구현 → GREEN → (필요시)리팩터. 기존 테스트 갱신은 옛 동작 고정분만.

1. **엔진 + 프롬프트 + 라우터**
   - `buildSynopsisPrompt(input, opts)`: 제목·언어·metaPrompt 반영, 줄글 개요 지시 포함, 대사/씬 미포함. (prompts 단위)
   - `buildScriptPrompt` synopsis 주입: `opts.synopsis` 있으면 컨텍스트 포함, 없으면 현행 동일(회귀 고정).
   - `generateSynopsis`(3 엔진): onDelta 누적 → `{synopsisMd}` 반환, signal abort. **각 엔진 자기 injection**(Claude queryImpl / Gemini fetchImpl / Codex runText).
   - **storyLlmRouter**: `generateSynopsis` 노출 + engine dispatch(claude/codex), 미구현 어댑터 에러. (Codex #6)
2. **스텝머신**
   - `machine.generateSynopsis({title,options})`: metaPrompt 로드 옵션 빌드, `story:synopsis-delta` emit(전용 opId), `synopsis.md` **+ `state.input`(title/options)** 저장, step status 불변, 반환값. busy/abort guard. (llm/store mock; Codex #1/#2/#7)
   - `script` 스텝 synopsis 수용: params.synopsis(trim) 우선→저장 후 사용 / effective type==='title'일 때만 synopsis.md 폴백 / pasted·continue는 폴백 안 함 / 둘 다 없으면 미주입. generateScript에 opts.synopsis 전달 검증. (Codex #5)
   - hydrate payload: open/getState/story:state에 `synopsisText`/`hasSynopsis` 포함. (Codex #2)
   - 회귀: continue/pastedScript 분기 synopsis 미관여, STEP_ORDER/DOWNSTREAM 불변.
3. **IPC/hook 배선**
   - story-api `story:generate-synopsis` → machine.generateSynopsis 위임.
   - preload valid 화이트리스트에 synopsis-delta 포함.
   - useStoryPipeline: `generateSynopsis` 호출, `synopsis-delta` 구독→`synopsisStreamingText` 누적, **전용 `synopsisActiveOpRef` 필터**(기존 activeOpRef 재사용 금지), `synopsisText`/`hasSynopsis` 노출. (Codex #1)
4. **UI**
   - StoryStepper.jsx `showSynopsis`: `input.type==='title'`(또는 pre-start 제목 seed)일 때만 synopsis 탭 렌더, pasted/imported·leftover synopsis.md면 미렌더, 클릭 콜백. (Codex #4)
   - StoryView: `handleStepClick('synopsis')` → viewedStep='script'+phase='synopsis'(leak 차단). setup 제목 시작 → synopsis phase 전이 + generateSynopsis 호출. synopsis phase에서 bottom generic 컨트롤 suppress. [대본 생성](공백 비활성)→start('script',{synopsis}) + editor 전이. [설정으로]→setup. 붙여넣기→editor 직행(synopsis 미호출). 재오픈 hydrate 분기(hasSynopsis+input.type==='title'). (Codex #3)

## 5. 변경 파일 요약

- `electron/api/llm/prompts.js` — buildSynopsisPrompt, buildScriptPrompt 확장
- `electron/api/llm/{llmClaude,llmGemini,llmCodex}.js` — generateSynopsis (엔진별 injection)
- `electron/api/llm/storyLlmRouter.js` — **METHOD_OPTION_INDEX에 generateSynopsis:1** (Codex #6)
- `electron/story/stepMachine.js` — generateSynopsis side action(metaPrompt·전용 op·state.input 저장), synopsis.md 저장, script 스텝 synopsis 수용(title 폴백 한정), hydrate payload(synopsisText/hasSynopsis)
- `electron/ipc/story-api.js` — story:generate-synopsis 핸들러
- `electron/preload.js` — storyGenerateSynopsis + synopsis-delta 화이트리스트
- `src/hooks/useStoryPipeline.js` — generateSynopsis, synopsisStreamingText, 전용 synopsisActiveOpRef, synopsisText/hasSynopsis
- `src/components/story/StoryView.jsx` — scriptPhase='synopsis', handleStepClick 분기, bottom 컨트롤 suppress, 버튼, hydrate
- `src/components/story/StoryStepper.jsx` — showSynopsis 게이트 탭 (**.jsx**)
- `src/locales/{ko,en}.js` — story.step.synopsis, story.synopsis.*
- 각 대응 테스트 (`tests/` 미러)

## 6. 비목표 (YAGNI)

- 파이프라인 실행 스텝으로 승격, DOWNSTREAM 연쇄 무효화 — 안 함.
- 시놉시스 스킵/자동 무효화 — 안 함.
- 자동 진행(전체 진행)은 scenes부터라 시놉시스/대본과 무관 — 무변경.
