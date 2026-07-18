# 스토리 파이프라인 M1 — 세션 핸드오프 (2026-07-03)

> 새 세션 시작 시 이 문서만 읽으면 이어서 작업 가능. 사용자(tuxxon)가 수동 테스트 예정이며, 이상 없으면 머지가 다음 액션.

## 현재 상태 (완료)

- **브랜치**: `feature/story-pipeline` (main 분기점 `cf670bf`, **33 커밋**, working tree clean)
- **테스트**: `npm run test:run` → **3709/3710 PASS**. 유일 실패 `tests/packaging/appxAssets.test.js`는 **pre-existing** (package.json 2.1.0 vs 테스트 하드코딩 2.0.1 — BASE에서도 실패 재현 확인, 이 브랜치 무관)
- **빌드**: `npx vite build` 성공
- **리뷰 상태**: 전부 종결
  - 태스크별(1~11) 구현자+리뷰어 서브에이전트 리뷰 전부 Approved (fix 라운드 포함)
  - 최종 whole-branch 리뷰 (Fable): **"머지 가능"**
  - Codex 교차 리뷰 4라운드: 5→5→1→**FINDINGS: 0**
- **기능**: 제목 입력 → ①대본 생성(Gemini 스트리밍) → ②씬/화자 분리 → ④씬별 프롬프트 → 기존 씬 그리드 push. 대본 붙여넣기로 ① 스킵 가능. ③오디오는 M2.

## 사용자가 할 일 (수동 테스트)

```bash
cd ~/workspace/AutoFlowCut && npm run dev
```

1. **폴더 저장 모드**여야 함 (로컬 모드면 Story 뷰에 안내 배너)
2. Header **"스토리"** 버튼 → 제목/장르/길이/언어 입력 → "대본 생성" (스트리밍 표시 확인)
3. "씬 분리 실행" → 씬·세그먼트 테이블 확인 (스텝퍼에서 done 스텝 클릭하면 해당 패널 재열람 가능)
4. 프롬프트 생성 → **기존 씬 그리드에 씬 push 확인** (타이밍은 낭독 추정 폴백값)
5. 대본 붙여넣기 → "대본으로 시작" 경로도 확인
6. 산출물 위치: `<프로젝트폴더>/story/` (story.json, script.md, scenes.json)
7. Gemini API 키는 기존 설정 그대로 사용 (텍스트 모델: gemini-2.5-pro 기본)

## 테스트 결과에 따른 다음 액션

- **이상 없음** → main 머지:
  ```bash
  cd ~/workspace/AutoFlowCut && git checkout main && git merge feature/story-pipeline
  ```
  머지 시 함께: 이 핸드오프와 M1 플랜(`docs/superpowers/plans/2026-07-02-story-pipeline-m1.md`)을 `docs/plans-archive/`로 이동 (CLAUDE.md 규칙 — docs/superpowers는 gitignore라 mv 후 git add). 스펙은 M2/M3 계약 포함이라 specs/에 유지.
- **버그 발견** → 증상 확인 후 회귀 테스트 먼저 작성(TDD, CLAUDE.md 규칙) → 수정. 아키텍처 배경은 아래 파일 맵과 스펙 참조.

## 파일 맵 (신규/수정)

