# W3: Script Writing + Review

This document is the W3 (script writing + review) stage guide for the story-engine skill — shared across all genres (yadam / dark-history / bespoke); genre-specific filenames & tone live in the meta-prompts under `meta-prompts/{genre}/`.

## Reference documents (must read at this stage)

**Per-genre meta-prompts (3 files for script writing):**

| Genre | Screenplay / narrative / suspense |
|-------|-----------------------------------|
| yadam | `meta-prompts/yadam/야담_시나리오_작성_지침.md`, `야담_서술기법_가이드.md`, `야담_서스펜스_기법.md` |
| dark-history | `meta-prompts/dark-history/screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md` |
| Bespoke | `meta-prompts/bespoke/{lang}/screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md` |

**Bespoke `{lang}` resolution**: when `STATE.md` genre is `bespoke`, the output language (`ko` or `en`) is auto-detected. See SKILL.md 참조 문서 table.

**Output filenames** (5 script files + 1 review per genre):
- **yadam**: `{title}_기.md`, `_승.md`, `_전.md`, `_결.md`, `{title}_hook.md`, `07_검토.md`
- **dark-history**: `{title}_part1_setup.md`, `_part2_rising.md`, `_part3_crisis.md`, `_part4_resolution.md`, `{title}_hook.md`, `07_review.md`
- **bespoke**: same English form as dark-history (`{title}_part1_setup.md`, etc., `{title}_hook.md`, `07_review.md`); content in the language `STATE.md` "Output language:" specifies
- `{title}_hook.md` is **universal ASCII across all genres**. Hook is written LAST, ~20s duration (universal rules: [`meta-prompts/_common/hook_principles.md`](../../meta-prompts/_common/hook_principles.md)).

**Bespoke genre additional REQUIRED read**: `_story_source/_meta_supplement.md` — read alongside the universal base; **supplement WINS on conflicts**. The supplement specifies the per-episode length target, voice register, vocabulary, and benchmark callouts derived from the user's 3–5 reference scripts.

---

## ★ Primary review lens — Viewer retention

> `SKILL.md` 핵심 원칙: **Curiosity + Expectation = Engagement. The top-level evaluation criterion.**

W3 review evaluates not "is this interesting?" but **"does this make the viewer keep watching paragraph by paragraph?"** (Detailed review dimensions: yadam in `meta-prompts/yadam/야담_서술기법_가이드.md`, dark-history in `meta-prompts/dark-history/narrative_techniques.md`, bespoke in `meta-prompts/bespoke/{lang}/narrative_techniques.md` — all § Review dimensions. E0–E3 (engagement) is primary; C1–C10 (craft) is subordinate.)

Engagement primary (4 items, E0–E3):
- **E0. Curiosity maintenance** — does each paragraph keep the audience asking "what next?" / "what does this mean?" If 3+ paragraphs answer no question and pose no new one, that's a drop-off zone.
- **E1. Expectation accumulation** — does each paragraph plant or stoke a specific anticipation? Atmospheric build-up without later payoff = wasted space.
- **E2. Engagement curve match** — does paragraph-level pacing track the synopsis's chapter curve?
- **E3. No drop-off zones** — explicitly list any beat where a viewer would mentally check out → these get prose rewrites, not editorial trims.

Craft score ≥ 9.5 with even one E-failure = revise. Craft never compensates for engagement collapse.

---

## Script writing

**You MUST read the selected genre's 3 script-writing guidelines before starting** (see the "Reference documents" table above):
- **yadam**: `meta-prompts/yadam/야담_시나리오_작성_지침.md`, `야담_서술기법_가이드.md`, `야담_서스펜스_기법.md`
- **dark-history**: `meta-prompts/dark-history/screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md`
- **Bespoke**: `meta-prompts/bespoke/{lang}/screenplay_guidelines.md`, `narrative_techniques.md`, `suspense_techniques.md` + `_story_source/_meta_supplement.md`

(Filename typo note: the canonical filenames are `narrative_techniques.md` and `suspense_techniques.md` — plural, not singular.)

Based on the synopsis, **write the four parts (Setup / Rising / Crisis / Resolution) FIRST, then write the Hook with the full story in view, then do integrated review**.

### Writing order

```
Setup → Rising → Crisis → Resolution → Hook (LAST) → (after all complete) Review
```

