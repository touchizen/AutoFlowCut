# Translation review — bespoke/ko/

## Per-file findings

### synopsis_guidelines.md
- Stale English: 0 in body prose. Acceptable English remnants: `_meta_supplement.md`, `suspense_techniques.md`, code-fence terms `Low / Medium-low / Medium / Medium-high / High / Maximum` (line 46), `(earliest-certainty lock)` parenthetical anchor (line 31), `"dear listener"` example phrase (line 83), `(Wave)` paren-anchor (line 41). All acceptable per criteria 1.
- Structure parity: PASS — 9 headers (matches en=9), 4 tables with matching columns, 0 code blocks (matches en=0).
- Numbering: PASS — sections 1–8 preserved exactly; deliverable list 1–11 preserved.
- Vocabulary issues:
  - "보편" used (3×) for "Universal" — diverges from preflight/narrative/suspense which use "범용".
  - "미끼" + "디코이" mixed: synopsis uses "미끼" (3×) while preflight uses "디코이" (line 52). Same English `decoy` term.
  - "브레이드 POV" (line 82) — synopsis-only; narrative_techniques uses "교차 POV" (lines 80, 89). Same English `braided`.
  - Section title "오스실레이팅 긴장도 곡선" (line 35) — leaves "oscillating" as transliteration; preflight uses "곡선이 진동함" / suspense uses Korean equivalents. Acceptable but inconsistent register.
- Code block integrity: PASS (no code blocks).
- Cross-refs: PASS — `suspense_techniques.md` filename preserved at line 98.
- Tone: PASS — neutral 합니다체 + 다 형 mixed at appropriate places. No yadam-specific 수면동화 markers. Universal-genre safe.
- Length: en=117, ko=117, ratio=100% (PASS).

### preflight.md
- Stale English: 0 in body prose. Acceptable: `SKILL.md`, `_meta_supplement.md`, `synopsis_guidelines.md`, `05_preflight.md` filename refs; `setup`/`payoff` (lines 43, 45) used as technical terms; `IN`/`OUT` (line 59) inline tokens; full English code-block on lines 73–82 (Output format spec — must remain English by design as it shows the literal output format).
- Structure parity: PASS — 12 headers (matches en=12), 1 code block (matches en=1, fence `markdown` preserved), section A–G + Section 0 all present.
- Numbering: PASS — items 1–18 preserved verbatim; E1–E5 preserved verbatim.
- Vocabulary issues:
  - "범용" (5×) — diverges from synopsis/screenplay's "보편".
  - "디코이 프레임" (line 52) — diverges from synopsis's "미끼 프레임".
  - Item 12 (line 49) translates `braided` as "교차" — diverges from synopsis's "브레이드".
  - "긴장감 곡선" (line 35) vs synopsis's "긴장도 곡선" — minor 감/도 inconsistency.
  - "ch.15", "ch.16" preserved as English-form anchors throughout — fine, matches en/.
  - `setup` and `payoff` left untranslated in items 9 & 11 — synopsis_guidelines uses "심기" / "회수" for the same concepts. Mild inconsistency but tolerable as item 9 is a technical-term-as-label.
- Code block integrity: PASS — code-fence content (lines 73–82) byte-equivalent to en/ except line 79's "(전체 18개 항목)" comment translated from "(all 18 items)". Allowed per criterion 6.
- Cross-refs: PASS — `synopsis_guidelines.md` (line 29), `_meta_supplement.md` references preserved.
- Tone: PASS — formal 합니다체 throughout. Universal-genre neutral.
- Length: en=94, ko=94, ratio=100% (PASS).

