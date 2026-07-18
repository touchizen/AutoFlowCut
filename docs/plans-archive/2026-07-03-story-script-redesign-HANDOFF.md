# Story 대본 스텝 재설계 — 세션 핸드오프 (2026-07-03)

> 새 세션은 이 문서만 읽으면 이어서 작업 가능. 사용자(tuxxon) 실기동 검토가 다음 액션.
> 브랜치 `feature/story-pipeline`, working tree **clean**. 전체 회귀 **3827 전부 통과**.

## 이번 세션에서 완료한 작업 (모두 `feature/story-pipeline`, Codex findings=0)

1. **M3 Claude 엔진 이식** (앞선 세션 연속) — 대본/씬분리/프롬프트를 Claude Agent SDK로. (이미 머지 대기)
2. **StoryView 폼 재설계** — 모델(opus/sonnet) 드롭다운, 길이 값+단위, 대본칸 PromptInput. Codex findings=0.
3. **abort 버그 수정** (커밋 6f54f77) — 중단 버튼이 running에 갇히던 것: `stepMachine.abort()`가 `story:state` 통지.
4. **장르 기본 bespoke** (4a90da0), **appxAssets 버전 2.1.0 sync** (31ce351, pre-existing 드리프트 정리).
5. **대본 스텝 2-phase 재설계** (커밋 e2346fd~5cb455e, 12 커밋) — 아래 상세.

## 대본 스텝 재설계 요지 (5번)

**2-phase 화면**: 설정 화면(setup) ↔ 대본 작업 화면(editor).
- setup: 세로 옵션(장르/모델/언어/길이+설명) + 제목 + **drag&drop 임포트(.txt/.md)** + `[✨ 시작]`
- editor: 대본칸(PromptInput, disableMentions/showCharCount/hideTip) + `[다시쓰기][이어쓰기][분리시작][⚙설정으로]`, 생성중 `[⏹중단]`
- **scriptText 단일 source of truth**(streamingText는 preview, 완료 커밋=main `payload.scriptText`), 재오픈 복원.
- **제목 자동생성**(제목 비면 `pipeline.generateTitle` 먼저), **이어쓰기**(`continueScript` base+delta), **편집 반영**(`start('scenes',{scriptOverride})`), **씬분리 5~10초**, 언어 ko/en 드롭다운.

**주요 파일**: `electron/api/llm/{prompts,llmClaude}.js`, `electron/story/stepMachine.js`, `electron/ipc/story-api.js`, `electron/preload.js`, `src/hooks/useStoryPipeline.js`, `src/components/PromptInput.jsx`, `src/components/story/StoryView.jsx`(+css), `src/App.jsx`(StoryView `key={storyProjectPath}`).

## 사용자가 할 일 (실기동 검토 — 다음 액션)

```bash
cd ~/workspace/AutoFlowCut && npm run dev   # 켜져 있으면 재시작 (코드 반영)
```
폴더 저장 모드 필수. 헤더 "스토리" 버튼 → Story 뷰.

1. **대본 스텝 UX**: 설정 화면(옵션+제목 or drag&drop) → `시작` → 대본 작업 화면 전환. 3버튼(다시쓰기/이어쓰기/분리시작), 제목 비우고 분리시작 시 제목 자동 생성 확인.
2. **M1 push 검증 (지난번 미확인)**: 대본→씬분리→**프롬프트 생성** 후, ⭐**헤더 "스토리" 버튼을 다시 눌러 씬 그리드('generate' 뷰)로 전환** → 씬들 + 이미지/비디오 프롬프트 입력창이 채워졌는지 확인. (Story 뷰와 씬 그리드는 별개 화면 — 코드/테스트상 push 흐름은 정상. 비어 있으면 그때 systematic-debugging.)

## 검토 결과에 따른 다음 액션

- **이상 없음** → spec/plan 커밋(주의: `docs/superpowers`·`.superpowers`는 **gitignore** → `git add -f` 필요) + main 머지 여부 결정. (사용자가 아직 머지 안 함.)
- **버그** → superpowers:systematic-debugging으로 근본원인 → TDD 수정(CLAUDE.md 규칙).

## 참고 문서

- **대본 스텝 재설계**: spec `docs/superpowers/specs/2026-07-03-story-script-step-redesign-design.md` (Codex spec 5R findings=0), plan `docs/superpowers/plans/2026-07-03-story-script-step-redesign.md`
- **폼 재설계**: `docs/superpowers/specs|plans/2026-07-03-storyview-form-redesign-*`
- **Claude 엔진(M3)**: `docs/superpowers/specs|plans/2026-07-03-story-claude-engine-*`
- **SDD 진행 원장**: `.superpowers/sdd/progress.md` (태스크별 커밋·리뷰 판정·Codex 라운드 전체)

## 후속 이슈 (Minor, 비차단 — 원장에 상세)

- Task 9 Minor: 제목 자동생성 async 갭 중 버튼 미비활성(느린 생성 시 더블클릭 → 중복 start), editor의 isRunning=currentStep 기준 엣지, drag&drop 읽기 실패 토스트 없음(데이터 보존은 됨).
- Task 8 Minor: scriptPhase/currentStep 커플링(Task 7 유래).
- 이어쓰기: 완결 대본에 억지 확장 가능(항상 노출, 사용자 판단).

## M2/M3 블로커 (이전 세션 기록 유지)

- M2(오디오/TTS): ffmpeg 번들 전략 미결정 시 시작 금지.
- 대본 편집→프롬프트 삽입/레퍼런스 캐릭터 등록/시놉시스(W2)는 **미구현** — 사용자가 "M1 먼저 검증 후" 로 우선순위 정함.
