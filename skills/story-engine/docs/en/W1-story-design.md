# W1: Story Design

This document is the W1 (success-factor analysis, fact-check, research) stage guide for the story-engine skill — dark-history genre.

## Environment precheck (required before starting)

Before starting W1, verify the environment is capable of completing the full pipeline. Hitting a block later wastes W1–W4 of work.

### Required items

| # | Item | How to check | On failure |
|---|------|--------------|-----------|
| 1 | **AutoFlowCut app running** | Call `app_status` MCP (localhost:3210) | Guide user to launch the app |
| 2 | **Work folder set** | Check `app_list_projects` response | Guide user to set work folder in app settings |
| 3 | **Claude Code MCP connected** | `mcp__autoflowcut__*` tools accessible | Guide user to register MCP / restart Claude Code |

### Optional items (missing any = that Wave blocked)

| # | Item | Used in | Location | Fallback if missing |
|---|------|---------|----------|--------------------|
| 4 | **ElevenLabs API** | W5 TTS / SFX generation | `~/.elevenlabs/credentials` | Vrew manual / Google AI Studio / skip W5 |
| 5 | **Typecast API** | W5 dialogue TTS (emotion-tagged) | `~/.typecast/credentials` | Replace with ElevenLabs per-character voice split |
| 6 | **Google Flow login** | W7 image / video generation | Flow tab login state in the AutoFlowCut app | Insert images manually in CapCut |
| 7 | **Google AI Studio API** | W5 Gemini TTS (to be integrated) | `~/.google-ai-studio/credentials` | Use ElevenLabs or Typecast instead |

### Reporting the result

Present the precheck result as a table to the user. **If any optional item is missing, ask the user which path to take.**

```
Environment check:
✅ AutoFlowCut app running
✅ Work folder set
✅ MCP connected
⚠️ ElevenLabs credentials missing → W5 TTS / SFX blocked
✅ Google Flow logged in

Without ElevenLabs, options:
1. Run W1–W4 only; handle W5 manually in Vrew
2. Create a free account (10 min free at elevenlabs.io), save credentials, then continue
3. Skip W5 entirely and handle audio manually in CapCut
4. Cancel

Which would you like?
```

**Do NOT start the actual W1 work until the user responds.**

---

## Branches

| Path | Trigger | Genre | Content |
|------|---------|-------|---------|
| **New** | "new episode", "write a script" + dark-history keywords | dark-history | Topic → fact-check → research |
| **Rewrite** | "rewrite", "redesign" | yadam / dark-history | Reference analysis → success factors → improvements |
| **Bespoke** | `--genre bespoke` or no other genre fits | bespoke | User-provided 3–5 references → meta-prompt synthesis → fact-check → research |

---

## [New] Path

### 1. Fact-check

Verify the historical claims in the topic or reference.

- Period accuracy (medieval Europe, Victorian era, colonial America, etc.) — titles, class system, daily life
- Real names of people, places, and institutions
- Customs, rituals, superstitions, legal/religious practices of the era
- Use WebSearch automatically (no separate permission needed)

#### Output

```
## Fact-check Results

✅ Confirmed: ...
⚠️ Needs correction: (original) → (accurate version)
❓ Uncertain (further check recommended): ...
```

**Output file**: `02_factcheck.md`

### 2. Research

Use WebSearch to collect material related to the topic. (Auto-executed)

- Primary sources (chronicles, court records, newspaper archives, trial transcripts, church registers)
- Variants of the same folklore/legend across cultures (Brothers Grimm variants, regional ghost-story variants)
- Historical context (plagues, wars, religious upheavals, technological shifts)
- Detail material (food, clothing, architecture, customs, medicine, belief systems)
- "Seasoning" anecdotes — surprising micro-facts that add texture

**Output file**: `03_research.md`

---

## [Rewrite] Path

### Success-factor analysis

When the user provides a reference (URL, transcript, video), analyze it.

#### Analysis items

