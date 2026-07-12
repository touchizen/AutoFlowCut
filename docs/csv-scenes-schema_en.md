# Scenes CSV Schema

Data file used by AutoFlowCut at the scene level.
Each row represents one scene and is used for image/video generation and subtitle display.

## Column Definitions

| Column | Required | Type | Description |
|--------|----------|------|-------------|
| `scene` | | integer | Ordinal used to group rows with the same number into one slot. Without this column, each row is a separate slot |
| `prompt` | | string | English image/video generation prompt. Required for visual-only slots |
| `prompt_ko` | | string | Korean prompt summary (for review) |
| `subtitle` | | string | Narration/dialogue subtitle text |
| `speaker` | ✅ when subtitle exists | string | Explicit subtitle speaker. Narration must use `narrator`; it is never inferred |
| `characters` | | string | Characters appearing on screen (comma-separated). Not used to infer the speaker |
| `scene_tag` | | string | Location/background tag (matches scene name in references.csv) |
| `style_tag` | | string | Per-scene style or mood directive |
| `shot_type` | | string | Scene type: `scene`, `reaction`, `narration`, `dialogue` |
| `duration` | | number | Scene length (in seconds, 3 decimal places) |
| `start_time` | | number | Start time (seconds) |
| `end_time` | | number | End time (seconds) |
| `parent_scene` | | string | Scene group ID (e.g., S001, S002) |

## Auto-Detection Conditions

Each kept row must carry slot content or timing. Subtitle rows require `subtitle`+`speaker`; visual-only slots require an English `prompt`+timing.

## Accepted Headers and Aliases

The only canonical headers are `scene`, `prompt`, `prompt_ko`, `subtitle`, `speaker`, `characters`, `scene_tag`, `style_tag`, `shot_type`, `duration`, `start_time`, `end_time`, and `parent_scene`. The four aliases are `prompt_en` → `prompt`, `subtitle_ko` → `subtitle`, `character` → `characters`, and `background` → `scene_tag`.

Headers bind by exact lookup in the ASCII-keyed allowlist after surrounding-whitespace trimming and lowercasing. Headers containing full-width, zero-width, homoglyph, internal TAB, or SHY characters, and names outside the list, are rejected as `storyboard-header-unknown`. Remove private notes columns from the CSV; there is no declared-extra-column syntax.

## Rules

- Each scene must be **15 seconds or less**
- A 20-minute video typically has about **120–350 scenes**
- `prompt` must be written in English (for AI image generation tool compatibility)
- Two headers that bind the same field are rejected before data interpretation as `storyboard-header-duplicate`. This includes case/surrounding-whitespace variants of one name and canonical/alias pairs such as `prompt`+`prompt_en`
- An empty header cell is not an identity. It is ignored as an Excel/Sheets trailing artifact only when every data cell in that column is also empty; otherwise it is rejected as `storyboard-header-unknown`
- A non-empty cell beyond the header width in any data row is a missing header and is rejected as `storyboard-header-unknown`. A row whose declared cells are all blank is not exempt
- If any value exists in the `scene` column, the first kept board row must contain a JavaScript safe integer. Later blank cells carry the previous ordinal forward; non-integers and values outside the safe-integer range are rejected. An entirely blank column is treated as absent
- `scene` ordinals cannot decrease in row order. Sequential `1, 2, 3, ...` ordinals are generated for kept board rows when the column is absent or entirely blank
- Physical blank lines and rows containing only a blank or valid integer `scene` are removed before import. A scene-only row updates carry-forward state before removal; a non-integer scene-only row is preserved and rejected as an error
- Consecutive scene-only rows or a scene-only row at EOF do not create declared scenes without board content. A contentless intermediate ordinal can therefore disappear from the resulting slots, and the adapter rejects the import if the distinct slot count no longer matches the image count
- `sourceRowId` is the parsed board-row position after removal, not a raw file line number: `storyboard-row-1`, `storyboard-row-2`, ...
- Every non-empty `subtitle` must have an explicit `speaker`. Narration accepts only the literal `narrator`; aliases such as `narration`, `해설`, and `화자`, and blank values are rejected
- A slot may contain at most one distinct non-empty `prompt` value. Repeats collapse only when they are byte-identical, including surrounding whitespace; for example, `p1` and ` p1 ` are distinct and produce `storyboard-prompt-ambiguous`
- The other slot-collapsed fields—`prompt_ko`, `characters`, `scene_tag`, `style_tag`, `shot_type`, and `parent_scene`—also reject distinct non-empty values within one slot as `storyboard-field-ambiguous`. Row-level `subtitle`, `speaker`, and timing fields are not part of this rule
- A visual-only slot requires both a non-empty English `prompt` and valid timing. A missing prompt produces `storyboard-prompt-missing`; missing timing produces `storyboard-duration-missing`
- `duration` accepts only positive plain decimals. `start_time`/`end_time` accept plain decimals or `HH:MM:SS(.mmm)` (no hex, exponent, binary, or octal notation). Start must be non-negative and less than end
- Empty and header-only CSV files are not valid storyboards
- `characters` are comma-separated (e.g., "소은,아버지,곽주사")
- `scene_tag` must match the scene type name in references.csv
- CSV encoding: UTF-8 (BOM allowed)
- Fields containing quotes must be wrapped with `"`, and internal quotes escaped with `""`

## Sample

```csv
scene,prompt,prompt_ko,subtitle,speaker,characters,scene_tag,style_tag,shot_type,duration,start_time,end_time,parent_scene
1,"A wealthy elderly nobleman bowing before a young girl in a courtyard, Joseon dynasty, cinematic",장부 든 소녀 앞에 고개 숙인 양반,"문중 어른들 앞에서, 거상이 고개를 숙였습니다",narrator,"장대인,소은,곽주사",courtyard,"Korean historical drama, cinematic, tense",scene,11.830,0.000,11.830,S001
```
