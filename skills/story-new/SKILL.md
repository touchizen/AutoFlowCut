---
name: story-new
description: "Initialize a new story episode. Creates episode directory, detects genre (yadam / dark-history / bespoke), discusses topic with user (and gathers 3–5 reference scripts if bespoke), initializes STATE.md. Auto-chains to /story-execute. Trigger: 'new episode', 'start ep5', '새 에피소드', '야담 대본 써줘', 'write a script about...'"
argument-hint: "[episode-number] [--genre yadam|dark-history|bespoke]"
---

<objective>
Initialize a new episode through topic discussion and context gathering.

**Creates (all paths resolved at runtime — see Step 0 of the workflow):**
- `{PROJECT_DIR}/ep{number}_{slug}/_story_source/` — episode directory (inside AutoFlowCut work folder, never inside source repo)
- `STATE.md` — workflow state (current wave, decisions)
- `W_progress.json` — progress log for external tools

**{PROJECT_DIR} resolution**: Call `mcp__autoflowcut__app_list_projects` — the `작업폴더:` line in its output is the work folder. Never fall back to cwd or to the source-code repo.

**After this command:** Automatically chains to `/story-execute`.
</objective>

<execution_context>
@skills/story-engine/workflows/new-episode.md
@skills/story-engine/SKILL.md
</execution_context>

<context>
Episode: $ARGUMENTS

**Genre Detection:**
- Korean + 야담/민담/조선/설화/전설 keywords → yadam (야담)
- English + dark/gothic/medieval/witch/folklore/colonial keywords → dark-history
- Otherwise → bespoke (universal genre with per-episode meta-prompt synthesis from user-provided 3–5 reference scripts)
- Override: `--genre yadam`, `--genre dark-history`, or `--genre bespoke`

**Bespoke additional input:** when bespoke is the genre, the workflow asks the user for 3–5 successful reference scripts (URLs / pasted text / local files) at Step 4 (Topic discussion). < 3 references = escalation.
</context>

<process>
Execute the new-episode workflow from @skills/story-engine/workflows/new-episode.md end-to-end.
</process>
