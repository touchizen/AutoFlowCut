# 구현 플랜 — 인앱 에이전트 오케스트레이션 (2026-07-12)

**정본 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` (D23·D24 교차 리뷰 findings 0 완료)
**브랜치**: `feature/inapp-agent` (main에서 분기)

---

## 0. 작업 분담 (CLAUDE.md 교차 리뷰 규칙)

| 성격 | 담당 |
|---|---|
| **어려운 것** — 코드 고고학, 미묘한 설계, 트랜잭션/동시성/identity | **Codex `gpt-5.6-sol`** (`mcp__codex__codex`, sandbox `workspace-write`) |
| **기계적인 것** — 배선, 테스트, 빌드, 설정 | **Claude** |
| **리뷰** | **누가 쓰든 다른 쪽이 뜯는다.** 마일스톤 끝마다 findings 0까지 loop |

⚠️ Codex는 이전 맥락을 못 본다 — 매 호출에 **완전한 맥락(왜/앵커/금지사항/직전 findings)**을 다 실어야 한다.

**모든 코드는 TDD.** 실패하는 테스트 → 최소 구현 → 통과 → 리팩터. 테스트 없이 머지 없음.

---

## 1. 실행 순서 (스펙 §3에서 유도)

```
M-1 하네스  ──▶  M1a (D24a 스토리보드)  ──▶  ship 가능
   │                    (에이전트와 무관, 단독 출하)
   │
   └──▶  M0 스파이크  ──▶  M1 Tool Core  ──▶  M2 AgentSession  ──▶  M3 ──▶ M4 ──▶ M5
         (라이브 측정,           (M0 결과가
          사용자 개입 필요)        스펙을 이긴다)