| 영역 | 파일 |
|---|---|
| 스텝 머신 (main) | `electron/story/stepMachine.js` — 오케스트레이션, push revision, 재발신, abort 하드닝 |
| 영속화 | `electron/story/storyStore.js` — story.json 원자적 쓰기(직렬화 큐) |
| 씬 identity | `electron/story/sceneIdentity.js` — storyId(uuid) 1:1 보수 승계 |
| 타이밍 | `electron/story/timing.js` — 낭독 추정(ko 5.5자/s), M1 폴백 타임라인 |
| LLM | `electron/api/llm/llmGemini.js`, `schemas.js` — SSE 스트리밍, structured output, 재시도 분리 |
| IPC | `electron/ipc/story-api.js` (+`main.js` 등록, `preload.js` 브릿지) — projectToken 가드, open 직렬화, workFolder 경로 검증 |
| renderer 훅 | `src/hooks/useStoryPipeline.js` (이벤트 구독·ack 트랜잭션·렌더 동기 토큰 무효화), `useStoryAutoOpen.js` |
| 씬 그리드 통합 | `src/hooks/useScenes.js` → `importStoryScenes` (storyId upsert, stale 플래그), `useProjectData.js` → `saveCurrentProjectWithPayload` |
| UI | `src/components/story/StoryView.jsx`, `StoryStepper.jsx`, `StoryView.css` (+Header 진입, locales `header.story`) |
| 테스트 | `tests/electron/story/`, `tests/electron/api/llm/`, `tests/electron/ipc/`, `tests/hooks/`, `tests/components/story/`, `tests/integration/storyPipelineM1.test.js` |

## 핵심 설계 계약 (디버깅 시 참조)

- **정본 스펙**: `docs/superpowers/specs/2026-07-02-story-pipeline-design.md` (v9). 플랜과 충돌 시 스펙이 이김
- push 원자성: renderer가 `importStoryScenes`+`saveCurrentProjectWithPayload`를 한 트랜잭션으로 → 성공 시에만 `story:pushAck` → main이 그때만 `pushedAt`/`lastPushedRevision` 기록. 재발신 조건: `prompts done && pendingPushRevision > lastPushedRevision` (open/getState 시)
- 모든 IPC payload는 `{ projectToken, operationId, ... }` 객체형, 토큰 불일치 이벤트는 renderer가 drop
- 씬 확장 필드는 `storyId/stalePrompt/stalePromptAt/staleVideo/staleVideoAt`만 (project.json schemaVersion 불변)
- stale 판정 필드: 이미지 `image/imagePath`, 비디오 `videoT2V/videoT2VPath/videoI2V/videoI2VPath`

## 진행 기록

- **SDD 원장**: `.superpowers/sdd/progress.md` — 태스크별 커밋·리뷰 판정·이월 minor 전체 목록 (gitignore)
- 태스크 브리프/보고: `.superpowers/sdd/task-*-{brief,report}.md`, 최종 fix 보고 `final-fix*-report.md`

## 후속 이슈 (머지 후, 우선순위 낮음 — 원장에 상세)

- 짧은 텍스트 포함매칭 오탐 가드 (sceneIdentity, M2 전 권장)
- storyStore.load catch-all이 손상 story.json을 조용히 초기화 — 경고 로그
- saveCurrentProjectWithPayload `{ok:false}`에 error 사유 없음 → pushAck reason generic
- useStoryAutoOpen open 실패 시 재시도 불가 + unhandled rejection
- generateScript abort/5xx 재시도 테스트 공백
- Story 씬 재push 시 그리드 수동 정렬(moveScene) 파괴 가능 (M-3)
- `story.*` i18n 키가 로케일에 없음 (한국어 하드코딩 폴백만) — en 지원 시 추가

## M2/M3 착수 전 블로커 (스펙 §10, 메모리에도 기록됨)

- **M2 (오디오/TTS)**: ffmpeg 번들 전략 결정 필수 — ⑴ ffmpeg-static(GPL 법적 검토) ⑵ LGPL 빌드 ⑶ 최초 실행 시 다운로드 ⑷ 순수 JS+WAV(ElevenLabs pcm output_format 지원 확인 필요). 미결정 시 M2 시작 금지
- **M3 (Claude)**: Agent SDK 구독 크레딧 정책(2026-06-15 발표, Pro $20/Max 5x $100/Max 20x $200, 서드파티 앱 허용) **시행 여부 확인** — 연기 상태였음. 미시행이면 feature flag. 크리덴셜은 `CLAUDE_CONFIG_DIR` 앱 전용 격리. **llmClaude는 AbortSignal 협조 필수** (stepMachine stale 가드가 signal 계약 전제)
