# Scenes CSV Schema

Data file used by Flow2CapCut at the scene level.
Each row represents one scene and is used for image/video generation and subtitle display.

## Column Definitions

| Column | Required | Type | Description |
|--------|----------|------|-------------|
| `prompt` | ✅ | string | English image/video generation prompt |
| `prompt_ko` | | string | Korean prompt summary (for review) |
| `subtitle` | | string | Narration/dialogue subtitle text |
| `characters` | | string | Characters appearing (comma-separated) |
| `scene_tag` | | string | Location/background tag (matches scene name in references.csv) |
| `style_tag` | | string | Style directive (e.g., "Korean historical drama, cinematic, tense") |
| `shot_type` | | string | Scene type: `scene`, `reaction`, `narration`, `dialogue` |
| `duration` | | number | Scene length (in seconds, 3 decimal places) |
| `start_time` | | number | Start time (seconds) |
| `end_time` | | number | End time (seconds) |
| `parent_scene` | | string | Scene group ID (e.g., S001, S002) |

## Auto-Detection Conditions

`prompt` column is required + at least one of the following must exist: `subtitle`, `characters`, `scene_tag`, `style_tag`, `duration`

## Rules

- Each scene must be **15 seconds or less**
- A 20-minute video typically has about **120–350 scenes**
- `prompt` must be written in English (for AI image generation tool compatibility)
- `characters` are comma-separated (e.g., "소은,아버지,곽주사")
- `scene_tag` must match the scene type name in references.csv
- CSV encoding: UTF-8 (BOM allowed)
- Fields containing quotes must be wrapped with `"`, and internal quotes escaped with `""`

## Sample

```csv
prompt,prompt_ko,subtitle,characters,scene_tag,style_tag,shot_type,duration,start_time,end_time,parent_scene
"A wealthy elderly nobleman bowing before a young girl in a courtyard, Joseon dynasty, cinematic",장부 든 소녀 앞에 고개 숙인 양반,"문중 어른들 앞에서, 거상이 고개를 숙였습니다","장대인,소은,곽주사",courtyard,"Korean historical drama, Joseon dynasty, cinematic, tense",scene,11.830,0.000,11.830,S001
```
