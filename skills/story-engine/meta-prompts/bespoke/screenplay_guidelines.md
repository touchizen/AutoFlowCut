# Screenplay Guidelines — Bespoke Genre (Universal)

This is the **genre-neutral** screenplay (script-writing) guideline. Used by W3 alongside `narrative_techniques.md`, `suspense_techniques.md`, the synopsis (`04_synopsis.md`), and the per-episode `_meta_supplement.md`.

---

## 1. Format (YouTube voice-over copy, NOT screenplay)

- **No screenplay sluglines** (`INT./EXT.`, `FADE IN`, `(beat)`).
- **Continuous narration prose** with occasional inline quoted dialogue.
- **Markdown only** — `*emphasis*` for prosodic stress (will become SSML in W5).
- **One file per act** (4 files total: setup / rising / crisis / resolution).
- Word count per file = target ÷ 4 (with discretion for act weighting).

## 2. Voice register

The narrator voice is **declared in the synopsis** and locked through the script. Default registers:

| Register | When | Cadence |
|---|---|---|
| **Measured / grave** | True crime, history, mystery | Long sentences for atmosphere; short for shock |
| **Warm / contemplative** | Biography, slice-of-life, memoir | Steady; confiding; uses "you" sparingly |
| **Wry / dry** | Comedy with stakes, irony-driven | Understated; rhythm-driven |
| **Urgent / clipped** | Thriller, action | Short sentences; verb-forward; minimal qualifiers |

Whichever register: NO breaks in voice mid-script. The supplement may pin a specific register (e.g., "country-Methodist plain", "Victorian-era omniscient").

## 3. Sentence rhythm

- **Atmospheric beats**: long, periodic sentences (15–30 words). Carry imagery.
- **Shock beats**: short, declarative (5–10 words). Land hits.
- **Transitions**: medium (10–15 words). Move the eye.
- Aim for **mixed rhythm** within each paragraph. Pure-long = reader drift. Pure-short = staccato exhaustion.

## 4. Direct audience address

- **Sparing**: 1–2 uses across the entire script. NOT every paragraph.
- Phrases: "dear listener", "let me tell you what really happened", "you may already know that…"
- **Genre fits**: history / mystery / true-crime use direct address well; sci-fi / fantasy / business often work better with strict third-person.
- Direct address belongs in the cold open OR the final outro — rarely mid-act (breaks immersion).

## 5. Dialogue (when present)

- **Minimal direct dialogue** in voice-over scripts. Most "what people said" goes through narrator paraphrase.
- Direct quotes used for **anchor lines** — refrains, signature phrases, courtroom moments.
- **Trout-style voicelessness** (using a real example): if a character is voiceless on the historical record, preserve that — the absence becomes a dramatic instrument.
- Every direct quote needs a clear context anchor (who, when, where).

## 6. Period / setting accuracy

- **Period vocabulary**: use the approved list from `_meta_supplement.md` § "Vocabulary".
- **Anachronism check**: no "okay", "detective" (modern police sense), modern brand names, modern technology unless the period supports it.
- **Idiom carefully**: "kin", "holler", "bombazine" for 19th-century rural; "mill", "ledger", "frock coat" for industrial; etc. Pull from supplement.
- Common modern slips to avoid: "guys" (audience address), "literally" (overused), "girlfriend/boyfriend" pre-1900, modern political terms.

## 7. Emphasis / italics (for SSML conversion)

- `*word*` marks moderate emphasis (TTS prosody)
- `*Sentence with emphasis.*` marks a strong emphasis beat (verdict, reveal)
- `*Title of work*` for newspapers, books, songs (italic title style)
- Use sparingly — too much italic = visual noise.

## 8. Chapter boundaries (synopsis → script)

- Chapter boundaries from the synopsis are **strict**. Do NOT merge or split chapters in W3.
- Within a chapter, sentence/paragraph structure is the writer's call.
- Compressed chapters (synopsis hand-off may permit "9+10 → one beat") follow the synopsis's compression notes.

## 9. The hook (first 60 seconds)

The first chapter MUST do five things in its opening 60 seconds (~150 words):

1. **Time anchor** — date or period
2. **Place anchor** — geographic or institutional
3. **A single concrete image** that the audience cannot un-see
4. **A planted question** (often via a withheld detail — Chekhov's bomb)
5. **A signal that this is going to matter** — stakes promised, not yet delivered

Avoid:
- Telling the audience what they're about to hear ("Today we'll tell you the story of…")
- Generic context ("In a small town…", "Once upon a time…")
- Pre-spoiling the twist

## 10. The closing (final 30 seconds)

The script's final 30 seconds:

1. **Lands the thematic image** (often a callback to ch.1)
2. **Refuses to over-explain** — leaves something for the audience
3. **(Optional) CTA** — one line, restrained ("if you'd like more…", "see you next time")
4. **Closes on a low** — held quiet, not another peak

The closing is the SECOND most-important moment in the script (after ch.16 reveal).

## 11. Review targets (W3)

- **Self-review** + **external-review subagent** per round
- Target average score: **9.5 / 10**
- Hard cap: 5 rounds
- Score dimensions are listed in `narrative_techniques.md` § Review

## 12. The supplement contract

The per-episode `_meta_supplement.md` (authored by W1-5 from the user's reference scripts + W1 research) layers on top of this universal guide. When the supplement specifies a more specific rule (e.g. "use ‘harken' instead of ‘listen'" or "avoid the cold-open weather imagery"), the supplement wins.

The W3 writer reads BOTH this file AND the supplement. Conflicts: supplement > universal. Document any conflicts in the W3 hand-off note.
