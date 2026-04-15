# W2: Synopsis + Preflight

This document is the W2 (synopsis writing + preflight check) stage guide for the story-engine skill — dark-history genre.

## Reference documents (must read at this stage)

| Step | Document |
|------|----------|
| Synopsis | `meta-prompts/dark-history/synopsis_guidelines.md` |
| Preflight | `meta-prompts/dark-history/preflight.md` |

---

## Synopsis writing

**You MUST read `synopsis_guidelines.md` before starting.**

Write a synopsis based on the 20-chapter framework.

### 20-chapter structure

```
【Setup】 Introduction (1–5)
├─ 1. Era and setting established
├─ 2. Protagonist introduced
├─ 3. Relationship web of surrounding characters
├─ 4. Peaceful daily life + first hint of change
└─ 5. Inciting incident — the rupture of the ordinary

【Rising】 Development (6–12)
├─ 6. First choice and action
├─ 7. A character who changes the story's direction enters
├─ 8. First trial and response
├─ 9. First twist — the situation shifts
├─ 10. Relationships deepen and transform
├─ 11. Second trial — crisis escalates
└─ 12. A crucial secret / piece of information is discovered

【Crisis】 Third act (13–17)
├─ 13. Protagonist's inner growth and change
├─ 14. Central twist — the situation is reversed
├─ 15. Maximum crisis — moment of despair
├─ 16. Decisive choice and action
└─ 17. Climax — final confrontation / trial

【Resolution】 Ending (18–20)
├─ 18. The full truth is revealed
├─ 19. Conflict resolved; a new order settles
└─ 20. Lesson and lingering resonance
```

### What to design at the synopsis stage

- **Curiosity maintenance (top priority)**: At the synopsis stage, explicitly mark "the earliest chapter at which the viewer can be certain of the culprit/truth". It MUST fall after chapter 15 (mid-third-act).
- **Emotion-to-action mapping**: For each major emotional beat, plan the "show, don't tell" method.
- **Suspense technique placement**: Plan which technique goes in which chapter:
  - Setup (1–5): open loops, information gap, seed placement
  - Rising (6–12): dramatic irony, gradual thaw, escalation
  - Crisis (13–17): cliffhangers, time pressure, false resolution, pattern break
  - Resolution (18–20): callbacks, ironic reversal, compound small-kindness payoff
- **Foreshadowing tracking draft**: Pre-assign setup chapter and payoff chapter for each seed
- **Suspect placement**: At least 2 decoy suspects in addition to the real culprit
- **Twist gap design**: Disguise the real culprit as the character the viewer trusts most → maximum gap at reveal. Before the reveal, build enough trust-establishing scenes.
- **Cinematic points**: Design key scenes where slow-motion, parallel editing, montage, or voice-over flashback would land hardest.

**Output file**: `04_synopsis.md`

**Review (substep 2-1)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 2-2. 5 rounds exceeded → escalate to user.

---

## Preflight check

**You MUST read `preflight.md` and inspect the synopsis against it.**

### Absolute prohibitions

| # | Prohibition |
|---|-------------|
| 1 | Direct naming of emotions ("she was sad", "he was happy") — always show through action, physiology, or dialogue |
| 2 | Ellipsis overuse (..., …) except for clearly intentional trailing speech |
| 3 | Anachronistic vocabulary (modern slang, post-period loanwords) |
| 4 | Modern brand names, modern technology references |
| 5 | Arabic numerals in narration (prefer spelled-out: "eight o'clock" not "8 o'clock") — flexible if genre-appropriate |
| 6 | Pronoun drift ("he", "she") when the referent is ambiguous — use name, title, or descriptor |
| 7 | Generic modern address ("Mr.", "Ms.") where period terms fit better ("Master", "Mistress", "Goodwife", "Father", "the Widow") |
| 8 | Modern occupational names where period terms exist ("servant" → "scullery maid", "lady's maid", "footman") |

### Synopsis structural check

- [ ] At least 2 decoy suspects placed?
- [ ] At least a double twist designed?
- [ ] Is curiosity sustained through chapter 15 (mid-third-act)? → Verify that the earliest chapter at which a viewer can be certain of the culprit/truth is AFTER chapter 15.
- [ ] At least one suspense technique placed per section?
- [ ] Foreshadowing tracker complete?
- [ ] Does the emotional curve oscillate (rise and fall) rather than rising monotonically?

### Foreshadowing tracker template

| # | Seed | Setup chapter | Payoff chapter | Status |
|---|------|---------------|----------------|--------|
| 1 | | | | not placed / placed / paid-off |

If it passes, proceed to W3. If issues are found, revise the synopsis and re-run preflight.

**Output file**: `05_preflight.md`

**Review (substep 2-2)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to the next Wave. 5 rounds exceeded → escalate to user.

---

## Wave review summary
Each substep above enforces max-5-round review with auto-advance on 0 issues. Wave 2 completes when the last substep's review passes. Escalate to user if any substep exceeds 5 rounds.
