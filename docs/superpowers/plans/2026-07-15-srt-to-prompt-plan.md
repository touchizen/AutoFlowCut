# SRT → 프롬프트 자동화 — Implementation Plan

> **For agentic workers:** 이 계획은 spec `docs/superpowers/specs/2026-07-15-srt-to-prompt-design.md`(v3.1, findings 0)를 실행 계약으로 삼는다. 각 슬라이스의 **정확한 계약·앵커·에러토큰은 스펙 해당 절을 정본**으로 열어라. 코드는 **Codex(gpt-5.6-sol xhigh) 저작**, 각 스테이지 끝 **Fable 적대적 리뷰 → findings 0**, **Opus 전체 스위트 직접 실행 + 뮤테이션 검증**(M4 워크플로우 동일).

**Goal:** SRT 자막에서 이미지·비디오 프롬프트를 앱 안에서 자동 생성(모드 A: 기존 씬 채우기 / 모드 B: 씬분리+생성)해 외부 AI+CSV 카피-페이스트를 제거한다.

**Architecture:** main은 stateless 순수 코어(어댑터 DI, story 커플링 0), renderer가 프로젝트 상태·수명·race·저장 소유. 기존 `buildPromptsPrompt`/어댑터 `writePrompts`/PROMPTS_SCHEMA 원형 재사용 — "새 엔진 아니라 배선".

**Tech Stack:** Electron, React hooks, vitest. LLM 어댑터 llmGemini/llmClaude/llmCodex. 기본 엔진 Gemini BYOK.

## Global Constraints (스펙 §1·§5, verbatim)
- story 파이프라인(storyCommands/stepMachine/story.json/manifest) 커플링 금지. storyLlmRouter/storyLlmCatalog 미변경. 인앱 에이전트 툴/MCP 등록 안 함(YAGNI). review·revise 루프 v1 제외.
- 🔴 타임코드는 LLM 입력·출력 어디에도 없다(모드 B는 라인 번호/텍스트만, 타이밍은 captured srtTrack에서 코드 파생). sequential 재배치 금지.
- 🔴 DTO/adapterScenes에 `imagePrompt`/`videoPrompt` 키 절대 없음(Gemini nullish 폴백 에코 차단).
- 🔴 exact-once validator는 어댑터 raw `out.scenes`에 **Map/merge 전** 실행.
- 🔴 Gemini는 `apiKey + resolved model`(curated allowlist ∩ /models) 필수, 없으면 호출 전 명시 에러.
- 🔴 모드 B는 App-level 파괴 트랜잭션(scenes+framePairs+srtTrack 함께 명시 저장, ownerSceneId 고아 0, storyId/fixedSceneState/busy 차단).
- 커밋 메시지 영어. batchStartGate/batchConsumeGate류 무관 모듈 무변경.

---

## File Structure (스펙 §9)
| 파일 | 책임 |
|---|---|
| `electron/api/llm/srtPrompts.js` (신규) | 순수 코어: DTO 매퍼, exact-once validator, writeScenePrompts, groupSrtLines |
| `electron/api/llm/prompts.js` | `buildSrtGroupPrompt` 추가 |
| `electron/api/llm/schemas.js` | GROUPS 스키마 |
| `electron/api/llm/{llmClaude,llmCodex,llmGemini}.js` | `groupSrtLines` 메서드 + `writePrompts` raw exact-once 검증 삽입 |
| `electron/ipc/srt-prompts-api.js` (신규) | stateless IPC(write-chunk/group/capabilities), engine·key·model 주입 |
| `electron/main.js`, `electron/preload.js` | IPC 등록 + 명시 bridge, `tests/electron/preloadContract.test.js` 갱신 |
| `src/hooks/useSrtPrompts.js` (신규) | 청크 루프 + race 가드 + flush |
| `src/hooks/useScenes.js` | bulk 필드-patch(빈것만/stale) + 모드 B 씬 교체 |
| `src/hooks/useProjectData.js` | 명시 저장에 framePairs payload/flush 추가 |
| `src/App.jsx` | 훅 배선·project identity·모드 B 파괴 트랜잭션·framePairsRef·모달 수명 |
| `src/components/SceneList.jsx`(+css), `src/components/SrtPromptModal.jsx`(신규+css) | 진입점 버튼(.scene-list-actions) + 모달 |
| `src/locales/{ko,en}.js` | i18n |

---