- **Hook**: Structure of the first 30 s–1 min opening
- **Story structure**: Act structure (setup/confrontation/resolution or 5-act), tension-release rhythm, placement of twists
- **Emotional design**: Which emotion is triggered and where
- **Curiosity maintenance**: How questions are seeded, mystery structure, timing of information reveal
- **Character**: Empathy anchors, reversal characters, distribution of suspicion
- **Language style**: Sentence length, closing cadences, recurring refrains, how the audience is addressed ("dear listener", "my friends", etc.)
- **Closing**: How the episode wraps and how it funnels to the next one

#### Output

```
## Success-factor Analysis

**Hook technique**: ...
**Story structure**: ...
**Emotional design**: ...
**Curiosity maintenance**: ...
**Character design**: ...
**Language style**: ...
**Closing technique**: ...

**→ Core success formula summary**: (1–3 lines)
```

**Output file**: `01_analysis.md`

---

## [Bespoke] Path

**Bespoke genre only** — analyzes 3–5 user-provided successful scripts to synthesize a per-episode meta-prompt (`_meta_supplement.md`). W2/W3 read the universal `meta-prompts/bespoke/` files alongside this supplement.

### Prerequisite

- `/story-new` REQUIRES **3–5 successful reference scripts** (URLs / pasted text / local files)
- ≤ 2 references → escalation (Bespoke cannot proceed; offer switch to yadam/dark-history, or request more references)
- Optional per-reference user labels: `tone-match`, `structure-match`, `topic-adjacent`, `audience-match`

### Substeps

**W1-0. Load references**
- Save user-provided material under `_references/` (URLs → fetch transcript via `WebFetch`; if extraction fails, ask user for transcript)
- **Metadata** (`_references/index.json`):
  - `id`, `source` (URL or "pasted"), `transcript_file`
  - `views`, `published_at`, `channel_size` (subscriber count), `view_subscriber_ratio`
  - `title`, `thumbnail_text` (text overlay on the thumbnail, if known)
  - `length_words`, `length_minutes`
  - `user_label` (optional: tone-match, structure-match, topic-adjacent, audience-match)
- **Reference selection criterion** — "high view count" is a proxy only. The real selection bar is **whether the video successfully maintained viewer curiosity + expectation** (the engagement principle — see `SKILL.md` 핵심 원칙). Pick references that satisfy at least one:
  - Comment-section retention signals ("watched all the way through", "couldn't stop watching")
  - Channel-size-relative viral indicator (view/subscriber ratio ≥ 5)
  - Absolute views ≥ 100K (must be paired with retention signals — high-view bait videos do NOT qualify)
  → A low-view video with strong engagement is preferred over a high-view bait video. The point is to learn the mechanism, not the headline metric.

**W1-1. Per-reference success-factor analysis**
- Apply the [Rewrite] analysis items to each reference (hook, story structure, emotional design, curiosity, characters, language style, closing)
- **Output**: `01_references_analysis.md` (3–5 sections, one per reference)

**W1-2. Topic fact-check** (same as [New] §1)
- **Output**: `02_factcheck.md`

**W1-3. Topic research** (same as [New] §2)
- **Output**: `03_research.md`

**W1-4. Cross-script engagement-mechanism synthesis**

Decompose the W1-1 analyses across **4 engagement faces** (the engagement principle — curiosity + expectation = engagement; see `SKILL.md` 핵심 원칙):

1. **Curiosity generation mechanism** — how do the references prompt the audience to ask "what happened?" / "what does this mean?" (information-withholding patterns, hook structure, mystery setup, first-60-second promise)
2. **Expectation accumulation mechanism** — how do the references stoke the "this is going to pay off" anticipation (foreshadow cadence, mini-cliffhangers, escalation, payoff promises)
3. **Curiosity ↔ Expectation interplay** — how do the two engines complement / alternate / amplify each other (a reveal opens a new mystery; a mystery stokes a new expectation)
4. **Engagement curve** — engagement-over-time shape (cold-open peak, mid-section dip prevention, ch.16 climax, held-quiet close) — compare per-reference curves and extract common shapes

