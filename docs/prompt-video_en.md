# Video Prompt Writing Guide

Rules for writing English prompts used in **video mode** for the `prompt` field in scene CSVs.
Includes all rules from the image prompt guide, with the addition of **actions and camera movements**.

## Basic Rules

- Write in **English**
- **Describe actions specifically** (movement, not still frames)
- Camera movement directions are allowed
- Append era/style tags at the end
- Exclude modern elements

## Prompt Structure

```
[Character description] + [Action/Movement] + [Location/Background] + [Era/Style tags] + [Camera direction]
```

### Examples

```
A young girl slowly moving abacus beads while looking down with concentration,
her fingers gently flicking each bead one by one,
in a quiet courtyard under warm afternoon sunlight,
Joseon dynasty, cinematic, smooth camera
```

```
An elderly nobleman walking slowly across a moonlit courtyard,
his shadow stretching long behind him,
stopping to look up at the night sky with a heavy sigh,
Joseon dynasty, cinematic, slow tracking shot
```

```
Close-up of trembling hands unfolding a ledger book,
fingers tracing along columns of numbers,
pausing at a circled entry with widening eyes,
Joseon dynasty, illustrated style, slow zoom in
```

## Differences from Image Prompts

| | Image | Video |
|--|-------|-------|
| Action | Static pose/expression | Specific movement description |
| Verbs | State verbs (standing, holding) | Action verbs (walking, flicking, turning) |
| Camera | Fixed composition | Camera movement directions allowed |
| Time | A single moment | Short sequence (5–15 seconds) |
| Depth of description | Detailed appearance/background | Action sequence and emotional changes |

## Action Description Keywords

### Speed

| Keyword | Usage |
|---------|-------|
| `slowly` | Emotional/heavy scenes |
| `gently` | Delicate/warm scenes |
| `quickly` | Urgent/startled scenes |
| `suddenly` | Twist/shock scenes |
| `gradually` | Transition processes |

### Common Actions

| 한글 | English |
|------|---------|
| 고개를 숙이다 | bowing head down |
| 뒤돌아보다 | turning around to look back |
| 눈물을 닦다 | wiping tears from eyes |
| 주먹을 쥐다 | clenching fists tightly |
| 문을 열다 | sliding open a paper door |
| 걸어가다 | walking toward / walking away |
| 뛰어가다 | running desperately |
| 무릎을 꿇다 | dropping to knees |
| 편지를 펼치다 | unfolding a letter |
| 장부를 넘기다 | flipping through ledger pages |

## Camera Directions

### Camera Movement

| Direction | Effect | Usage |
|-----------|--------|-------|
| `smooth camera` | Smooth default movement | General purpose |
| `slow zoom in` | Slowly zoom in | Emotional buildup, tension |
| `slow zoom out` | Slowly zoom out | Establishing context, lingering effect |
| `pan left/right` | Horizontal panning | Exploring space, switching between characters |
| `tracking shot` | Follow a character | Movement scenes |
| `static camera` | Fixed | Tension, stillness |
| `slow dolly in` | Forward approach | Climax |
| `aerial view` | Bird's eye view | Wide establishing shots |

### Camera Angles

| Direction | Effect |
|-----------|--------|
| `low angle` | Intimidation, authority |
| `high angle` | Vulnerability, smallness |
| `eye level` | Neutral, empathy |
| `over the shoulder` | Dialogue, observation |
| `dutch angle` | Unease, confusion |

## Video Prompt Writing Tips

1. **Focus on a single action**: Describe only one key action per scene (5–15 seconds)
2. **Start-to-end structure**: Describe both the beginning and end states of the action
3. **Emotional change**: Include changes in expression/emotion during the action
4. **Environmental interaction**: Include interactions with the environment such as clothing fluttering in the wind, rain splashing, etc.

### Good Example

```
A girl sitting still, then slowly lifting her head to reveal tear-streaked cheeks,
   the candlelight flickering across her determined expression,
   Joseon dynasty, cinematic, slow zoom in
```

### Bad Example

```
A girl crying (too simple, no action)
A girl runs across the courtyard, picks up a book, reads it, then throws it away
   (too many actions in a single scene)
```

## Character/Location/Architecture Keywords

Use the same keyword tables from the image prompt guide (`prompt-image.md`).
