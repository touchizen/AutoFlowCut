# Story 대본 스텝 재설계 — 설계 (2026-07-03)

> 실기동 피드백 기반. 대본 스텝을 **2단계 화면(설정 → 대본 작업)**으로 분리하고, 제목 자동생성·
> 이어쓰기·편집 반영·씬분리 기준(5~10초)·언어 드롭다운을 추가한다. Codex R1/R2 findings 반영
> (데이터 모델 확정 + 화면 phase로 버튼 상태 단순화).
> 대상: `StoryView.jsx`(+css), `PromptInput.jsx`(hideTip), `llmClaude.js`·`prompts.js`,
> `stepMachine.js`, `story-api.js`, `useStoryPipeline.js`.

## 배경 / 스코프

대본 스텝을 **진입(설정) 화면**과 **대본 작업 화면**으로 나눈다. 붙여넣기 칸/정적 버튼의 애매함을
화면 분리로 없앤다.

**비목표**: 엔진 선택, W1/W2(시놉시스), 이어쓰기 자동 판단.

---

## 0. 데이터 모델 (Codex R1/R2 — 먼저 확정)

### 0.1 대본 단일 source of truth — `scriptText`
StoryView는 대본을 **하나의 state `scriptText`**로 관리한다(scriptDraft/pastedScript/streamingText 혼재 제거).
- 초기/재오픈: main이 `story/script.md`를 읽어 payload로 내려주면 그 값으로 초기화(§0.2).
- 편집: PromptInput `onChange` → `scriptText`.
- 판정: "대본 있음" = `scriptText.trim()` 비지 않음. 화면 phase 결정(§1)·제목 자동생성 판정에 사용.
- `streamingText`는 **생성 중 preview 전용**. 완료 커밋 소스가 아니다(§0.3).

### 0.2 script.md ↔ renderer 동기화 (R1-F3)
- `stepMachine.open()`/`getState()` payload에 **`scriptText`(디스크 `story/script.md` 내용) 추가**
  (현재 `state`,`scenes`만 — [stepMachine.js:121/128]). 없으면 `''`.
- `useStoryPipeline`이 `scriptText`를 상태로 노출(open 응답 + `story:state`). StoryView가 초기값으로 사용.
- → 재오픈 시 script.md가 있으면 **대본 작업 화면으로 바로** 복원(§1).
- **폼 hydrate (R4-2)**: StoryView는 `payload.scriptText`와 함께 **`state.input.title`/`state.input.options`에서
  제목·장르·모델·언어·길이 폼을 복원**한다(값 없으면 로컬 기본값). → 재오픈한 프로젝트가 현재 설정을 UI에
  반영해, 사용자가 바로 '분리시작'해도 UI 기본값(ko/min/opus/bespoke)이 옛 설정을 덮지 않는다.

### 0.3 생성 완료 커밋 — main 저장값이 진실 (R2-3)
- 생성/이어쓰기 스트리밍이 끝나면 **main이 저장한 최종 대본이 진실**이다. main은 Claude result의
  `scriptMd`(이어쓰기는 이어진 **전체**)를 `script.md`에 저장하고, **완료 `story:state` payload에
  `scriptText`(저장값)를 실어 보낸다**. renderer는 `payload.scriptText`로 `scriptText`를 커밋한다.
- `streamingText`(및 `baseScript + streamingText`)는 preview 표시 전용 — renderer delta 재조립 금지.

### 0.4 저장+씬분리 단일 액션 + options 보존 (R2-2, R2-4, R1-F7)
- '분리시작' = **`start('scenes', { scriptOverride: scriptText, options })`** 단일 액션.
- stepMachine `scenes` 스텝: `params.scriptOverride`가 있으면 **먼저 `script.md`를 그 값으로 저장**하고,
  **`params.options`가 오면 `state.input.options`를 그 값으로 갱신**한다(현재 설정 반영). `state.input`이
  없으면(직접 임포트) `state.input = { type:'manual', options: params.options }`로 초기화.
