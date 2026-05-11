# Hook Principles (genre-agnostic)

This file is loaded for every genre (yadam, dark-history, bespoke). It
codifies the universal rules for the cold-open Hook. Genre-specific
screenplay guides may extend these rules (e.g., yadam's "~지요" 어투,
dark-history's gothic atmosphere) but MUST NOT contradict them.

---

## 1. Hook is written LAST

**Writing order**: Setup / Rising / Crisis / Resolution → **Hook** → Review.

The Hook's only job is to ignite curiosity or anticipation in the first
20–30 seconds. Picking the strongest lever requires seeing the entire
arc first. Drafting Hook before the four parts produces generic
"Long ago…" / "옛날 옛적에…" openings — see "Failing hooks" in the wave
docs.

The four valid hook types (pick exactly one per episode):
- **Flash-forward** — show a dramatic moment from Act III out of context
- **Mystery opening** — present the aftermath of the central event
- **Provocative statement** — narrator makes a bold/unsettling claim
- **Sensory immersion** — drop viewer into a vivid scene with strong sensory detail

Each type's mechanism is: "viewer asks a question they cannot answer
without watching to the end."

---

## 2. Hook lives in its own file

**Filename**: `{title}_hook.md` (universal — ASCII filename, all genres).

Hook content is NEVER duplicated inside `{title}_part1_setup.md` /
`{title}_기.md`. Part 1 (Setup / 기) begins with the POST-hook
narrative — viewer has just seen the hook and is now landing in the
story's world.

Reasons for separation (do not weaken):
- Writer can iterate the hook independently — A/B opening variants
  without rewriting part 1
- Reviewers focus on the single highest-leverage 30 seconds of the video
- Hook style (sensory / teaser) does not bleed into part 1's paced
  narrative style

---

## 3. Hook duration target

~20 seconds of narration:
- English: 50–80 words
- Korean: 80–130자

A hook ≥ 30s risks losing the viewer before the story begins. A hook
≤ 10s rarely lands strongly enough to plant the question.

---

## 4. Hook MUST do five things

Inside the 20-second window, the Hook must accomplish all five:

1. **Time anchor** — date, era, or "this happened ___ years ago"
2. **Place anchor** — geographic or institutional
3. **One concrete image** the audience cannot un-see
4. **A planted question** — a withheld detail (Chekhov's bomb pattern)
5. **Signal that this matters** — stakes promised, payoff withheld

Avoid:
- Telling the audience what they're about to hear ("Today we'll tell
  you the story of…" / "오늘은 ~의 이야기를 들려드리겠습니다")
- Generic context ("In a small town…" / "어느 작은 마을에…", "Once upon
  a time…" / "옛날 옛적에…")
- Pre-spoiling the twist

---

## 5. Pipeline contract for Hook

The Hook is pipeline-uniform with the four narrative parts:

- W4 extracts `narration_hook.txt`, `dialogs_hook.json` (typically `[]`
  — hook is usually narration-only)
- W5 TTS produces `segments_hook/`, `final_hook.mp3`,
  `timeline_hook.json` on the same contract as the four narrative parts
- W5-3 5-part merge order: `hook → <part1> → <part2> → <part3> → <part4>`,
  where the four narrative parts are the genre's canonical keys (yadam:
  `기 → 승 → 전 → 결`; dark-history & bespoke:
  `setup → rising → crisis → resolution`). Hook's full-timeline offset
  is `0`; subsequent parts shift by hook duration
- W6 scenes.csv: hook scenes appear FIRST, anchored at t=0..hook_duration
- W8 CapCut export: hook segment leads the final timeline

The Hook is the fifth `{part}` value — universally `hook` (ASCII,
all genres). The only special property is the merge order (it goes
first). For the full list of {part} keys per genre, see
`workflows/execute-pipeline.md` § Notation.
