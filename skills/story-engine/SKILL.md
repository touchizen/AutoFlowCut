---
name: story-engine
description: "YouTube story channel script writing skill with 9-wave automated pipeline (with manual user gates after W3 script and W7 image production). Supports three genres: (1) yadam — Korean historical tales (야담, 민담, 설화, 조선시대) in Korean, (2) dark-history — Western dark history, medieval mystery, gothic tales, true crime, folklore in English, (3) bespoke — universal genre with per-episode meta-prompts synthesized from user-provided 3–5 successful reference scripts (any topic, any audience language). Trigger on: 'write a script', 'new episode', 'create storyboard', 'start ep5', '야담 대본 써줘', '새 에피소드 만들어줘', '스토리보드 작성해줘', 'ep11 시작하자', 'rewrite', 'redesign', '리라이팅', '리디자인'. Auto-detects genre by user language + topic keywords (Korean + 야담/민담/조선/설화/전설 keywords → yadam; English + dark/gothic/medieval/witch/folklore/colonial keywords → dark-history; otherwise → bespoke). Override via `--genre yadam|dark-history|bespoke`."
---

# Story Engine v2

9-Wave 자동 파이프라인으로 YouTube 스토리 채널 대본을 작성하고, TTS/SFX 생성, 이미지 생성, 어셈블리(오디오 임포트/CapCut), 업로드 정보까지 자동화한다.

## 스킬 구조

| 스킬 | 역할 | 트리거 |
|------|------|--------|
| `/story-new` | 에피소드 초기화 + 주제 논의 | "새 에피소드", "start ep5" |
| `/story-execute` | W1~W9 자동 파이프라인 | "파이프라인 실행", "execute" |
| `/story-next` | 중단 후 재개 | "이어서 해줘", "continue" |
| `/story-rewrite` | 기존 에피소드 개선 (몰입도 진단 → fork → 개선판) | "rewrite my", "ep03 개선", "다시 써줘" |

## 9-Wave 파이프라인

| Wave | 내용 | 리뷰 |
|------|------|------|
| **W1** | 스토리 설계 (신규/리라이팅 분기) | — |
| **W2** | 시놉시스 + 프리플라이트 | 최대 5회 |
| **W3** | 대본 작성 + 검토 | 최대 5회 (목표 9.5점) |
| | 🛑 **사용자 확인** | |
| **W4** | 프로덕션 추출 + 검증 | 최대 5회 |
| **W5** | TTS/SFX + mechanic 타임코드 검증 | 리뷰 |
| **W6** | 스토리보드 CSV + 검토 (batch QA, 3그룹 병렬) | 최대 5회 |
| **W7** | 이미지 프로덕션 (ref + 씬 + 에러 fix + image QA, batch QA) | 최대 5회 |
| | 🛑 **사용자 확인** | |
| **W8** | 어셈블리 (SFX 씬 매칭 + 오디오 임포트 + CapCut export + 영상 선택) | 최대 5회 |
| **W9** | 업로드 정보 (제목/설명/태그/썸네일) | — |

## 장르

| 트리거 | 장르 | 메타프롬프트 |
|--------|------|-------------|
| 한국어 + 야담/민담/조선/설화/전설 키워드 | **yadam** (야담) | `meta-prompts/yadam/` (한국어 5개 파일) |
| English + dark/gothic/medieval/witch/folklore/colonial 키워드 | **dark-history** | `meta-prompts/dark-history/` (영문 5개 파일) |
| 어느 장르도 명확하지 않음 (또는 `--genre bespoke`) | **bespoke** (맞춤형) | `meta-prompts/bespoke/{lang}/` (한국어 출력 시 `ko/`, 영문 출력 시 `en/` — 각 5개) + 에피소드별 `_story_source/_meta_supplement.md` (W1-5에서 user reference 3~5개로 합성). `{lang}`은 `STATE.md` "Output language:" 필드에서 해석. |

`--genre yadam`, `--genre dark-history`, 또는 `--genre bespoke`로 오버라이드 가능.

**Bespoke 장르 추가 요건:** `/story-new` 시 사용자에게 **3~5개 성공 대본 reference**를 받아야 함 (URL / 텍스트 / 로컬 파일). reference가 ≤ 2개 → escalation (다른 장르로 전환 권장).

## Review discipline (W2–W7)
- Every substep runs a review loop: subagent self-review → list issues → revise.
- Max 5 rounds. 0 issues → proceed immediately.
- 5 rounds exceeded → escalate to user.
- W1 (research) and W8 (upload info) are exceptions with no review loop.

