# Story M1 폴리싱 + M2~v2 로드맵 — 세션 핸드오프 (2026-07-03)

> 새 세션은 이 문서만 읽으면 이어서 작업 가능. 브랜치 `feature/story-pipeline`. M1 폴리싱 완료(Codex findings 0), 다음은 M2 착수.

## 이번 세션에서 완료 (M1 뷰 폴리싱 — 7커밋, 전부 feature/story-pipeline)

실기동 검증 중 발견한 UX/버그 수정 묶음. **Codex Review로 findings 0까지 수렴 완료**(4→3→1→0).

| 커밋 | 내용 |
|------|------|
| `cd2ede4` | 스크롤 고정(스텝퍼/컨트롤 고정, 패널만 스크롤), editor min-height 사슬, 설정 레이아웃(라벨 좌/값 우 그리드+가운데), 대본 카운트 "N줄", 진행 초시계+경과시간, 탭 네비게이션(currentStep 클릭+viewedStep 리셋) |
| `90a54f3` | 씬 분리 입도 옵션(씬 기준/문장 기준) + 대본 임포트 파일 선택 버튼 |
| `4b4b47d` | 씬분리 진행 화면에 씬 분리 단위+기준 요약 표시 |
| `6278d59` | 씬분리 탭 재분리 옵션(단위 변경+다시 분리) |
| `6ef0075` | Codex findings 1차(F1~F4): fresh 대본탭 setup유지 / sceneGranularity 유실방지 / running 재오픈 진행화면 / **StopwatchIcon·ElapsedTime 공통 컴포넌트 추출**(6곳 통합) |
| `fc42eb5` | Codex findings 2차: running 재오픈 중단버튼 / script패널 scriptRunning 분기 / Clip ElapsedTime 통일 |
| `26d3630` | Codex findings 3차: editor controls는 isRunning 기준(abort 유지), stream 렌더만 scriptRunning |

**전체 회귀 3856 통과.** 새 공통 컴포넌트: `src/components/StopwatchIcon.jsx`(StopwatchIcon, ElapsedTime).

## 핵심 파일

- `src/components/story/StoryView.jsx` — 상태: scriptPhase(setup/editor/null)·viewedStep·currentStep·displayStep, isRunning(currentStep) vs scriptRunning(script만), hydratedRunning(재오픈 running 가드)
- `src/components/story/StoryStepper.jsx` — clickable = done || currentStep
- `electron/api/llm/prompts.js` — `buildSplitPrompt(opts.sceneGranularity)`: scene(5~10초) / segment(문장단위, 화자변경 분리, 짧은조각 병합, 긴문장 10초↑ 분할)
- `src/components/StopwatchIcon.jsx` — 공통(신규)

## 다음: M2 (오디오/TTS) — ⚠️ 스펙 방향 바뀜

**중요 결정(이번 세션, 사용자와 합의): ffmpeg 불필요.**
- 원 스펙(design.md §4-③)은 `full_narration.mp3` concat(ffmpeg 번들 = 릴리스 블로커)이었으나 **폐기**.
- **새 방향**: AutoFlowCut은 최종 렌더러가 아니라 **CapCut/Premiere/Vrew 프로젝트 생성기**. TTS **세그먼트별 오디오 조각을 export 타임라인(currentTimeMs, 이미 capcut.js:78~100에 있음)에 그대로 배치** → 편집기가 렌더링. concat/정규화/ffmpeg 전부 불필요.
- 오디오 길이는 `music-metadata`(순수 JS)로 측정 → 타임라인 위치. SRT는 조각 길이 누적으로 생성.
- **export가 현재 오디오 미포함**(M1이라). M2에서 세그먼트별 오디오 클립을 exporters(capcut/premiere/vrew)에 추가하는 게 핵심.
- ffmpeg-static 논의는 무의미해짐(AGPL이라 GPL도 OK였지만 애초에 안 씀).

**M2 착수 순서**: design.md의 M2 오디오 스펙을 위 새 방향으로 재작성 → TDD 구현 → 마일스톤 완료 시 Codex Review(findings 0).

## SFX 정밀 배치 (원래 v2, 사용자 관심 큼)

- story-engine의 타임코드 파일명 방식은 **부정확**(텍스트 위치→시간 추정, TTS 실제 타이밍과 어긋남).
- **해법 = 3요소 조합**: ① LLM(SFX를 어느 단어/문장에 넣을지 연출 판단) + ② **word-level timestamp**(TTS provider, ElevenLabs alignment 등 — 그 단어의 실제 오디오 시각) + ③ 세그먼트 입도(문장 기준이면 앵커 오차 작음).
- SFX/캐릭터 Ref는 스펙상 **v2**(§9). 사용자가 우선순위 당길 수 있음.

## 로드맵 (사용자 확정: v2까지, 각 마일스톤마다 Codex Review)

```
M1(완료) → M2(나레이션 오디오, ffmpeg 없이 세그먼트별 export)
        → M3(Claude 경로: Agent SDK 구독로그인+검토루프+정책 — 크리덴셜 라이프사이클 블로커 확인)
        → v2(§9): 캐릭터 Ref 자동등록·SFX·화자 멀티트랙·BGM·다국어·프롬프트 QA·유료화
```
v3는 없음(story 스펙 기준). v3 언급 파일은 별개 프로젝트(flow-chrome-extension, nogo).

## 작업 규칙 (메모리에 기록됨)

- **마일스톤마다 Codex Review**: `mcp__codex__codex` subagent, 구조·공통/중복·에러방지 관점, findings 0까지 loop. Codex가 findings 제출 → 내가 검토·수정. (메모리: codex-review-per-milestone)
- **어려운 난제는 Fable 5 subagent**(`model: 'fable'`). (메모리: use-fable5-for-hard-problems)
- **컨텍스트 3% 남으면 handoff 작성 후 멈춤**(이 문서가 그 산출).
- CLAUDE.md: 모든 변경 TDD, 커밋 전 전체 회귀(`npm run test:run`), 커밋만 사용자 요청 시.

## 참고 문서

- 스펙(gitignore): `docs/superpowers/specs/2026-07-02-story-pipeline-design.md` (§9 v2목록, §10 마일스톤, §4-③ 오디오 — M2 재작성 대상)
- 이전 핸드오프: `docs/superpowers/plans/2026-07-03-story-script-redesign-HANDOFF.md`
