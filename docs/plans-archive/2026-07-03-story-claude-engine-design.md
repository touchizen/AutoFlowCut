# Story 파이프라인 Claude 엔진 — 설계 (2026-07-03)

> AutoFlowCut의 Story 대본 파이프라인을 Claude Agent SDK로 구동하고, story-engine 장르
> 메타프롬프트를 주입한다. Gemini(BYOK)를 테스트할 수 없는 환경이라, **키 없이(로컬 Claude
> 로그인) 파이프라인을 끝까지 돌리는 것**이 1차 목적이다.
>
> Codex 교차 리뷰 R1 반영본(8 findings). 변경 이력은 문서 하단 §변경 이력.

## 배경 / 문제

- 현재 Story 파이프라인(대본 → 씬분리 → 프롬프트)은 Gemini(BYOK) 전용이다([llmGemini.js](../../../electron/api/llm/llmGemini.js)).
- 사용자가 Gemini API 키/billing이 없어 **파이프라인을 아예 실행·검증할 수 없다.**
- Claude Agent SDK(`@anthropic-ai/claude-agent-sdk`)는 번들된 claude 바이너리 subprocess라
  **로컬 Claude 구독 로그인이 있으면 API 키 없이 동작**한다 (AutoMovie에서 실증).
- 대본 품질을 위해 AutoFlowCut에 번들된 [story-engine 스킬](../../../skills/story-engine)의
  장르별 메타프롬프트(작법 가이드)를 대본 생성에 주입하고 싶다.

## 최종 목표 (전체 그림 — 2단계에서 완성)

```
제목
→ [W1 스토리 설계]    Claude + 장르 메타프롬프트
→ [W2 시놉시스]       Claude + synopsis-guide + preflight
→ 🛑 사용자 확정 게이트
→ [W3 대본]           Claude 스트리밍 + scenario/narrative/suspense + 확정 시놉시스
→ [씬분리]            Claude + 메타프롬프트
→ [프롬프트]          Claude
```
전 단계 Claude 엔진 + 장르(yadam / dark-history / bespoke) 메타프롬프트.

**이 문서는 1단계(엔진 기반)만 상세화한다.** W1/W2/확정 게이트는 2단계 별도 스펙.

---

## 1단계 스코프 (본 스펙)

기존 파이프라인 3단계(대본 → 씬분리 → 프롬프트)를 **Claude 엔진으로 전환**하고, 대본에 장르
메타프롬프트를 주입한다. 스텝 머신 스텝 구성(script → scenes → prompts)은 그대로 두고 **엔진과
그 주입/기본값만 교체**하므로, 2단계(스텝 추가)와 독립적으로 검증 가능하다.

### 아키텍처

```
StoryView (장르 드롭다운)
   │ start('script', { options:{ genre, language } })
   ▼
stepMachine ──llm 주입(main.js)──▶ llmClaude   (신규, 1단계 기본)
   │                               llmGemini    (기존, 유지)
   │  각 스텝 실행 전 loadMetaPrompt(genre, wave, language) → opts.metaPrompt
   │
   ├─ prompts.js       (신규: 빌더 3종 추출 + 대본 메타 슬롯)   ← 두 엔진 공유
   ├─ schemas.js       (기존 Gemini식) + toJsonSchema()(신규)  ← Claude는 변환본 사용
   └─ metaPrompts.js   (신규: 장르 wave 조합 로더)
```

### 컴포넌트

#### 1. `llmClaude` 엔진 — `electron/api/llm/llmClaude.js` (신규)
[llmGemini.js](../../../electron/api/llm/llmGemini.js)와 **동일 시그니처**로 구현한다:
- `generateScript(input, opts, { onDelta, signal, queryImpl })` → `{ scriptMd }` (스트리밍)
- `splitScenes(scriptMd, opts, ctx)` → `{ scenes, speakers }`
- `writePrompts(scenes, context, opts, ctx)` → `{ scenes }`

(단, 시그니처만 같다고 교체되는 게 아니다 — 주입/기본값 변경은 §컴포넌트 4 참조.)