- **R3-3 — options는 "현재 설정 반영"으로 통일**: 사용자가 editor의 `[⚙ 설정으로]`에서 language/model/length를
  바꾸면 그 값이 분리시작 payload로 넘어와 `state.input.options`를 덮고, 씬 분리(및 이후 프롬프트)가 그
  **현재 설정**을 쓴다("생성 당시 고정"이 아님). → UX와 실행 계약이 일치.
- **빈 대본 가드 (R4-1)**: `scriptText.trim()`이 비면 editor의 `[다시쓰기]`/`[이어쓰기]`/`[분리시작]`을
  **비활성**한다. main `scenes` 스텝도 `scriptOverride`가 공백뿐이면 `script.md`를 **덮지 않고 에러**
  (기존 대본을 빈 파일로 날리지 않음). scenes는 대본 없으면 실패하는 기존 계약([stepMachine.js:89])과 정합.

## 1. 화면 구조 (2-phase)

StoryView의 script 스텝 패널이 두 phase를 가진다. renderer state `scriptPhase: 'setup' | 'editor'`.
- **초기**: `scriptText.trim()`이 있으면(재오픈 복원) `'editor'`, 없으면 `'setup'`.
- 전환: '시작'/'임포트 후 시작' → `'editor'`. '설정으로'(뒤로) → `'setup'`.
- **표시 라우팅 (R3-1)**: script가 `done`이 되면 기존 `computeCurrentStep`은 `currentStep`을 `scenes`로
  넘기지만, **`scriptPhase`가 남아 있는 동안(setup/editor)에는 `displayStep`을 `'script'`로 강제**해 대본
  작업 화면을 유지한다. '분리시작'을 눌러 `scenes`를 실행할 때 비로소 `scriptPhase`를 벗고(=`null`)
  스텝퍼가 scenes/prompts 패널로 진행한다. 스텝퍼에서 done된 script를 다시 클릭하면 이 대본 작업 화면으로
  돌아온다(scriptPhase='editor' 재설정).

### A. 설정 화면 (`scriptPhase==='setup'`)
- **옵션을 세로로, 각 설명과 함께** 배치:
  - 장르: 이야기 유형 — `yadam`(한국 야담/설화) · `dark-history`(서양 다크) · `bespoke`(범용, 기본)
  - 모델: 생성 AI — `Opus 4.8`(고품질, 기본) · `Sonnet 5`(균형)
  - 언어: 출력 언어 — `ko`(한국어) · `en`(English) **드롭다운**
  - 길이: 대본 분량 — `[값][단위▼]` (ko: 분/자, en: min/words)
- **제목 입력** 필드.
- **대본 임포트**: 작은 **drag&drop 영역**(`.txt`/`.md` 파일) + **텍스트 붙여넣기** 겸용 → 로드 시 `scriptText`에 채움.
- **[✨ 시작]** — 분기:
  - `scriptText`(임포트/붙여넣기) 있으면 → 임포트 대본을 확정하고 **editor**로 (LLM 생성 없음; §2-임포트).
  - 없고 제목 있으면 → 제목으로 **대본 생성** 시작 → editor(스트리밍).
  - 둘 다 없으면 시작 비활성.

### B. 대본 작업 화면 (`scriptPhase==='editor'`)
- **대본 칸**: 생성 중(`isRunning`)엔 `story-script-stream` div(스트리밍 preview), 그 외 `PromptInput`
  (`value=scriptText`, `disableMentions showCharCount hideTip`).
- 버튼(하단):
  | 상태 | 버튼 |
  |---|---|
  | 생성 중 | `[⏹ 중단]` 단독 |
  | 대기 | `[다시쓰기] [이어쓰기] [분리시작]` + `[⚙ 설정으로]` |
- `[⚙ 설정으로]` = setup 화면(옵션/제목 조정). `scriptText`는 유지.

## 2. 버튼/동작 데이터 흐름

