# References CSV Schema

File that defines prompts for generating reference images of characters, scenes, and styles.
Used in Flow2CapCut for generating reference images, and matches against the `scene_tag` and `characters` fields in the scenes CSV.

## Column Definitions

| Column | Required | Type | Description |
|--------|----------|------|-------------|
| `name` | ✅ | string | Reference name (character name, location name, or style name) |
| `type` | ✅ | string | `character` / `scene` / `style` |
| `prompt` | ✅ | string | English image generation prompt |

## Auto-Detection Conditions

`name` + `type` columns are required. The `subtitle`, `characters`, and `duration` columns must not be present.

## Writing Rules by Type

### character

- **Must start with `solo, single person`** (single-person reference)
- Include: age, gender, appearance, hairstyle, clothing, expression, pose
- Use Joseon-era terminology in parallel: `topknot (상투)`, `jeogori top and chima skirt (저고리+치마)`
- Append `historical Korean costume, no modern clothing` at the end

### scene (location/background)

- Include era, architectural style, lighting, and atmosphere
- Append `no modern elements` at the end
- Time-of-day variations for the same location: `courtyard`, `courtyard_rain`, `courtyard_night`

### style

- Define art style, color palette, line style, etc.
- A style preset applied commonly to all scenes

## Sample

```csv
name,type,prompt
소은,character,"solo, single person, a beautiful 14-year-old Korean Joseon dynasty girl with bright gentle eyes, soft kind smile, long braided hair with daenggi ribbon (댕기머리), wearing a clean neat jeogori top and chima skirt (저고리+치마), historical Korean costume, no modern clothing"
courtyard,scene,"A traditional Korean Joseon dynasty (조선시대) courtyard (마당) with stone-paved ground, wooden pillars, giwa tiled roofing (기와지붕), open sky above, warm natural daylight, no modern elements"
joseon_drama,style,"Korean manhwa webtoon illustration style, clean line art, soft cel shading"
```
