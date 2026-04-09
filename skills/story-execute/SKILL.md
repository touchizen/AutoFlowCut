---
name: story-execute
description: "Execute the 8-wave story pipeline automatically. W1(story design) → W2(synopsis) → W3(writing+review) → 🛑user confirm → W4(production) → W5(TTS/SFX) → W6(storyboard CSV) → W7(images+CapCut) → W8(upload info). Each wave runs as a subagent with fresh context. Review loops max 5 rounds. Trigger: 'execute story', 'run pipeline', '파이프라인 실행', '자동 실행'"
argument-hint: "[--from W{N}] [--to W{N}]"
---

<objective>
Execute the story pipeline from W1 to W8 using wave-based subagent execution.

Each wave:
- Runs as a subagent (fresh context)
- Has built-in review loop (max 5 rounds, exits on 0 issues)
- Writes W{N}_SUMMARY.md on completion
- Updates STATE.md + W_progress.json

**Manual gate:** W3 completion requires user confirmation before W4.

**Flags:**
- `--from W{N}` — start from wave N (default: next incomplete wave from STATE.md)
- `--to W{N}` — stop after wave N (default: W8)
</objective>

<execution_context>
@skills/story-engine/workflows/execute-pipeline.md
@skills/story-engine/SKILL.md
</execution_context>

<context>
$ARGUMENTS

Wave reference docs are loaded per-wave by the orchestrator.
STATE.md tracks current position for resume capability.
</context>

<process>
Execute the pipeline workflow from @skills/story-engine/workflows/execute-pipeline.md end-to-end.
Preserve all workflow gates (review loops, user confirmation at W3, state updates).
</process>
