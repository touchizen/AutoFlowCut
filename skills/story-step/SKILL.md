---
name: story-step
description: "Run the next single wave of the story pipeline only, then exit. Manual mode: no in-wave AskUserQuestion, no W3/W7 hard gates, no auto-advance. User reviews deliverables and re-invokes /story-step when ready for the next wave. Trigger: 'one wave', 'single step', 'step through', 'manual mode', '한 단계만', '한 웨이브', '한 단계씩', 'step'"
argument-hint: ""
---

<objective>
Run exactly one wave of the 9-wave story pipeline — the next incomplete one
according to STATE.md — then exit.

Differences vs `/story-execute` (auto, full pipeline) and `/story-next`
(auto, full resume):
- **No `AskUserQuestion`** anywhere (orchestrator OR subagent). Every choice
  the wave doc presents as user-facing is auto-resolved with a deterministic
  default and logged in the wave's `SUMMARY.md`.
- **No W3/W7 hard gates** — the orchestrator exits after one wave; user
  confirms by choosing to invoke `/story-step` again.
- **No loop to W{N+1}** — exactly one wave per invocation.

Use this when you want to inspect each wave's deliverables before deciding to
continue (vs `/story-execute` which runs through with two confirmation gates).
</objective>

<execution_context>
@skills/story-engine/workflows/step.md
@skills/story-engine/workflows/execute-pipeline.md
@skills/story-engine/SKILL.md
</execution_context>

<process>
Execute the step workflow from @skills/story-engine/workflows/step.md end-to-end.
Honor the manual-mode contract: no AskUserQuestion, single wave, exit cleanly.
</process>