```

**왜 M1a를 M0보다 먼저 하나**: D24a는 **Tool Core 호출이 0개**다(이미지 + 씬 CSV → deterministic 변환). 에이전트 스택 전체가 M0 결과에 걸려 있는데, 제품 가치가 가장 큰 경로가 거기 인질로 잡힐 이유가 없다. 스펙 §3 M1a도 "AgentSession/MCP/Codex 결과와 무관하게 먼저 ship할 수 있다"고 못박았다.

**M0가 막고 있는 것**: M2(Codex ship 여부), M3의 D24b(이미지-온리), D23의 BYOK 노출. 이건 라이브 측정이라 **사용자 머신 + 실제 CLI 로그인 + 최대 60분 workflow**가 필요하다 — 별도 세션으로 잡는다.

---

## 2. M-1 — 하네스 (Claude, 지금)

스펙 §3 M-1 / §4 M-1 슬라이스 3개.

| 할 일 | 함정 (스펙이 이미 경고) |
|---|---|
| `vitest.config.js`에 `test.projects` 도입 | **Vitest 4에서 `vitest.workspace.js`는 제거됨** (설치본 4.1.10) |
| `vitest.spike.config.js` 분리, `tests/spike/**`를 `test:run`에서 제외 | `SPIKE=1`로만 실행. CI 제외 |
| long-run 프로젝트 timeout **> 75분** | 10분 approval + 60분 workflow + cleanup을 덮어야 함 |
| `@playwright/test` devDependency 추가 | 현재 `package.json`에 없음 |
| Playwright Electron `executablePath` 명시 | **postinstall이 Electron 바이너리를 `AutoFlowCut.app`으로 개명**한다 (`scripts/patch-electron-name.cjs`) |
| `tests/spike/fixtures/echo-mcp.js` | `echo` + gated `echo_gated`(handler 안에서 MCP elicitation). **M0-8/M0-9는 이 fixture에 붙는다 — 제품 Tool Core/HTTP 사용 금지** |
| Playwright 하네스 ↔ packaging smoke 분리 | `main`이 `dist-electron/main.js` → **[P] 슬라이스는 빌드 선행** |

**슬라이스**
1. `[U]` spike test가 `npm run test:run`에 **포함되지 않는다**
2. `[N]` echo MCP fixture가 stdio initialize/list/call을 반환한다
3. `[P]` 빌드된 Electron을 명시 `executablePath`로 띄운다

**검증**: 기존 530파일 5485테스트가 그대로 통과 + 위 3개 GREEN.

---

## 3. M1a — D24a 스토리보드 우선 (Codex 주도, 지금)

**이게 제품이다.** 이미지 N장 + 기존 씬 CSV → deterministic fixed scenes → TTS → export. LLM 씬분리 0회.

리뷰 10라운드가 깎아낸 급소들 (전부 구현에서 지켜야 함):

- **단일 시계** — exporter는 씬을 **누적 duration**으로 깐다(`prepareCloudRequest.js:202`, `scene.startTime`을 안 읽음). `regroupScenes`를 빼면 이미지와 오디오가 누적 desync. → **slot-anchored 타임라인** + `Σ image_duration[0..k-1] === sceneStart[k]` 불변식.
- **push/revision 소유권** — 첫 push와 manifest 재스탬프를 **prompts 스텝이 소유**(`stepMachine.js:1141-1164`). image-first는 audio의 `timingOnly`(`:1085`)를 **강제 해제**해야 함 (안 그러면 새 prompt-sync 프로토콜이 전부 죽은 코드).
- **import transaction** — staging → journal → 원자 커밋. 6개 whole-file writer(autosave 1초 debounce 포함)를 `isImportingRef`로 막고, `onPushScenes`도 여섯 번째 writer다.
- **게이트 두 곳** — `rosterEnforced()`(`:283`)와 미확정 게이트(`:1704`)가 **각각** `['title','pasted']`를 하드코딩. 공용 predicate로.
- **모든 거절은 mount된 surface** — `fixed-clock-not-ready`/`fixed-slot-missing`/`fixed-scenes-stale`은 generate view에서 발화하는데 StoryView는 거기서 unmount다 → toast.

**슬라이스**: §4 M1a — D11 30a/30b/30c(PNG normalizer/strict guard/stage guard), D17 storyboard partial-roster guard, D24-C1~C6, D24a-1~15.

**순서** (각 단계 TDD, 각 단계 끝에 교차 리뷰):
1. `storyboardInput.js` — raw CSV 파서(행 단위 보존) + Storyboard profile 검증 → **Codex**
2. `fixedScenes.js` — 공통 validator (identity/coverage/finite timing) → **Codex**
3. staging/journal/commit IPC + `isImportingRef` 6-writer 게이트 → **Codex** (동시성)
4. slot-anchored timing (`timing.js`) + audio 분기 + `timingOnly` override → **Codex**
5. prompt-sync 스텝 (LLM 0회, revision/push 소유) → **Codex**
6. ImportModal 다중 이미지 + 순서 확인 + 오류 row alert → **Claude**
7. StoryView 라우팅/컨트롤 숨김/toast + i18n → **Claude**
8. export readiness/completeness 게이트 (4개 진입점) → **Claude**

---

## 4. M0 — 스파이크 (사용자 개입 필요, 별도 세션)

**제품 코드 0줄.** 17개 항목(M0-S01~S17) + D23-1/D23-2. 산출물: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md`.

필요한 것:
- Claude / Codex CLI가 **실제로 로그인된** 머신
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (BYOK 경로 실측용)
- 최대 **60분 workflow** + 10분 approval hold 런
- **M0-S17(D24b blind gate)**: 사람이 ordered image set 3개를 blind 평가 (한 set은 N=maxN, 한 set은 N≥20)

**가장 중요한 하나 — M0-2/M0-S02**: 12분 블로킹 MCP 툴이 **종단 `tool_result`로 오는가** (백그라운드 핸들이 아니라). 실패하면 폴링으로 붕괴하고 턴 예산이 33~45 → 280턴. **이 하나가 전체 설계를 좌우한다.**

---

## 5. 리뷰 게이트

| 언제 | 무엇을 |
|---|---|
| M-1 끝 | 하네스 (Codex가 뜯는다 — Claude가 썼으니) |
| M1a의 각 Codex 단계 끝 | Claude가 적대적으로 뜯는다 |
| M1a 끝 | 전체 (findings 0까지) + **실앱 눈검증** |
| M0 끝 | **결과의 해석** (코드가 아니라 판정: "이 측정이 정말 그 결론을 지지하나?") |

**리뷰 프롬프트에 반드시** (10라운드가 가르쳐준 것):
1. 모든 앵커를 직접 열어 대조하라. 드리프트/조작 앵커 자체가 finding.
2. **부재·개수 주장을 grep으로 반증하라.** ("autosave 없다"→있었다, "writer 셋"→여섯, "리터럴 둘"→다섯)
3. **모든 신규 메커니즘의 caller를 기본 설정 상태로 끝까지 걸어라.** 심볼 존재 ≠ 분기 도달 가능.
4. **모든 거절은 그 view에서 mount된 surface가 있어야 한다.**
5. 직전 findings를 통째로 붙여라. findings 0까지 loop.