### screenplay_guidelines.md
- Stale English: 0 stale in prose. Acceptable: bracketed bilingual examples on lines 21–24 (register names), 38, 80–81, 90 (English original + Korean gloss); `INT./EXT.`, `FADE IN`, `(beat)` are slugline tokens (line 9); `*emphasis*` / `*word*` / `*Sentence with emphasis.*` / `*Title of work*` are markdown-syntax examples (lines 11, 58–60); `country-Methodist plain`, `Victorian-era omniscient`, `'listen'`/`'harken'` are quoted exemplars (lines 26, 104); `kin`, `holler`, `bombazine`, `mill`, `ledger`, `frock coat`, `okay`, `detective`, `guys`, `literally`, `girlfriend/boyfriend` (lines 53–54) are vocabulary anchor tokens — must remain English; `04_synopsis.md`, `narrative_techniques.md`, `suspense_techniques.md`, `_meta_supplement.md` filenames preserved.
- Structure parity: PASS — 13 headers (matches en=13), 1 register table (4 cols) preserved.
- Numbering: PASS — sections 1–12 preserved exactly.
- Vocabulary issues:
  - File title is "시나리오 가이드라인" (line 1) — and section 1 says "시나리오가 아닌 유튜브 보이스오버 카피". Internal contradiction: title labels itself "시나리오" but content disclaims "시나리오". The en/ original handles this better ("Screenplay Guidelines … YouTube voice-over copy, NOT screenplay"). Korean reads slightly self-contradictory; "스크립트 가이드라인" or "각본 가이드라인" would be cleaner. NOT a blocker.
  - "스크립트" (used 12×) and "시나리오" (used 13×) used somewhat interchangeably. Same source word `script` / `screenplay`.
  - "보이스" used for `voice` (15× combined with 보이스오버, 보이스 레지스터). OK.
  - "보편" (3×) — matches synopsis but diverges from preflight/narrative/suspense.
  - "청자" (audience/listener, 9×) — only file using "청자"; narrative uses "관객", suspense uses "시청자". Three different terms across the 5 files for the same `audience`/`listener` concept.
  - "아우트로" (line 40) for `outro` — synopsis uses "아웃트로" (line 29). Spelling inconsistency.
- Code block integrity: PASS (no code blocks).
- Cross-refs: PASS — all four `.md` filenames preserved.
- Tone: PASS — formal 합니다체. Universal-genre neutral; no 수면동화 / yadam markers.
- Length: en=106, ko=106, ratio=100% (PASS).

### narrative_techniques.md
- Stale English: 0 stale in prose. Acceptable: `screenplay_guidelines.md`, `suspense_techniques.md`, `_meta_supplement.md` filename refs; English example sentences in italics at lines 27, 28, 74 ("It was no dream") preserved as bilingual exemplars per criterion 1; `*Only known case in which testimony from ghost helped convict a murderer.*` (line 127) preserved verbatim from en/ (a real US-60 marker quote — must stay English).
- Structure parity: PASS — 15 headers (matches en=15), tables in §10 preserved.
- Numbering: PASS — sections 1–11 preserved; E0–E3, C1–C10 labels preserved verbatim.
- Vocabulary issues:
  - "범용" (2×) at lines 1, 181 — matches preflight/suspense, diverges from synopsis/screenplay's "보편".
  - "교차 POV" (lines 80, 89) — matches preflight, diverges from synopsis's "브레이드".
  - "관객" (15×) — only file using "관객" exclusively. Suspense uses "시청자", screenplay uses "청자", synopsis uses "시청자". Inconsistent across files for `audience`.
  - "몸을 앞으로 기울인다" (line 61) is correct (en says "lean forward").
  - "떡밥" used consistently for `seed`/`foreshadowing` (5×) — matches synopsis. Good.
  - "보완 자료" (lines 163, 174, 181) for `supplement` — preflight uses "supplement" / "보완 supplement" / "보완(supplement)"; screenplay uses "보완 문서". Three different renderings for the same concept across files.
  - "크래프트" (5×) for `craft` — left as transliteration. OK but could be "장인성" or "기법" for full Korean register.
