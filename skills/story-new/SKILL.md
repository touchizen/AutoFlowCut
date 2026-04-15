---
name: story-new
description: "Initialize a new story episode. Creates episode directory, detects genre (yadam/dark-history), discusses topic with user, initializes STATE.md. Auto-chains to /story-execute. Trigger: 'new episode', 'start ep5', '새 에피소드', '야담 대본 써줘', 'write a script about...'"
argument-hint: "[episode-number] [--genre yadam|dark-history]"
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
- Korean input → yadam (야담)
- English input → dark-history
- Override: `--genre yadam` or `--genre dark-history`
</context>

<process>
Execute the new-episode workflow from @skills/story-engine/workflows/new-episode.md end-to-end.
</process>
