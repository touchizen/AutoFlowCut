# W4: Production Extraction + Review

This document is the W4 (production extraction + review) stage guide for the story-engine skill — dark-history genre.

**Reference scripts** (`~/workspace/AutoFlowCut/scripts/`):

| Script | Purpose |
|--------|---------|
| `generate_tts_elevenlabs.py` | ElevenLabs TTS (narration + dialogue, with-timestamps → mp3 + SRT) |
| `generate_tts_typecast.py` | Typecast TTS (per-character dialogue, auto-timecoded filenames) |
| `generate_sfx.py` | ElevenLabs Sound Generation (SFX) |

---

## Production extraction + review

**Run only after the script has been confirmed through W3 review.** Extracting before the script is locked causes rework on every revision.

1. **Narration extraction** → `narration_{part}.txt` — pure narration text (dialogue and stage directions removed)
2. **Per-character dialogue extraction** → `dialogs_{part}.json` — character name, line, emotion, order
3. **SFX extraction** → `08_sfx_list.md` — list of sound-effect beats (with English prompts)

### Extraction review (subagent, max 5 rounds)

- The subagent **reads the script files and extraction files directly with the Read tool** and cross-checks
- **No program / code cross-check**: must use the Read tool and visual inspection
- Repeat until no revisions are needed (max 5)

### SFX categories

| Category | Examples |
|----------|----------|
| Props | counting beads, turning ledger pages, quill scratching, lock turning, snuff candle |
| Ambient | wind through bare trees, rain on rooftops, crow calls, crowded market, crickets, church bells |
| Human | breath, sigh, footsteps on gravel / flagstones / wood, robes rustling |
| Metal / doors | heavy wooden door creaking, iron latch, padlock clicking, chain dragging |
| Writing | quill scratching parchment, wax seal pressed |
| Crowd | muttering, gasps, whispered prayer, distant laughter |
| Supernatural / atmosphere (dark-history-specific) | distant thunder, wolves howling, wind through ruins, unexplained knock, chanting in Latin |

---

## Review loop
Up to 5 rounds. If 0 issues, proceed immediately to the next Wave. If 5 rounds are exceeded, escalate to the user.