**Supporting extraction (props for the 4 faces):**
- **Common tropes** — genre conventions (the visible patterns in how the 4 faces are expressed)
- **Differentiators** — unique moves per reference (inspiration pool, concrete callouts to apply to this episode)
- **Avoid list** — beats where retention faltered (if any) OR what user labels excluded

**Output**: `04_success_synthesis.md` (4 engagement-mechanism sections + 3 supporting)

**W1-5. Meta-prompt synthesis**
- W1-3 (research) + W1-4 (cross-synthesis) → write `_meta_supplement.md`
- Supplement sections:
  - `## Tone / voice register`
  - `## Period / setting vocabulary`
  - `## Reference success factors` (summary of W1-4)
  - `## Avoid list`
  - `## Benchmark callouts` (specific moves from W1-1 references — "apply ref-2's hook style to ch.1")
- **Output**: `_meta_supplement.md` (W2/W3 MUST read this)

### Review

W1-0 through W1-3 have no review loop. **W1-5 output (`_meta_supplement.md`) is recommended for user confirmation** (not a hard gate like W3; W2 synopsis sign-off may be sufficient).

---

## Benchmark channels

| Channel | Representative video | Views | Length | Niche |
|---------|----------------------|-------|--------|-------|
| Bailey Sarian | "Murder, Mystery & Makeup" series | 1M+ per episode | 20–40 min | True crime, casual storytelling |
| BuzzFeed Unsolved / Watcher | True crime episodes | 5–20M | 15–30 min | True crime / supernatural, duo banter |
| Lemmino | "The Zodiac Killer" | 40M+ | 30–60 min | Deep-dive unsolved mysteries |
| The Infographics Show | "Dark history" episodes | 5–20M | 10–15 min | Animated dark history / facts |
| Casual Criminalist | Infamous crimes | 1M+ | 15–25 min | Story-driven narration |
| Fact Fiend | Obscure dark facts | 500K+ | 10–20 min | Dry humor, obscure history |

### Winning topic patterns

- **Fall from grace**: Royalty → outcast, hero → villain, lover → murderer
- **Hidden identity**: The kindly neighbor was a serial killer; the beggar was a deposed prince
- **Family secrets & betrayal**: Inheritance feuds, incestuous nobility, murderous spouses
- **The wise victim**: A child, a servant, a "witch" uses cunning to survive persecution
- **Karmic reversal**: Cruelty punished, kindness rewarded in dramatic fashion — often centuries later
- **Forbidden knowledge / heresy**: A scholar, healer, or midwife destroyed by the powerful
- **Unsolved disappearance / cold case**: Ambiguous evidence, multiple suspects

### Winning title patterns

- **Provocative situation + curiosity hook**
  "The Orphan Boy Sold for Five Shillings Who Would Later Execute the King's Advisor"
- **Twist foreshadowed**
  "Everyone Mocked the 8-Year-Old Bride Until What She Whispered on Her Wedding Night"
- **Character contrast**
  "The Beggar a Duchess Saved for Pity — and the Fortune He Secretly Hid in Her Cellar"
- **Number / date anchor**
  "In 1348 a Plague Doctor Walked Into the Wrong Village. What He Saw There Was Never Written Down."
- **Question opener**
  "Why Did the Entire Village of Hartford Vanish in a Single Night in 1692?"

### Narration voice defaults for dark-history

- **Perspective**: Omniscient narrator with occasional direct address ("dear listener", "let me tell you what really happened")
- **Tone**: Measured, grave, occasionally wry — never jokey
- **Pacing**: Slow-burn with controlled escalation; long sentences for atmosphere, short sentences for shock
- **Diction**: Period-appropriate vocabulary; avoid anachronisms unless deliberate contrast
- **Address**: "my friends", "dear listener", or nameless — avoid casual "you guys"

---

## Review

W1 has no review loop. Proceed to W2 after research is complete.