```
시작(제목):    start('script',{input:{type:'title',title},options}) → generateScript(스트리밍)
              → editor phase → done 시 scriptText=payload.scriptText 커밋
시작(임포트):  start('script',{pastedScript:scriptText,options}) → main이 script.md 저장(LLM 없음)
              → editor phase (scriptText 유지)
다시쓰기:      (제목 비면 title=await generateTitle(scriptText)) →
              start('script',{input:{type:'title',title},options}) → 성공 시 scriptText 교체(§5)
이어쓰기:      baseScript=scriptText → start('script',{continue:baseScript,options}) → continueScript
              → 표시 baseScript+streamingText(preview) → done 시 scriptText=payload.scriptText,
                abort 시 scriptText=baseScript(롤백)
분리시작:      (제목 비면 title=await generateTitle(scriptText); setTitle) →
              start('scenes',{scriptOverride:scriptText,options}) → scenes(script.md 갱신+분리)
```

## 3. 제목 자동생성 (generateTitle) — 전용 액션 (R2-2)

- **main 전용 LLM.** `story:start`(결과 버리고 `{operationId}`만 반환 + DOWNSTREAM 전제)로 태우지 않는다.
  → **전용 액션 `machine.generateTitle(scriptMd)` + 전용 IPC `story:generate-title`**. `{ title }`을 응답 반환.
- 흐름: '분리시작'/'다시쓰기'에서 **제목 비고 `scriptText` 있으면**:
  `const { title } = await pipeline.generateTitle(scriptText)` → 반환 `title`을 **로컬 변수로** 받아
  제목 state 세팅 + 이어지는 start payload에 직접 사용(React state 순서 비의존).
- 신규 `llmClaude.generateTitle(scriptMd, opts, {signal,queryImpl}) -> { title }`(논스트리밍),
  `prompts.buildTitlePrompt`.
- 실패: 토스트 + 진행 중단(제목 없이 분리/재생성 안 함).

## 4. 이어쓰기 (continueScript) — base+delta (R1-F4, R2-3)

- '이어쓰기' 시작 시 `baseScript = scriptText` 스냅샷. `start('script',{continue:baseScript,options})`.
- stepMachine `script` 스텝: `params.continue`면 `continueScript(baseScript, opts, {onDelta,signal})` 스트리밍.
  main은 이어진 **전체**를 `script.md`에 저장, 완료 payload에 `scriptText`(전체).
- **표시(생성 중)**: `baseScript + streamingText`(preview). **완료 커밋**: `scriptText = payload.scriptText`
  (§0.3와 동일 — base+delta 재조립 금지). **abort**: `scriptText = baseScript` 롤백.
- 신규 `llmClaude.continueScript(existingScript, opts, {onDelta,signal,queryImpl}) -> { scriptMd }`(이어진 전체),
  `prompts.buildContinuePrompt`("톤·흐름 유지, 앞부분 반복 금지, 이어서").

## 5. 다시쓰기 — 트랜잭션 경계 (R2-6)

- '다시쓰기' = 현재 제목/옵션으로 **재생성**(editor에 머문 채 스트리밍). 클릭 즉시 대본 폐기 안 함.
- 재생성 **성공 시 교체**(main이 새 scriptMd 저장 → payload.scriptText 커밋), 실패 시 옛 대본 유지 +
  script error(기존 stepMachine 동작 계승 — [stepMachine.js:145/161], 테스트 고정). 제목 비면 §3 먼저.

## 6. 씬 분리 기준 + 언어 드롭다운

- `buildSplitPrompt`: "6~10초" → **"의미 단위로 나누되 각 씬은 낭독 시 5~10초"**(ko 약 28~55자, en ~75~150 chars).
- 언어: setup 화면 언어를 `<select>`(`ko`/`en`), 길이 단위 옵션이 연동. 기본 `ko`.

## 컴포넌트 / 인터페이스

- `stepMachine.open()/getState()` payload에 `scriptText`. `scenes` 스텝 `params.scriptOverride`(+manual 초기화).
  `script` 스텝 `params.continue`·`params.pastedScript` 분기. 전용 액션 `generateTitle(scriptMd)->{title}`.