**Why Hook is written last** — the cold open's only job is to ignite curiosity or
anticipation in the first 20–30 seconds. The most compelling lever
(flash-forward from Act III, mystery of the aftermath, provocative claim,
sensory immersion) can only be picked after the full arc is on paper. Drafting
hook first produces generic "Long ago, once upon a time…" openings (see
"Failing hooks" below).

**Hook lives in its own file** — `{title}_hook.md`. It is NOT duplicated inside
`{title}_part1_setup.md` (dark-history / bespoke) or `{title}_기.md` (yadam);
those start with the post-hook narrative.
Keeping hook separate lets the writer iterate hook independently (A/B different
openings without re-running part1) and lets reviewers focus on hook as the
single most-leveraged 30 seconds of the entire video.

**Hook target**: ~20s of narration (50–80 words EN / 80–130자 KO).

### W3 deliverables

W3 produces **5 script files + 1 review file**. Nothing else.

```
ep{number}/
├── {title}_part1_setup.md       ← Introduction (POST-hook) [dark-history & bespoke]
├── {title}_part2_rising.md      ← Development
├── {title}_part3_crisis.md      ← Crisis / twist
├── {title}_part4_resolution.md  ← Ending
├── {title}_hook.md              ← Cold open (~20s, written LAST — universal ASCII)
└── 07_review.md                 ← Integrated review
```

Upstream files (`01_analysis.md` ... `05_preflight.md`) come from W1/W2 and
are READ-ONLY for W3. Downstream artifacts (`segments_{part}/`,
`final_{part}.mp3`, `{title}_scenes.csv`, `media/final_full.mp3`, etc.) are
produced by W4–W8 and **not** by W3 — for the full episode tree across all
waves, see `workflows/execute-pipeline.md` § Wave I/O contract (the
single source of truth).

### Word count distribution (target: 2,000 – 3,000 words, ~13–20 min at ~150 wpm narration)

| Section | Word count (2,500 baseline) | Ratio |
|---------|------------------------------|-------|
| 【Setup】 Introduction | 375 | 15% |
| 【Rising】 Development | 750 | 30% |
| 【Crisis】 Crisis / twist | 875 | 35% |
| 【Resolution】 Ending | 500 | 20% |
| **Total** | **2,500** (midpoint) | 100% |

> **Note**: Below 2,000 words the story feels thin; above 3,000 the video runs long and YouTube retention drops. **You may go outside this range only if immersion is still sustained.**
>
> Word count check: `wc -w` (English word count, not character count)

### Prose conventions

- **POV**: Third-person observer, kept consistent throughout
- **Tense**: Past tense (narrator recounting historical events)
- **Opening phrases**: "In the year of our Lord...", "It was the winter of...", "Long before anyone alive remembered it...", "They say that on the night of..."
- **Closing CTA**: "If you'd like more stories like this one, leave a like and subscribe. I'll see you next time, dear listener. Until then — keep the candle burning."
- **Dialogue**: Period-appropriate speech. Avoid modern idioms. Class and region mark speech differently (peasant vs. noble, northerner vs. southerner, etc.)
- **Address by class**:
  - Peasants among themselves: familiar, direct
  - Peasants to nobles: deferential ("my lord", "your grace")
  - Nobles to peasants: curt, sometimes cruel
  - Clergy: archaic formality ("child", "my son", "brother")

### Show, Don't Tell — core rule

Never name emotions directly. Reveal them through action, physiology, environment, or dialogue.

| Emotion | Tell | Show |
|---------|------|------|
| Sadness | "She was sad." | Her shoulders bowed. Her fingers curled around the letter until the paper creased. |
| Anger | "He was angry." | His jaw tightened. The knuckles on the tankard handle went white. |
| Fear | "She was afraid." | A chill climbed the back of her neck. Her breath caught. The candle guttered. |
| Love | "He loved her." | He turned his face so she would not see him smile. He kept the ribbon in his breast pocket for the rest of his life. |
| Grief | "The family grieved." | No one lit the hearth for three days. The youngest brother kept setting out an extra bowl at supper. |

### Suspense techniques (applied to the script)

| Technique | Where to use |
|-----------|--------------|
| Open loop | Setup → early Rising. Plant a question; pay it off 2–3 chapters later. |
| Dramatic irony | Rising. The audience knows something the characters don't. |
| Time pressure | Crisis. A deadline compresses everything. |
| False resolution | Crisis. The problem appears solved — then a bigger one surfaces. |
| Callback | Resolution. An early line or image returns with new meaning. |

### Information-release principle — drip-feed, don't explain