## 리뷰 원칙 (W2–W8)
- 모든 서브스텝은 리뷰 루프를 실행한다: 서브에이전트 자가검토 → 이슈 목록 → 수정.
- 최대 5회. 0 이슈 시 즉시 진행.
- 5회 초과 시 사용자에게 에스컬레이션.
- W1(리서치)과 W9(업로드 정보)은 리뷰 루프 없는 예외 단계이다.

## Batch QA discipline (parallel subagent reviewers, checklist > 5 items)

When a review checklist exceeds 5 items, a single subagent skims rather than audits. Split into focused groups and spawn ONE subagent per group, in parallel.

- **Group size**: 3–4 items per group (target 3, max 4).
- **QA is subagent + Read tool, NOT scripts.** Even if a scene/CSV check could in principle be automated by a Python script, the QA step itself is performed by a subagent reading the artifacts via the Read tool and reporting findings. Pre-check scripts (running BEFORE QA as a fast sanity gate) are allowed and separate; they do not replace subagent inspection. "Script passed, so QA passes" is forbidden.
- **Parallelism**: spawn all groups in a single message with multiple `Agent` tool uses → concurrent execution.
- **Recommended concurrency**: 3 (sweet spot). Max useful: 5. Beyond 5 = diminishing returns; token cost still scales N×.
- **Each subagent receives**: only its group's items + the read-only inputs it needs + an exclusive output file path (e.g., `{wave}_review_group{X}.md`).
- **Subagent prohibitions during batch**: do NOT touch `STATE.md`, `W_progress.json`, or any other shared state. The orchestrator merges all group results AFTER every subagent returns.
- **Heartbeat prefix**: every `_progress.log` line written by a batch subagent MUST be prefixed with `[Group {X}]` to allow interleaved-line forwarding without ambiguity.
- **Sequential fallback**: if a group must call external APIs (TTS, image gen, app-state mutation), run that group sequentially or extract the API work out of QA. Read-only QA stays parallel.

## Batch QA 원칙 (병렬 서브에이전트 리뷰어, 체크리스트 > 5 항목)

체크리스트가 5개를 넘기면 한 서브에이전트는 형식적 통과만 함. focused 그룹으로 쪼개서 그룹마다 별도 서브에이전트를 **병렬로** 호출한다.

- **그룹 크기**: 3~4 항목 (목표 3, 최대 4).
- **QA는 subagent + Read 도구, 스크립트 아님.** 어떤 검사 항목이 Python 스크립트로 자동화 가능하더라도, QA 자체는 subagent가 Read 도구로 산출물을 직접 읽고 점검한다. Pre-check 스크립트 (QA 직전에 빠른 sanity gate로 돌리는 자동 검사)는 허용되고 별개이다 — subagent 점검을 대체할 수 없음. "스크립트 통과했으니 QA 통과"는 금지.
- **병렬성**: 한 메시지에 여러 `Agent` 호출을 동시에 보내면 동시 실행됨.
- **권장 동시 N**: 3 (sweet spot). 최대 유용 N: 5. 5 넘으면 한계 효용 빠르게 감소, 토큰 비용은 N배 그대로.
- **각 서브에이전트가 받는 것**: 자기 그룹 항목만 + 필요한 read-only 입력만 + 전용 출력 파일 경로 (`{wave}_review_group{X}.md`).
- **batch 중 서브에이전트 금지**: `STATE.md`, `W_progress.json`, 기타 공유 상태 절대 안 건드림. 오케스트레이터가 모든 그룹 반환 후 1회 합산 update.
- **하트비트 prefix**: batch 서브에이전트가 `_progress.log`에 쓰는 모든 라인은 `[Group {X}]` prefix 필수 (interleaved 라인 forwarding 시 모호성 제거).
- **Sequential 폴백**: 외부 API 호출 (TTS, 이미지 생성, 앱 상태 변경) 필요한 그룹은 sequential로. read-only QA만 병렬 유지.

## Progress reporting discipline (orchestrator — wave AND sub-step level)

**The user must always know what is currently happening.** Wave-level START/DONE banners (see `workflows/execute-pipeline.md`) cover wave boundaries; this discipline covers EVERYTHING inside a wave.

