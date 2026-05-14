<purpose>
Orchestrate the 9-wave story pipeline (with manual user gates after W3 and W7).
Each wave runs as a subagent with fresh context. The orchestrator stays lean:
read STATE.md, determine next wave, spawn subagent, collect result, update state.
</purpose>

<process>
**Step 1: Load state**

Read `STATE.md` from the episode directory.
Determine current wave from STATE.md status table.

Parse $ARGUMENTS for:
- `--from W{N}` -- override start wave
- `--to W{N}` -- override end wave (default: W9)

**Step 2: Wave execution loop**

For each wave from current to target:

```
┌─ Read STATE.md → determine wave N
│
├─ Load wave reference doc: docs/{lang}/W{N}-*.md
│   - lang=ko for yadam
│   - lang=en for dark-history
│   - lang=auto-detect for bespoke (Korean references/topic → ko, English → en;
│     user can override via STATE.md or AskUserQuestion)
│   For bespoke, ALSO load `_story_source/_meta_supplement.md` (W1-5 output)
│
├─ ▶ PRINT WAVE-START BANNER (see "Wave banners" section below)
│   - Banner language follows the resolved {lang} (yadam → ko; dark-history → en;
│     bespoke → auto-detected from references/topic, see Step 2 box diagram)
│   - Print to chat output BEFORE spawning the subagent
│
├─ Predecessor input contract (applies for N ≥ 2):
│   For each predecessor wave M ∈ [1..N-1]:
│     - W_progress.json waves.W{M}.status MUST === 'done'.
│       If not → STOP and escalate (cannot start W{N} on incomplete pipeline).
│     - W{M}_SUMMARY.md MUST exist.
│       If artifacts on disk exist BUT W_progress.json/SUMMARY are empty → run
│       backfill (see "Backfill protocol" below) before proceeding.
│     - W_progress.json waves.W{M}.review_rounds_used MUST be a number OR
│       carry `backfilled: true` with a `backfill_reason`. Anything else → fail.
│
├─ Spawn subagent for W{N}:
│   - Type: general-purpose
│   - Prompt: wave-specific instructions + reference doc content
│   - Fresh context (no prior wave baggage)
│   - Includes: "Before starting, verify predecessors per input contract."
│
├─ Subagent executes:
│   - Performs wave work
│   - Runs review loop (max 5 rounds per substep, exit on 0 issues,
│     escalate on round 5) — see "Mandatory completion checklist" below
│   - Writes W{N}_SUMMARY.md with required sections
│   - Writes/updates W_progress.json waves.W{N} with required fields
│   - Writes/updates STATE.md wave status row
│   - Returns completion signal including numeric review_rounds_used
│
├─ Orchestrator verifies (FAIL = retry subagent once; still FAIL = escalate):
│   - W{N}_SUMMARY.md exists AND contains non-empty "Review rounds" section
│   - W_progress.json waves.W{N}.status === 'done'
│   - W_progress.json waves.W{N}.review_rounds_used is a number (≥1)
│   - W_progress.json waves.W{N}.issues_found is a number (≥0)
│   - W_progress.json waves.W{N}.completed_at is an ISO timestamp
│   - W_progress.json waves.W{N}.deliverables is a non-empty array
│   - No unresolved issues flagged in the summary
│
├─ Orchestrator sanity-checks STATE.md + W_progress.json consistency:
│   - STATE.md wave row "done" ↔ W_progress.json status 'done'
│   - If mismatched → fix and warn
│
├─ ▶ PRINT WAVE-DONE BANNER (see "Wave banners" section below)
│   - Banner language follows the resolved {lang} (yadam → ko; dark-history → en;
│     bespoke → auto-detected from references/topic, see Step 2 box diagram)
│   - Print AFTER verification + sanity-check pass
│
├─ Special gate check:
│   - After W3: 🛑 AskUserQuestion "대본을 확정하시겠습니까? / Confirm script?"
│     User must confirm before W4.
│   - After W7: 🛑 AskUserQuestion "이미지 검수 끝났어요. 어셈블리(W8)로 진행할까요? / Image QA complete. Proceed to assembly (W8)?"
│     User must confirm before W8 (W7 image gen burns Google Flow credits;
│     W8 assembly is free, but the user may want to redo images first).
│
└─ Next wave
```

---

**Wave banners** (orchestrator emits to chat between every wave; do NOT skip)

The orchestrator MUST print one START banner before spawning each wave's subagent
and one DONE banner after the completion checks pass. Banners give the user a
visible heartbeat across the long pipeline. **Use the banner text verbatim** — do
not reword. Pick the language block that matches the resolved `{lang}`:
- yadam → `ko`
- dark-history → `en`
- bespoke → auto-detected from user references/topic at episode init (Korean refs → `ko`, English refs → `en`); user override possible via STATE.md

**Wave name table** (use these exact labels in the banner)

| Wave | KO (yadam)                                   | EN (dark-history)                          |
|------|----------------------------------------------|--------------------------------------------|
| W1   | 스토리 디자인 (분석/팩트체크/자료수집)        | Story design (analysis/fact-check/research) |
| W2   | 시놉시스 + 프리플라이트                       | Synopsis + preflight                        |
| W3   | 대본 작성 + 리뷰                              | Script writing + review                     |
| W4   | 프로덕션 (나레이션/대사/SFX 추출)             | Production (narration/dialogue/SFX)         |
| W5   | TTS + SFX + SRT 자막                          | TTS + SFX + SRT subtitles                   |
| W6   | 스토리보드 CSV                                | Storyboard CSV                              |
| W7   | 이미지 프로덕션 (ref + 씬 + QA)              | Image production (ref + scene + QA)         |
| W8   | 어셈블리 (오디오 임포트 + CapCut + 영상)     | Assembly (audio import + CapCut + video)    |
| W9   | 업로드 정보 (제목/설명/태그)                   | Upload info (title/description/tags)        |

**Wave I/O contract** (canonical inputs/outputs per wave — banner auto-fills from this)

This table is the single source of truth for what each wave reads and writes.
The orchestrator MUST consult this table to populate the "입력 / Inputs" and
"출력 예정 / Outputs" lines of the START banner. The DONE banner's "실제 출력
/ Actual outputs" line is populated by listing files in the episode directory
that match the output patterns AND were touched within the wave's runtime.

Notation:
- `{title}` = episode title slug from STATE.md
- `{part}` = `1`/`2` for split episodes; absent for single-part
- Trailing `/` denotes a directory
- `(none)` means the wave has no predecessor file inputs (W1 only)

**Filename convention varies by genre** (the table below shows the canonical yadam Korean form; substitute per genre):