If the narrator kindly explains everything, the audience loses the chance to infer. **Deliberately give less.**

| Kindly explanatory (bad) | Drip-feed (good) |
|--------------------------|------------------|
| "It wasn't Mistress Hale who had altered the ledger. She had detected someone else's tampering and had been quietly keeping her own record." | "The original figure still stood in Mistress Hale's book. Her hand paused above it." |
| "Agnes had not noticed anything strange at that moment." (authorial commentary on interiority) | Leave only the question in dialogue; let the viewer catch it. |
| "It turned out the steward was not the only one." (stating the conclusion in dialogue) | The ledger discrepancy reappears → only Agnes's lips tighten. |
| A moral/aphorism repeated three times ("Mistakes are not selective; intent is.") | State the aphorism once at setup and once at payoff. No middle repetition. |

**Principle**: The narrator reports facts. **Meaning and interpretation are for the viewer to infer.** "Something was not right" → revealed later. Do not explain immediately.

### Resolution / action-scene principle — fast and hard

Crisis-resolution, rescue, confrontation scenes should **cut down on narrative explanation and center on action**.

| Descriptive (slow) | Action (fast) |
|--------------------|---------------|
| "Agnes sought the key to the granary from the steward, but the baron had already removed it." | "No key. Thomas dragged the iron bar forward. The latch twisted." |
| "Agnes examined the ledger once more in the dim light of the single candle." | "Agnes opened the ledger. Set the counting-beads on her knee. Click. Click." |
| Three or four lines of reconciliation / confession dialogue | One or two key lines + action / physiology |

**Principle**: Crisis → resolution sections use **short sentences + verb-driven writing + sound and motion** to raise tempo. Explanations bleed tension.

### Setup — the first thirty seconds decide everything

- Open with a concrete, vivid situation — not "One day..."
- Avoid generic openings ("In a small village long ago...")
- Within three sentences, hint at the central conflict or mystery

#### Hook opening gallery (first 3 lines that work)

**Example 1 — Reveal the result first, the cause as mystery**
> On the morning of 17 October 1692, every child in Hartford Parish woke from the same dream.
> By Thursday, three of them were gone.
> The Reverend wrote down nothing of it in the parish register — and that silence is how we know.

**Why it works**: Shocking result (mass identical dream, children missing) up front. The absence (no record) is itself evidence. The viewer has to ask: what did the Reverend see?

---

**Example 2 — A final word + its riddle**
> The last thing Margaret Kent said before they took her to the gallows was a single sentence.
> "The key is not in the cellar."
> For eighty-six years no one in the house found a cellar, and no one dared to look.

**Why it works**: Final statement + unsolvable meaning. Strong open loop. "What key? What cellar?"

---

**Example 3 — Anomalous behaviour caught**
> One October afternoon, Lord Ashbourne dismissed every servant in his household on a single hour's notice.
> Before the sun had set, he locked the great doors from the inside.
> The doors were not opened again until the following Lent.

**Why it works**: Two anomalous acts (mass dismissal → self-imprisonment). The gap (a full winter) is the hook.

---

**Example 4 — Time jump + contrast**
> The boy took the bowl of thin soup without a word.
> Thirty years later, that same boy stood before the King with a sealed letter in his hand.
> The King did not yet know that the bowl of soup given to a stranger in the rain had already decided the outcome of the war.

**Why it works**: Ordinary scene → 30-year jump → dramatic consequence implied. "How could a bowl of soup...?"

---

**Example 5 — Negation + riddle**
> That night, not one of the village dogs barked.
> The oldest shepherds, who had lived there seventy winters, had never known such a silence.
> By morning, a box wrapped in black cloth had been set before the magistrate's door.

**Why it works**: "Did not bark" — the absence is itself eerie. Silence + a dark parcel arriving. What is coming?

---

#### Failing hooks (before / after)

**Failure 1 — Generic opening**
> ❌ Long ago, in a small village, there lived a poor old couple. They had little but loved each other dearly. One day, something strange happened in their garden.

**Problem**: "Long ago", "One day" — viewer leaves immediately. No hook in the first 3 lines.

> ✅ Every night, something was taking away a handful of earth from the old couple's garden. On Monday, a handful. By Friday, a shovelful. By the following Sunday, the entire vegetable plot was gone. And by dawn each day, the plot was always — always — back where it had been.

**Fix**: Remove generic opening + specific anomaly (earth disappearing) + anomaly's anomaly (restoration each dawn) + scale escalation (handful → plot).

