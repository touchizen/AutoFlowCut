# 핸드오프 — 인앱 에이전트 오케스트레이션 (2026-07-12)

**브랜치**: `main` (HEAD `e9ee291`) — **아직 작업 브랜치 안 팠음**
**상태**: 설계 완료, **코드 0줄**. M-1(하네스)부터 착수 가능.

---

## 0. 이 세션이 한 일 (한 줄)

**인앱 에이전트 오케스트레이션 스펙을 v0→v11까지 썼고, 교차 리뷰 6라운드로 BLOCKER 8→0 까지 수렴시켰다. 코드는 안 건드렸다.**

---

## 1. 정본 문서

| 파일 | 상태 |
|---|---|
| **`docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md`** | ✅ **정본. 이걸 봐라** (1026줄) |
| `...-spec.md` (접미사 없음) | ❌ **폐기본 v7.** 파일명이 깔끔해서 헷갈린다. **읽지 마라** |
| `...-spec-v8/v9/v10.md` | 중간 판본. 이력용 |
| `docs/plans-archive/2026-07-11-llm-orchestration-mcp-spec-REJECTED.md` | v0 (MCP 브릿지 우선) — 폐기 |

**⚠️ 파일명 정리 필요**: `spec.md`(v7 폐기본)를 아카이브로 보내고 v11을 정본 이름으로 올릴 것.

---

## 2. 지금 당장 해야 할 것 (우선순위)

### ① D23 · D24 리뷰 — ✅ **둘 다 완료 (2026-07-12)**

**D24: 적대적 교차 리뷰 10라운드 완료.** Claude 서브에이전트가 뜯고 → Codex(gpt-5.6-sol)가 고치고 → 다시 뜯기를 반복. findings 추이 **17 → 9 → 6 → 6 → 5 → 3 → 4 → 2 → 4 → 0**. 최종 판정: **스펙으로 출하 가능.**

**D23: 같은 방식 5라운드 완료.** findings 추이 **17 → 7 → 7 → 5 → 0**. 최종 판정: **스펙으로 출하 가능.**

D23에서 나온 것 (전부 실물 확인):
- **`SAFE_ENV_KEYS`는 버그가 아니라 가드였다.** 원안은 "`OPENAI_API_KEY`가 없어서 BYOK가 막힌다 → 추가하라"였는데, 그건 **사용자 셸의 키가 child로 새는 걸 막는 장치**고 `codexSdk.test.js:59`가 이미 그걸 단언한다. 처방대로 했으면 cli-local 사용자가 모르는 새 API 과금으로 넘어갔다. → 가드 유지 + **필터 뒤 명시 주입**.
- **Claude 경로엔 env 핀이 아예 없었다** (`claudeSdk.js`에 `env` 0회). SDK 기본이 `{...process.env}` 상속이라 **셸에 `ANTHROPIC_API_KEY`가 있으면 지금도 조용히 BYOK로 돈다** — "우리는 사용자가 만든 로컬 자격증명을 읽을 뿐"이라는 **법적 논거를 코드가 강제하지 않았다.** 게다가 3-var denylist로는 부족하다(`CLAUDE_CONFIG_DIR`이 자격증명 루트, `CLAUDE_CODE_USE_BEDROCK`/`ANTHROPIC_BASE_URL`이 경로를 갈아탄다) → Codex처럼 **allowlist**로.
- **`codexSdk.js:114`가 ChatGPT `auth.json`을 임시 CODEX_HOME으로 무조건 복사한다** → BYOK 모드에서도 구독 토큰이 child로 간다. **"BYOK가 회색지대를 피한다"는 핵심 근거가 거짓**이었는데, D23-2 테스트는 전부 green으로 통과했다(전형적 paper fix).
- **세 번째 codex spawn 경로**(`listCodexModels` → `withAppServer` → `openAppServer`의 `env = process.env` 기본값)가 필터·임시홈을 **전부 우회**. 그런데 그걸 고치자 이번엔 **임시홈 disposer가 없어** 매 실행마다 `/tmp`에 `auth.json` 복사본이 쌓이는 새 결함이 생겼다(`withAppServer`의 `finally`엔 cleanup이 없다).
- D23은 **§4/§5에 아예 배선이 안 된 산문**이었고(M0 슬라이스에 `D23-*` 0개), `keyStoreMulti.js`는 **이미 존재**하며 `anthropic` 슬롯까지 있는데 **읽는 곳이 0개**, `ApiKeyTab.jsx`는 **Gemini 전용 탭**이라 거기에 엔진 인증을 넣으면 3층 분리가 첫 커밋에 무너진다, 팩트체크는 엔진과 무관하게 **Claude 하드코딩**(`FACTCHECK_LLM`)이라 "Codex×BYOK" 조합이 성립 불가였다.
- **ToS 회색지대**는 §7 리스크로 등록됐다(오너 + 2026-07-31 문의 기한 + 불리한 답변 시 fallback). **단, BYOK가 fallback이 되려면 "클린 머신에서 BYOK만으로 완주"가 GREEN이어야 한다 — 아직 측정 안 됨.**

