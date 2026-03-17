# Image Prompt Writing Guide

Rules for writing English prompts used in **image mode** for the `prompt` field in scene CSVs and reference CSVs.

## Basic Rules

- Write in **English** (for AI image generation tool compatibility)
- Describe the scene in a single sentence (based on a still frame)
- Append era/style tags at the end
- Exclude modern elements
- Focus on **composition, expressions, and atmosphere** rather than actions

## Prompt Structure

```
[Character description] + [Pose/Expression] + [Location/Background] + [Era/Style tags]
```

### Examples

```
A wealthy elderly nobleman with a topknot bowing deeply in regret
before a thin 14-year-old girl holding two ledger books
in a grand traditional courtyard,
Joseon dynasty, cinematic
```

```
Close-up of a 14-year-old girl's hands clutching old ledgers,
a glimpse of a worn wooden abacus tucked into her traditional vest,
Joseon dynasty, illustrated Korean webtoon style
```

## Required Elements

| Element | Description | Example |
|---------|-------------|---------|
| Character | Age, appearance, clothing | "a thin 14-year-old girl" |
| Pose/Expression | Static state description | "bowing deeply in regret" |
| Location | Background/space | "in a grand traditional courtyard" |
| Era tag | Period setting | "Joseon dynasty" |
| Style tag | Art style/mood | "cinematic", "illustrated Korean webtoon style" |

## Character Description Keywords

| 한글 | English |
|------|---------|
| 상투 | topknot |
| 댕기머리 | braided hair with daenggi ribbon |
| 갓 | gat hat (갓) |
| 저고리+치마 | jeogori top and chima skirt |
| 도포 | dopo scholar's outer robe |
| 두루마기 | durumagi overcoat |
| 바지저고리 | baji jeogori |
| 비녀 | binyeo hairpin |
| 쪽진머리 | jjok bun |

## Location/Architecture Keywords

| 한글 | English |
|------|---------|
| 기와지붕 | giwa tiled roofing |
| 초가지붕 | choga thatched roof |
| 한지 문 | hanji paper doors |
| 온돌 | ondol heated floor |
| 마당 | courtyard |
| 안채 | inner quarters |
| 사랑채 | men's quarters |
| 행랑채 | servants' quarters |
| 대문 | main gate |
| 아궁이 | clay stove |
| 가마솥 | iron pot |

## Prompt Characteristics by shot_type

| shot_type | Composition | Prompt Characteristics |
|-----------|-------------|----------------------|
| `scene` | Wide to medium | Describe background and characters together, convey overall spatial sense |
| `reaction` | Close-up | Focus on facial expressions/physical reactions, emphasize detail |
| `narration` | Wide/atmospheric | Environment-focused, characters shown only as silhouettes or partial views |
| `dialogue` | Medium to close-up | Conversational composition, two or more people or the speaking character |

## style_tag

Specify the mood in the scene CSV's `style_tag` field. Separate with commas.

### Commonly Used style_tags

```
Korean historical drama, Joseon dynasty, cinematic, dramatic, tense
Korean historical drama, Joseon dynasty, cinematic, warm, bittersweet
Korean historical drama, Joseon dynasty, cinematic, dark, ominous
Korean historical drama, Joseon dynasty, cinematic, emotional, sorrowful
Korean historical drama, Joseon dynasty, cinematic, heartbreaking, silent
illustrated Korean webtoon style  ← Use for close-up/emotional scenes
```

## Reference Prompt vs Scene Prompt

| | Reference | Scene |
|--|-----------|-------|
| Purpose | Maintain character/location consistency | Generate individual scenes |
| Number of characters | Must be single person (`solo, single person`) | Multiple allowed |
| Pose | Default posture/expression (neutral) | Pose matching the specific situation |
| Location | Basic environment setup | Variations in time of day/weather/mood |
| Composition | Front to three-quarter view, full body or upper body | Varies by shot_type |

## Things to Avoid in Image Prompts

- Do not use action verbs (running, walking, etc.) — replace with static descriptions
- Do not use expressions that imply passage of time — capture a single moment
- Do not request text/letter insertion — use `no text, no letters, no writing`
- Do not include modern objects — replace with period-appropriate props