- Code block integrity: PASS (no code blocks).
- Cross-refs: PASS.
- Tone: PASS — predominantly 다 form (declarative neutral). Mismatches with synopsis/preflight/screenplay (합니다체) but matches suspense_techniques. Two distinct tones across the 5 files: declarative (narrative + suspense) vs polite formal (synopsis + preflight + screenplay). Both are universal-safe; not yadam-specific. Reader will perceive a register shift between files but each file is internally consistent.
- Length: en=181, ko=181, ratio=100% (PASS).

### suspense_techniques.md
- Stale English: 0 stale in prose. Acceptable: `_meta_supplement.md`; bilingual quote-pairs at lines 27, 28, 29, 59, 131 (English original + Korean gloss) — proper bilingual exemplar pattern; `(Curiosity)`, `(Expectation)`, `(Held quiet)`, `(held-quiet)`, `Sherlock Holmes silver-blaze` (line 123), `June 22 trial` (line 85) — technical/cultural anchors per criterion 1.
- Structure parity: PASS — 12 headers (matches en=12), 4 tables preserved with matching columns.
- Numbering: PASS — sections 1–11 preserved.
- Vocabulary issues:
  - "범용" (3×) — matches preflight/narrative, diverges from synopsis/screenplay.
  - "시청자" (17×) — matches synopsis (5×), diverges from narrative's "관객" and screenplay's "청자".
  - "씨앗" (lines 70, 73, 105) for `seed` — diverges from synopsis/narrative/preflight's "떡밥". This is the SAME concept (`seed` in en/ = `foreshadowing seed`). Suspense file uniquely picks "씨앗" while the rest use "떡밥". **This is the single most important vocabulary inconsistency.**
  - "정적 (Held quiet)" (lines 147, 151, 157) — translates `held quiet` as "정적". Acceptable, with English in parens.
  - "후더닛" (line 46) for `whodunit` — transliteration. OK.
  - "아이러니" / "이중 엔진" / "거짓 해결" — clean translations.
- Code block integrity: PASS (no code blocks).
- Cross-refs: PASS — `_meta_supplement.md` preserved.
- Tone: PASS — 다 form declarative; matches narrative_techniques. Universal-genre safe.
- Length: en=159, ko=159, ratio=100% (PASS).

---

## Cross-file vocabulary consistency

| English term | synopsis | preflight | screenplay | narrative | suspense | Consistent? |
|---|---|---|---|---|---|---|
| engagement | 몰입도 | 몰입도 | 몰입(1×, breaks immersion) | 몰입도 | 몰입도 | YES (the screenplay 1× is a different sense) |
| curiosity | (n/a) | 궁금증 | (n/a) | 궁금증 | 궁금증 | YES |
| expectation | (n/a) | 기대감 | (n/a) | 기대감 | 기대감 | YES |
| foreshadowing / seed | 떡밥 | 떡밥 | (n/a) | 떡밥 | 씨앗 | **NO — suspense uses 씨앗** |
| hook | 훅 | 훅 | 훅 | 훅 (E0–E3 implicit) | (implicit) | YES |
| act | 막 | 막 | 막 | 막 | 막 | YES |
| chapter | 챕터 | 챕터 | 챕터 | 챕터 | 챕터 | YES |
| synopsis | 시놉시스 | 시놉시스 | 시놉시스 | 시놉시스 | 시놉시스 | YES |
| preflight | (n/a) | 프리플라이트 | (n/a) | (n/a) | (n/a) | YES |
| drop-off zone | (n/a) | (n/a) | (n/a) | 이탈 구간 | (n/a) | YES (single-file term) |
| universal | 보편 | 범용 | 보편 | 범용 | 범용 | **NO — split 2/3** |
| audience / listener | 시청자, 독자 | 시청자 | 청자 | 관객 | 시청자 | **NO — 4 different terms** |
| decoy | 미끼 | 디코이 | (n/a) | (n/a) | (n/a) | **NO — synopsis vs preflight clash** |
| braided (POV) | 브레이드 | 교차 | (n/a) | 교차 | (n/a) | **NO — synopsis is the outlier** |
| supplement | supplement / 보완 supplement | supplement / 보완(supplement) | 보완 문서 | 보완 자료 | 보완 (계약) / 보완 문서 | **NO — 4 renderings** |
| outro | 아웃트로 | (n/a) | 아우트로 | (n/a) | (n/a) | NO — spelling differs |
| script | 대본 / 스크립트 | 대본 | 스크립트 / 시나리오 | 대본 | 대본 / 참고 대본 | mixed |
| craft | (n/a) | (n/a) | (n/a) | 크래프트 | (n/a) | YES (single-file term) |