- D24는 **D24a(스토리보드 = 이미지+씬 CSV, 에이전트 무관, M1a 단독 출하) / D24b(이미지만, M0 blind 측정 게이트 뒤)** 로 쪼개졌다. 순서가 뒤집혔다 — 권장 경로인 (b)가 먼저다.
- **앵커 조작·드리프트는 0건이었다.** 진짜 병은 **"인용하지 않은 스텝을 통째로 빼먹은 것"**: exporter의 누적 타임라인(`prepareCloudRequest.js:202`가 `scene.startTime`을 안 읽는다), prompts 스텝의 push/revision 소유권, `script.md`/step status heal, `project.json` 저장 화이트리스트, 1초 debounce autosave, `parsers.js`의 행→씬 붕괴, `preload.js` strict allowlist.
- **반복된 실패 모드 둘** (매 라운드 걸림): ① **caller 없는 메커니즘** — 핸들러/툴/헬퍼를 만들고 그걸 부르는 곳을 안 씀. ② **거짓 부재/개수 주장** — "autosave 없다"(실재), "리터럴 두 개"(다섯 개), "whole-file writer 셋"(여섯), "image clock은 한 경로"(둘). ③ 파생: **거절이 닿을 수 없는 surface** — 에러는 올바르게 반환되는데 그걸 보여줄 컴포넌트가 그 view에서 unmount 상태.
- **→ 다음 리뷰 프롬프트에 반드시 넣을 것**: "모든 앵커를 직접 열어라. **부재/개수 주장은 grep으로 반증하라.** **모든 신규 메커니즘의 caller를 기본 설정 상태로 끝까지 걸어라** — 심볼이 있는 것과 그 분기가 실제로 도달 가능한 것은 다르다. **모든 거절은 그 view에서 mount된 surface가 있어야 한다.**"

**D23 (인증 3층 분리)은 아직 리뷰 안 받았다.** 앱 인증(Firebase) / Gemini 키(BYOK) / Claude·Codex(Story 전용, 사용자가 이미 로그인해둔 CLI를 읽을 뿐). **"앱은 로그인을 offer 하지 않는다"** 가 핵심. 약관 회색지대는 회색지대로 남겨둠.

### ② 측정 — **사용자가 하기로 함**

**앱에서 대본 분량을 `10000자`로 놓고 한 편 돌려서** 셋을 확인:
1. 대본이 실제로 1만자 나오나 (6~7천에서 끊기면 청킹 필요)
2. **뒷부분 품질이 무너지나** (앞 30% vs 뒤 30% 비교) — 토큰 한도랑 무관한 문제라 **돌려보지 않으면 모른다**
3. **씬 분리가 다 나오나** (150씬쯤 나와야 함. 80~100에서 끊기면 구조화 출력이 잘린 것 — 여기가 대본보다 먼저 터질 확률 높음)

**이 결과가 "청킹(막 단위 생성)이 필요한지"를 결정한다.** 필요하면 인앱 에이전트보다 먼저다 — **스텝이 30분짜리를 못 뱉으면 에이전트가 아무리 똑똑해도 소용없다.**

### ③ Veo 오디오 볼륨 — ✅ **완료 (2026-07-12), 브랜치 `feature/veo-audio-volume` 커밋 `c652899`**

**⚠️ 위의 원래 안(앱이 `volume` 전송 → GCF가 수용)은 틀렸다. GCF 수정이 필수라 폐기.**
GCF의 영상 오버레이 세그먼트 빌더(`whisk2capcut/functions/index.suffixed.js:1193-1208`)는 **`segment.volume`을 아예 쓰지 않는다** — 앱이 보내봐야 무시당한다.

**실제 해법: 앱이 GCF에서 받은 draft JSON을 디스크에 쓰기 직전 패치한다. GCF 0줄.**
draft는 GCF가 만들지만 **쓰는 건 앱**이다 (`src/exporters/capcutCloud.js:85` `draftInfo` 수신 → `:166` `writeCapcutProject`).

- 신규 `src/exporters/videoAudioVolume.js` — 오버레이 **파일명 집합**에 속한 material을 참조하는 세그먼트만 패치 (CapCut은 정지 이미지도 `materials.videos`에 담는다 — `type:'photo'`)
- 옵션(하드코딩 아님): **음소거(0, 기본)** / 앰비언스(0.15) / 원본(1). 미설정이면 draft 불변 = 기존 동작
- Export 모달 UI + `useExportSettings` localStorage
- 테스트: 단위 7 + 통합 3 + UI 3. 전체 스위트 530파일 5485테스트 통과

