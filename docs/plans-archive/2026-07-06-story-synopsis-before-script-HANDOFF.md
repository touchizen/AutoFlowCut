# Story — 제목→시놉시스→대본 게이트 (핸드오프/설계 스케치)

**날짜**: 2026-07-06
**브랜치**: `feature/story-pipeline` (HEAD `08f3b00`, working tree clean, 미푸시)
**상태**: 미착수 — 다음 세션에서 brainstorm→spec→TDD

## 0. 목표 (한 줄)

**제목만 입력**해서 대본을 생성하는 경로에서, **대본(시나리오) 생성 전에 시놉시스를 먼저 보여주고** 사용자가 확인/편집한 뒤 그 시놉시스로 대본을 쓰게 한다. **임포트/붙여넣기 대본은 현행 그대로**(형식 맞으면 바로 편집기 → 씬 분리) — 시놉시스 단계 없음.

## 1. 현재 흐름 (앵커)

- **UI**: `src/components/story/StoryView.jsx`
  - `scriptPhase` state: `'setup' | 'editor'` (설정 폼 ↔ 대본 편집기). 시놉시스 게이트를 여기 **`'synopsis'` phase로 추가**하는 게 자연스러움.
  - setup 폼 "✨ 시작"(`handleSetupStart`) → 제목만 있으면 `startScriptFromTitle()` → `start('script', { input:{type:'title',title}, options })`. scriptText(붙여넣기) 있으면 `handlePasteStart()`(pastedScript 경로).
  - `handlePrimaryAction`(currentStep==='script') → `startScriptFromTitle()`.
  - `generateTitle`은 pipeline의 **side action**(스텝 아님) — 시놉시스도 이 패턴을 따르면 됨(`ttsPreview`/`generateTitle`처럼 IPC side action).
- **스텝머신**: `electron/story/stepMachine.js` `script` 스텝(~L495)
  - `params.continue` / `params.pastedScript` → early return(각각 이어쓰기/임포트, 시놉시스 대상 아님).
  - 그 외(제목 생성) → `llm.generateScript(state.input, opts, { onDelta, signal })` → `script.md` 저장.
  - `state.input = { type:'title'|'pasted', title, options }`.
- **LLM 엔진**: `electron/api/llm/{llmClaude,llmGemini,llmCodex}.js` `generateScript(input, opts, {onDelta,signal})`(스트리밍). 프롬프트 빌더 `buildScriptPrompt(input, opts)`(prompts.js) — `input.title` 사용.
- **story-engine 스킬**엔 이미 W1(스토리 설계)→W2(시놉시스)→W3(집필) 개념 있음 — 앱엔 아직 시놉시스 없음.

## 2. 권장 설계 (파이프라인 스텝 추가 X, script phase로)

시놉시스를 **새 파이프라인 스텝(스텝퍼 pill)로 만들지 말 것** — 임포트 경로는 시놉시스가 없어 조건부 pill이 지저분해짐. 대신 **script 흐름의 pre-script phase**로.

```
setup(제목) --시작--> [synopsis phase: 시놉시스 생성/편집] --"이 시놉시스로 대본 생성"--> [editor: 대본 스트리밍] --분리시작--> scenes ...
                     (제목 경로만)                                                     (기존)
임포트/붙여넣기: setup --> editor (시놉시스 건너뜀, 현행)
```

### 2.1 LLM 엔진 (3개 다: claude/gemini/codex)
- `generateSynopsis(input, opts, { onDelta, signal }) → { synopsisMd }` (스트리밍, generateScript 미러).
- `prompts.js buildSynopsisPrompt(input, opts)` — "제목으로 로그라인 + 3~5문장 시놉시스(도입/전개/전환/결말 방향)를 {language}로. 장르/톤/길이 반영. 대사·씬 없이 줄글 개요." metaPrompt(장르) 포함.
- `buildScriptPrompt(input, opts)` 확장: `opts.synopsis`(또는 input.synopsis) 있으면 "아래 시놉시스를 따라 대본을 쓰라"로 컨텍스트 주입.

