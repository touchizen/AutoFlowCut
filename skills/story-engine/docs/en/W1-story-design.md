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

| Path | Trigger | Content |
|------|---------|---------|
| **New** | "new episode", "write a script", "start ep5" | Topic → fact-check → research |
| **Rewrite** | "rewrite", "redesign" | Reference analysis → success factors → improvements |

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
