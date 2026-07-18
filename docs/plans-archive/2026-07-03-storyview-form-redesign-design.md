# StoryView 폼/대본 영역 재설계 — 설계 (2026-07-03)

> 실기동 피드백 기반 UX 개선. Story 대본 스텝의 입력 폼 레이아웃, 모델/길이 옵션, 대본 표시·편집
> 영역을 개선한다. 대상 파일은 `src/components/story/StoryView.jsx` / `StoryView.css`,
> `src/components/PromptInput.jsx`(매개변수화), `electron/api/llm/prompts.js`(길이 지시).

## 배경 / 스코프

실기동에서 나온 4개 개선을 한 묶음으로 처리(모두 대본 스텝 폼·대본 영역이라 서로 얽힘):
1. 폼 레이아웃 — 제목 full width + 옵션 행 분리
2. 모델 선택 드롭다운 (Claude Opus / Sonnet)
3. 길이 입력 — 값 + 단위(언어 연동)
4. 대본 표시·편집을 `PromptInput` 재사용(줄 수 + 문자 수)

**비목표**: Codex 등 Claude 외 엔진 통합(별도 작업), 대본 칸/붙여넣기 칸 통합, 단위 자동 환산.

---

## 1. 폼 레이아웃

현재 [`story-title-form`](../../../src/components/story/StoryView.jsx#L119)은 제목/장르/길이/언어를 한 컨테이너에 flex-wrap으로 나열. 이를 두 행으로 분리:

- **title-row**: 제목 input — **full width** 단독.
- **options-row**: `장르▼` · `모델▼` · `언어` · `[길이 값][단위▼]` — flex-wrap.

CSS: `.story-title-form`을 `.story-title-row`(제목) + `.story-options-row`(나머지)로. `.story-input`은 유지하되 제목은 `flex: 1 1 100%`.

## 2. 모델 선택 드롭다운

- StoryView에 `model` state 추가(기본 `'claude-opus-4-8'`).
- 드롭다운: `Opus 4.8`(값 `claude-opus-4-8`) / `Sonnet 5`(값 `claude-sonnet-5`). `aria-label`="모델".
- `handlePrimaryAction`의 script 분기에서 `options.model`로 전달. → stepMachine이 `state.input.options`에 저장하므로 **씬분리/프롬프트 스텝도 동일 모델**을 쓴다(파이프라인 일관).
- `llmClaude`는 이미 `opts.model` 오버라이드 지원(`DEFAULT_MODEL='claude-opus-4-8'`). 미선택 경로에도 기본이 opus라 안전.
- 붙여넣기 경로(`handlePasteStart`)도 `options.model` 포함.

## 3. 길이 입력 (값 + 단위)

- StoryView state: `lengthValue`(기본 `'10'`), `lengthUnit`(기본 언어 연동 — ko `'min'`, 그 외 `'min'`).
- UI: `[값 input][단위 select]`.
  - 단위 옵션은 **언어 값으로 결정**: `language === 'en'` → `min` / `words`, 그 외(ko 등) → `min`(분) / `chars`(자).
  - 표시 라벨: ko `분`/`자`, en `min`/`words`. 내부 값은 `min`/`chars`/`words`.
- `options`에 `{ lengthValue, lengthUnit }` 전달(기존 `targetMinutes` 대체).
- **프롬프트 반영** — [`buildScriptPrompt`](../../../electron/api/llm/prompts.js) 수정:
  - `min` → "약 {N}분 분량의 나레이션 대본"
  - `chars` → "약 {N}자 분량의 나레이션 대본"
  - `words` → "a narration script of about {N} words"
  - 기존 `opts.targetMinutes` 사용부는 `opts.lengthValue`/`opts.lengthUnit` 기반으로 교체. (Gemini/Claude 공유 빌더이므로 두 엔진 동일 적용.)
- 자동 환산 없음 — 값은 사용자가 직접 입력. 언어를 en으로 바꾸면 단위 옵션만 min/words로 바뀜(값 유지).
- `targetMinutes`를 참조하던 다른 코드(예: [timing.js](../../../electron/story/timing.js) 폴백 타임라인)는 이 스텝 입력과 무관(낭독 추정은 글자수 기반) — 영향 없음 확인 필요.

## 4. 대본 표시·편집 — PromptInput 재사용

현재 대본 영역: `isRunning ? story-script-stream(div) : story-script-textarea(textarea)`.

- **생성 중(`isRunning`)**: 기존 `story-script-stream` div 유지 — 스트리밍 델타를 가볍게 실시간 표시(PromptInput은 value 변경마다 Lexical 전체 재파싱이라 스트리밍에 부적합).
- **완성/편집(`!isRunning`)**: `textarea`를 [`PromptInput`](../../../src/components/PromptInput.jsx)으로 교체.
  - props: `value={scriptDraft || streamingText}`, `onChange={setScriptDraft}`, `references={[]}`, `placeholder`, 그리고 아래 신규 prop.

### PromptInput 매개변수화 (공용 컴포넌트 — 기본값은 기존 동작 불변)

- `disableMentions`(기본 `false`): `true`면 `@멘션` 관련 플러그인(`BeautifulMentionsPlugin`/`MentionLiveTransformPlugin`/`UnknownMentionTextNode` 빨간 물결)을 **비활성**. 대본에 `@`/이메일이 있어도 밑줄이 안 그어진다.
- `showCharCount`(기본 `false`): `true`면 footer의 줄 수 옆에 **문자 수**도 표시(`text.length`). 기존 사용처(이미지 프롬프트 등)는 false라 영향 없음.
- 대본 창은 `disableMentions showCharCount`로 사용 → footer에 **줄 수 + 문자 수** 동시 표시.

## 데이터 흐름 (대본 생성)

```
StoryView: model/genre/language/lengthValue/lengthUnit
  → start('script', { input:{type:'title',title}, options:{ genre, language, model, lengthValue, lengthUnit } })
  → stepMachine script: opts = { apiKey, model, metaPrompt, ...options }
  → buildScriptPrompt(input, opts)  // 길이 단위별 지시 생성
  → llmClaude.generateScript(..., { model })  // 선택 모델
생성 중: streamingText → story-script-stream div
완성 후: scriptDraft/streamingText → PromptInput(disableMentions, showCharCount)
```

## 테스트 (TDD)

- **StoryView 레이아웃**(컴포넌트): 제목 행 + 옵션 행, 모델 드롭다운(opus/sonnet, 선택→`options.model` 전달), 길이 값+단위(단위 옵션이 language로 바뀜), 붙여넣기 경로 model 포함.
- **prompts.js**: `buildScriptPrompt`가 `lengthUnit` 별로 올바른 지시(min/chars/words) 생성.
- **PromptInput 매개변수화**: `disableMentions=true`면 멘션 플러그인/빨간줄 미적용, `showCharCount=true`면 문자 수 표시. 기본값(false)일 때 기존 동작·기존 테스트 회귀 없음.
- **대본 창 분기**: `isRunning`이면 stream div, 아니면 PromptInput 렌더.
- 위치는 CLAUDE.md TDD 규칙대로 `tests/` 미러링.

## 열린 결정 (사소 — 구현 중 확정)

- 언어 필드를 자유 텍스트 input 유지 vs `ko`/`en` 드롭다운화(단위 연동 명확성). 이번엔 **input 유지**, 단위는 `language==='en'` 판정. 향후 드롭다운화는 범위 밖.
- Sonnet 모델 ID 정확값(`claude-sonnet-5`)은 구현 시 [claude-api 스킬]로 재확인.