### 2.2 스텝머신 (side action + script 입력 확장)
- **시놉시스 생성 = side action**(스텝 아님, generateTitle 패턴): `machine.generateSynopsis({ title, options })` → `generateSynopsis` 스트리밍(story:delta 재사용 or 전용 `story:synopsis-delta`) → `synopsis.md` 저장 → 반환. IPC `story:generate-synopsis` + preload + useStoryPipeline `generateSynopsis`.
- **script 스텝**: `start('script', { input, options, synopsis })`에서 `synopsis`(편집본)를 opts로 실어 `generateScript`에 전달. synopsis 없으면(임포트/이어쓰기/직접) 현행대로.
- `synopsis.md`는 store에 저장(재오픈 hydrate). script 스텝이 synopsis를 안 받으면 저장된 synopsis.md를 폴백으로 읽을지 여부 결정(권장: 명시 전달만 — 단순).

### 2.3 UI (StoryView scriptPhase='synopsis')
- setup "시작"(제목만) → `scriptPhase='synopsis'`; `generateSynopsis` 호출 → 스트리밍 표시(대본 편집기와 유사한 PromptInput 편집 가능).
- synopsis 패널 버튼: **[대본 생성]**(이 시놉시스로 → `start('script',{input,options,synopsis:편집본})`, `scriptPhase='editor'`), **[시놉시스 다시]**(regenerate), **[설정으로]**(0번 설정 탭).
- 재오픈: script done이면 editor(현행). synopsis.md만 있고 script 미완이면 synopsis phase 복원.
- 붙여넣기/임포트(`handlePasteStart`)·이어쓰기: `scriptPhase='editor'` 직행(시놉시스 skip) — 현행.
- i18n: `story.synopsis.*` ko+en(스토리 기능은 이미 `story:` 객체로 로컬라이즈됨 — inline 폴백 아님).

## 3. 엣지/결정 사항 (spec 때 확정)
- 시놉시스 편집 후 대본 생성 → 시놉시스 재편집 시 대본 stale 처리? (권장: 대본은 사용자가 [다시쓰기]로 갱신, 자동 무효화 X.)
- 시놉시스 없이 바로 대본으로 건너뛰는 "skip" 옵션 줄지? (권장: 안 줌 — 제목 경로는 항상 시놉시스 게이트. 필요하면 토글.)
- synopsis 길이/형식(로그라인+개요) 기본값.
- 자동 진행(전체 진행)과의 상호작용: 현재 전체 진행은 scenes부터 — 시놉시스/대본은 사용자 게이트라 무관(그대로 두기).

## 4. 변경 파일(예상)
- `electron/api/llm/prompts.js`(buildSynopsisPrompt, buildScriptPrompt synopsis 컨텍스트)
- `electron/api/llm/{llmClaude,llmGemini,llmCodex}.js`(generateSynopsis)
- `electron/story/stepMachine.js`(generateSynopsis side action + synopsis.md 저장 + script가 synopsis 수용)
- `electron/ipc/story-api.js` + `electron/preload.js` + `src/hooks/useStoryPipeline.js`(story:generate-synopsis 배선)
- `src/components/story/StoryView.jsx`(scriptPhase='synopsis' 패널/버튼, 제목 경로 라우팅)
- `src/locales/{ko,en}.js`(story.synopsis.*)
- 테스트: 각 미러(엔진 generateSynopsis, 프롬프트, 스텝머신 synopsis+script 수용, StoryView synopsis phase).

## 5. 작업 방식 (다음 세션 반드시)
- **brainstorm → spec(docs/superpowers/specs, gitignore=로컬) → Codex 방향 리뷰 findings 0 → TDD(RED→GREEN) → Codex 코드 리뷰 findings 0**.
- Codex: `mcp__codex__codex` **model:'gpt-5.5', config.model_reasoning_effort:'xhigh'** (ChatGPT 계정 — gpt-5.5-codex/5.2 불가).
- **커밋 메시지 영어**(레포 컨벤션). 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. 커밋은 사용자 OK 후. 푸시는 사용자 결정.
- 어려운 서브문제 → Fable 5 subagent(model:'fable'). 관련 메모리 [[autoflowcut-story-m2a-audio]] [[autoflowcut-story-m3-review-loop]].

## 6. 이번 세션까지 완료(참고)
M2b(SFX)·M3(대본 검토 루프)·V2-A(캐릭터 레퍼런스 @멘션)·자동진행·감정(2줄+TTS 화자만)·narrator self-heal·세션간 Codex LLM 엔진 WIP 커밋 — 전부 커밋됨(영어), 전체 4305 pass, 미푸시.