---

**Failure 2 — Too much background**
> ❌ In the year 1692, in the village of Hartford in the County of Essex, there lived a widow named Margaret Kent, aged thirty-five, who had lost her husband to the plague and supported herself by running a small inn. She was known for her sharp temper and exact accounts, and she kept a ledger of every coin that passed through her door. One morning, the ledger was gone.

**Problem**: Three sentences of setup → viewer already gone. No mystery in the first line.

> ✅ When Margaret Kent's ledger disappeared, she did not weep. She bolted the inn door and let no one enter for three days. When she opened the door again — in her hand was a ledger, identical to the one that had been lost.

**Fix**: Character's reaction (not weeping, locking door) → curiosity. What emerged after three days (new, identical ledger) → deeper mystery.

---

#### Hook design formula

| Element | Question | Check |
|---------|----------|-------|
| Is the first sentence anomalous? | "That is not ordinary." | Does the reader pause? |
| Is there a mystery within 3 sentences? | "Why did that happen?" | Is a question formed automatically? |
| Does it avoid immediate answer? | Not explaining | Is there no "because..." commentary mixed in? |
| Are there concrete details? | "17 October 1692", "three of them", "eighty-six years" | Not vague generalities? |

---

#### Suspense techniques, before / after

**1. Open loop (pose a question, delay the answer)**

> ❌ **Closed loop (bad)**
> "Agnes opened the ledger and saw at once that the steward had taken the missing sum."

> ✅ **Open loop (good)**
> "Agnes opened the ledger. She checked it three times. When the fourth bead of the counting-frame slid back, her lips went still."

**Difference**: Bad version answers immediately. Good version shows only action; the answer comes later.

---