- **Every new sub-step announces itself in one line BEFORE work begins.** Format: `▸ Starting <step name>…`
- **Every sub-step completion announces its result with elapsed time.** Format: `✅ <step name> done (mm:ss). Next: <next step>.`
- **Sub-step ≠ wave.** A wave has multiple sub-steps. Example W5 sub-steps: W5-0 voice-pick, W5-1 narration-TTS, W5-2 dialogue-TTS, W5-3 SRT, W5-4 SFX (batched), W5-5 merge. Each sub-step MUST emit its own status line. See the canonical sub-step decomposition table in `workflows/execute-pipeline.md`.
- **No silent block longer than 3 minutes.** Any operation expected to run >3 min MUST be split into 1–3 minute chunks at the orchestrator level, with a status line between chunks.
- **Repeated calls batch.** When a sub-step does N similar API calls (e.g. 55 SFX cues, 20 scene images), group into batches of 10–15 with one status line per batch: `▸ SFX batch 2/4 (cues 16–30)…` then `✅ batch 2/4 done (M:SS), N/N succeeded.`
- **Heartbeat fallback.** If a sub-step genuinely cannot be split, the subagent writes `_progress.log` per state change. The orchestrator polls every 30–60 s and forwards the latest line.
- **Trigger:** any time the action changes — reading docs → spawning subagent → calling API → writing files → reviewing — announce it.
- **Subagent invocations are the highest-risk silence point. Always over-announce them:**
  - **BEFORE every `Agent` tool call:** `▸ Spawning <type> subagent for <task> (est. <X> min, prompt ~<N> tokens)…`
  - **AFTER every `Agent` tool call returns:** `✅ <task> subagent returned in <mm:ss>. Result: <one-line summary>.`
  - **For `SendMessage` to an existing agent:** `▸ Sending message to agent <id> (<reason>)…` then `✅ Agent <id> response in <mm:ss>.`
  - The user MUST NEVER see a silent `Agent` or `SendMessage` tool call. These are the exact moments where multi-minute silence happens — bracket every one with announcements.
- **Subagents must self-report during execution (heartbeat).** Every wave subagent MUST append a one-line heartbeat to `_story_source/_progress.log` at every sub-step transition. Format: `<ISO-8601 UTC> <wave-label> <event>: <description> [<metrics>]`. Events: `START`, `END`, `API`, `SPAWN`, `WRITE`, `ERROR`, `WAIT`. Triggers: sub-step start/end, before every external API call, before every file write, entering/exiting review rounds, before spawning child agents, on errors/retries. The orchestrator polls this file (every 30–60 s for `run_in_background: true` calls; once after return for foreground) and forwards new lines to the user as `📡 [<wave>]: <line>`. See `workflows/execute-pipeline.md` "Subagent heartbeat protocol" for full spec.
- **Default to over-reporting.** Silence is the failure mode; verbosity is recoverable.

## 진행 상황 보고 원칙 (오케스트레이터 — Wave 및 서브스텝 단위 공통)

**사용자는 항상 지금 무엇이 진행되고 있는지 알아야 한다.** Wave 경계의 START/DONE 배너(`workflows/execute-pipeline.md` 참조)는 Wave 경계만 다룬다. 이 원칙은 Wave 내부의 모든 것을 다룬다.

- **새 서브스텝 시작 시 무조건 1줄 알림 (작업 시작 전).** 형식: `▸ <단계명> 시작…`
- **서브스텝 완료 시 1줄 알림 (소요시간 포함).** 형식: `✅ <단계명> 완료 (mm:ss). 다음: <다음 단계>.`
- **서브스텝 ≠ Wave.** 한 Wave는 여러 서브스텝으로 구성. 예시 W5: W5-0(음성 선택), W5-1(나레이션 TTS), W5-2(대화 TTS), W5-3(SRT), W5-4(SFX 배치), W5-5(머지). 각 서브스텝마다 상태 라인 필수. 캐노니컬 서브스텝 분해 표는 `workflows/execute-pipeline.md` 참조.
- **3분 이상의 침묵 금지.** 3분 초과 예상되는 작업은 오케스트레이터 레벨에서 1~3분 단위 청크로 분할, 청크 사이에 상태 보고.
- **반복 호출은 배치로 묶기.** 한 서브스텝이 N개의 유사 호출(SFX 55개, 씬 이미지 20개 등)을 할 때 10~15개 배치로 묶고, 배치당 상태 1줄.
- **하트비트 대체.** 분할이 정말 불가능한 경우, 서브에이전트가 매 상태 변화마다 `_progress.log`에 1줄 기록 → 오케스트레이터가 30~60초마다 폴링.
- **트리거:** 무엇을 하고 있는가가 바뀔 때 — 문서 읽기 → 서브에이전트 스폰 → API 호출 → 파일 쓰기 → 검토 — 매번 알림.
- **서브에이전트 호출은 침묵 위험 최고치. 과보고 필수:**
  - **모든 `Agent` 도구 호출 전:** `▸ <type> 서브에이전트 스폰 — <태스크명> (예상 <X>분, 프롬프트 ~<N> 토큰)…`
  - **모든 `Agent` 호출 반환 후:** `✅ <태스크명> 서브에이전트 반환 (<mm:ss>). 결과: <한 줄 요약>.`
  - **기존 에이전트에 `SendMessage`:** `▸ 에이전트 <id>에 메시지 송신 (<이유>)…` 그리고 `✅ 에이전트 <id> 응답 (<mm:ss>).`
  - `Agent`나 `SendMessage` 호출이 조용히 일어나면 절대 안 됨 — 다분 침묵이 발생하는 정확한 지점이므로 매번 알림으로 감싸기.
