# SRT → 프롬프트 자동화 — 설계 v3.1 (Fable 최종 리뷰 findings 반영, 2026-07-15)

**이 문서**: Codex(gpt-5.6-sol xhigh) + Fable 5 독립 자문·수렴 → 스펙 → 적대적 리뷰 R1(5 BLOCKER) → v2 → Codex 재리뷰(신규 3 BLOCKER) → **Codex가 v3 저작**(전부 닫음) → **Fable 최종 리뷰**(앵커 19개 파일 전수 대조, 드리프트 0, BLOCKER/MAJOR 0, MINOR 4). v3.1이 그 MINOR 4건(M1 validator story blast radius, M2 무발신 인증신호, M3 sceneNo 파생, M4 framePairs stale closure)을 반영해 **구현 착수 가능** 상태다. 이전 라운드에서 닫은 필드 단위 patch·빈 summary·DTO whitelist·prompt 키 부재·타임코드 LLM 미통과 계약은 그대로 유지한다.

> ⚠️ `docs/superpowers/`는 `.gitignore` — 디스크에만. 지우지 마라.

## 0. 목표 / 사용자 가치
현재 수동 흐름 **SRT → 외부 AI 프롬프트 작성 → CSV 재임포트**를 앱 안에서 끝낸다.
- **모드 A — SRT → 프롬프트**: 기존 SRT 씬에 이미지(+비디오) 프롬프트 자동 작성.
- **모드 B — SRT → 씬분리 + 프롬프트**: SRT를 씬으로 묶고 각 씬 프롬프트를 한 번에 작성.
- **v1 범위**: A + B 둘 다.

## 1. 제약 / Non-goals
- story 파이프라인(`storyCommands`/`stepMachine`/`story.json`/manifest) 커플링 금지. `storyLlmRouter`/`storyLlmCatalog` 미변경(코어는 어댑터 DI). 인앱 에이전트 툴/MCP 등록 안 함(YAGNI). review·revise 루프 v1 제외.
- 코어는 `(dtoScenes, opts, deps) → prompts` stateless. renderer가 프로젝트 상태·수명·race·저장을 소유한다.