**2. Dramatic irony (the audience knows; the character doesn't)**

> ❌ **No tension**
> "The baron had altered the tithe-book. Agnes, unaware, handed over another sack of grain."

> ✅ **Dramatic irony**
> "Agnes took the tithe-book the baron offered. The numbers matched her own. What she did not know — but the listener did — was that the numbers had been rewritten by candlelight the night before."

**Difference**: Bad version is narrator shorthand. Good version gives the secret to the viewer only; the character's calm action generates tension.

---

**3. Time pressure (deadline)**

> ❌ **No sense of time**
> "Agnes had to uncover the ledger's secret. It was not an easy task."

> ✅ **Time pressure**
> "Before the third bell of matins — Agnes had to find the hidden entry in the ledger. The first bell had already rung across the frost. Her fingers moved faster."

**Difference**: Good version gives a concrete deadline (third bell) + a countdown already in motion (first bell).

---

**4. False resolution (it seems solved — it isn't)**

> ❌ **Linear**
> "The steward was revealed as the culprit. Everyone was relieved. But the true culprit was someone else."

> ✅ **False resolution**
> "When the steward was dragged out, the village drew breath again. Even the baron nodded. At that very moment — outside Agnes's door — a fresh ledger, newly bound, was waiting."

**Difference**: Good version shows the *air* of resolution (breath, nod), then plants the seed of the next act without explanation.

---

**5. Callback (an early element transformed in meaning)**

> ❌ **No connection**
> "The tale was finished. Agnes lived in peace once more."

> ✅ **Callback**
> "Thirty years passed. A new counting-master came to the village. When Agnes's grandson heard the click of his beads, something in him went still. Four clicks. Somewhere — somewhere — he had heard them before."

**Difference**: The "fourth bead" from the opening returns thirty years later to the grandson. The meaning amplifies.

---

#### Immersion-collapse warning signs (check during review)

If any of these appear, rewrite the section immediately.

| Signal | Symptom | Fix direction |
|--------|---------|---------------|
| Explanatory paragraph | Consecutive "This was because..." | Cut explanation; keep only action / reaction |
| Emotion named | "He was sad", "She was happy" | Convert to Show |
| Too much info at once | Three+ secrets revealed in one chapter | Spread across 2–3 chapters |
| Dialogue overload | Dialogue continuing past 5 lines | Insert action / description between lines |
| Repeated phrasing | "The villagers did not know" used 3+ times | Vary the phrasing |
| Flat emotional curve | Same tone throughout — no tension/release | Ensure one emotional pivot per chapter |

### Rising — build the question

- Place at least two decoy suspects (mystery structure)
- Repeat the "small victory → larger crisis" pattern
- Disguise the real culprit as an ally or helper
- Establish emotional bonds (trust, friendship, obligation, indebtedness)

### Crisis / twist — double-twist, maximum gap

- First twist: "Could it be...?" + Second twist: "And this too?!"
- **The culprit's identity is revealed AFTER chapter 15 (mid-third-act)** — if revealed earlier, the structure fails.
- **Twist-gap principle**: the larger the distance between what the viewer believed and the truth, the stronger the twist.
  - The most trusted ally is the culprit → maximum gap → maximum shock
  - The most-suspected character was in fact the protector → double reversal
  - Before the twist, build enough trust/suspicion scenes so the gap is wide.
- After the twist, give scenes that let the emotion deepen (shock → betrayal → rage → catharsis)

### Resolution — leave a resonance

- Pay off foreshadowing for satisfaction
- Use callbacks for emotional peak
- The final sentence carries the lesson and the lingering resonance

### At every chapter transition

- [ ] No direct naming of emotions? (Show, Don't Tell)
- [ ] At least one cinematic technique used?
- [ ] At least two of the five senses invoked?
- [ ] Natural continuity with the previous chapter?
- [ ] Word count distribution respected?
- [ ] Foreshadowing tracker up-to-date?

---

## Review and revision (iterative)

Self-review → subagent review → revise — **repeat until there are no more revisions** (max 5 rounds, target average 9.5/10).

```
┌─ 1. Self-review + list revisions
│     ▼
│  Revisions needed? → YES → revise script
│                            ▼
│                    subagent review (subagent reads the script files directly)
│                            ▼
│                    Revisions needed? → YES → revise → re-review (loop)
│                                     → NO  → exit loop
│                   → NO  → exit loop
│
│  ※ Max 5 rounds. If exceeded, escalate to user.
│
└─ External review (optional): run Gemini / Codex only on user request
```

### Evaluation criteria (each out of 10, target avg. 9.5)

> **Curiosity + Anticipation = Immersion** — Immersion is the top criterion.
> If curiosity breaks, anticipation dies, and immersion collapses.

| Criterion | Checkpoints | Priority |
|-----------|-------------|----------|
| **Immersion** | 30-sec hook, sustained curiosity, no dead stretches, shock-value of twist | Highest |
| **Emotional impact** | Empathy depth, tear / rage / catharsis moments, resonance | High |
| **Entertainment** | Dialogue appeal, character individuality, pacing, unpredictability | High |

### Review checklist

**Curiosity maintenance:**
- [ ] Curiosity established within the first 30 seconds?
- [ ] Any dead stretches where a viewer might leave?
- [ ] Culprit/truth not revealed too early? (If fixed before chapter 15, structural failure.)
- [ ] Twist not predictable?

**Prose quality:**
- [ ] No direct naming of emotions? (Show, Don't Tell)
- [ ] Patterns like "the villagers did not know" not repeated more than twice?
- [ ] Sensory description is sufficient?

**Structure:**
- [ ] All foreshadowing paid off?
- [ ] Total word count within 2,000–3,000? (may exceed when immersion is sustained)
- [ ] No period/historical errors?
- [ ] No banned items (anachronisms, modern brands, ellipsis overuse, etc.)?

**Ending:**
- [ ] Villain's comeuppance is satisfying?
- [ ] Ending leaves a resonance?
- [ ] CTA line included?

### External AI validation (optional)

> **Optional**: Only run when the user explicitly requests it. Takes a long time, so default is self-review only.

If the user requests external validation, spawn Gemini-cli and Codex MCP agents in parallel.

**Codex MCP:**
```
cwd: "/path/to/project/story/ep{number}"
```
- Don't paste the text inline; pass the directory path via cwd
- Ask for: Immersion / Emotional impact / Entertainment scored out of 10 + analysis of curiosity-maintenance windows

**Gemini-cli:**
```
mcp__gemini-cli__ask-gemini
```
- Pass the script file paths and ask for feedback

**Reviewing and applying feedback:**
- Valid criticism → apply
- Excessive or misdirected criticism → note the reason and skip

**Output file**: `07_review.md` (self-review + external feedback integrated)

**Review (substep 3-1)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to the next Wave (after user confirmation below). 5 rounds exceeded → escalate to user.

---

## User confirmation required

After W3 completes, the user must confirm the script before proceeding to W4.

---

## Wave review summary
Each substep above enforces max-5-round review with auto-advance on 0 issues. Wave 3 completes when the last substep's review passes. Escalate to user if any substep exceeds 5 rounds.