**남은 것**: ① 실제 export → CapCut에서 영상 트랙 볼륨 0 **눈검증** (draft JSON까지만 테스트가 보증). ② **Premiere 경로** — 앱이 `premiereXml` 문자열을 받아 이미 치환 후 쓰므로(`premiereCloud.js:118,131`) 같은 앱-온리 패치가 가능해 보이나, `whisk2premiere` GCF의 videoOverlays 처리부에 audio/gain 코드가 안 보여 **영상 오디오가 XML에 실리는지 실측 전엔 단정 불가.**

### ④ 아카이브 커밋 — staged 상태

완료된 스펙/플랜 13개를 `docs/plans-archive/` 로 옮겨놨다 (git status에 `R` 로 보임). **커밋 안 했다.** CLAUDE.md 규칙상 커밋해야 한다.
**커밋 메시지는 영어로.** (사용자가 여러 번 지적)

---

## 3. 작업 방식 (CLAUDE.md 에 박아둠)

**Claude ↔ Codex 교차 리뷰.** 누가 쓰든 다른 쪽이 뜯는다.

- **어려운 것 → Codex `gpt-5.6-sol`** (`mcp__codex__codex`, `sandbox: workspace-write`). 코드 고고학, 미묘한 설계.
- **기계적인 것 → Claude.** 배선, 테스트, 빌드.
- ⚠️ **Codex는 이전 맥락을 못 본다.** 매 호출이 새 세션 — **완전한 맥락(왜/앵커/금지사항)을 프롬프트에 다 실어야 한다.**
- **리뷰 트리거 셋**: 마일스톤 끝(코드) / 설계가 바뀔 때(스펙, 마일스톤 안 기다림) / 스파이크 끝(결과 해석).

**⚠️ gpt-5.6-sol 은 Codex CLI ≥ 0.144.1 필요.** MCP 서버가 옛 바이너리를 물고 있으면 `pkill -f "codex mcp-server"` 후 **Claude Code 완전 종료**(리로드 아님).

---

## 4. 이 문서의 반복된 병 — **반드시 읽을 것**

리뷰 6라운드가 **같은 실수를 다섯 번** 잡았다. **이름을 읽고 그 물건을 열어보지 않은 것:**

| # | 무엇을 믿었나 | 실제 |
|---|---|---|
| 1 | 문서(CLAUDE.md)가 `flow:*` 를 영상 엔진이라 함 | **`mode.js:16` `currentMode='api'`** — Flow는 레거시. 실제는 `genai:generate-video` (Veo) |
| 2 | `useFileSystem.js:49` 라는 **이름**이 setter 같음 | 네이티브 다이얼로그를 띄우는 함수 |
| 3 | JSDoc 의 `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` | **바이너리에 0회 등장하는 유령.** 실재는 `MCP_TOOL_TIMEOUT` |
| 4 | 화자 롤백 버그 | **지어냈다.** `stepMachine.js:1075` 가 이미 영속화 |
| 5 | `approvalPolicy:'never'` → "Codex는 툴 루프 못 돈다" | **작가용으로 일부러 잠근 설정.** Codex CLI는 `codex mcp` 로 MCP 지원 |

**→ 확인 안 한 것은 단정하지 말고 스파이크로 미룰 것.**

---

## 5. 제품을 죽일 뻔한 발견 둘 (스펙에 반영됨)

### ⚠️ 크레딧 게이트 우회

**`consumeBatchDownload`(배치 1건=1크레딧)가 `useVideoAutomation.start()` 안에만 있다.** 초기 설계는 `save_videos` 툴을 위해 `submitVideoItem`/`downloadAndSaveVideo` 를 메인 프로세스로 추출하려 했는데 — **그 두 함수엔 게이트가 없다. 게이트는 그것들을 감싸는 `start()` 에 있다.** 추출하면 **에이전트가 영상을 공짜로 받는다.**

→ **D5**: `save_videos` 삭제. `generate_videos` 가 **fire-and-forget `runVideoBatch()` 한 방**으로 제출→폴링→**consume**→다운로드→저장→씬패치를 끝까지 소유. **렌더러 경유 필수** (권한 스냅샷이 `useAuth()` React 컨텍스트에 있어 메인이 못 읽음). 슬라이스 35/36/50이 이걸 못박는다.

**추가**: `batchStartGate.js:20` 의 첫 줄이 `if (subscriptionBatch == null) return { action: 'proceed' }` — **null 스냅샷이면 두 게이트가 조용히 사라진다.** 지금 안전한 건 `App.jsx:114` 가 항상 non-null 객체를 넘기기 때문 — **배선의 성질이지 함수의 성질이 아니다.**