| Genre | Filename style | Example (W1 fact-check) |
|-------|----------------|-------------------------|
| **yadam** | Korean filenames | `02_팩트체크.md`, `04_시놉시스.md`, `{title}_기.md` |
| **dark-history** | English filenames | `02_factcheck.md`, `04_synopsis.md`, `{title}_part1_setup.md` |
| **bespoke** (any output language) | English filenames | `02_factcheck.md`, `04_synopsis.md`, `{title}_part1_setup.md` (content inside files in resolved {lang}; filenames stay ASCII-safe) |

| Wave | Inputs (filenames — yadam form shown; substitute per genre) | Outputs (filenames — yadam form shown; substitute per genre) |
|------|--------------------------------------------------------------|---------------------------------------------------------------|
| W1   | (none) — only `STATE.md` (topic)                              | `01_분석.md`, `02_팩트체크.md`, `03_자료수집.md` (bespoke also: `01_references_analysis.md`, `04_success_synthesis.md`, `_meta_supplement.md`) |
| W2   | `01_분석.md`, `02_팩트체크.md`, `03_자료수집.md`               | `04_시놉시스.md`, `05_프리플라이트.md` |
| W3   | `04_시놉시스.md`, `05_프리플라이트.md`, `02_팩트체크.md`       | `{title}_기.md`, `{title}_승.md`, `{title}_전.md`, `{title}_결.md`, `07_검토.md` |
| W4   | `{title}_기.md`, `{title}_승.md`, `{title}_전.md`, `{title}_결.md`                                 | `narration_{part}.txt`; `dialogs_{part}.json` — only when `production_scope.dialogue`; `08_sfx_목록.md` — only when `production_scope.sfx` |
| W5   | `narration_{part}.txt`; `dialogs_{part}.json` (with `after_paragraph`) — when `production_scope.dialogue`; `08_sfx_목록.md` — when `production_scope.sfx`; `tts_settings.md` | `segments_{part}/` (with `index.json` carrying `paragraph_idx`), `subtitles_{part}.txt`, `final_{part}.mp3`, `final_{part}.srt`, **`timeline_{part}.json`**, `voices/` — when `production_scope.dialogue`; `media/sfx/` — when `production_scope.sfx`; `media/final_full.{mp3,srt}`, `tts_settings.md` (updated) |
| W6   | `final_{part}.srt`, **`timeline_{part}.json`**, `narration_{part}.txt`, `{title}_*.md` (script), `08_sfx_목록.md` (when `production_scope.sfx`), **`voices/result_{part}.json`** (one per part) + **`voices/{part}_*_{HHMMSS}.mp3`** (when `production_scope.dialogue` — primary speaker→timecode source for `splitOnSpeakerChange: true`; carries TTS-resolved per-part start/duration including consecutive-dialogue stacking; part prefix in filename prevents cross-part collisions), `dialogs_{part}.json` + `segments_{part}/index.json` (fallback anchor for single-dialog-per-paragraph cases, when dialogue on) | `references.csv`, `{title}_scenes.csv`, `06_review_group{A,B,C}.md` (batch QA)                                |
| W7   | `references.csv`, `{title}_scenes.csv` (read-only — for ref/scene prompts)                         | AutoFlowCut images (refs + scenes in workspace), `07_image_review_group{A,B}.md` (batch QA)                  |
| W8   | `references.csv`, `{title}_scenes.csv`, `final_{part}.mp3`, `final_{part}.srt`, `media/sfx/` (when `production_scope.sfx`), AutoFlowCut images (from W7) | CapCut project (`{title}` draft folder), `08_sfx_scene_match_qa.md` (when `production_scope.sfx`; W8-0 skipped otherwise), optional video clips |
| W9   | `04_시놉시스.md`, `{title}_*.md` (script), `{title}_scenes.csv`                                   | `11_업로드정보.json`                                                                                          |

Fallback: if a wave reference doc (`docs/{lang}/W{N}-*.md`) lists additional or
different files, the wave doc takes precedence — log a warning and use the doc's
list. The table above is the default contract.

**Banner truncation rule**: if the inputs or outputs list contains more than 5
filenames, show the first 4 and append `…외 N개` (KO) / `…+N more` (EN), where
N is the remaining count. Directories count as one item.

**START banner — KO (yadam)**
```
══════════════════════════════════════════════════════════
 STORY ENGINE ▸ Wave {N}/8 ▸ {KO 단계명}
══════════════════════════════════════════════════════════
 시작 시각  : {YYYY-MM-DD HH:MM}
 이전 단계  : {W{N-1} 한 줄 요약 — N=1이면 "(없음)"}
 이번 단계  : {wave reference doc의 1-line 목적 요약}
 입력       : {Wave I/O 표의 Inputs — 파일명만, 5개 초과 시 truncation}
 출력 예정  : {Wave I/O 표의 Outputs — 파일명만, 5개 초과 시 truncation}
══════════════════════════════════════════════════════════
```

**START banner — EN (dark-history)**
```
══════════════════════════════════════════════════════════
 STORY ENGINE ▸ Wave {N}/8 ▸ {EN step name}
══════════════════════════════════════════════════════════
 Started   : {YYYY-MM-DD HH:MM}
 Previous  : {W{N-1} one-line summary — "(none)" when N=1}
 This step : {one-line purpose pulled from wave reference doc}
 Inputs    : {Wave I/O table Inputs — filenames only, truncate >5}
 Outputs   : {Wave I/O table Outputs — filenames only, truncate >5}
══════════════════════════════════════════════════════════
```

**DONE banner — KO (yadam)**
```
──────────────────────────────────────────────────────────
 ✓ Wave {N}/8 완료 — {review_rounds_used} round,
   issues {issues_found}, 소요 {duration}
   실제 출력  : {디스크에 실제 생성된 파일명 — 5개 초과 시 truncation}
──────────────────────────────────────────────────────────
```

**DONE banner — EN (dark-history)**
```
──────────────────────────────────────────────────────────
 ✓ Wave {N}/8 done — {review_rounds_used} round(s),
   {issues_found} issue(s), took {duration}
   Actual    : {actual filenames created on disk — truncate >5}
──────────────────────────────────────────────────────────
```

**Failure / escalation banner** (replace the DONE banner if the wave fails after retry)
```
──────────────────────────────────────────────────────────
 ✗ Wave {N}/8 ESCALATE — {reason}
   누락 출력 / Missing : {expected outputs that were NOT produced}
   참고 / See          : {paths to logs / SUMMARY.md / W_progress.json}
──────────────────────────────────────────────────────────
```

Format rules:
- Box-drawing characters: `══` for START (heavy), `──` for DONE (light). Width ~58 cols.
- All time values use the user's local timezone in `YYYY-MM-DD HH:MM` format.
- `{duration}` is computed as `completed_at - started_at`, formatted as `Hh Mm Ss` /
  `H시간 M분 S초`. Drop zero leading units (e.g. `2분 13초`, `2m 13s`).