## 2. 검증된 사실 (v3 앵커 재대조)
- 활성 SRT 경로는 `parseSRTToTrack()`(`src/utils/parsers.js:513-543`; 호출 `src/hooks/useScenes.js:264-265`)이다. `parseSRTToScenes`의 production `src/` 참조는 App/useScenes import뿐이고(`src/App.jsx:53`, `src/hooks/useScenes.js:8-12`) 실행 호출은 없다. 분리 모델 정의는 `src/utils/srtTrack.js:8-11`, 실제 표시 해석은 `src/components/SceneList.jsx:30-36,557-559`다. 씬-자막 연결 권위는 `scene.srtLineIds`; `src/`와 `tests/` 전반의 소비를 확인했으며 개수 주장은 하지 않는다.
- `buildPromptsPrompt`는 `segments[].text`만 본다(`electron/api/llm/prompts.js:408-409`). `{sceneNo,summary,text}`를 그대로 주면 SRT 본문이 프롬프트에서 사라진다.
- `llmGemini.writePrompts`는 raw `out.scenes`를 먼저 `Map`으로 접고(`electron/api/llm/llmGemini.js:215-218`) 누락을 기존 값/null로 폴백한다(:219-225). Claude/Codex도 raw 응답을 검증 전에 `Map`으로 접는다(`llmClaude.js:385-394`, `llmCodex.js:214-222`) — 현재 검증은 입력 커버/non-empty뿐이라 duplicate·extra를 이미 잃는다.
- `llmGemini`는 `opts.apiKey`와 `opts.model` 둘 다 필수다. `structuredCall`이 `${BASE}/${opts.model}`을 쓴다(`llmGemini.js:113-121`). 키는 없을 수 있다(`electron/api/keyStore.js:52-60`). PROMPTS_SCHEMA는 image/video를 모두 required로 둔다(`schemas.js:170-187`).
- story 매핑 전례는 `imagePrompt → prompt`, `videoPrompt → videoT2VPrompt`(`electron/story/stepMachine.js:535-536`). `videoI2VPrompt`는 채우지 않는다.
- 타이밍 절대값 보존은 기존 회귀점이다(`src/hooks/useScenes.js:229-232,330-333,365-368`). sequential 재배치 금지.
- SRT/CSV factory의 `characters` 계약은 문자열이다. CSV 입력·씬 복사는 `src/utils/parsers.js:430-435,474-496`, SRT factory는 :525-540에서 `characters:''`를 만든다. `checkTagMatch`는 `.trim()`/`.split()`을 호출한다(`src/utils/tagMatch.js:9-11,20-22`)며 `normalizeScene`은 타입을 고치지 않는다(`src/hooks/useScenes.js:30-47`).
- `buildProjectSavePayload`는 scenes와 framePairs를 같은 payload에 담는다(`src/hooks/useProjectData.js:420-428`; scenes는 :424, framePairs는 :427). 그러나 명시 저장 builder는 scenes/srtTrack/references만 override하고 framePairs는 closure를 쓴다(:1225-1242); 공개 함수도 framePairs 인자가 없다(:1272-1275). `{ok:false}`는 실제 저장 실패 표면이다(:1273-1275).
- autosave는 debounce이며 실행/복원/import 중 skip한다(`src/hooks/useAutoSave.js:51-74`). prompt 트랜잭션의 즉시 flush로 쓸 수 없다. folder project가 아니거나 폴더가 없으면 명시 저장도 `undefined`로 skip한다(`src/hooks/useProjectData.js:498-518`).
- 프로젝트 교체는 scene ID 카운터를 현재 프로젝트 max로 reset한다(`src/hooks/useScenes.js:80-104`) — 다른 프로젝트에서 `scene_1` 재사용 가능. epoch guard 전례는 `src/hooks/useProjectData.js:584-593`.
- `ownerSceneId`는 canonical row→scene binding(`src/services/mediaSync.js:25-33`), 레거시 backfill은 `src/hooks/useProjectData.js:55-80`, 단일 삭제 cascade는 `src/hooks/useScenes.js:447-465`, 전체 삭제 cascade는 `src/App.jsx:2583-2587`다. 개수 주장은 하지 않는다.
- Gemini `/models` 결과는 id/display/description/**supportedGenerationMethods**만 보존한다(`electron/api/genai.js:597-620`, 특히 :610-615). structured-output/`responseSchema` 지원 여부를 제공하지 않으므로 capability 권위로 쓰지 않는다.
- Claude 모델 조회는 모든 실패/timeout을 `[]`로 접는다(`electron/api/llm/llmClaude.js:47-75`). 고정 SDK 0.3.207(`package.json:48`)의 `Query.accountInfo()`와 `supportedModels()` surface는 확인했다(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2353-2358,2420-2424`). Codex 실제 write 경로는 `assertCodexChatGptLogin`을 호출한다(`electron/api/llm/codexAppServer.js:187-192`; 구현 `codexSdk.js:264-297`).
- 모드 B 차단에 `anyRunning`만 쓰면 불충분하다(`src/App.jsx:2262-2266`). 더 넓은 현재 UI busy 조합은 image/video/ref/pending/retry/single-scene/thumbnail/gallery를 포함한다(:2365-2366). `storyId`는 scene 필드(`src/hooks/useScenes.js:666-705`)이고 `fixedSceneState`는 프로젝트 상태(`src/hooks/useProjectData.js:400-413`)다.
- 진입점은 `SceneList`의 `.scene-list-actions`(`src/components/SceneList.jsx:595-615`). preload는 단일 expose 객체의 명시 메서드 구조(`electron/preload.js:1-5,106-114,125-145`)이지 invoke allowlist가 아니다.

## 3. 아키텍처 (3층 — renderer가 상태·수명·정합 소유, main은 stateless)

### 3.1 순수 코어 (main, 신규 `electron/api/llm/srtPrompts.js`)
- `writeScenePrompts(dtoScenes, context, opts, deps)` 입력은 whitelist DTO `[{sceneNo,summary,text}]`뿐이다(base64/이미지/타이밍 없음). 입력 `sceneNo`는 각각 `Number.isInteger(sceneNo) && sceneNo > 0`, non-empty, unique여야 한다.
- 호출 직전에 반드시 아래 adapter shape로 바꾼다. 이것이 `buildPromptsPrompt`의 실제 입력 계약이다.
  ```js
  const adapterScenes = dtoScenes.map(({ sceneNo, summary, text }) => ({
    sceneNo,
    summary,
    segments: [{ text }],
  }))
  const result = await deps.writePrompts(adapterScenes, context, opts)
  ```
  `adapterScenes`에도 `imagePrompt`/`videoPrompt` 키가 **절대 없다**. 있으면 Gemini의 기존 값 폴백이 옛 값을 에코해 검증을 무력화한다. 반환도 whitelist `[{sceneNo,imagePrompt,videoPrompt}]`만 허용한다.
- 공용 `validatePromptScenesExactOnce(inputSceneNos, rawScenes)`를 둔다. 입력·응답 sceneNo 모두 positive integer, 입력 non-empty·unique, 응답 array/length=N/unique, 정확히 같은 집합(extra·missing 금지), image/video prompt trim non-empty를 검사한다. **각 `llmGemini`/`llmClaude`/`llmCodex.writePrompts`가 structured call 직후 raw `out.scenes`에 이 validator를 호출한 다음에만 Map/merge한다.** 코어는 deps 반환에도 같은 경계 검증을 한 번 더 한 뒤 whitelist한다. raw-before-Map 검증이 duplicate·extra 차단의 권위이며 코어 사후검증만으로 대체할 수 없다. **(M1)** 이 검증은 story 파이프라인의 `writePrompts` 호출에도 적용된다 — Gemini의 조용한 null 폴백(잠재 버그)이 명시 실패로 바뀌며 이는 의도된 강화다. §1 "story 커플링 금지"는 **호출 배선**을 말하며 이 공유 함수 강화는 그 예외다. story 경로 회귀는 슬라이스 4가 커버한다(happy path만 고정하던 `tests/electron/api/llm/llmGemini.test.js:149-156` 갱신).
- `groupSrtLines(numberedLines, opts, deps)`는 시간 없는 번호 라인만 받는다. LLM 호출 **전** `numberedLines.length <= MAX_GROUP_LINES`와 전체 텍스트 문자수 `<= MAX_GROUP_CHARS`를 동시에 검사한다. 하나라도 초과하면 v1은 분할/부분 grouping하지 않고 `SRT_GROUP_INPUT_TOO_LARGE`로 중단한다. 통과 시 `deps.groupSrtLines` 결과 `{groups:[{fromLine,toLine,summary}]}`를 순수 파티션 검증(1..N 총망라·빈틈/중복/역순 없음, summary trim non-empty)한다. 결과 오류는 1회 재요청 후 명확히 실패한다.
- 신규 `buildSrtGroupPrompt`(`prompts.js`)와 GROUPS 스키마(`schemas.js`). 타임코드는 prompt payload에 넣지 않는다.
- `toPromptSceneDTO(scene, srtTrack)`는 renderer 소유 순수 helper다. `resolveSceneText`는 `srtLineIds → srtTrack text join`, 연결이 없으면 `subtitle`, 둘 다 빈 문자열이면 skip한다. 모드 A는 `summary=''`, 모드 B는 group summary, `text=resolvedText`. DTO에는 prompt/media/timing 키가 없다. **(M3)** 기존 씬엔 `sceneNo` 필드가 없다(`_sceneNum`은 CSV 전용). `sceneNo`는 renderer가 **전송 대상 집합 전역 1-based ordinal**로 부여하고 `sceneNo→sceneId` map을 run 상태로 보유해 apply 역매핑과 §3.3 fingerprint에 쓴다.

### 3.2 IPC (신규 `electron/ipc/srt-prompts-api.js`) — stateless
- 핸들러 3개: `srt-prompts:write-chunk`, `srt-prompts:group`, `srt-prompts:capabilities`. engine에 따라 llmClaude/llmCodex/llmGemini 모듈을 직접 주입한다. Gemini 키는 main에서만 읽고 renderer payload·응답·로그에 넣지 않는다. preload에 `srtPromptsWriteChunk`/`srtPromptsGroup`/`srtPromptsCapabilities` 명시 bridge를 추가한다.
- structured-output 지원 권위는 코드의 curated allowlist가 소유한다. v1 우선순위 `GEMINI_STRUCTURED_MODEL_ALLOWLIST = ['gemini-2.5-flash', 'gemini-2.5-pro']`; 항목 추가는 responseSchema 실호출 회귀를 통과해야 한다. `/models`는 **현재 키에서 allowlist 모델이 가용한지만** 확인한다. 우선순위 allowlist ∩ `/models` id의 첫 모델을 선택하고 교집합이 비면 LLM 호출 전에 `GEMINI_STRUCTURED_MODEL_UNAVAILABLE`로 실패한다. `/models.methods`를 structured capability로 해석하지 않는다.
- capabilities 응답은 boolean이 아니라 엔진별 `{available, reason, model?}`다. reason은 최소 `ok | missing_api_key | model_unavailable | cli_unavailable | login_required | timeout | probe_failed`로 정규화한다.
  - Gemini: main key 존재 + allowlist/`/models` resolved-model preflight. 성공 모델을 `model`에 넣는다.
  - Claude: `listClaudeModels()`의 빈 배열을 bool로 쓰지 않는다. 별도 non-swallowing probe가 같은 SDK `rawQuery`로 Query를 만들고 timeout 안에서 `accountInfo()`와 `supportedModels()` 성공을 모두 확인한다. CLI spawn/로그인/모델 실패를 reason으로 보존하고 성공한 우선 모델을 `model`에 넣은 뒤 Query를 interrupt한다.
  - Codex: write 경로와 동일한 `assertCodexChatGptLogin` preflight를 실행하고 기본/선택 모델을 `model`에 넣는다. “CLI 존재하지만 ChatGPT 미로그인”을 available로 보고하지 않는다.
- 각 probe timeout은 10초, 성공/실패 cache TTL은 30초다. 엔진별 독립 cache다. **(M2)** Gemini는 `keys:set`/`clear` IPC에서 즉시 invalidate; Claude/Codex는 인증 변경이 외부 CLI라 앱 내 발신 신호가 없으므로 30초 TTL 만료로 수렴한다(존재하지 않는 이벤트를 찾지 말 것 — 재시도 버튼이 강제 invalidate). 한 엔진 timeout이 다른 엔진 결과를 막지 않게 병렬 probe한다. UI는 `available:false`를 비활성화하고 `reason`별 설정 안내를 낸다.

### 3.3 렌더러 (신규 `src/hooks/useSrtPrompts.js` + 모달)
- 대상 DTO는 **씬 수 + 문자/토큰 예산** 동시 한도로 청크 분할한다. 단일 cue가 prompt 예산을 넘으면 명시 오류다. grouping 전에는 별도로 §3.1의 `MAX_GROUP_LINES` + `MAX_GROUP_CHARS` 동시 한도를 검사하며 v1은 초과 입력을 나누지 않는다.
- race snapshot은 `runId + projectId/switchEpoch + sourceFingerprint`다. `sourceFingerprint = stableHash({scenes:[{sceneId,sceneNo,resolvedText}], srtLines:[{id,text,startTime,endTime}]})`: 대상 씬 전체를 deterministic 순서로 넣고, `srtLines`는 그 씬들이 `srtLineIds`로 참조한 항목을 참조 순서대로 중복 제거해 네 필드를 모두 넣는다. 존재하지 않는 revision 값에 의존하지 않는다.
- 매 응답 **apply 직전**과 각 명시 저장 **flush 직전**에 project/epoch와 현재 state에서 다시 만든 fingerprint를 모두 비교한다. subtitle, 연결된 line text/timing, scene 순서/ID/sceneNo 중 하나라도 달라지면 응답/저장을 폐기하고 stale/cancel 상태로 끝낸다. 취소·unmount도 동일하다. 모드 B는 grouping 전 기존 source fingerprint를 commit 직전 검사하고, regroup commit 뒤 `nextScenes + capturedTrack`으로 새 prompt fingerprint를 잡아 청크 apply/flush에 사용한다.
- 모드 A 반영은 `useScenes` 신규 함수형 bulk patch. **필드 단위**로 apply 시점에 비어 있는 `prompt`/`videoT2VPrompt`만 채운다. 채울 prompt에 기존 image/imagePath가 있으면 `stalePrompt`, 채울 videoT2VPrompt에 T2V 미디어가 있으면 `staleVideo`를 설정한다(`src/hooks/useScenes.js:680-693` 전례). 이미지/비디오/status 런타임 필드는 구조적으로 보존한다. 전량 덮어쓰기 옵션도 명시 선택 + stale 마킹. `videoI2VPrompt`는 건드리지 않는다.
- 저장 flush: 성공 청크마다 적용할 `nextScenes`를 동기로 계산해 state 반영 후, flush 직전 fingerprint를 재검사하고 `await saveCurrentProjectWithPayload({scenes:nextScenes,...})`한다. 명시 저장 반환은 `{ok,persisted,error?}`로 확장한다. throw와 `{ok:false}`는 저장 실패로 처리해 `unsaved`를 표시하고 다음 청크를 시작하지 않는다. 실제 write가 skip되면 `persisted:false`; non-folder는 “디스크에 저장되지 않음”을 명시하고, folder project의 `persisted:false`(프로젝트 폴더 없음 등)는 실패로 취급한다. autosave debounce는 성공 조건이 아니다.
- 실패/취소: 청크 k LLM 실패는 누적 표시 후 다음 청크 계속, “실패분만 재시도”는 아직 빈 필드만 재실행. 취소는 청크 경계(in-flight 응답 폐기). 대상 0이면 모달 비활성/short-circuit. folder project의 모드 B 최초 regroup flush는 prompt 청크보다 먼저 끝나므로 이후 모든 prompt 청크가 실패하거나 취소돼도 regroup 결과는 이미 디스크에 남는다. non-folder는 메모리 상태가 `unsaved`임을 계속 표시한다.
- 모달: 모드(A 기본/B), engine(capabilities reason 반영), 스타일, 덮어쓰기(빈것만 기본/전량+영향 씬 수), 진행 “청크 i/N (씬 a~b)”, 실패/unsaved/skip 리포트.

## 4. 모드별 계약

### 모드 A (SRT → 프롬프트)
- 대상은 기존 씬. 씬이 없고 srtTrack만 있으면 srtTrack에서 1:1 씬 재구성(raw SRT는 import 뒤 보관하지 않음, `src/App.jsx:1430-1441`). srtTrack도 없으면 명시 에러/모달 비활성.
- 텍스트는 `resolveSceneText`(§3.1). 텍스트 없는 씬은 제외하고 “건너뜀 N개”를 보고한다. validator 기준은 실제 전송 집합.
- “빈 것만”은 필드 단위다. prompt 또는 videoT2VPrompt 중 하나라도 빈 씬을 전송하되 apply는 원래 비었던 필드에만 한다. 전량 덮어쓰기는 명시 옵션 + stale 마킹.
- `imagePrompt → prompt`, `videoPrompt → videoT2VPrompt`; `videoI2VPrompt`와 씬 구조·절대타이밍은 불변.

### 모드 B (SRT → 씬분리 + 프롬프트) — App-level 파괴적 트랜잭션
- `groupSrtLines`에는 라인 번호+텍스트만 보낸다. 코드가 그룹 구간으로 scene factory를 구성한다: `startTime=첫 라인.startTime`, `endTime=마지막 라인.endTime`, `duration=end-start`, `srtLineIds=[구간 id]`, `subtitle=join('\n')`. 각 line timing은 finite이고 end≥start여야 하며 gap을 재배치하지 않는다.
- factory 전체 필드: `{id:allocateSceneId(), startTime, endTime, duration, prompt:'', videoT2VPrompt:'', videoI2VPrompt:'', subtitle, characters:'', scene_tag:'', style_tag:'', status:'pending', image:null, srtLineIds}`. `characters`는 배열이 아니라 빈 **문자열**이다. 생성 직후 각 string tag field로 `checkTagMatch`를 호출하고 `SceneList`를 렌더해도 예외가 없어야 한다. 그룹 summary를 DTO summary로 넣고 같은 write 청크 루프를 쓴다.
- 시작 차단 predicate는 타입을 섞지 않고 정확히 다음이다.
  ```js
  const importInProgress = isImageFirstImporting || importProcessing
  const fullGenerationBusy = isRunning || videoAutomation.isRunning || refBatchRunning
    || hasPendingBatch || videoRetryRunning || Boolean(generatingSceneId)
    || thumbnailGenerating || galleryUploading
  const modeBBlocked = scenes.some((s) => Boolean(s.storyId))
    || fixedSceneState != null || projectLoading || importInProgress || fullGenerationBusy
  ```
  `storyId` scene 존재와 프로젝트 `fixedSceneState`를 각각 검사한다. 차단 중에는 grouping IPC도 시작하지 않는다. 파괴 확인 모달 필수이고 기존 이미지가 있으면 모드 A를 권장한다.
- 확정 시 기존 scene ID 집합과 capturedTrack을 잡고, **setter 호출 전에** `{nextScenes,nextFramePairs}`를 모두 계산한다. `nextFramePairs`는 `ownerSceneId`가 기존 scene ID를 가리키는 행을 전부 제거하고 gallery-rooted/null 행만 보존한다. 기존 source fingerprint가 같을 때 React의 `setScenes(() => nextScenes)`와 `setFramePairs(() => nextFramePairs)`를 같은 동기 commit에서 반영한다. srtTrack은 `capturedTrack` 그대로다.
- prompt IPC를 하나도 시작하기 전에 `nextScenes + capturedTrack` fingerprint와 현재 state를 비교하고, current framePairs/track도 `nextFramePairs`/`capturedTrack`과 구조적으로 같은지 확인한다. **(M4)** `framePairs`는 동기 ref가 없는 평범한 `useState`(App.jsx:491)라 same-tick closure 읽기는 항상 stale이다(나이브 구현은 매번 비교 실패 → 기능 영구 불능). 이 비교는 commit 후 시점(effect/후속 microtask)에 하거나 App에 `framePairsRef`(동기 갱신)를 추가해 읽는다 — same-tick closure 읽기 금지. 그 뒤 `await saveCurrentProjectWithPayload({scenes:nextScenes, framePairs:nextFramePairs, srtTrack:capturedTrack})`한다. 이는 folder project의 한 project.json payload에 scenes/framePairs/srtTrack을 함께 쓰는 최초 파괴 트랜잭션 flush다. throw, `{ok:false}`, folder인데 `persisted:false`면 prompt 청크 0회, 화면은 새 regroup 상태를 `unsaved`로 표시한다. `persisted:true` 뒤 새 prompt fingerprint를 캡처하고 청크를 시작하므로 prompt 전량 실패/취소에도 regroup 결과와 고아 제거는 저장돼 있다. non-folder는 디스크 flush 불가를 파괴 확인에서 한 번 더 고지하고 동의할 때만 `unsaved` 상태로 prompt를 계속한다.

## 5. 🔴 안전 불변식
- **타임코드 LLM 미통과** — 모드 B도 line number/text만. apply는 field patch(A) 또는 captured srtTrack 절대시간 파생(B). gap SRT 시간 보존 테스트 필수.
- **DTO 본문 보존** — `{text}`를 `segments:[{text}]`로 바꾸고 adapter DTO에도 imagePrompt/videoPrompt 키가 없다.
- **exact-once raw-before-Map** — 세 어댑터가 raw `out.scenes`를 공용 validator로 먼저 검사한다. core 사후검사만으로 대체 금지.
- **race** — scene id/no/resolvedText 전체 + 참조 srt line의 id/text/start/end stable hash를 apply 직전·flush 직전 모두 비교한다.
- **framePairs + 디스크 정합** — 모드 B 최초 flush에 nextScenes/nextFramePairs/capturedTrack을 함께 명시 전달하며 고아 0.
- **키 격리** — Gemini key main 전용.
- **저장 결과 검사** — throw와 `{ok:false}` 모두 실패. `{ok,persisted}`로 실제 write와 skip을 구분한다. folder의 B 최초 flush가 `persisted:true`가 아니면 prompt 0회; 성공 시 prompt 전량 실패/취소에도 regroup 저장 유지.

## 6. LLM 인증 / 모델 / 비용
- 기본 Gemini BYOK. `apiKey + resolved model` 필수. structured-output 권위는 curated allowlist, `/models`는 현재 키의 모델 가용성만 판정한다. 교집합이 없으면 `GEMINI_STRUCTURED_MODEL_UNAVAILABLE`로 호출 전 실패. flash 우선.
- Claude는 Agent SDK CLI/account login preflight, Codex는 write 경로와 같은 ChatGPT auth preflight. capabilities는 엔진별 `{available,reason,model?}`로 false positive와 설정 안내를 구분한다. timeout 10초 + TTL 30초.
- prompt output은 `buildPromptsPrompt`가 영어를 강제한다(`electron/api/llm/prompts.js:418-424`).

## 7. 최위험 3 + 완화
1. 타이밍/race 오염 → line number만, 절대시간 파생, full source fingerprint를 apply+flush 직전 비교.
2. 긴 SRT/불완전 결과 → write는 씬+문자 예산 청크, grouping은 `MAX_GROUP_LINES`+`MAX_GROUP_CHARS` 동시 hard stop, raw exact-once, 실패분 재시도.
3. 파괴적 덮어쓰기/디스크 고아 → 필드 patch, 모드 B nextScenes+nextFramePairs 선계산·동시 반영·최초 명시 flush, story/fixed/import/full busy 차단.

## 8. TDD 슬라이스
1. `resolveSceneText`/`toPromptSceneDTO`: srtLineIds 결손, subtitle fallback, 빈 text skip, summary 계약, DTO whitelist와 imagePrompt/videoPrompt·타이밍 키 부재.
2. `writeScenePrompts`: `{sceneNo,summary,text}`가 정확히 `{sceneNo,summary,segments:[{text}]}`로 deps에 전달되고 adapterScenes에도 imagePrompt/videoPrompt 키가 없음을 단언. 반환 whitelist와 positive-integer/unique 입력 검증.
3. 그룹: `MAX_GROUP_LINES`와 `MAX_GROUP_CHARS` 각각 경계/초과/동시 초과에서 LLM 미호출, 파티션 총망라·연속·비중복·역순 거부, 1회 retry. `buildSrtGroupPrompt`에 타임코드 부재 + GROUPS 스키마.
4. 세 어댑터 각각: raw `out.scenes` duplicate/extra/missing/non-integer/0/empty prompt가 Map 전에 throw. 정상 exact-once만 merge. `groupSrtLines` 어댑터 mock도 포함.
5. `buildPromptsPrompt`: 빈 summary가 `N.  :: text`, `segments[0].text`가 실제 본문에 들어감. Gemini prompt key 폴백 회귀(F5) 차단.
6. IPC/model/capabilities: Gemini key 부재, allowlist∩`/models` 선택, methods를 capability로 쓰지 않음, 빈 교집합 에러; Claude `accountInfo+supportedModels` 성공/CLI·login·timeout 이유; Codex 동일 auth preflight; 엔진 독립 timeout/30초 cache/invalidate; key renderer 미노출; story machine 미호출.
7. renderer race: project/epoch뿐 아니라 sceneId/sceneNo/resolvedText 변경과 참조 line의 id/text/start/end 각 변경이 apply 직전 및 flush 직전 응답/저장을 폐기. 취소/unmount/in-flight 폐기, 씬+문자 청크, 부분성공.
8. 모드 A apply: 필드 단위 빈것만, 채운 필드 보존, 전량 옵션, stalePrompt/staleVideo, 런타임 미디어/status와 videoI2VPrompt/타이밍 불변.
9. 모드 B factory/차단: `characters:''`; 생성 즉시 `checkTagMatch`와 `SceneList` 무예외; 절대시간/end≥start/gap 보존; storyId와 fixedSceneState를 별도 차단하고 project/import 및 fullGenerationBusy의 모든 항을 하나씩 검증.
10. 모드 B 저장 트랜잭션: stale closure framePairs 대신 explicit nextFramePairs가 scenes/capturedTrack과 같은 payload에 저장, 고아 0. current scenes/framePairs/track의 flush 직전 mismatch도 저장/IPC 폐기. 최초 flush `{ok:false}`/throw/folder `persisted:false`면 write IPC 0 + unsaved. `persisted:true` 뒤 prompt 전량 실패/취소여도 regroup flush 1회 존재. 성공 prompt 청크 flush의 `{ok:false}`도 다음 청크 중단. non-folder skip은 `persisted:false`와 재확인/unsaved 안내.
11. UI/통합: 임포트→capability→모드 A/B→진행/실패/unsaved/skip, preload contract, folder/non-folder 안내, Gemini 실호출 1회 smoke.

## 9. 변경/신규 파일
| 파일 | 변경 |
|---|---|
| `electron/api/llm/srtPrompts.js` | 신규 — DTO→adapterScenes 변환, group hard limits/파티션, core 경계 검증 |
| `electron/api/llm/prompts.js`, `schemas.js` | `buildSrtGroupPrompt`, GROUPS 스키마 |
| `electron/api/llm/{llmClaude,llmCodex,llmGemini}.js` | `groupSrtLines` + **writePrompts raw `out.scenes` exact-once 검증(Map 전)** |
| `electron/ipc/srt-prompts-api.js` | 신규 — stateless write/group/capabilities + **Gemini model resolver(curated allowlist ∩ /models 가용성, 명시 에러) + 엔진별 preflight/reason/model(10s timeout, 30s cache/invalidate)를 이 파일에 병합**(별도 파일 아님, 구현 확정). 엔진·키 주입 |
| `electron/main.js`, `electron/preload.js` | IPC 등록 + 명시 bridge |
| `tests/electron/preloadContract.test.js` | bridge 회귀 |
| `src/hooks/useSrtPrompts.js` | 신규 — 청크, full source fingerprint, apply/flush 가드, `{ok:false}` 처리 |
| `src/hooks/useScenes.js` | bulk field patch + 모드 B factory/scene replacement helper |
| `src/hooks/useProjectData.js` | `buildCurrentProjectPayload`와 `saveCurrentProjectWithPayload`에 **framePairs explicit payload/flush** 및 `{ok,persisted}` 결과 추가 |
| `src/App.jsx` | 훅 배선, project identity, mode B predicate/파괴 트랜잭션, nextScenes+nextFramePairs 동시 반영·최초 flush·unsaved |
| `src/components/SceneList.jsx`, `SceneList.css` | `.scene-list-actions` 진입 버튼 |
| `src/components/SrtPromptModal.jsx` + css | 신규 모달 |
| `src/locales/{ko,en}.js` | i18n |
| `tests/` (위 파일 미러) | TDD 슬라이스 1~11 |

## 10. 남은 미확인 / 실호출 게이트
- Gemini initial curated allowlist 두 모델의 **현재 실제 계정/리전** responseSchema 동작은 저장소 mock 테스트만으로 증명되지 않는다. `/models` 가용성 통과 뒤 각 allowlist 추가·릴리스 때 실호출 1회 smoke를 게이트로 둔다. `/models`가 structured capability를 준다는 가정은 제거했다.
- Claude SDK 0.3.207의 `accountInfo()` surface는 확인했지만 CLI 미설치/미로그인 때의 실제 오류 문자열·subtype은 이 저장소에 fixture가 없다. 구현은 오류를 삼키지 않는 probe seam으로 reason을 정규화하고 실앱 미로그인/로그인 smoke로 매핑을 고정한다.