## Stage 1 — 순수 코어 (main, 타이밍-안전 + validator 급소). 스펙 슬라이스 1–5.
가장 위험한 불변식(타임코드 미통과·exact-once·DTO 키 부재)을 먼저 잠근다. 전부 순수 함수 단위 테스트라 loopback 무관.

### Task 1: DTO 매퍼 + resolveSceneText (슬라이스 1) — `srtPrompts.js`
**Interfaces — Produces:** `toPromptSceneDTO(scene, srtTrack) → {sceneNo, summary, text}|null`(text 없으면 null=skip), `resolveSceneText(scene, srtTrack)`, sceneNo 부여는 renderer가 전역 1-based ordinal(스펙 §3.1 M3).
- [ ] 실패 테스트: srtLineIds→srtTrack join / 없으면 subtitle / 둘 다 빈 문자열이면 null. **DTO 출력에 `imagePrompt`/`videoPrompt` 키 부재 단언**(스펙 §5, F5).
- [ ] RED 확인 → 최소 구현 → GREEN → 커밋.

### Task 2: 그룹 파티션 검증 + 씬 factory (슬라이스 2) — `srtPrompts.js`
**Produces:** `validateGroupPartition(groups, n)`(1..N 총망라·빈틈/중복/역순 없음, summary non-empty), `groupsToScenes(groups, srtTrack)`(factory 전체 필드 스펙 §4B, `characters:''`, 절대시간 파생, end≥start).
- [ ] 실패 테스트: 유효 파티션 통과 / 빈틈·중복·역순 거부 / **gap 있는 SRT의 startTime/endTime 보존**(재배치 0) / `characters:''`가 `checkTagMatch`(tagMatch.js:9-22) 무예외.
- [ ] RED → 구현 → GREEN → 커밋.

### Task 3: buildSrtGroupPrompt + GROUPS 스키마 + 빈 summary 계약 (슬라이스 3) — `prompts.js`/`schemas.js`
- [ ] 실패 테스트: `buildSrtGroupPrompt(numberedLines, opts)` 출력에 라인번호/텍스트만·타임코드 없음. GROUPS 스키마 `{groups:[{fromLine,toLine,summary}]}`. `buildPromptsPrompt`가 빈 summary에서 `N.  :: text`로 축약(prompts.js:409 계약).
- [ ] RED → 구현 → GREEN → 커밋.

### Task 4: 어댑터 raw exact-once validator (슬라이스 4) — 3 어댑터 + `srtPrompts.js`
**Produces:** `validatePromptScenesExactOnce(inputSceneNos, rawScenes)`(스펙 §3.1). 각 어댑터 `writePrompts`가 structured call 직후 raw `out.scenes`에 이 검증 후에만 Map.
- [ ] 실패 테스트(mock queryImpl/runJson/fetchImpl): duplicate·extra sceneNo·length≠N·빈 prompt를 raw에서 throw. llmGemini writePrompts가 이제 누락에 throw(happy-path만 있던 llmGemini.test.js:149-156 갱신, 스펙 §3.1 M1 story blast radius).
- [ ] RED → 구현 → GREEN → 커밋.

### Task 5: writeScenePrompts / groupSrtLines orchestration (슬라이스 5) — `srtPrompts.js`
**Produces:** `writeScenePrompts(dtoScenes, context, opts, deps) → [{sceneNo,imagePrompt,videoPrompt}]`(adapterScenes 변환 `segments:[{text}]`, 키 부재 단언, deps.writePrompts, 경계 재검증), `groupSrtLines(numberedLines, opts, deps)`(MAX_GROUP_LINES/CHARS 초과 `SRT_GROUP_INPUT_TOO_LARGE`, 파티션 검증, 1회 재요청).
- [ ] 실패 테스트(mock 어댑터): DTO→segments 변환 정확 / onlyEmpty 필터 / validator 실패 전파 / grouping 한도 초과 에러.
- [ ] RED → 구현 → GREEN → 커밋.

**🔴 Stage 1 게이트**: Opus가 `npm run test:run` 전체 직접 실행(그린) + Stage 1 급소 뮤테이션(타임코드 파생·validator exact-once·DTO 키 부재·grouping 한도) killed. Fable 적대적 리뷰 → findings 0.

---

## Stage 2 — IPC + capabilities + renderer 훅 (배선·race·저장). 스펙 슬라이스 6–7.