- File lists: filenames only (no paths). Comma-separated. Apply 5-item truncation rule.
- The DONE banner's "실제 출력 / Actual" list is computed by `listdir(episode_dir)`
  filtered to files matching the wave's expected output patterns AND with mtime
  ≥ wave start time. If a file pattern is fulfilled by multiple files (e.g.
  `{title}_*.md` matches 4 files), all of them are listed individually.
- If "실제 출력" diverges from "출력 예정" (missing or extra files), the
  orchestrator logs a one-line warning before the DONE banner:
  `⚠ 출력 불일치: 예정 X개 / 실제 Y개 — {missing/extra 파일명}`
- Banners are plain text in the chat — do NOT wrap in code fences when printed
  during execution (the fences shown above are for this spec doc only).
- If genre cannot be determined from STATE.md, default to KO.

**Intra-wave sub-step reporting** (orchestrator, mandatory)

Wave START/DONE banners alone are not enough. The orchestrator MUST also emit
status lines at every internal sub-step transition within a wave. The user must
always be able to see what is currently happening, not just "we're inside W5
somewhere".

**Sub-step decomposition table** (canonical — orchestrator and wave subagents MUST
follow this granularity; wave docs may add finer breakdowns but never remove these):

| Wave | Sub-steps                                                                                          |
|------|---------------------------------------------------------------------------------------------------|
| W1 (yadam / dark-history) | W1-0 read-docs, W1-1 fact-check, W1-2 research, W1-3 summarize                          |
| W1 (bespoke) | W1-0 load-references (3–5), W1-1 per-reference analysis, W1-2 fact-check, W1-3 research, W1-4 cross-script synthesis, W1-5 meta-prompt synthesis (`_meta_supplement.md`) |
| W2   | W2-0 read-inputs, W2-1 synopsis-draft, W2-2 preflight, W2-3..N preflight-revise (per round)        |
| W3   | W3-0 read-inputs, W3-1..4 part-write × 4, W3-5 self-review, W3-6 external-review, W3-7 polish     |
| W4   | **W4-0 production-scope (user gate — AskUserQuestion if `production_scope` missing in STATE.md; otherwise skip)**, W4-1 read-inputs, W4-2..5 narration-extract × 4, W4-6 dialogue-extract (skip when `production_scope.dialogue: false`), W4-7 SFX-list (skip when `production_scope.sfx: false`), W4-8 audit |
| W5   | W5-0-prep provider-pick, W5-0-assign voice-assign (narrator-only when `production_scope.dialogue: false`), W5-1a narration-TTS, W5-1b draft-subs, W5-1c build-SRT+timeline, W5-1d user-review (optional), W5-1e merge-segments, W5-1f dialogue-TTS (skip when `production_scope.dialogue: false` OR `dialogs_{part}.json` absent), W5-2 SFX (skip when `production_scope.sfx: false` OR `08_sfx_*.md` absent), W5-3 4-part merge (SFX timecode conversion no-op when sfx off), W5-4 mechanic-QA (SFX checks vacuous → empty cue list = pass when sfx off) |
| W6   | W6-1 references-CSV (character + scene only), W6-2 scenes-CSV, W6-3a/b/c **batch QA × 3 parallel** (Completeness / Reference integrity / Timing structure) |
| W7   | W7-0 project-setup, W7-1 ref-batch (incl. style-pick + type:style row), W7-2 scene-batch, W7-2a error-fix, W7-2b-1/2 **image-QA batch × 2 parallel** (Visual / Content) → 🛑 user sign-off |
| W8   | W8-0 SFX scene-match QA (moved from old W7 7-2c), W8-1 audio-import, W8-2 CapCut-export, W8-3 video (optional, requires user confirm) |
| W9   | W9-0 title-desc-tags, W9-1 thumbnail-text                                                          |

**For each sub-step the orchestrator MUST:**
1. ▸ START line BEFORE the work begins: `▸ Starting W{N}-{S} <name>…` (one line, plain text)
2. (do the work — typically a single foreground `Agent` call, 1–3 min target, OR inline orchestrator work)
3. ✅ DONE line AFTER the work completes: `✅ W{N}-{S} <name> done (mm:ss). Next: W{N}-{S+1} <next>.`

**Hard rules:**
- If a sub-step itself runs >3 min (e.g. W5-4 SFX with 55 cues), it MUST split into
  batches of 10–15 calls, with one status line per batch:
  `▸ W5-4 SFX batch 2/4 (cues 16–30)…` then `✅ W5-4 SFX batch 2/4 done (M:SS), N/N succeeded.`
- Silence longer than 3 minutes without a status line is a violation. Default to
  over-reporting; verbosity is recoverable, silence is not.
- The orchestrator emits these lines DIRECTLY to the user (chat), not to logs.
- **Subagent invocations MUST be bracketed with announcements** (no silent `Agent` calls):
  - Before: `▸ Spawning <type> subagent for <task> (est. <X> min, prompt ~<N> tokens)…`
  - After:  `✅ <task> subagent returned in <mm:ss>. Result: <one-line>.`
  - SendMessage: `▸ Sending message to agent <id> (<reason>)…` then `✅ Agent <id> response in <mm:ss>.`
  This applies to wave subagents, external review subagents, and any other `Agent`
  tool call. The Agent tool's wait window is the single largest source of "I don't
  know what's happening" — make it the single most-narrated moment instead.

**Wave subagent prompts (Step 3) MUST include this instruction explicitly:**
> "At every sub-step transition, emit a one-line status: `▸ Starting <name>…`
> when starting and `✅ <name> done (mm:ss). Next: <next>.` when finishing.
> Sub-steps follow the wave's row in the sub-step decomposition table in
> `workflows/execute-pipeline.md`. Long sub-steps (>3 min) split into batches
> with one status line per batch."

When the orchestrator runs a wave inline (instead of spawning a subagent), the
orchestrator itself emits these lines as it transitions between sub-steps.

**Step 3: Wave-specific subagent prompts**

Each subagent receives:
1. Episode context (genre, topic, decisions from STATE.md)
2. Wave reference doc (docs/{lang}/W{N}-*.md):
   - `lang=ko` for yadam
   - `lang=en` for dark-history
   - `lang=auto-detected` for bespoke (Korean references/topic → `ko`, English → `en`)
3. Meta-prompts (for W2, W3):
   - **yadam**: `meta-prompts/yadam/*.md` (ASCII filenames: yadam-*.md)
   - **dark-history**: `meta-prompts/dark-history/*.md`
   - **bespoke**: `meta-prompts/bespoke/{lang}/*.md` (subfolder per output language) PLUS `_story_source/_meta_supplement.md`
