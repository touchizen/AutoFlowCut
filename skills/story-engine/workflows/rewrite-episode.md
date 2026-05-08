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

Read these artifacts (some may be absent — handle gracefully):
- `STATE.md` — genre, decisions, target length, original topic
- `04_synopsis.md` — original synopsis (if exists)
- Script parts: `Three_Wives_part*.md`, `{title}_기.md`/`승/전/결.md`, etc.
- `02_factcheck.md` — fact-check (REUSE; do NOT re-run W1-1)
- `03_research.md` — research (REUSE; do NOT re-run W1-2)
- `_meta_supplement.md` — bespoke supplement (if bespoke)

**Genre detection:**
- Read `STATE.md` "Genre:" line. Use that.
- If absent or ambiguous: AskUserQuestion. Do NOT guess silently.

**Step 3: W1-Rw — engagement diagnosis (subagent)**

Spawn a subagent (`general-purpose`) to apply the engagement principle
(curiosity + expectation = 몰입도; see SKILL.md 핵심 원칙) to the original
script.

The subagent reads:
- All script part files
- The genre's meta-prompts (`meta-prompts/{genre}/*.md`)
- For bespoke: `_meta_supplement.md`
- `meta-prompts/{genre}/narrative_techniques.md` § "10. Review dimensions"
  (E0–E3 engagement criteria, C1–C10 craft criteria)

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

**Step 6: Run wave subset**

Per the chosen scope, invoke `/story-execute --from W{N} --scope <scope>`:

- **Polish**: skip W1 entirely (no fact-check/research needed); skip W2 (synopsis intact); start W3 with the targeted drop-off zones
- **Restructure**: skip W1 fact-check/research; W2 partial (regenerate synopsis for the affected act only); W3 partial (rewrite that act)
- **Full rewrite**: skip W1 fact-check/research IF topic same; otherwise full W1; then W2/W3 from scratch

The orchestrator's wave subagents read the diagnosis (`01_improvement_diagnosis.md`) as input and apply the documented fixes.

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
