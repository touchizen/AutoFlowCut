---
name: story-new
description: "Initialize a new story episode. Creates episode directory, detects genre (yadam/dark-history), discusses topic with user, initializes STATE.md. Auto-chains to /story-execute. Trigger: 'new episode', 'start ep5', '새 에피소드', '야담 대본 써줘', 'write a script about...'"
argument-hint: "[episode-number] [--genre yadam|dark-history]"
---

<objective>
Initialize a new episode through topic discussion and context gathering.

**Creates:**
- `{PROJECT_DIR}/story/ep{number}/` — episode directory
- `STATE.md` — workflow state (current wave, decisions)
- `W_progress.json` — progress log for external tools

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
