<purpose>
Orchestrate the 8-wave story pipeline. Each wave runs as a subagent with fresh context.
The orchestrator stays lean: read STATE.md, determine next wave, spawn subagent, collect result, update state.
</purpose>

<process>
**Step 1: Load state**

Read `STATE.md` from the episode directory.
Determine current wave from STATE.md status table.

Parse $ARGUMENTS for:
- `--from W{N}` -- override start wave
- `--to W{N}` -- override end wave (default: W8)

**Step 2: Wave execution loop**

For each wave from current to target:

```
┌─ Read STATE.md → determine wave N
│
├─ Load wave reference doc: docs/{lang}/W{N}-*.md (lang=ko for yadam, lang=en for dark-history)
│
├─ ▶ PRINT WAVE-START BANNER (see "Wave banners" section below)
│   - Banner language follows genre: yadam → KO, dark-history → EN
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
│   - Banner language follows genre: yadam → KO, dark-history → EN
│   - Print AFTER verification + sanity-check pass
│
├─ Special gate check:
│   - After W3: 🛑 AskUserQuestion "대본을 확정하시겠습니까?"
│   - User must confirm before W4
│
└─ Next wave
```

---

**Wave banners** (orchestrator emits to chat between every wave; do NOT skip)

The orchestrator MUST print one START banner before spawning each wave's subagent
and one DONE banner after the completion checks pass. Banners give the user a
visible heartbeat across the long pipeline. **Use the banner text verbatim** — do
not reword. Pick the language block that matches the genre (yadam=ko, dark-history=en).

**Wave name table** (use these exact labels in the banner)

| Wave | KO (yadam)                                   | EN (dark-history)                          |
|------|----------------------------------------------|--------------------------------------------|
| W1   | 스토리 디자인 (분석/팩트체크/자료수집)        | Story design (analysis/fact-check/research) |
| W2   | 시놉시스 + 프리플라이트                       | Synopsis + preflight                        |
| W3   | 대본 작성 + 리뷰                              | Script writing + review                     |
| W4   | 프로덕션 (나레이션/대사/SFX 추출)             | Production (narration/dialogue/SFX)         |
| W5   | TTS + SFX + SRT 자막                          | TTS + SFX + SRT subtitles                   |
| W6   | 스토리보드 CSV                                | Storyboard CSV                              |
| W7   | 이미지 생성 + CapCut 내보내기                 | Image generation + CapCut export            |
| W8   | 업로드 정보 (제목/설명/태그)                   | Upload info (title/description/tags)        |

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