- `story-api.js`: 신규 IPC `story:generate-title`(guarded). **`preload.js`: `storyGenerateTitle` 노출**
  (renderer는 `window.electronAPI.storyGenerateTitle`로 호출 — 기존 storyOpen/storyStart/storyAbort 패턴과 동일, R3-2).
- `useStoryPipeline`: `scriptText` 노출(open/story:state), `generateTitle(scriptMd)` 메서드(→ `window.electronAPI.storyGenerateTitle`).
- `llmClaude.generateTitle`(논스트리밍), `continueScript`(스트리밍) — llmClaude 계약(keyless, abort→'Aborted').
- `prompts.buildTitlePrompt`, `buildContinuePrompt`, `buildSplitPrompt`(5~10초).
- `PromptInput` `hideTip`(기본 false).
- StoryView: `scriptPhase` 상태, setup(세로 옵션+설명+제목+drag&drop) / editor(대본칸+3버튼) 분리,
  `scriptText` 단일 상태, 언어 select, drag&drop 파일 리더(.txt/.md → text).

## 에러 처리

- generateTitle/continueScript: llmClaude 계약(keyless, abort→'Aborted', 실패→사용자 메시지).
- 제목 자동생성 실패: 토스트 + 진행 중단.
- 이어쓰기 abort: `scriptText=baseScript` 롤백.
- drag&drop: `.txt`/`.md` 외 파일/읽기 실패 시 토스트, `scriptText` 미변경.
- scriptOverride 저장 실패: 씬분리 중단 + 에러(saveText 가드).

## 테스트 (TDD)

- llmClaude: generateTitle(제목 1줄), continueScript(스트리밍/abort/전체 반환).
- prompts: buildTitlePrompt/buildContinuePrompt/buildSplitPrompt(5~10초, ko/en).
- stepMachine: `scriptText` payload(open/getState), `scenes` scriptOverride→script.md 저장+manual options,
  `script` continue·pastedScript 분기, generateTitle 액션.
- story-api: `story:generate-title` IPC guarded.
- useStoryPipeline: scriptText 동기화, generateTitle.
- StoryView: phase 전환(setup↔editor, 재오픈 시 editor 복원), 시작 분기(제목 vs 임포트), drag&drop 로드,
  버튼(생성중 중단 / 대기 3버튼), 제목 자동생성 트리거(로컬 변수), 언어 select, hideTip.
- 회귀: 기존 script/scenes/prompts, PromptInput 기존 사용처, 다시쓰기 실패 시 옛 대본 잔존.

## 변경 이력

- **R1 (Codex 7)**: scriptText 단일 source / script.md↔renderer 동기화 / 단일 액션 + options / 이어쓰기
  base+delta / 제목 자동생성 계약 / 다시쓰기 트랜잭션 / 편집 options 보존.
- **R2 (Codex 4 + 사용자 화면분리)**: ①버튼 상태 머신을 **2-phase 화면**(setup/editor)으로 대체 — currentStep
  충돌 해소. ②generateTitle 전용 액션+IPC 확정. ③완료 커밋을 main `payload.scriptText`로 통일(delta 재조립
  금지). ④scenes에 options 전달 + `state.input` 없을 때 `manual` 초기화. + 설정 화면 세로 옵션·설명, drag&drop 임포트.
- **R3 (Codex 3)**: ①`scriptPhase` 있는 동안 `displayStep`='script' 강제(대본 작업 화면 유지, 분리시작 때
  scenes 진행). ②`preload.js` `storyGenerateTitle` 노출(renderer 호출 경로). ③scenes options를 "현재 설정
  반영"으로 통일(설정으로에서 바꾼 옵션이 씬분리에 적용, state.input.options 갱신).
- **R4 (Codex 2)**: ①빈 대본 가드 — `scriptText` 공백이면 editor 3버튼 비활성 + main scenes `scriptOverride`
  trim guard로 기존 대본 보존. ②재오픈 시 `state.input.title/options`에서 폼 hydrate(현재 설정 복원, UI
  기본값이 옛 설정 안 덮음).