4. Previous wave summaries (for context continuity)
5. File paths for all episode artifacts created so far

**W1 subagent prompt includes:**
- Branch detection: new vs rewrite
- Reference analysis instructions (if rewrite)
- Fact-check + research instructions (if new)
- Output (per-genre filename — see "Filename convention varies by genre" note above):
  - **yadam**: `01_분석.md`, `02_팩트체크.md`, `03_자료수집.md`
  - **dark-history**: `01_analysis.md`, `02_factcheck.md`, `03_research.md`
  - **bespoke**: `01_references_analysis.md`, `02_factcheck.md`, `03_research.md`, `04_success_synthesis.md`, `_meta_supplement.md` (English filenames regardless of output language)

**W2 subagent prompt includes:**
- Synopsis writing guidelines:
  - **yadam**: `meta-prompts/yadam/yadam-synopsis-guide.md`
  - **dark-history**: `meta-prompts/dark-history/synopsis_guidelines.md`
  - **bespoke**: `meta-prompts/bespoke/{lang}/synopsis_guidelines.md` PLUS `_story_source/_meta_supplement.md`
- Preflight checklist:
  - **yadam**: `meta-prompts/yadam/yadam-preflight.md`
  - **dark-history**: `meta-prompts/dark-history/preflight.md`
  - **bespoke**: `meta-prompts/bespoke/{lang}/preflight.md` (Section 0 Engagement is bespoke-only)
- 20-chapter framework
- Review loop: preflight fail → revise synopsis → re-check (max 5)
- Output (per-genre filename):
  - **yadam**: `04_시놉시스.md`, `05_프리플라이트.md`
  - **dark-history**: `04_synopsis.md`, `05_preflight.md`
  - **bespoke**: `04_synopsis.md`, `05_preflight.md` (English filenames, content in {lang})

**W3 subagent prompt includes:**
- Screenplay guidelines + narrative + suspense:
  - **yadam**: `meta-prompts/yadam/yadam-scenario-guide.md`, `yadam-narrative-guide.md`, `yadam-suspense-techniques.md`
  - **dark-history**: `meta-prompts/dark-history/screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md`
  - **bespoke**: `meta-prompts/bespoke/{lang}/screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md` PLUS `_story_source/_meta_supplement.md`