Six concrete vocabulary inconsistencies across files (universal, audience, decoy, braided, supplement, foreshadowing-seed). The `seed → 씨앗 vs 떡밥` issue and `audience → 4 different terms` are the two most material to reader experience.

## Verdict per file

| File | Pass / Revise / Block | Top fix needed |
|---|---|---|
| synopsis_guidelines.md | REVISE | Decide synopsis's "미끼/브레이드" vs the other files' "디코이/교차" — pick ONE per concept and align. |
| preflight.md | REVISE | Align "범용" vs synopsis's "보편"; align "디코이" vs synopsis's "미끼". |
| screenplay_guidelines.md | REVISE | "시나리오" vs "스크립트" used interchangeably; pick one. Title "시나리오 가이드라인" mildly contradicts §1's disclaimer that it's NOT a 시나리오. Consider "각본 가이드라인" or "스크립트 가이드라인". Also "아우트로" → "아웃트로" to match synopsis. |
| narrative_techniques.md | REVISE | Align "관객" → "시청자" (matches synopsis + suspense + preflight); align "보완 자료" → unified "supplement" rendering. |
| suspense_techniques.md | REVISE | "씨앗" → "떡밥" (3 occurrences, lines 70, 73, 105) to match synopsis/narrative/preflight. **This is the highest-priority single fix in the whole bundle** because `seed/foreshadowing` is a load-bearing concept in the engagement framework. |

## Overall

**REVISE** — all 5 files are structurally sound (100% line parity, header parity, code-block parity, no stale English in prose), but cross-file vocabulary drift is significant enough to confuse a writer reading them as a coherent toolkit. The 5 subagents each translated their file in isolation without a shared glossary, so 6 distinct vocabulary collisions emerged.

**No file is BLOCK-level.** Every file is internally consistent and readable on its own. The fixes are mechanical: pick one term per concept and propagate. Estimated effort: ~10–15 small edits across the 5 files.

**Recommended fix order (highest leverage first):**
1. `seed`: unify on "떡밥" (currently `씨앗` in suspense_techniques only — 3 edits).
2. `audience`: unify on "시청자" (narrative's "관객" → "시청자", screenplay's "청자" → "시청자" — ~25 edits but mechanical replace-all).
3. `universal`: unify on "범용" (3 of 5 already use it; synopsis + screenplay flip "보편" → "범용" — ~6 edits).
4. `decoy`: unify on "디코이" or "미끼" (~4 edits).
5. `braided POV`: unify on "교차 POV" (synopsis flip "브레이드" → "교차" — 1 edit).
6. `supplement`: unify on a single rendering, e.g., "보완 문서" (~8 edits).
7. `outro`: unify spelling — "아웃트로" or "아우트로" (1 edit).

After these fixes: PASS-ready. The Korean is otherwise high-quality, faithful to the en/ original, structurally exact, and tone-neutral (no yadam contamination, no 수면동화 종결어미 patterns).

## Audit obligations

```json
{
  "disk_changes": {
    "created": ["skills/story-engine/meta-prompts/bespoke/_translation_review.md"],
    "modified": [],
    "deleted": []
  },
  "bash_commands": [
    "wc -l (line count of all 10 files)",
    "grep -c (counts of 보편/범용 across ko files)",
    "grep -c (counts of audience-term variants across ko files)"
  ],
  "external_api_calls": [],
  "verdict": "REVISE",
  "issues_count": 6
}
```