### ⚠️ Codex 자동 실행

**Codex는 MCP 툴 호출에 승인 요청을 안 보낸다.** 바이너리 `ServerRequest` enum 전수 조사: `mcpToolCallApproval` = **0회**. MCP 툴은 `item/mcpToolCall/progress` **notification만** 뱉는다.

그리고 오케스트레이터 프로필이 shell/browser/patch를 deny하므로 **실재하는 승인 요청 3종이 제품 경로에서 영원히 안 뜬다** → **Codex가 과금 툴(`generate_videos`)도 게이트 툴(`story_confirm_synopsis`)도 자동 실행한다.**

→ **D9/D22**: 게이트를 **`mcpServer/elicitation/request`** 에 묶는다. **stdio 어댑터 프로세스가 MCP 서버를 소유**하고 게이트 툴 핸들러 **안에서** `elicitInput()` 을 쏜다. `accept` 일 때만 메인 Tool Core 로 단방향 RPC. (MCP SDK 1.29.0 공식 예제가 `registerTool` 핸들러 안에서 `await server.elicitInput()` 하는 바로 그 패턴.)

---

## 6. 핵심 설계 결정 요약 (v11 §1 참조)

| # | 결정 |
|---|---|
| **M-1 → M0 → M1** | **하네스 → 스파이크 → 코드.** M0 결과가 스펙을 이긴다. API를 M0 전에 굳히지 않는다 |
| **M0-3a** | **12분 블로킹 MCP 툴이 종단 `tool_result` 로 오는가 (백그라운드 핸들이 아니라).** ⚠️ 이 하나가 전체 설계를 좌우 — 실패하면 폴링으로 붕괴하고 턴 예산이 33~45 → 280턴 |
| **영상 엔진** | **공식 Veo API** (`genai:generate-video`). `flow:*` 는 레거시 |
| **인앱 vs MCP** | 인앱 에이전트가 제품(고객에겐 Claude Code 없음). MCP는 개발자 사용자용 추가 프론트엔드. **Tool Core는 한 벌** |
| **제품 포지션** | **10~30분 롱폼.** 1분은 Claude Code로 되니 차별화 0. 1시간은 재개(resume) 얹으면 확장 |
| **해자** | 캐릭터·목소리 일관성(Veo가 못 함) / 편집 가능한 산출물(ffmpeg가 못 줌) / 상태가 디스크에(대화가 못 함) |
| **오픈소스** | **클라이언트는 가능**(asar로 이미 열려있고 export가 서버에서 원자적으로 막힘). **GCF는 절대 금지**(해자가 거기) |

---

## 7. 미해결 / 열린 질문

- **청킹**: 대본/씬분리/프롬프트가 전부 **LLM 1회 호출로 통째로** 뽑는다. 저장소에 chunk/act 개념 없음. **30분짜리(1만자·150씬)가 나오는지 측정 필요** (§2-②).
- **약관 회색지대**: "앱이 로그인을 offer하지 않으니 조항에 안 걸린다"는 해석이 맞는지 **확정하려면 Anthropic/OpenAI에 문의해야 함.** 스펙은 확정을 참칭하지 않음.
- **Veo 오디오 앰비언스 활용**: 대사 없는 클립은 낮은 볼륨(0.15)으로 살릴 수 있음. 근데 **에이전트는 귀가 없다** — 오디오 분석 툴(`analyze_video_audio`)이 필요. M4 이후.
- **video-as-base exporter**: 영상-온리 씬은 여전히 drop. GCF 크로스레포. 별건.

---

## 8. 다음 세션 첫 수

```
1. 이 문서 + v11 스펙 §1(결정) 읽기
2. D23/D24 적대적 리뷰 (Claude 서브에이전트) → findings 0까지
3. 작업 브랜치 따기 (feature/inapp-agent)
4. Veo 오디오 음소거 (작고 즉시 이득) — TDD로
5. 아카이브 커밋 (영어 메시지)
6. M-1 하네스 착수: @playwright/test + vitest test.projects + 스파이크 격리(SPIKE=1, test:run 제외)
   ⚠️ vitest.workspace.js 는 Vitest 4에서 제거됨 (설치본 4.1.10)
   ⚠️ postinstall 이 Electron 바이너리를 AutoFlowCut.app 으로 개명 → executablePath 명시 필요
   ⚠️ main 이 dist-electron/main.js → [P] 슬라이스는 빌드 선행
```

**측정(§2-②)은 사용자가 하기로 했다. 결과 나오면 청킹 필요 여부가 갈린다.**
