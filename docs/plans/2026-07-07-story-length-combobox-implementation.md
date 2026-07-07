# Story Length Combobox Implementation Plan

**Goal:** Make Story setup's script length control an editable value combobox plus a language-aware unit selector.

**Architecture:** Keep length logic local to `StoryView.jsx` with pure helpers for unit lists, normalization, conversion, suggestion generation, and legacy hydration. Preserve selected units in Story payloads. Keep prompt formatting in `electron/api/llm/prompts.js`.

## Spec

Implement:

`docs/plans/2026-07-07-story-length-combobox-spec.md`

## Task 1: UI Tests

Files:

- `tests/components/story/StoryView.setup.test.jsx`
- `tests/components/story/StoryView.phase.test.jsx`
- `tests/components/story/StoryView.test.jsx`
- `tests/components/story/StoryView.form.test.jsx`

Steps:

1. Assert the setup UI renders `대본 분량 값` input and `대본 분량 단위` select.
2. Assert Korean unit options are `분` and `자수`.
3. Assert English unit options are `min`, `words`, and `chars`.
4. Assert `min` suggestions cover `1..60`.
5. Assert `chars` suggestions cover `330..19800`.
6. Assert `words` suggestions cover `150..9000`.
7. Assert unit changes convert values while preserving duration.
8. Assert payloads preserve selected `lengthUnit`.
9. Assert language changes keep allowed units and convert disallowed `words` to `chars`.
10. Assert legacy minute-shaped `chars`/`words` values hydrate as duration, then display as the selected unit.

## Task 2: Prompt Tests

File:

- `tests/electron/api/llm/prompts.test.js`

Steps:

1. Keep Korean `min` prompt estimate tests.
2. Keep English `min` prompt estimate tests.
3. Keep Korean `chars` direct-unit test.
4. Add English `chars` direct-unit test for `about N characters`.
5. Keep English `words` direct-unit test.

## Task 3: StoryView Implementation

Files:

- `src/components/story/StoryView.jsx`
- `src/components/story/StoryView.css`

Steps:

1. Add constants for defaults, max minutes, `330` chars/min, and `150` words/min.
2. Add language unit option helpers:
   - Korean: `min`, `chars`
   - English: `min`, `words`, `chars`
3. Add selected-unit normalization:
   - invalid/empty/`<=0` -> selected unit's 10-minute equivalent
   - round positive numbers
   - clamp to selected unit's 60-minute equivalent
4. Add conversion helpers that preserve duration across units.
5. Add conversion helpers that preserve sub-minute positive values, including decimal `min` results.
6. Add `lengthMode: "unit"` for new non-`min` payloads.
7. Add legacy hydration that treats unmarked `chars`/`words` values `1..60` as old minute-shaped values.
8. Restore `lengthUnit` state.
9. Render value input plus unit select.
10. Generate datalist values based on the active unit.
11. On unit change, convert the value.
12. On language change, keep the unit if allowed; otherwise convert to the fallback allowed unit.

## Task 4: Prompt Implementation

File:

- `electron/api/llm/prompts.js`

Steps:

1. Preserve min estimates:
   - Korean: `약 N분(대략 X자)`
   - English: `about N minutes (about Y words)`
2. Preserve Korean `chars`: `약 N자`.
3. Add English `chars`: `about N characters`.
4. Preserve English `words`: `about N words`.

## Task 5: Verification

Run:

```bash
npm test -- --run tests/components/story/StoryView.setup.test.jsx tests/components/story/StoryView.phase.test.jsx tests/components/story/StoryView.test.jsx tests/components/story/StoryView.form.test.jsx tests/electron/api/llm/prompts.test.js
npm test -- --run tests/components/story tests/electron/api/llm/prompts.test.js
git diff --check
npm run build
```