- For **bespoke**: ALSO read `_story_source/_meta_supplement.md` (W1-5 per-episode supplement) — supplement OVERRIDES universal base on conflicts; universal base is the fallback
- Writing order: Hook → Act I → II → III → IV
- Length targets — depends on genre:
  - **yadam** (Korean): 8,000~12,000자
  - **dark-history** (English): 2,000~3,000 words
  - **bespoke**: derived from `_meta_supplement.md` § "Length target" (W1-5 sets this from user preference + reference scripts' average length); default fallback if missing: 1,500–2,500 words / ~10–17 min
- Review loop: self-review + subagent review (max 5 rounds, target 9.5)
- Output (per-genre filename):
  - **yadam**: `{title}_기.md`, `{title}_승.md`, `{title}_전.md`, `{title}_결.md`, `07_검토.md`
  - **dark-history**: `{title}_part1_setup.md`, `{title}_part2_rising.md`, `{title}_part3_crisis.md`, `{title}_part4_resolution.md`, `07_review.md`
  - **bespoke**: same English form as dark-history (`{title}_part1_setup.md` etc., `07_review.md`); content in {lang}

**W4 subagent prompt includes:**
- **W4-0 production-scope gate (FIRST sub-step, before any extraction):**
  - Read `STATE.md` `## Decisions` for a `production_scope:` block (nested keys `dialogue: <bool>` and `sfx: <bool>`).
  - **If absent** → call `AskUserQuestion` with the two-flag prompt below; persist the resolved booleans to `STATE.md` `## Decisions` under a new `production_scope:` block. Default suggestion: both `true` (current behavior).
  - **If present** → skip the question, log the current values, and continue. Idempotent on `/story-resume`.
  - `AskUserQuestion` content (bilingual, mirror existing question style):
    ```
    이번 에피소드의 프로덕션 범위 / Production scope for this episode:
    [x] Dialogue TTS (다중 화자 — Typecast dialogue mode)
    [x] SFX (atmospheric / 긴장 환기)

    조합 / Combos:
    - Full (default)        : 둘 다 켬 / both on
    - Narration + Dialogue  : SFX 끄기 → ~10–20분 절약 / save ~10–20 min
    - Narration + SFX       : dialogue 끄기 → ~2–5분 절약 (대사 없는 스크립트일 때) / save ~2–5 min
    - Narration only        : 둘 다 끔 → ~12–25분 절약 (draft / preview용) / save ~12–25 min
    ```
  - Echo the resolved scope in the W4 START banner so the user sees what is being skipped (e.g. `프로덕션 범위 / Scope: dialogue=on, sfx=off`).
- **Cascade on `production_scope`:**
  - W4-2..5 narration extraction — always runs (narration is mandatory).
  - W4-6 dialogue extraction — **skip entirely when `dialogue: false`**; do NOT produce `dialogs_{part}.json`. W5-1f then skips by absence-of-file (do NOT special-case empty file vs missing file).
  - W4-7 SFX list — **skip entirely when `sfx: false`**; do NOT produce `08_sfx_*.md`. W5-2 then skips by absence-of-file.
- Narration/dialogue/SFX extraction rules (for the enabled tracks)
- Review loop: subagent cross-checks extraction vs script (max 5)
- Output (per-genre filename; conditional on `production_scope`):
  - **yadam**: `narration_{part}.txt`; `dialogs_{part}.json` (when `dialogue: true`); `08_sfx_목록.md` (when `sfx: true`)
  - **dark-history**: `narration_{part}.txt`; `dialogs_{part}.json` (when `dialogue: true`); `08_sfx_list.md` (when `sfx: true`)
  - **bespoke**: `narration_{part}.txt`; `dialogs_{part}.json` (when `dialogue: true`); `08_sfx_list.md` (when `sfx: true`) — English filenames, content in {lang}

**W5 subagent prompt includes:**
- **Read `production_scope` from `STATE.md` `## Decisions` at startup.** Missing → default `{ dialogue: true, sfx: true }` (legacy episode, current behavior preserved). Persisted absent files (no `dialogs_{part}.json` / no `08_sfx_*.md`) are also respected — `production_scope` flags AND file-presence checks both gate downstream work; absence-of-file is authoritative.
- **MANDATORY W5-0 provider selection + voice assignment** (BEFORE TTS):
  - 5-0-prep: ask user separately for narration provider (ElevenLabs / Typecast / Vrew-import) and dialogue provider (Typecast / 없음). Bundled dialogue script is **Typecast-only** — every character voice_id MUST be `tc_*`.
  - 5-0-assign: extract unique characters from `dialogs_*.json`, diff against `tts_settings.md`; if any unmapped characters or missing narrator → AskUserQuestion with 3–4 voice recommendations from the chosen provider's library, persist to `tts_settings.md`.
    - **When `production_scope.dialogue: false`**: only the `narrator` row is required in `tts_settings.md`. Character voice assignment is skipped entirely (no character extraction, no AskUserQuestion for character voices).
- **W5-1 (5 sub-steps, each invokes a bundled `.cjs` script):**
  - 5-1a narration TTS — `generate_tts_elevenlabs.cjs` OR `generate_tts_typecast.cjs narration` (provider chosen in 5-0-prep). Outputs `segments_{part}/seg_NNN.mp3` + `seg_NNN.json` (alignment) + `index.json` (with `paragraph_idx` for each segment).
  - 5-1b auto-draft baseline subtitles — `draft_subtitles.cjs` produces `subtitles_{part}.txt`. Manual splitting is OPTIONAL refinement (5-1d), not the default; users edit only if baseline cuts are awkward.
  - 5-1c build SRT + timeline — `build_srt.cjs <segmentsDir> <subtitlesFile> <outSrt> <timelineJson>` (4th arg REQUIRED — `timeline_{part}.json` is consumed by W6).
  - 5-1d user review of baseline (optional refinement loop) → re-run 5-1c if subtitles edited.
  - 5-1e per-part merge — `merge_audio.cjs` produces `final_{part}.mp3`.
  - 5-1f dialogue TTS — **skip entirely when `production_scope.dialogue: false` OR `dialogs_{part}.json` does not exist** (no `voices/` directory created). Otherwise: `generate_tts_typecast.cjs dialogue <dialogsJson> <outDir> <ttsSettings> <segmentsDir>`. The 4th arg `segmentsDir` lets the script resolve each dialog's `_HHMMSS` from `after_paragraph` + `index.json`'s `paragraph_idx`. **Consecutive dialogues sharing one `after_paragraph` are auto-stacked** (previous dialog end + 0.2s gap) so they never collide. Without `start` AND without `after_paragraph` the script throws — silent `00:00:00` collisions are blocked.
- W5-2 SFX — **skip entirely when `production_scope.sfx: false` OR `08_sfx_*.md` does not exist** (no `media/sfx/` produced). Otherwise: `generate_sfx.cjs` driven by SRT-anchor manifest (anchor narration + placement + offset → in-part timecode).
- W5-3 4-part merge (ffmpeg concat) → `media/final_full.mp3` + `media/final_full.srt`. **SFX in-part → full-timeline conversion is a no-op when sfx off** (`sfx/` empty / absent → nothing to convert). Narration merge always runs.
- W5-4 mechanic timecode validation (collision / per-part range / full range / per-part offset). **When `production_scope.sfx: false`**: empty SFX cue list = pass automatically (early-return success on the SFX checks). Narration timing validation still runs.
- Outputs (conditional on `production_scope`): `segments_{part}/`, `subtitles_{part}.txt`, `final_{part}.mp3`, `final_{part}.srt`, **`timeline_{part}.json`**, `voices/` (when `dialogue: true`), `media/final_full.{mp3,srt}` (always), `media/sfx/` (when `sfx: true`).

**W6 subagent prompt includes:**
- **No external scripts** — `scenes.csv` is built directly via AutoFlowCut MCP tools (`get_schema`, `load_csv`, `update_field`, `save_csv`) using W5's `final_{part}.srt` + `timeline_{part}.json` as inputs.
- CSV schema (`get_schema` MCP tool)
- References CSV + scenes CSV creation
- SRT-based scene splitting (15sec rule)
- 설정 옵션 (W_progress.json 루트 `options`에서 가져옴):
  - `splitOnSpeakerChange: {true|false}` (없으면 `false` fallback)
    - `true`: 화자 전환 분리 룰 적용 (W6-storyboard.md "화자 전환 분리" 섹션 참조)
    - `false`: 기존 룰만 사용
- Review loop: CSV vs script vs SRT cross-check (max 5)
- Gap/coverage checks performed by the subagent reading the CSV/SRT directly (not via .py)
- Output: `references.csv`, `{title}_scenes.csv`, `06_review_group{A,B,C}.md`
- **HARD RULE**: W6 must NOT generate images. Forbidden calls: `app_start_ref_batch`, `app_start_scene_batch`, `app_generate_reference`, `app_generate_scene`, and their HTTP equivalents. Image generation belongs exclusively to W7. If the subagent even considers kicking off a batch "since the CSV is ready", that is a spec violation — STOP and hand off to W7.

**W6 legacy fallback (옵션 누락 시):** `W_progress.json`에 `options` 객체 자체가 없거나 `options.splitOnSpeakerChange` 필드가 없는 (Task 1 이전에 생성된) 에피소드는 사용자에게 묻지 않고 `splitOnSpeakerChange = false`로 진행한다. 재개 흐름을 끊지 않으며, W6 subagent는 기존 룰만 사용하므로 기존 동작과 동일하다. (rewrite-episode.md Step 5.5는 의도적으로 인터랙티브하게 묻는다 — 사용자가 직접 재실행을 몰고 있는 시점이라 정책 재확인 가치가 silence보다 크기 때문. 일관성 맞추려 이 silent fallback을 interactive로 바꾸지 말 것.)

**STATE.md schema — `production_scope` block (W4-0 gate, read by W4 / W5 / W8 subagents)**

The W4-0 sub-step persists user-chosen production scope to `STATE.md` `## Decisions` as a nested YAML-style block:

```markdown
## Decisions
- Topic: ...
- Genre: ...
- ...
- production_scope:
    dialogue: true       # Dialogue TTS on (W4-6 dialogue extract + W5-1f dialogue TTS)
    sfx: true            # SFX on (W4-7 SFX list + W5-2 SFX generation)
```

**Semantics:**
- `dialogue: true` (default) — full pipeline: W4-6 produces `dialogs_{part}.json`, W5-0-assign maps character voices, W5-1f generates per-character TTS into `voices/`.
- `dialogue: false` — W4-6 skipped; `dialogs_{part}.json` NOT produced; W5-0-assign requires only `narrator`; W5-1f skipped; `voices/` not created.
- `sfx: true` (default) — full pipeline: W4-7 produces `08_sfx_*.md`, W5-2 generates SFX, W5-3 converts to full timeline, W8-0 scene-match QA runs.
- `sfx: false` — W4-7 skipped; `08_sfx_*.md` NOT produced; W5-2 skipped; W5-3 SFX conversion is a no-op; W5-4 SFX checks vacuous (empty cue list = pass); W8-0 SFX scene-match QA skipped entirely.

**Legacy fallback (block missing on pre-spec episodes):** Every wave subagent that reads `production_scope` MUST default missing/absent to `{ dialogue: true, sfx: true }` — preserves current behavior for episodes created before this gate existed. The W4-0 question is asked ONLY when the block is absent on a fresh episode; resume on a legacy mid-pipeline episode inherits the defaults silently and does NOT re-ask.

**Filename convention is unchanged.** Files that aren't produced are simply absent on disk. Downstream subagents check existence first (`if exists(dialogs_{part}.json)`); they do NOT special-case "empty file" vs "missing file". This keeps the contract simple: `production_scope` flag controls whether the file is produced; absence-of-file is authoritative for downstream consumers.

**Why W4-0 and not /story-new?** The script is locked at W3 confirmation — by W4 the user knows what the episode actually needs. Asking at /story-new (like `splitOnSpeakerChange`) would be premature: the user is still designing the story. Asking later (W5-0-prep) wastes W4-6/W4-7 extraction work. W4-0 is the goldilocks point.

**W7 subagent prompt includes:**
- **MANDATORY pre-check**: `app_open_project({ name })` to switch to target project BEFORE loading CSV or generating. Verify current project matches. If mismatch → STOP.
- AutoFlowCut project creation (or open existing)
- Style selection (list_styles MCP)
- Reference image batch generation
- Scene image batch generation
- Full QA (all images, max 5 rounds)
- Error scene fix + regeneration loop
- Audio import + CapCut export
- Output: generated images, CapCut project

**W8 subagent prompt includes:**
- YouTube title/description/tags generation
- Thumbnail text suggestions
- Output (per-genre filename):
  - **yadam**: `11_업로드정보.json`
  - **dark-history**: `11_upload_info.json`
  - **bespoke**: `11_upload_info.json` (English filename, content in {lang})

---

**Backfill protocol (applies when a predecessor wave's bookkeeping is missing)**

A predecessor wave M is "artifact-complete but bookkeeping-empty" when ALL of:
- The expected deliverable files for W{M} exist on disk under `_story_source/`.
- AND any of: `W_progress.json` lacks `waves.W{M}`, or `waves.W{M}.status` ≠ 'done',
  or `waves.W{M}.review_rounds_used` is missing/null/string.

When detected, the orchestrator MUST run backfill **before** spawning W{N}'s subagent:

1. **Reconstruct what is reconstructible** from the filesystem alone:
   - `status`: `'done'`
   - `completed_at`: file mtime of the newest deliverable (ISO timestamp)
   - `deliverables`: directory listing of W{M}'s expected output files that actually exist
   - `issues_found`: `0` IF no `*_ISSUES.md` or unresolved-issue artifact found; otherwise `null`

2. **Mark unrecoverable fields explicitly** (do NOT invent values):
   - `review_rounds_used`: `null` (cannot be reconstructed without the original session's log)
   - Any wave-specific metric (e.g. `final_score`, `word_count` if not derivable, `preflight_result`): `null`

3. **Tag the wave as backfilled** with audit metadata:
   ```json
   "waves": {
     "W{M}": {
       "status": "done",
       "completed_at": "<mtime ISO>",
       "review_rounds_used": null,
       "issues_found": 0,
       "deliverables": [...],
       "backfilled": true,
       "backfill_reason": "artifacts present, original session bookkeeping absent",
       "backfill_source": "filesystem mtime + directory listing",
       "backfill_at": "<now ISO>"
     }
   }
   ```

4. **Stub a SUMMARY.md if missing** at `_story_source/W{M}_SUMMARY.md`:
   ```markdown
   # W{M} Summary (backfilled)

   ## Deliverables
   <auto-generated list of files found>

   ## Review rounds
   _Unknown — this wave's records were reconstructed from filesystem evidence alone.
   The original session did not log review rounds._

   ## Issues found
   0 (assumed, no issue logs found)

   ## Open questions for W{M+1}
   _Backfilled wave — verify integrity before relying on outputs._
   ```

5. **User-confirm gate for critical waves** (W3 script, W7 images):
   When backfill targets W3 or W7, the orchestrator MUST call AskUserQuestion:
   "Wave W{M} 기록이 비어있어요. (a) backfill로 진행, (b) 새로 다시 실행, (c) 중단?"
   Other waves (W2/W4/W5/W6/W8) backfill silently and the audit metadata logs it.

6. **Final summary warns about backfilled waves** at the end of `/story-execute`:
   List every wave with `backfilled: true` so the user knows audit gaps exist.

The backfill protocol exists to recover from "artifacts-but-no-records" gracefully
without inventing data. A wave with `backfilled: true` is treated as `done` for
pipeline progression but flagged for human review.

---

**Mandatory completion checklist (applies to W1–W8, no exceptions)**

Every Wave subagent MUST, as its final action before returning:

1. **Write `W{N}_SUMMARY.md`** with at minimum these sections:
   - `## Deliverables` — full list of produced files (relative paths under `_story_source/`)
   - `## Review rounds` — numbered log, one row per round: round number, result (pass/fail), issues found, fixes applied. Even if only 1 round, log it.
   - `## Issues found` — final unresolved issues count. `0` if clean.
   - `## Open questions for W{N+1}` — handoff notes; empty section is allowed but the heading must exist.

2. **Update `W_progress.json`**. Merge (do NOT replace) the existing JSON; set `waves.W{N}` to:
   ```json
   {
     "status": "done",
     "completed_at": "<ISO-8601 timestamp>",
     "review_rounds_used": <number ≥ 1>,
     "issues_found": <number ≥ 0>,
     "deliverables": ["<path1>", "<path2>", ...],
     "...any wave-specific metadata..."
   }
   ```
   The numeric `review_rounds_used` and `issues_found` fields are REQUIRED. Do not omit; do not leave as `null`/`"?"`/string.

3. **Update `STATE.md`**: set the `W{N}` row's Status column to `done` and the Summary column to a one-liner (e.g., `Synopsis + preflight — 1 round, passed, 2026-04-16`).

4. **Return report** (the completion signal that closes the subagent) MUST include the numeric fields `review_rounds_used` and `issues_found` so the orchestrator can verify without re-reading the JSON.

If the subagent exits without satisfying items 1–4, the orchestrator treats the wave as incomplete and retries.

---

**Batch QA execution protocol** (orchestrator runs N parallel subagents for grouped checklists)

When a wave doc marks a section as `batch QA × N parallel`, the orchestrator
spawns N `Agent` subagents in a single message (concurrent execution). The
SKILL.md "Batch QA discipline" section defines the policy; this section
defines the orchestrator's execution.

### When to use batch QA

A wave doc enables batch QA when its review section has > 5 check items grouped
into N labeled groups (typically `[Group A]`, `[Group B]`, ...). Examples:
- W6 6-3: 10 items → 3 groups (Completeness / Reference integrity / Timing structure)
- W7 7-2b: 8 items → 2 groups (Visual / Content)

### Spawn pattern (one message, multiple Agent calls)

```
<single orchestrator message>
  Agent({ description: "W6-3 Group A QA", subagent_type: "general-purpose", prompt: <focused brief A> })
  Agent({ description: "W6-3 Group B QA", subagent_type: "general-purpose", prompt: <focused brief B> })
  Agent({ description: "W6-3 Group C QA", subagent_type: "general-purpose", prompt: <focused brief C> })
</single message — all 3 run concurrently>
```

The orchestrator MUST emit one `▸ Spawning batch QA: 3 subagents in parallel
(Group A/B/C)…` line before, and one `✅ Batch QA returned: A=<X>m, B=<X>m,
C=<X>m, total wall-clock <X>m` line after.

### Per-group focused brief (mandatory contents)

Every batch-QA subagent prompt MUST include:

1. **Group label and item list** — only that group's items, nothing else.
2. **Read-only inputs** — paths to CSVs / scripts / SRTs the group needs.
3. **Exclusive output path** — `_story_source/{wave}_review_group{X}.md` (do
   NOT share output files between groups).
4. **Heartbeat prefix** — explicit instruction: "Every `_progress.log` line
   you write MUST start with `[Group {X}]`."
5. **Shared-state prohibition** — explicit: "Do NOT touch `STATE.md` or
   `W_progress.json`. The orchestrator will merge after all groups return."
6. **Audit obligations** — same as any subagent: `disk_changes`,
   `bash_commands`, `external_api_calls` in the return JSON.

### Orchestrator post-batch merge (mandatory)

After all N groups return:

1. Verify each group's `disk_changes` against actual mtime-newer files.
2. Read all `{wave}_review_group{X}.md` files → consolidate into one summary.
3. Total issue count = sum across groups.
4. Update `STATE.md` (single writer) and `W_progress.json` (single writer).
5. If ANY group exceeded its 5-round cap → escalate (the whole wave fails).
6. If 0 unresolved issues across all groups → wave passes.

### Concurrency cap

- Recommended N parallel: **3** (sweet spot for token cost vs wall-clock gain).
- Maximum useful N: **5** (beyond 5, throughput plateaus; cost scales N×).
- Rule of thumb: if a wave needs > 5 groups, the wave's QA is itself bloated —
  rethink the wave structure, do not just add more parallelism.

### Sequential fallback rule

If any group must call an external API that has rate limits or app-state
mutation (TTS, image gen via AutoFlowCut/Google Flow, audio import IPC), that
group runs sequentially OR the API work is extracted out of QA. Read-only QA
groups (CSV/script/SRT inspection, image file inspection via Read tool) stay
parallel.

---

**Rewrite-mode scope file** (`_rewrite_scope.json` — used by `/story-rewrite`)

When `/story-rewrite` invokes `/story-execute`, it writes `_story_source/_rewrite_scope.json` to communicate scope information that doesn't fit in `--from` / `--to` flags. Every wave subagent (W2–W9) MUST check for this file and adjust scope.

**File schema:**
```json
{
  "mode": "rewrite",
  "scope": "polish" | "restructure" | "full" | "custom",
  "diagnosis_ref": "_story_source/01_improvement_diagnosis.md",
  "original_ep": "ep{N}_{slug}",
  "affected": {
    "acts": ["II"],
    "parts": ["part2", "part3"],
    "scenes": [12, 13, 14, 17],
    "drop_off_zones": [
      {"part": "part2", "paragraphs": [5, 6, 7], "fix": "<recommendation>"}
    ]
  }
}
```

**Wave subagent contract — when `_rewrite_scope.json` is present:**

1. Read `_rewrite_scope.json` at startup (alongside the standard inputs).
2. Read `_story_source/01_improvement_diagnosis.md` for the documented fix recommendations.
3. Scope work to `affected.*` lists ONLY:
   - W2 (synopsis): regenerate synopsis ONLY for `affected.acts`. Other acts inherit from original synopsis.
   - W3 (script): rewrite ONLY paragraphs in `affected.drop_off_zones` (polish) OR ONLY parts in `affected.parts` (restructure). Other parts inherit from original.
   - W4 (extract): re-extract narration/dialogue/SFX ONLY for parts in `affected.parts`.
   - W5 (TTS/SFX): regenerate TTS ONLY for new segments in `affected.parts`. Reuse original audio for unaffected parts.
   - W6 (CSV): update scenes.csv rows for `affected.scenes` ONLY. Other rows preserved.
   - W7 (images): re-image ONLY scenes in `affected.scenes`. Other images reused.
   - W8 (assembly): re-import + re-export to pick up changed audio/images. Affected scope info in commit message.
   - W9 (upload info): re-evaluate title/thumbnail ONLY if structural change (restructure / full); skip for polish.
4. Return JSON includes `rewrite_scope_applied: true` and `affected_processed: [<list of items touched>]`.
5. Do NOT regenerate `affected.*` items that don't match the wave (e.g., W4 ignores `affected.acts` since W4 deals with parts, not acts).

**When `_rewrite_scope.json` is absent**: subagent behaves as a normal /story-new full wave (no scope filtering).

**Wave subagent prompts MUST embed this instruction**:

> "**Rewrite-mode scope detection:** check for `_story_source/_rewrite_scope.json` at startup. If present, this is a /story-rewrite invocation — read the file + `01_improvement_diagnosis.md`, scope your work to `affected.*` lists, and return `rewrite_scope_applied: true` + `affected_processed`. If absent, behave as a normal full-wave /story-new run."

---

**Subagent heartbeat protocol** (subagent self-reports DURING execution — mandatory)

Wave subagents are not a black box. During execution, every wave subagent MUST
append a one-line heartbeat to `_story_source/_progress.log` at every sub-step
transition. This is the only way the orchestrator (and the user) can see what
the subagent is doing WHILE the `Agent` call is in flight, before it returns.

### Heartbeat line format

Append-only, one line per event, ISO-8601 UTC timestamp:

```
<ISO-8601 UTC> <wave-label> <event>: <description> [<optional metrics>]
```

Where:
- `<wave-label>` = `W1`..`W8`, or a child label like `W3-EXT` (external review),
  `W5-1` (sub-step), etc.
- `<event>` ∈ { `START`, `END`, `API`, `SPAWN`, `WRITE`, `ERROR`, `WAIT` }.
- `<description>` is short and specific (no credentials, no secrets).
- Metrics in `[brackets]` optional: took N s, N words, N issues, status code.

### Examples

```
2026-05-08T20:34:11Z W3 START: writing part 2 (Act II)
2026-05-08T20:34:14Z W3 WRITE: Three_Wives_part2_rising.md
2026-05-08T20:35:42Z W3 END:   writing part 2 [took 1:31, 463 words]
2026-05-08T20:35:43Z W3 START: self-review round 1
2026-05-08T20:36:55Z W3 END:   self-review round 1 [3 issues, 1:12]
2026-05-08T20:36:56Z W3 SPAWN: external review subagent
2026-05-08T20:36:58Z W3-EXT START: reading 4 part files
2026-05-08T20:38:01Z W5 API:   POST /v1/text-to-speech/<voice_id> [200, 4.2s]
```

### Mandatory triggers (subagent emits a heartbeat WHENEVER)

1. Starting or ending a logical sub-step
2. Just before every external API call (status logged on return)
3. Just before writing/modifying/deleting a file (final path logged on success)
4. Entering or exiting a review round
5. Just before spawning a child `Agent` subagent
6. On error, retry, or wait state (e.g. polling a batch)

### Orchestrator polling

- For subagents expected to run **> 3 min**, the orchestrator MUST spawn with
  `run_in_background: true` and poll `_progress.log` every 30–60 s, forwarding
  new lines to the user as `📡 [<wave-label>]: <line>`.
- For subagents expected **< 3 min**, foreground is OK; the orchestrator reads
  `_progress.log` once after the call returns and forwards the heartbeat as
  part of the post-return audit.
- Track last-forwarded byte offset to avoid duplicates.

### Wave subagent prompts MUST include this instruction (verbatim)

> "**Heartbeat self-report.** During execution, append one line per sub-step
> transition to `_story_source/_progress.log`. Format: `<ISO-8601 UTC>
> <wave-label> <event>: <description> [<metrics>]`. Events: START, END, API,
> SPAWN, WRITE, ERROR, WAIT. Emit on: sub-step start/end, just before every
> external API call, just before every file write, entering/exiting review
> rounds, just before spawning a child Agent, on errors/retries/wait states.
> The orchestrator polls this file and forwards new lines to the user.
> Heartbeat is mandatory — silent execution = contract violation."

### Hard rules

- A subagent that runs > 3 min without writing a heartbeat is treated as a
  contract violation — orchestrator escalates immediately, even if final
  output looks fine.
- Heartbeat lines must NOT contain credentials, API keys, response bodies,
  or env values — `<description>` is short and human-readable only.
- The heartbeat file is append-only; never truncate or overwrite.

---

**Subagent audit protocol** (orchestrator verification — mandatory, applies to every `Agent` return)

Subagent self-reports are NOT trusted by default. After every `Agent` return, the
orchestrator MUST verify the report against disk reality before proceeding to the
next wave or sub-step. This protocol is the safety net that prevents subagents
from doing invisible work (file writes, API calls, side effects).

### Required fields in every subagent return JSON

In addition to the wave-specific fields (`wave`, `status`, `review_rounds_used`,
`issues_found`, `deliverables`, etc.), every subagent return MUST include:

```json
{
  "disk_changes": {
    "created":  ["_story_source/foo.txt", "..."],
    "modified": ["_story_source/STATE.md", "_story_source/W_progress.json"],
    "deleted":  []
  },
  "bash_commands": [
    "mkdir -p segments",
    "ffmpeg -i input.mp3 -af loudnorm output.mp3"
  ],
  "external_api_calls": [
    {"method": "GET",  "url": "https://api.elevenlabs.io/v1/voices",                    "status": 200},
    {"method": "POST", "url": "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>", "status": 200}
  ]
}
```

Rules:
- `bash_commands`: literal command strings only — strip env values, credentials, body content.
- `external_api_calls`: method, URL, and status only — never bodies or auth headers.
- `disk_changes`: paths relative to episode dir.
- A subagent that omits these fields is treated as a failed wave — retry once with the audit instruction reinforced; second failure = escalate.

### Orchestrator verification steps (run after every `Agent` return)

1. **Before spawning** the subagent, record `wave_start_ts = <ISO timestamp>`.
2. **After return**, list actual disk changes under the episode directory:
   ```bash
   find {episode_dir} -newer {wave_start_ts} -not -path '*/.git/*'
   ```
   (PowerShell equivalent: `Get-ChildItem -Recurse | Where-Object { $_.LastWriteTime -gt $wave_start_ts }`)
3. **Cross-check actual vs declared** (`disk_changes.created` ∪ `disk_changes.modified`):
   - Any actual file NOT in declared list → **undeclared change**.
   - Any declared `created` entry missing from disk → **declared-but-absent**.
4. **Cross-check declared deliverables**: every entry in the subagent's `deliverables`
   array MUST exist on disk. Missing = wave failure → retry once.
5. **Cross-check API boundary**: if the wave brief explicitly forbade an API
   surface (W4 forbids audio gen; W6 forbids image gen), scan `external_api_calls`
   for hits on those surfaces. Any hit = **boundary violation**.
6. **On any violation**, the orchestrator MUST:
   - Print `▸ ⚠ Subagent contract violation: <details>` to the user.
   - Pause the pipeline (do NOT advance to the next wave or sub-step).
   - Surface options: continue (accept the change), rollback (delete undeclared
     files), or escalate (full pipeline halt for human review).

### Hard rules

- The verification step is NOT optional. Subagents have demonstrated the ability
  to "go beyond" their brief — TTS, image gen, file creation outside deliverables.
  Once a subagent has done this, the only remediation is detection on return.
- Subagent prohibitions explicitly enumerated in the wave brief MUST be enforced
  by both the subagent (self-restraint) AND the orchestrator (post-return audit).
- The orchestrator's audit log lives in `STATE.md` under a `## Subagent audit log`
  section, with one entry per `Agent` call (timestamp, wave, declared deliverables,
  actual disk changes, violations).

### Wave subagent prompts MUST include this instruction

Every `Step 3` wave subagent prompt MUST embed the following block verbatim:

> "**Audit obligations.** Your return JSON MUST include `disk_changes` (created/
> modified/deleted), `bash_commands` (literal command strings, no env values), and
> `external_api_calls` (method/URL/status, no bodies). Do NOT create files outside
> your declared `deliverables`. Do NOT call any API surface this brief did not
> explicitly authorize. If a code path requires a forbidden action, return
> `escalation_required: true` and STOP. The orchestrator will verify your audit
> block against disk reality after you return — undeclared changes are a contract
> violation."

**Step 4: Completion**

After all waves complete:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STORY ENGINE ► Episode {number} COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ All 8 waves completed
◆ CapCut project exported
◆ Upload info ready
```

Update STATE.md final status.
</process>
