<purpose>
Diagnose engagement gaps in an existing episode's script and produce an
improved version. Reuses the original episode's genre, meta-prompts, and
research artifacts (fact-check / research are NOT re-run unless the topic
shifts). Forks to a new ep dir to preserve the original.

**Distinction from W1 [Rewrite] path** (in `docs/{lang}/W1-story-design.md`):
- W1 [Rewrite] = analyze a successful reference (someone else's script) → produce a NEW script using its patterns
- This workflow = analyze YOUR OWN draft → produce an IMPROVED version
</purpose>

<process>

**Step 0: Resolve {PROJECT_DIR}** — same protocol as `new-episode.md` Step 0
(call `mcp__autoflowcut__app_list_projects` for the work folder).

**Step 1: Parse arguments**

- Required: episode number (e.g., `ep03`) OR file path to a draft markdown.
- Optional: `--scope polish|restructure|full` (skip the user-decision gate
  in Step 5 if specified).

**Step 2: Load original artifacts**

Locate the source episode:
- If episode number: `{PROJECT_DIR}/ep{N}_{slug}/_story_source/`
- If file path: read the draft directly; ask user for ep number to assign

Read these artifacts (some may be absent — handle gracefully). **Filenames vary by genre:**

| Artifact | yadam (Korean output) | dark-history (English output) | bespoke (any output language) | Resolution rule |
|----------|------------------------|-------------------------------|-------------------------------|-----------------|
| State | `STATE.md` | `STATE.md` | `STATE.md` | exact filename, all genres |
| Synopsis | `04_시놉시스.md` | `04_synopsis.md` | `04_synopsis.md` | exact filename match per genre. Do NOT glob `04_*.md` — bespoke also has `04_success_synthesis.md`. |
| Fact-check | `02_팩트체크.md` | `02_factcheck.md` | `02_factcheck.md` | exact filename per genre. All three genres including bespoke emit fact-check — never skip. |
| Research | `03_자료수집.md` | `03_research.md` | `03_research.md` | exact filename per genre. |
| Script parts | `{title}_기.md`, `_승.md`, `_전.md`, `_결.md` | `{title}_part1_setup.md`, `_part2_rising.md`, `_part3_crisis.md`, `_part4_resolution.md` | `{title}_part1_setup.md`, `_part2_rising.md`, `_part3_crisis.md`, `_part4_resolution.md` (English filenames regardless of output language) | per-genre filename pattern |
| Hook (schema v2+) | `{title}_hook.md` | `{title}_hook.md` | `{title}_hook.md` | universal ASCII filename. **schema: v1 episodes do not have this file** — diagnosis skips it and notes "schema=v1, hook lives inside part1". |
| Meta supplement | (n/a) | (n/a) | `_meta_supplement.md` | bespoke-only; absence = genre is NOT bespoke |
| Bespoke synthesis | (n/a) | (n/a) | `04_success_synthesis.md` | bespoke-only; distinct from `04_synopsis.md` |
| Bespoke ref analysis | (n/a) | (n/a) | `01_references_analysis.md` | bespoke-only |

**Design choice — Bespoke uses English filenames regardless of output language**

Bespoke artifacts are named in English (`04_synopsis.md`, `02_factcheck.md`, `Three_Wives_part1_setup.md`, etc.) regardless of whether the output language is Korean or English. The Korean content lives INSIDE the files; the filenames stay ASCII-safe for shell-tool compatibility and cross-language stability.

This is intentional and contrasts with **yadam**, which uses Korean filenames (`04_시놉시스.md` etc.) because yadam is locked to Korean output and has its own established convention. **dark-history** uses English filenames (lock to English).

**Bespoke output language affects file CONTENT, not file NAMES.**

**Implementation rule** — exact filename match keyed by genre + (for bespoke) output language for inside-file content interpretation:

- yadam → `02_팩트체크.md` / `03_자료수집.md` / `04_시놉시스.md` (Korean filenames + Korean content)
- dark-history → `02_factcheck.md` / `03_research.md` / `04_synopsis.md` (English filenames + English content)
- bespoke → `02_factcheck.md` / `03_research.md` / `04_synopsis.md` (English filenames; content in `STATE.md` "Output language:" — `ko` or `en`) + optional bespoke-only files

If genre is unknown after `STATE.md` read → AskUserQuestion (Step 2 below). Do NOT auto-glob a wrong file.

**Genre detection:**
- Read `STATE.md` "Genre:" line. Use that.
- If absent or ambiguous: `AskUserQuestion`. Do NOT guess silently.

**Per-genre meta-prompt loading** (used by W1-Rw-1 diagnosis):

| Genre | Meta-prompt files |
|-------|-------------------|
| **yadam** | `meta-prompts/yadam/야담_시놉시스_작성_지침.md`, `야담_프리플라이트.md`, `야담_시나리오_작성_지침.md`, `야담_서술기법_가이드.md`, `야담_서스펜스_기법.md` |
| **dark-history** | `meta-prompts/dark-history/synopsis_guidelines.md`, `preflight.md`, `screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md` |
| **bespoke** | `meta-prompts/bespoke/{lang}/synopsis_guidelines.md`, `preflight.md`, `screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md` (lang = `ko` or `en` per STATE.md output language) PLUS `_story_source/_meta_supplement.md` (per-episode supplement) |

The W1-Rw-1 diagnosis subagent applies the **engagement E0–E3 lens** (curiosity / expectation / engagement curve / drop-off zones) which is genre-agnostic in concept but lives in:
- `meta-prompts/bespoke/{lang}/narrative_techniques.md` § "10. Review dimensions" (English) / "10. 리뷰 차원" (Korean) — **primary source** for the engagement-primary review framework. `{lang}` = `en` or `ko` per the source episode's output language.
- `meta-prompts/dark-history/narrative_techniques.md` § "Review dimensions" — equivalent for dark-history-genre rewrites.
- For yadam: the same E0–E3 lens applies conceptually; the subagent adapts the universal lens to yadam's `야담_서스펜스_기법.md` "궁금증과 긴장 유지 기법" framing.

**Step 3: W1-Rw — engagement diagnosis (subagent)**

Spawn a subagent (`general-purpose`) to apply the engagement principle
(curiosity + expectation = 몰입도; see SKILL.md 핵심 원칙) to the original
script.

The subagent reads (genre-conditional):
- All script part files (per the filename table in Step 2) — **including `{title}_hook.md` when STATE.md `Schema: v2`**. For schema v1 (no separate hook file), the hook content lives at the very top of part1 and must be diagnosed in place.
- The universal hook principles: `meta-prompts/_common/hook_principles.md` — engagement diagnosis MUST evaluate the hook against the 5-element checklist regardless of schema version.
- The genre's meta-prompts:
  - **yadam**: `야담_시놉시스_작성_지침.md`, `야담_시나리오_작성_지침.md`, `야담_서술기법_가이드.md`, `야담_서스펜스_기법.md`
  - **dark-history**: `meta-prompts/dark-history/synopsis_guidelines.md`, `screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md`
  - **bespoke**: `meta-prompts/bespoke/{lang}/synopsis_guidelines.md`, `screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md` — `{lang}` per STATE.md output language (`ko` or `en`)
- For bespoke additionally: `_story_source/_meta_supplement.md`
- The engagement E0–E3 lens from `meta-prompts/bespoke/{lang}/narrative_techniques.md` § "Review dimensions" (or "리뷰 차원" in Korean) — canonical source for the engagement-primary review framework. For yadam, adapt the universal lens to `야담_서스펜스_기법.md` "궁금증과 긴장 유지 기법" framing.

The subagent produces `_story_source/01_improvement_diagnosis.md`:

```markdown
# Improvement Diagnosis — ep{N}

## Engagement scores (E0–E3, primary)

- **E0 Curiosity maintenance**: X/10
  - Drop-off zones (paragraphs that answer no question and pose no new one for 3+ consecutive paragraphs):
    - Part {N}, paragraph {M}: <quote 1 line>
    - ...
- **E1 Expectation accumulation**: X/10
  - Orphan seeds (setup without payoff): list
  - Pre-mature payoffs (payoff without setup): list
  - Atmospheric build-up that pays nothing later: list
- **E2 Engagement curve match**: X/10
  - Synopsis curve: <recap if available, or "not available — inferred">
  - Actual prose curve: <reviewer's reading>
  - Deviations: chapter Y is local-peak when synopsis says it should be low; ...
- **E3 No drop-off zones**: PASS / FAIL with explicit list

## Hook diagnosis (first 60 seconds)

- Promise specificity: <evaluation> — does the title/cold-open promise a specific question?
- First 30s payoff alignment: <does it begin to answer/raise the promise?>
- Concrete fix: <if FAIL>

## Reveal diagnosis (ch.16 lock)

- Truth landed at chapter: N
- Earliest-certainty violation: yes / no
- If yes: which prior chapter accidentally confirms the truth → fix recommendation

## Foreshadowing diagnosis

- Orphan seeds: <list, with chapter where setup occurs>
- Strongest unused seed opportunities: <list>
- Pre-mature reveals: <list>

## Drop-off zone catalog (rewrite priority)

| Location | Type | Severity | Fix recommendation |
|---|---|---|---|
| Part 2, paragraphs 5–7 | curiosity-flat | high | Plant a specific question; current paragraphs answer nothing |
| Part 3, paragraphs 12–14 | expectation-stall | medium | Stoke anticipation toward ch.16 |
| ... | | | |

## Suggested scope

Based on the diagnosis:
- **Polish recommended**: M drop-off zones, structure intact → prose-level rewrites
- **Restructure recommended**: act {X} engagement curve broken → rebuild act {X}
- **Full rewrite recommended**: structural failures across 2+ acts → start from synopsis

## Estimated improvement

- Engagement score after fix (predicted): E0 X→Y, E1 X→Y, E2 X→Y, E3 PASS
- Effort: <hours of subagent work; ElevenLabs / Google Flow credit cost if W5/W7 affected>
```

The subagent's return JSON includes the suggested scope.

**Step 4: 🛑 User scope decision**

AskUserQuestion presenting:
- 1-screen summary of the diagnosis (E0–E3 scores, top 3 drop-off zones)
- 4 scope options:

| Option | What re-runs |
|---|---|
| (a) **Polish** | W3 (prose rewrite of drop-off zones only; structure preserved) → W4 (re-extract changed parts) → W5 (re-TTS for changed segments) → W6 (re-CSV for changed scenes) → W7 (re-image only changed scenes) → W8 (re-import + re-export) → W9 (optional title polish) |
| (b) **Restructure** | W2 (rebuild synopsis for affected act) → W3 (rewrite that act) → W4–W9 (changed parts only) |
| (c) **Full rewrite** | W1 (re-research only if topic shifts) → W2 → W3 → W4–W9 (effectively /story-new from scratch with same topic) |
| (d) **Custom** | User specifies which paragraphs/beats; minimum scope |
| (e) **Cancel** | Take no action; diagnosis preserved for later reference |

**Step 5: Fork to {ep}-v2**

Create `{PROJECT_DIR}/ep{N}-v2_{slug}/` (or `-v3` if v2 exists). Copy:

```bash
cp -r {original}/_story_source/ {new}/_story_source/
# Update STATE.md
```

Update the new STATE.md:
- `Original`: ep{N}_{slug}
- `Mode`: rewrite
- `Scope`: <chosen>
- `Diagnosis ref`: _story_source/01_improvement_diagnosis.md
- All wave statuses reset to `pending` for the affected scope; non-affected
  waves marked as `inherited` (referencing original).

Do NOT copy generated assets (audio, images) — those regenerate for changed
scenes only. The `_story_source/` folder copy is sufficient input.

**Step 6: Run wave subset (scope state via `_rewrite_scope.json`, NOT a CLI flag)**

`/story-execute` only accepts `--from` / `--to`. To pass rewrite-mode scope information to wave subagents, write `_story_source/_rewrite_scope.json` BEFORE invoking `/story-execute`:

```json
{
  "mode": "rewrite",
  "scope": "polish" | "restructure" | "full" | "custom",
  "diagnosis_ref": "_story_source/01_improvement_diagnosis.md",
  "original_ep": "ep03_greenbrier_ghost",
  "affected": {
    "acts": ["II"] ,
    "parts": ["part2", "part3"],
    "scenes": [12, 13, 14, 17],
    "drop_off_zones": [
      {"part": "part2", "paragraphs": [5, 6, 7], "fix": "plant a specific question; current paragraphs answer nothing"},
      {"part": "part3", "paragraphs": [12, 13, 14], "fix": "stoke anticipation toward ch.16 reveal"}
    ]
  }
}
```

Then invoke `/story-execute` with the appropriate starting wave (no `--scope` flag — wave subagents detect rewrite mode by presence of `_rewrite_scope.json`):

| Scope | Invocation | Wave subagent behavior |
|-------|------------|------------------------|
| **Polish** | `/story-execute --from W3` | W3: rewrite ONLY paragraphs in `affected.drop_off_zones`. W4–W9: process ONLY parts in `affected.parts`. W2 skipped (synopsis intact). W1 skipped. |
| **Restructure** | `/story-execute --from W2` | W2: regenerate synopsis ONLY for `affected.acts`. W3: rewrite ONLY that act. W4–W9: process affected parts. |
| **Full rewrite** | `/story-execute --from W2` (or `--from W1` if topic shifts) | Full waves; affected scope = "all" — `_rewrite_scope.json` lets subagents distinguish "fresh content" (use original W1 artifacts) from "fully new". |
| **Custom** | Per user spec; `_rewrite_scope.json` lists exact paragraphs/beats. | Subagents process ONLY listed items. |

**Wave subagents in rewrite mode MUST:**
1. Check for `_story_source/_rewrite_scope.json` at start.
2. If present, scope work to `affected.*` lists (do NOT regenerate unaffected parts).
3. If absent, behave as a normal /story-new full wave.
4. Read `01_improvement_diagnosis.md` for the documented fix recommendations.
5. In their return JSON, include `rewrite_scope_applied: true` and list which `affected.*` items they touched.

**Step 7: User sign-off after W3 of new content**

Same as `/story-new` — manual gate before W4. If only some chapters were
rewritten, the gate confirms only those chapters; unchanged chapters stay.

**Step 8: Downstream waves with affected-only scope**

| Scope | W4 | W5 | W6 | W7 | W8 | W9 |
|---|---|---|---|---|---|---|
| Polish | re-extract changed parts | re-TTS changed segments | re-CSV changed scenes | re-image changed scenes | re-import + re-export | (optional) title polish |
| Restructure | re-extract affected act | re-TTS affected segments | re-CSV affected scenes | re-image affected scenes | re-import + re-export | re-evaluate title |
| Full rewrite | full re-extract | full re-TTS | full re-CSV | full re-image | full re-import | full new title/desc |

For Polish/Restructure: reused assets stay in original `{ep}/` location;
new assets land in `{ep}-v2/`. CapCut export from `{ep}-v2/` references
both (or copies needed assets — depends on AutoFlowCut conventions).

---

**Wave subagent prompts must read the diagnosis**

Every wave subagent invoked in /story-rewrite mode MUST include this
instruction:

> "**Rewrite-mode input**: read `_story_source/01_improvement_diagnosis.md`
> in addition to the standard wave inputs. Apply the documented fixes
> to the affected scope. The original artifacts in `_story_source/` (and
> the original ep folder, referenced) are inputs; the new outputs replace
> only the affected portions."

---

**Cost / time savings vs full /story-new**

- Polish: ~30% of full pipeline time (only changed paragraphs)
- Restructure: ~50% (one act rewritten + downstream changes)
- Full rewrite: ~90% (effectively a new run, but research can be reused)

The diagnosis itself takes ~3–5 min (single subagent reading the script).

</process>