[AutoMovie vision.mjs](../../../../AutoMovie/server/utils/vision.mjs)에서 이식(검증된 순수 함수):
- `buildClaudeSdkOptions(model, abortController, extra)` — 격리 옵션.
  - `tools: []`, `settingSources: []`, `thinking: { type:'disabled' }`, `maxTurns`.
  - **`skills`**: SDK 타입 주석상 skills 옵션을 **생략하면 "off"가 아니라 CLI 기본이 적용**된다
    (sdk.d.ts). 스토리 생성 품질을 통제하려면 skills를 명시적으로 넘겨야 한다 → 구현 시 SDK가
    허용하는 "비활성" 표현으로 설정하고, 첫 `system/init` 메시지로 실제 비활성화를 검증한다.
- `extractClaudeSdkResult(message)` — result 텍스트 추출 + 에러 throw.
- `bridgeAbortSignal(signal)` — 파이프라인 AbortSignal → SDK AbortController(취소 즉시 전달 + 리스너 정리).

**대본 스트리밍** (신규): `buildClaudeSdkOptions`에 `includePartialMessages: true`를 더하고,
`query()` 루프에서:
- `message.type === 'stream_event'` → `message.event.type === 'content_block_delta'` →
  `event.delta.type === 'text_delta'`의 `event.delta.text`를 `onDelta`로 흘린다.
- 그 외 partial 이벤트(`message_start`/`message_delta`/`content_block_start`/`_stop`/
  `input_json_delta`/`thinking_delta` 등)는 무시(필요 시 debug 로깅).
- **`onDelta` 호출 직전 `signal.aborted`를 확인**해 abort 이후 델타 방출을 차단한다(§stale delta).
- 최종은 `message.type === 'result'`에서 `extractClaudeSdkResult`.
→ 기존 [StoryView](../../../src/components/story/StoryView.jsx)의 `streamingText` UI가 그대로 살아난다.

**씬분리/프롬프트 (structured output)**: Claude Agent SDK는
`outputFormat: { type:'json_schema', schema }` 옵션을 지원하고(sdk.d.ts), result 메시지의
`structured_output` 필드로 스키마에 맞는 구조화 데이터를 돌려준다 → **이걸 1차 수단**으로 쓴다
(프롬프트+파싱이 아니라 SDK가 스키마를 강제). 단:
- 기존 [schemas.js](../../../electron/api/llm/schemas.js)는 **Gemini식 대문자 타입**
  (`OBJECT`/`ARRAY`/`INTEGER`/`STRING`)이라 JSON Schema(`object`/`array`/`integer`/`string`)로
  **변환하는 레이어가 필요**하다 → `toJsonSchema(geminiSchema)` 유틸 신설. schemas.js 원본은
  Gemini용으로 유지하고, Claude는 변환본을 `outputFormat.schema`로 넘긴다.