- **서브에이전트는 실행 중 자가 보고 필수 (하트비트).** 모든 Wave 서브에이전트는 `_story_source/_progress.log`에 서브스텝 전환마다 1줄 append 필수. 형식: `<ISO-8601 UTC> <wave-label> <event>: <설명> [<메트릭>]`. 이벤트: `START`, `END`, `API`, `SPAWN`, `WRITE`, `ERROR`, `WAIT`. 트리거: 서브스텝 시작/종료, 외부 API 호출 전, 파일 쓰기 전, 리뷰 라운드 진입/종료, 자식 에이전트 스폰 전, 에러/재시도 시. 오케스트레이터는 이 파일을 폴링(`run_in_background: true` 시 30~60초마다, foreground 시 반환 후 1회)하고 새 줄을 사용자에게 `📡 [<wave>]: <줄>` 형식으로 전달. 전체 스펙은 `workflows/execute-pipeline.md` "Subagent heartbeat protocol" 참조.
- **과보고가 디폴트.** 침묵이 실패 모드, 장황함은 복구 가능.

## Subagent transparency contract (orchestrator MUST verify, never trust blindly)

**Subagent self-reports are not trusted by default — they are verified against disk reality.** Without this, subagents can perform invisible work (file writes, API calls, side effects) that the orchestrator and user never see.

### Subagent obligations (every wave subagent return MUST include)

In addition to the wave-specific return fields, every subagent MUST append:

```json
{
  "disk_changes": {
    "created":  ["_story_source/...", "..."],
    "modified": ["_story_source/STATE.md", "_story_source/W_progress.json"],
    "deleted":  []
  },
  "bash_commands": ["mkdir -p segments", "ffmpeg -i ..."],
  "external_api_calls": [
    {"method": "GET",  "url": "https://api.elevenlabs.io/v1/voices",                    "status": 200},
    {"method": "POST", "url": "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>", "status": 200}
  ]
}
```

Rules: command strings only (no env values, no credentials, no body content); URL/method/status only.

### Subagent prohibitions (hard rules — no "going beyond to be helpful")

- Do NOT create, modify, or delete files outside the declared `deliverables` list.
- Do NOT call external APIs (TTS, image gen, web requests beyond research) unless the wave brief explicitly authorizes that surface.
- Do NOT "over-reach" — if the brief says "do NOT generate audio", that is a hard rule, not a hint. The brief is the contract.
- If a code path WOULD require a forbidden action, STOP and return `escalation_required: true` with a description. Do not proceed.

### Orchestrator verification (mandatory, after every `Agent` return)

1. Snapshot `wave_start_ts` BEFORE spawning the subagent.
2. After return, list actual disk changes: every file under episode dir with `mtime ≥ wave_start_ts`.
3. Diff actual vs `disk_changes`. Any actual file missing from `disk_changes` = **undeclared change**.
4. Verify every `deliverables` entry exists on disk. Missing = wave failure → retry once.
5. If the wave brief forbade certain API surfaces (e.g. W4 forbids audio gen, W6 forbids image gen), scan `external_api_calls` — any hit on a forbidden surface = **boundary violation**.
6. On ANY violation: print `▸ ⚠ Subagent contract violation: <detail>` to user, pause pipeline, ask continue/rollback/escalate.

### 서브에이전트 투명성 계약 (오케스트레이터는 검증하라, 신뢰만으로는 안 됨)