### Task 6: IPC + Gemini model resolver + capabilities (슬라이스 6) — `srt-prompts-api.js`/`main.js`/`preload.js`
**Produces:** `srt-prompts:write-chunk`/`:group`/`:capabilities` 핸들러(스펙 §3.2), Gemini curated allowlist ∩ /models resolver, capabilities `{available,reason,model?}` per engine(preflight: Gemini key+model, Claude non-swallowing rawQuery probe, Codex assertCodexChatGptLogin). preload 명시 bridge 3종.
- [ ] 실패 테스트(mock ipcMain/keyStore/어댑터): engine 선택 / **키 renderer payload 미포함** / **story machine 미호출** / Gemini model 부재 `GEMINI_STRUCTURED_MODEL_UNAVAILABLE` / capabilities reason 정규화. preloadContract 갱신.
- [ ] RED → 구현 → GREEN → 커밋.

### Task 7: useSrtPrompts 훅 — 청크 루프 + race 가드 + flush (슬라이스 7) — `useSrtPrompts.js`
**Produces:** `useSrtPrompts()` — 씬+문자 예산 청크, `sourceFingerprint = stableHash({scenes:[{sceneId,sceneNo,resolvedText}], srtLines:[{id,text,startTime,endTime}]})`, apply·flush 직전 project/epoch/fingerprint 재검사·폐기, 성공 청크 flush(`{ok,persisted,error?}`), 실패/취소/skip 리포트.
- [ ] 실패 테스트(mock IPC): 청크 분할 / 부분성공 즉시 반영 / **projectId·epoch·fingerprint mismatch면 응답 폐기** / non-folder persisted:false 처리 / 취소 청크 경계.
- [ ] RED → 구현 → GREEN → 커밋.

**🔴 Stage 2 게이트**: Opus 전체 스위트 직접 실행(그린) + race 폐기·키 격리·persisted 판정 뮤테이션 killed. Fable 리뷰(직전 findings 붙여) → findings 0.

---

## Stage 3 — 반영 + UI + 통합. 스펙 슬라이스 8–9.

### Task 8: useScenes 반영 (슬라이스 8) — `useScenes.js`/`useProjectData.js`/`App.jsx`
**Produces:** bulk 필드-patch(원래 빈 필드만, stale 마킹 useScenes.js:680-693), 모드 B `{nextScenes,nextFramePairs}` 계산+ownerSceneId 고아 제거+동기 commit, `saveCurrentProjectWithPayload`에 framePairs 인자 추가(useProjectData.js:420-427/1272), App `framePairsRef`(M4 stale-closure 회피).
- [ ] 실패 테스트: 필드단위 빈것만(채운 필드 보존) / stale 마킹 / 모드 B **framePairs 고아 0** / srtTrack 불변 / storyId 차단 predicate / framePairs 명시 저장 payload.
- [ ] RED → 구현 → GREEN → 커밋.

### Task 9: 모달 + 진입점 + 통합 (슬라이스 9) — `SrtPromptModal.jsx`/`SceneList.jsx`/locales
- [ ] 실패 테스트: 모달(모드/engine capabilities/스타일/덮어쓰기/진행·실패·unsaved·skip 리포트), SceneList `.scene-list-actions` 버튼, 통합("임포트→생성→반영→flush 저장", mock IPC), 대상 0 short-circuit. ko/en parity.
- [ ] RED → 구현 → GREEN → 커밋.

**🔴 Stage 3 게이트**: Opus 전체 스위트 + `npm run build` 그린. Fable 리뷰 → findings 0. 이후 **실앱 눈검증** + **Gemini 실호출 1회 스모크**(스펙 §10 미확인: allowlist 모델 responseSchema, Claude 미로그인 오류 문자열).

---

## Self-Review (스펙 커버리지)
- §3.1 코어 → Task 1/2/4/5. §3.2 IPC/capabilities/model → Task 6. §3.3 훅/race/flush → Task 7. §4A 모드A → Task 1/8. §4B 모드B → Task 2/8. §5 불변식 → Task 1/2/4 뮤테이션 게이트. §6 인증 → Task 6. §8 슬라이스 → Task 1–9 1:1. §9 파일 → File Structure. §10 미확인 → Stage 3 스모크 게이트. **갭 없음.**
- Placeholder: 없음(상세 코드 계약은 스펙 정본 참조, 각 Task는 검증가능 테스트 의도 명시).
- 타입 일관성: writeScenePrompts/groupSrtLines/toPromptSceneDTO/validatePromptScenesExactOnce/sourceFingerprint 시그니처가 Task 간 일관.