- **result 메시지 분기 (structured call은 `extractClaudeSdkResult` 재사용 금지)**: `outputFormat`이
  스키마 강제에 실패하면 성공 result가 아니라 **`SDKResultError`**로 온다 — 타입에
  `error_max_structured_output_retries` subtype이 있고(sdk.d.ts), `result`/`structured_output`은
  **성공(subtype `success`) 메시지에만** 존재한다. AutoMovie `extractClaudeSdkResult`는 error result를
  즉시 throw하므로 이걸 그대로 쓰면 폴백/재시도까지 못 간다. → structured 단계는 result 메시지 전체를
  받아 subtype으로 분기한다:
  - `subtype === 'success'`: `structured_output`이 있으면 검증 후 사용, 없으면 `result` 텍스트 폴백
    파싱(코드펜스 ```` ``` ````/서두 설명 텍스트 제거 + `JSON.parse` + 스키마 필수 필드 검증).
  - `subtype === 'error_max_structured_output_retries'`: SDK 스키마 강제 실패 → **`outputFormat` 없이
    "JSON only" 프롬프트로 1회 재요청**(텍스트 파싱 경로).
  - 그 외 에러(인증/모델/abort/실행 실패): 그대로 throw.
  - 위 폴백까지 실패하면 에러(stepMachine error 상태).
  참고: 대본 생성(비-structured)은 기존 `extractClaudeSdkResult` 재사용 OK.

**인증**: 로컬 Claude 로그인. API 키 입력 불필요. 키 미설정이어도 동작해야 한다.

#### 2. 프롬프트 빌더 추출 — `electron/api/llm/prompts.js` (신규)
현재 `buildScriptPrompt`/`buildSplitPrompt`/`buildPromptsPrompt`는 llmGemini.js **내부 함수**라
Claude가 못 쓴다. → `prompts.js`로 추출해 `export`, 두 엔진이 import. llmGemini.js는 이를 참조하도록
수정(동작 불변 — 순수 이동).

- `buildScriptPrompt(input, opts)` 시그니처에 **메타프롬프트 슬롯 추가**: `opts.metaPrompt`가 있으면
  `## CUSTOM INSTRUCTIONS\n{metaPrompt}` 블록을 프롬프트 앞부분에 삽입.
- `buildSplitPrompt`/`buildPromptsPrompt`는 **메타 슬롯 없이 그대로 이동**(1단계에서 씬분리/프롬프트
  메타 주입은 하지 않음 — §열린 결정 7 확정: 씬분리는 6~10초 분할·speaker/emotion 추출 작업이라
  대본 작법 메타와 충돌 소지).

#### 3. 메타프롬프트 로더 — `electron/api/llm/metaPrompts.js` (신규, main process)
번들된 story-engine 메타프롬프트를 장르·wave별로 읽어 하나의 문자열로 합친다.

- **경로 해석**: 기존 [main.js:1421](../../../electron/main.js#L1421)/[mcp.js:19](../../../electron/ipc/mcp.js#L19)이
  쓰는 `process.resourcesPath/skills`(패키징) 규칙을 재사용. 개발 시엔 프로젝트 `skills/`.
  → `resolveSkillsDir()` 유틸로 dev/prod 통합.
- **장르 → 대본(W3) → 실제 파일명 매핑** (파일명은 리터럴로 고정 — 약칭 금지):

  | 장르 | 파일 (meta-prompts/ 하위) |
  |---|---|
  | yadam | `yadam/yadam-scenario-guide.md`, `yadam/yadam-narrative-guide.md`, `yadam/yadam-suspense-techniques.md` |
  | dark-history | `dark-history/screenplay_guidelines.md`, `dark-history/narrative_techniques.md`, `dark-history/suspense_techniques.md` |
  | bespoke(`{lang}`) | `bespoke/{lang}/screenplay_guidelines.md`, `.../narrative_techniques.md`, `.../suspense_techniques.md` |

  - 위 3파일 세트는 story-engine [SKILL.md:228](../../../skills/story-engine/SKILL.md#L228) W3 표 기준.
  - **`_common/hook_principles.md`를 모든 장르 공통으로 함께 포함**(확정). SKILL W3 표에는 없는
    항목이므로, 조합은 "W3 3파일 + 공통 hook_principles"임을 코드/주석에 정확히 표기한다.
  - `{lang}`: bespoke는 language(ko/en)로 서브폴더 선택.
  - **bespoke는 1단계에서 `_meta_supplement`(에피소드별 reference 합성) 없이 기본 파일만** 사용.
- `loadMetaPrompt({ genre, wave, language })` → 해당 파일들을 읽어 구분선으로 join한 문자열 반환.
  파일 누락 시 조용히 스킵하지 않고 로그 경고 + 해당 파일 제외하고 진행.

#### 4. 엔진 전환 (동일 시그니처만으로는 안 됨 — 실제 변경 목록)
현재 stepMachine은 DI된 `llm` 하나를 쓰지만 기본 주입·기본값이 전부 Gemini로 박혀 있다. 1단계는
**Claude를 기본 엔진**으로 하므로 아래를 바꾼다:

1. **주입**: [main.js](../../../electron/main.js#L204) `registerStoryIPC(...)`에 `llm: llmClaude`를 넘긴다
   (현재 미지정 → [story-api.js:40](../../../electron/ipc/story-api.js#L40) 기본값 `llmGemini` 사용 중).
2. **기본 엔진 상태**: [storyStore.js `defaultStoryState`](../../../electron/story/storyStore.js)의
   `engine: { llm: 'gemini' }` → `'claude'`.
3. **모델 fallback**: [stepMachine.js:77](../../../electron/story/stepMachine.js#L77) 등
   `model: state.engine.model || 'gemini-2.5-pro'`의 하드코딩 fallback을 **제거**하고
   `model: state.engine.model`만 넘긴다. 모델 미지정 시 **각 llm 모듈이 자기 기본 모델을 책임**진다
   (llmClaude는 Claude 기본 모델, §열린 결정 2). → 엔진별 모델명이 상대 엔진에 새지 않는다.
4. llmGemini 경로/코드는 그대로 남긴다(추후 설정 토글 자리). 1단계에서 엔진 전환 설정 UI는 없음(YAGNI).

#### 5. UI — `StoryView.jsx`
- 현재 "장르" **텍스트 입력칸**을 → **장르 선택 드롭다운**(yadam / dark-history / bespoke)으로 교체.
- 선택된 장르는 `start()` 파라미터(`options.genre`)로 전달돼 메타프롬프트 로딩·주입에 쓰인다.
- 대본 스트리밍 표시는 기존 `streamingText` 경로 그대로(단, delta 필터 보강은 §stale delta).

#### 6. 의존성 / 패키징
- `package.json`에 `@anthropic-ai/claude-agent-sdk` 추가(AutoMovie와 동일 계열 버전 `^0.3.x`).
- **패키징 리스크(중요)**: SDK는 claude 바이너리 subprocess를 실행하고, 플랫폼별 native optional
  deps를 가진다. Electron ASAR 안에 실행 파일이 갇히거나 optional dep이 누락되면 `query()`가
  **런타임에 실패**한다. → [electron-builder](../../../package.json) 설정에 SDK(및 그 실행 바이너리)를
  `asarUnpack`에 포함하거나, `pathToClaudeCodeExecutable`로 언팩된 경로를 지정한다. **패키징
  스모크 테스트**(빌드본에서 대본 1회 생성)를 검증 항목에 포함.

### 데이터 흐름 (대본 생성 예)
```
StoryView: 장르 선택 → start('script', {options:{genre,language}})
  → stepMachine: loadMetaPrompt({genre, wave:'script', language})  (main, 파일 읽기)
  → prompts.buildScriptPrompt(input, {...opts, metaPrompt})
  → llmClaude.generateScript(prompt, {onDelta, signal})
      → query({prompt, options:{...buildClaudeSdkOptions, includePartialMessages:true}})
      → stream_event → content_block_delta/text_delta
          → (signal.aborted면 방출 중단) onDelta → send('story:delta',{text},opId)
          → StoryView streamingText
      → result → 최종 대본
```

### 에러 처리
- **structured output 실패(씬분리/프롬프트)**: result subtype으로 분기 — `success`+`structured_output`
  부재는 텍스트 폴백 파싱, `error_max_structured_output_retries`는 outputFormat 없는 JSON-only 1회
  재요청, 그 외 에러는 throw. 폴백까지 실패면 에러(stepMachine error 상태). (상세 §컴포넌트 1)
- **abort / stale delta (High)**: 최종 상태 저장은 `isStale()`(controller 교체 or `signal.aborted`)
  가드가 있으나([stepMachine.js:150](../../../electron/story/stepMachine.js#L150)), `onDelta`는 가드 없이
  `story:delta`를 emit하고 renderer는 `projectToken`만 확인한다
  ([useStoryPipeline.js:62](../../../src/hooks/useStoryPipeline.js#L62)). Claude abort가 늦게 끊기면
  이전 실행 델타가 새 `streamingText`에 붙을 수 있다. → **두 겹 방어**:
  1. llmClaude `onDelta` 호출 전 `signal.aborted` 확인(엔진 레벨 차단).
  2. renderer가 현재 running `operationId` 기준으로 `story:delta`를 필터(이미 payload에 `opId`가
     실려 있음 — `send('story:delta', {text}, opId)`). running op와 다르면 drop.
- **인증 실패(로컬 로그인 없음)**: SDK 에러를 사용자향 메시지로 변환("Claude 로그인이 필요합니다").
- **메타프롬프트 파일 누락**: 경고 로그 + 해당 파일 제외하고 진행(대본 생성 자체는 계속).

### 테스트 (TDD)
- **순수 함수 단위**: `buildClaudeSdkOptions`(includePartialMessages/skills 포함), `extractClaudeSdkResult`
  (success/error), stream_event 델타 추출(대상/무시 이벤트 분기 + abort 차단), `toJsonSchema` 변환,
  JSON 폴백 파싱·검증·재시도 분기.
- **prompts.js 단위**: 빌더 3종 출력, 대본 메타프롬프트 슬롯 주입 유무.
- **metaPrompts.js 단위**: 장르×wave→실제 파일명 매핑, 경로 해석(dev/prod mock), 파일 누락 경고.
- **llmClaude 단위**: `query` mock으로 generateScript(델타/최종/abort)·splitScenes·writePrompts
  (structured_output 성공 / 폴백 파싱 / 재시도).
- **엔진 전환 단위**: main.js 주입 경로, defaultStoryState engine 기본값, 모델 fallback 제거로
  Claude 모델이 쓰이는지.
- **stale delta 단위**: renderer가 running operationId 외 delta를 drop하는지.
- **통합**: 엔진 Claude로 대본→씬분리→프롬프트 흐름(SDK mock), 메타프롬프트 주입 확인.
- **패키징 스모크**: 빌드본에서 `query()` 실행 성공(asarUnpack 검증).
- 위치는 [CLAUDE.md](../../../CLAUDE.md) TDD 규칙대로 `tests/` 미러링.

## 확정된 결정

1. **Claude 모델 기본값**: `claude-opus-4-8`. llmClaude는 `opts.model`이 없으면 이 기본을 쓰고,
   `opts.model`로 **오버라이드 가능**(엔진이 기본 모델 책임 — §컴포넌트 4). 모델 선택 UI는 오버라이드
   경로를 그대로 재사용하도록 구조만 열어두고, **1단계 필수 범위는 기본값 고정 + opts 오버라이드**까지다
   (드롭다운 UI는 필요 시 추가).
2. **브랜치 전략**: `feature/story-pipeline`(M1, 머지 대기) 위에 이어서 작업.
3. **`_common/hook_principles.md` 주입**: **포함**. 대본(W3) 메타에 장르 3파일 + 공통
   `hook_principles.md`를 함께 주입(훅 원칙 보강).

## 비목표 (1단계에서 안 함)
- W1 스토리 설계 / W2 시놉시스 스텝 및 사용자 확정 게이트 (→ 2단계)
- 씬분리·프롬프트 단계의 메타프롬프트 주입 (R1 finding 7: 추출 작업과 충돌 → 생략 확정)
- 씬분리 이후(W6 스토리보드/W7 이미지)의 메타프롬프트 연동
- bespoke `_meta_supplement`(reference 합성)
- 엔진 전환 설정 UI (Gemini↔Claude 토글)
- 대본 칸 UI 통합(앞서 논의된 StoryView 입력/출력 칸 통합 — 별개 작업)

## 변경 이력
- **R1 (Codex 8 findings 반영)**: ①structured output을 `outputFormat`/`structured_output` 1차 +
  `toJsonSchema` 변환 레이어로 재설계(텍스트 파싱은 폴백). ②엔진 전환을 "동일 시그니처"에서 실제
  변경 목록(main.js 주입 / defaultStoryState engine / 모델 fallback 제거)으로 구체화. ③stale delta
  2겹 방어(엔진 abort 가드 + renderer operationId 필터). ④스트리밍 무시 이벤트 타입 명시.
  ⑤skills 옵션 명시적 통제. ⑥메타프롬프트 실제 파일명 고정 + hook_principles 근거 정정.
  ⑦씬분리 메타 주입 생략 확정. ⑧패키징(asarUnpack/native binary) 리스크 + 스모크 테스트 추가.
- **R2 (Codex 1 finding 반영)**: structured call이 `extractClaudeSdkResult`를 그대로 쓰면
  `error_max_structured_output_retries` result에서 즉시 throw되어 폴백/재시도로 못 가는 문제 →
  result 메시지 전체를 받아 subtype 분기(success→structured_output/텍스트, retries-error→JSON-only
  재요청, 그 외→throw)로 수정.