**서브에이전트의 자가 보고는 기본적으로 신뢰하지 않는다 — 디스크 실제 상태와 대조해 검증한다.** 이게 없으면 서브에이전트가 보이지 않는 작업(파일 생성, API 호출, 부작용)을 수행해도 오케스트레이터도 사용자도 모른다.

- **서브에이전트 의무:** 모든 반환 JSON에 `disk_changes` (created/modified/deleted), `bash_commands`, `external_api_calls` 블록 포함 필수. 명령어 문자열만 (env값/자격증명/바디 금지). URL/메서드/상태코드만.
- **서브에이전트 금지:** deliverables 목록 외 파일 생성/수정/삭제 금지. 명시적 권한 없는 외부 API 호출 금지. "도와주려고 oversize" 금지 — 브리프가 곧 계약. 위반 위험 시 즉시 `escalation_required: true`로 반환.
- **오케스트레이터 검증 (모든 `Agent` 반환 후 필수):**
  1. 서브에이전트 스폰 전에 `wave_start_ts` 기록
  2. 반환 후, 에피소드 dir의 `mtime ≥ wave_start_ts` 파일 전체 나열
  3. `disk_changes` 대조 → 누락된 변경 = **undeclared change**
  4. `deliverables` 모두 디스크에 존재 검증, 없으면 = wave 실패 → 1회 재시도
  5. 브리프가 금지한 API 표면을 `external_api_calls`에서 스캔 → 적중 = **boundary violation**
  6. 위반 시: `▸ ⚠ 서브에이전트 계약 위반: <상세>` 사용자에 출력, 파이프라인 일시정지, 계속/롤백/에스컬레이션 질문

## 핵심 원칙 — 몰입도가 모든 wave의 평가 anchor

> **궁금증 + 기대감 = 몰입도. 몰입도가 모든 wave의 최상위 평가 기준.**
>
> 시청자가 클릭하고(궁금증 작동), 끝까지 보고(기대감 작동), 다음 영상도 본다(몰입도 누적). **조회수 / CTR / retention / 구독자 증가는 몰입도의 사후 proxy일 뿐, 평가의 입력 변수가 아니다.** 메커니즘을 강화하면 metric은 따라온다.

### 모든 wave는 이 원칙으로 평가한다

| Wave | 검토 질문 |
|------|----------|
| **W1 reference 분석 (Bespoke)** | 그 영상이 시청자 궁금증/기대감을 어떻게 만들고 유지했나 (조회수는 proxy로 기록만, 평가 기준은 메커니즘) |
| **W1-4 success synthesis** | 4 섹션 mandatory: ① 궁금증 발생 메커니즘 ② 기대감 누적 메커니즘 ③ 둘의 interplay ④ 몰입도 곡선 |
| **W2 시놉시스 + preflight** | 매 챕터가 궁금증을 유지하거나 기대감을 누적하는가 (둘 다 기여 안 하면 챕터 구조 실패) |
| **W3 대본 + review** | 매 단락이 시청자를 다음 단락으로 끌고 가는가 (≠ "재미있는가") |
| **W9 업로드 정보** | title/thumbnail이 시청자에게 궁금증/기대감 promise를 거는가; 첫 30초가 그 promise를 지키는가 |

### 구조 원칙 (몰입도 곡선)

- **W1~W2**: 다중 용의자/가능성 — 시청자 확신 불가 — **궁금증 유지**
- **W3 전반**: 거짓 해결 / 반전 / 떡밥 — **기대감 극대화**
- **W3 후반 (ch.16~17)**: 진실 폭로 — **몰입도 최고조**
- **결말 (ch.18~20)**: held quiet — 몰입도 resonant low close
- **진범/진실이 전 중반(15챕터) 이전에 확정되면 구조적 실패** (몰입도 곡선 깨짐 — 시청자 이탈)

## 상태 관리

| 파일 | 역할 |
|------|------|
| `STATE.md` | 메인 — 현재 Wave, 완료 단계, 결정사항 |
| `W{N}_SUMMARY.md` | Wave별 결과, 리뷰 라운드, 이슈 |
| `W_progress.json` | 사이드 로그 — 앱/외부 도구용 JSON |

## 참조 문서

문서는 언어별로 분리되어 있다. **장르 + 출력 언어에 따라 자동 선택**:

| 장르 | `{lang}` | meta-prompts 경로 |
|------|---------|-------------------|
| **yadam** (야담/민담/조선시대) | `ko` | `meta-prompts/yadam/` (한국어 5개 파일) |
| **dark-history** (Western dark history/gothic/folklore) | `en` | `meta-prompts/dark-history/` (영문 5개 파일) |
| **맞춤형 (Bespoke)** (어떤 주제든) | reference + 주제 언어 자동 감지 (Korean refs → `ko`, English refs → `en`; 사용자 override 가능) | `meta-prompts/bespoke/{lang}/` — **subfolder per language**: `bespoke/ko/` (한국어 5개) + `bespoke/en/` (영문 5개) |

**Bespoke 표시 규약**: 한국어 doc/UI는 "맞춤형" (또는 "맞춤형 (Bespoke)"), 영문 doc/UI는 "Bespoke". 코드/플래그는 동일하게 `bespoke`.

**Bespoke 추가 read 필수**: `_story_source/_meta_supplement.md` (W1-5에서 생성된 에피소드 전용 supplement) — W2, W3, (조건부 W6/W9) 서브에이전트 프롬프트에 자동 포함.

| Wave | 문서 |
|------|------|
| W1 | `docs/{lang}/W1-story-design.md` |
| W2 | `docs/{lang}/W2-synopsis.md` + 메타프롬프트:<br>• yadam: `meta-prompts/yadam/야담_시놉시스_작성_지침.md` + `야담_프리플라이트.md`<br>• dark-history: `meta-prompts/dark-history/synopsis_guidelines.md` + `preflight.md`<br>• bespoke: `meta-prompts/bespoke/{lang}/synopsis_guidelines.md` + `preflight.md` + `_story_source/_meta_supplement.md` |
| W3 | `docs/{lang}/W3-writing.md` + 메타프롬프트:<br>• yadam: `meta-prompts/yadam/야담_시나리오_작성_지침.md` + `야담_서술기법_가이드.md` + `야담_서스펜스_기법.md`<br>• dark-history: `meta-prompts/dark-history/screenplay_guidelines.md` + `narrative_techniques.md` + `suspense_techniques.md`<br>• bespoke: `meta-prompts/bespoke/{lang}/screenplay_guidelines.md` + `narrative_techniques.md` + `suspense_techniques.md` + `_story_source/_meta_supplement.md` |
| W4 | `docs/{lang}/W4-production.md` |
| W5 | `docs/{lang}/W5-tts-sfx.md` |
| W6 | `docs/{lang}/W6-storyboard.md` |
| W7 | `docs/{lang}/W7-image-production.md` (이미지 프로덕션 — ref + 씬 + QA) |
| W8 | `docs/{lang}/W8-assembly.md` (어셈블리 — SFX 씬 매칭 + 오디오 임포트 + CapCut export + 영상) |
| W9 | `docs/{lang}/W9-upload-info.md` (업로드 정보) |

## AutoFlowCut MCP 도구

- 프로젝트: `app_list_projects`, `app_create_project`
- CSV: `load_csv`, `list_scenes`, `update_prompt`, `save_csv`
- 레퍼런스: `list_references`, `update_reference_prompt`
- 이미지: `app_start_ref_batch`, `app_start_scene_batch`, `app_wait_batch`
- 스키마: `get_schema({ type: "scenes" | "references" | "prompt-image" })`
- 스타일: `list_styles`

## Red Flags

| 생각 | 현실 |
|------|------|
| "리뷰 안 해도 되겠지" | 리뷰 루프는 필수 |
| "이미지로 바로 가자" | Wave 순서 엄수 |
| "CSV 맞을 거야" | subagent 리뷰가 있는 이유 |
| "스킬 내용 기억나" | 매번 docs 읽기 |
| "간단하네" | 간단한 건 복잡해진다. 먼저 확인 |
| "빨리 하자" | 빠른 것보다 정확한 것 |
| "조용히 끝까지 가자" | 매 서브스텝 보고 — 3분 침묵 = red flag |
| "한 번에 큰 서브에이전트로" | 3분 초과 = 청크 분할, 서브스텝 단위 보고 |
| "서브에이전트가 솔직히 다 말했겠지" | self-report 신뢰 금지 — `disk_changes` 디스크 대조 필수 |
| "deliverables에 없지만 도와주려고" | over-reach = 계약 위반 — 즉시 escalation, 진행 금지 |
| "Subagent 안에서 일어나는 건 어차피 안 보여도 어쩔 수 없음" | `_progress.log` 하트비트 + 오케스트레이터 폴링 필수 |
