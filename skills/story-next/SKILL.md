---
name: story-next
description: "Resume story pipeline from where it left off. Reads STATE.md to determine current wave and continues execution. Trigger: 'continue story', 'resume', '이어서 해줘', '다음 단계', 'story next'"
argument-hint: ""
---

<objective>
Resume the story pipeline from the last incomplete wave.

Reads STATE.md to determine:
- Current episode and wave
- What was completed
- What needs to run next

Then delegates to `/story-execute --from W{next}`.
</objective>

<execution_context>
@skills/story-engine/workflows/resume.md
@skills/story-engine/SKILL.md
</execution_context>

<process>
Execute the resume workflow from @skills/story-engine/workflows/resume.md end-to-end.
</process>