| Wave | Inputs (filenames)                                                                                | Outputs (filenames)                                                                                          |
|------|--------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| W1   | (none) — only `STATE.md` (topic)                                                                  | `01_분석.md`, `02_팩트체크.md`, `03_자료수집.md`                                                              |
| W2   | `01_분석.md`, `02_팩트체크.md`, `03_자료수집.md`                                                   | `04_시놉시스.md`, `05_프리플라이트.md`                                                                        |
| W3   | `04_시놉시스.md`, `05_프리플라이트.md`, `02_팩트체크.md`                                            | `{title}_기.md`, `{title}_승.md`, `{title}_전.md`, `{title}_결.md`, `07_검토.md`                              |
| W4   | `{title}_기.md`, `{title}_승.md`, `{title}_전.md`, `{title}_결.md`                                 | `narration_{part}.txt`, `dialogs_{part}.json`, `08_sfx_목록.md`                                              |
| W5   | `narration_{part}.txt`, `dialogs_{part}.json`, `08_sfx_목록.md`, `tts_settings.md`                  | `segments/`, `final_{part}.mp3`, `final_{part}.srt`, `media/`, `tts_settings.md` (updated)                   |
| W6   | `final_{part}.srt`, `narration_{part}.txt`, `{title}_*.md` (script), `08_sfx_목록.md`              | `references.csv`, `{title}_scenes.csv`                                                                       |
| W7   | `references.csv`, `{title}_scenes.csv`, `final_{part}.mp3`, `final_{part}.srt`                     | AutoFlowCut images (in workspace), CapCut project (`{title}` draft folder)                                   |
| W8   | `04_시놉시스.md`, `{title}_*.md` (script), `{title}_scenes.csv`                                   | `11_업로드정보.json`                                                                                          |

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
| W1   | W1-0 read-docs, W1-1 fact-check, W1-2 research, W1-3 summarize                                    |
| W2   | W2-0 read-inputs, W2-1 synopsis-draft, W2-2 preflight, W2-3..N preflight-revise (per round)        |
| W3   | W3-0 read-inputs, W3-1..4 part-write × 4, W3-5 self-review, W3-6 external-review, W3-7 polish     |
| W4   | W4-0 read-inputs, W4-1..4 narration-extract × 4, W4-5 dialogue-extract, W4-6 SFX-list, W4-7 audit |
| W5   | W5-0 voice-pick, W5-1 narration-TTS, W5-2 dialogue-TTS, W5-3 SRT, W5-4 SFX (batched), W5-5 merge   |
| W6   | W6-0 schema-load, W6-1 references-CSV, W6-2..5 scenes-CSV × parts, W6-6 gap-validate               |
| W7   | W7-0 project-open, W7-1 style-pick, W7-2 ref-batch, W7-3..N scene-batches, W7-4 QA, W7-5 CapCut    |
| W8   | W8-0 title-desc-tags, W8-1 thumbnail-text                                                          |

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
2. Wave reference doc (docs/{lang}/W{N}-*.md (lang=ko for yadam, lang=en for dark-history))
3. Meta-prompts (for W2, W3): meta-prompts/{genre}/*.md
4. Previous wave summaries (for context continuity)
5. File paths for all episode artifacts created so far

**W1 subagent prompt includes:**
- Branch detection: new vs rewrite
- Reference analysis instructions (if rewrite)
- Fact-check + research instructions (if new)
- Output: 01_분석.md, 02_팩트체크.md, 03_자료수집.md

**W2 subagent prompt includes:**
- Synopsis writing guidelines (meta-prompts/{genre}/synopsis_guidelines.md)
- Preflight checklist (meta-prompts/{genre}/preflight.md)
- 20-chapter framework
- Review loop: preflight fail → revise synopsis → re-check (max 5)
- Output: 04_시놉시스.md, 05_프리플라이트.md

**W3 subagent prompt includes:**
- Screenplay guidelines + narrative + suspense (meta-prompts/{genre}/*.md)
- Writing order: Hook → Act I → II → III → IV
- Length targets — depends on genre:
  - yadam (Korean): 8,000~12,000자
  - dark-history (English): 2,000~3,000 words
- Review loop: self-review + subagent review (max 5 rounds, target 9.5)
- Output: {title}_기.md, {title}_승.md, {title}_전.md, {title}_결.md, 07_검토.md

**W4 subagent prompt includes:**
- Narration/dialogue/SFX extraction rules
- Review loop: subagent cross-checks extraction vs script (max 5)
- Output: narration_{part}.txt, dialogs_{part}.json, 08_sfx_목록.md

**W5 subagent prompt includes:**
- **MANDATORY W5-0 character voice assignment** (BEFORE TTS): extract unique characters from `dialogs_*.json`, diff against `tts_settings.md`; if any unmapped characters or missing narrator → AskUserQuestion with 3–4 voice recommendations, then persist to `tts_settings.md`
- TTS generation (ElevenLabs with-timestamps)
- SRT generation (manual subtitle splitting)
- SFX generation + timecode assignment
- Audio merge (ffmpeg concat)
- Timecode validation
- Output: segments/, final_{part}.mp3, final_{part}.srt, media/

**W6 subagent prompt includes:**
- CSV schema (get_schema MCP tool)
- References CSV + scenes CSV creation
- SRT-based scene splitting (15sec rule)
- Review loop: CSV vs script vs SRT cross-check (max 5)
- Gap/coverage validation scripts
- Output: references.csv, {title}_scenes.csv
- **HARD RULE**: W6 must NOT generate images. Forbidden calls: `app_start_ref_batch`, `app_start_scene_batch`, `app_generate_reference`, `app_generate_scene`, and their HTTP equivalents. Image generation belongs exclusively to W7. If the subagent even considers kicking off a batch "since the CSV is ready", that is a spec violation — STOP and hand off to W7.

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
- Output: 11_업로드정보.json

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
