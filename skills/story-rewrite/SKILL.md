---
name: story-rewrite
description: "Improve an existing episode's script by diagnosing engagement gaps (curiosity / expectation / drop-off zones via the E0–E3 lens) and producing an improved version. Auto-detects the original episode's genre (yadam / dark-history / bespoke) and reuses its meta-prompts. Forks the original to {ep}-v2 — original preserved. Re-runs only the affected wave scope (polish / restructure / full). Trigger: 'improve script', 'fix draft', 'rewrite my episode', 'improve ep03', '대본 개선', '다시 써줘', 'ep03 개선'."
argument-hint: "[episode-number-or-path] [--scope polish|restructure|full]"
---

<objective>
Improve an existing episode's script. Diagnose engagement gaps using the
engagement principle (curiosity + expectation = 몰입도; see story-engine
SKILL.md 핵심 원칙), present a fix plan to the user, and produce an
improved version forked from the original.

**Reuses:**
- The original episode's genre (auto-detected from STATE.md)
- The genre's meta-prompts (yadam / dark-history / bespoke)
- W2/W3/W4–W9 waves (re-runs only the affected scope, not the whole pipeline)

**Creates:**
- `{ep}-v2/` directory (original `{ep}/` preserved — no overwrite)
- `_story_source/01_improvement_diagnosis.md` — engagement gap analysis
- New synopsis/script for the chosen scope
- Updated downstream artifacts (only for changed scenes/parts to save cost)

**After this command:** Pauses for user-confirmed scope, then chains into
the chosen wave subset (typically /story-execute --from W{N}).
</objective>

<execution_context>
@skills/story-engine/workflows/rewrite-episode.md
@skills/story-engine/SKILL.md
</execution_context>

<context>
$ARGUMENTS

Inputs accepted:
- **Episode number** (e.g., "ep03") — auto-locates the dir under PROJECT_DIR
- **File path** to a draft markdown — uses as-is; asks for genre + ep number

Optional `--scope` flag:
- `polish` — prose-level rewrites for drop-off zones; structure preserved
- `restructure` — rebuild a specific act (synopsis + script for that act)
- `full` — full rewrite (use draft as topic; effectively /story-new on same topic)

If `--scope` is omitted, the workflow runs diagnosis and asks the user.

**Genre auto-detection:** reads `STATE.md` of the source episode. If
unavailable, asks via AskUserQuestion.

**Distinction from existing W1 [Rewrite] path:** the W1 [Rewrite] path
(in `docs/{lang}/W1-story-design.md`) analyzes someone else's successful
reference to learn its patterns and produce a NEW script. This skill
analyzes YOUR OWN draft to find engagement weaknesses and produce an
IMPROVED version. Different operations.
</context>

<process>
Execute the rewrite workflow from @skills/story-engine/workflows/rewrite-episode.md end-to-end.
</process>
