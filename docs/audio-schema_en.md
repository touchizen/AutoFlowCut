# Audio Schema (Audio & SFX)

Structure for per-character dialogue audio (TTS) and sound effect (SFX) files.

## Directory Structure

```
voice_samples/
├── generate_tts.py          <- TTS generation script
├── generate_sfx.py          <- SFX generation script
├── typecast_voice_catalog.md <- Voice catalog
├── sfx/                     <- Sound effects
│   ├── 01_주판/
│   │   ├── abacus_beads_01.mp3
│   │   ├── click_01.mp3
│   │   └── ...
│   ├── 02_환경음_바람/
│   ├── 02_환경음_빗소리/
│   ├── 02_환경음_새소리/
│   ├── 03_침묵_호흡/
│   ├── 04_발소리/
│   ├── 05_금속_타격_문/
│   ├── 06_붓소리/
│   └── 07_군중/
├── {character_name}/                <- Per-character dialogue TTS
│   ├── {character}_{number}_{timecode}.mp3
│   └── ...
└── .audio_review.json       <- Audio review status
```

## TTS (Dialogue Audio)

### Generation API: Typecast

```
API: https://api.typecast.ai/v1/text-to-speech
Auth: ~/.typecast/credentials
```

### Dialogue Data Structure (generate_tts.py)

```python
# (character_name, number, timecode, dialogue, emotion)
("소은", 1, "01:59", "서른한 푼이요.", "normal")
("곽 주사", 5, "10:30", "이 집안이 흔들리고 있소.", "angry")
```

### Character-to-Voice Mapping

```python
VOICES = {
    "character_name": ("voice_id", "model"),  # model: ssfm-v21 or ssfm-v30
}
```

### Output Filename Convention

```
{character_name}/{character}_{number}_{timecode}.mp3
e.g.: 소은/소은_01_0159.mp3
```

### Emotion Parameters

| Emotion | Description |
|---------|-------------|
| `normal` | Default |
| `happy` | Bright/joyful |
| `sad` | Sad |
| `angry` | Angry/intense |

## SFX (Sound Effects)

### Generation API: ElevenLabs

```
API: https://api.elevenlabs.io/v1/sound-generation
Auth: ~/.elevenlabs/credentials
```

### SFX Data Structure (generate_sfx.py)

```python
# (folder, filename, English prompt, duration_in_seconds)
("01_주판", "abacus_beads_01.mp3",
 "Wooden abacus beads clicking gently, traditional Korean counting", 3)
```

### SFX Categories

| Category | Folder | Examples |
|----------|--------|----------|
| Props | `01_주판` | Abacus bead sounds, dropping sounds |
| Ambience | `02_환경음_*` | Wind, rain, birdsong, marketplace, insects |
| Body | `03_침묵_호흡` | Breathing, sighing |
| Footsteps | `04_발소리` | Walking, running, wooden floor |
| Metal/Doors | `05_금속_타격_문` | Door opening/closing, locks |
| Writing | `06_붓소리` | Brush writing sounds |
| Crowd | `07_군중` | Murmuring, chattering |

### Timecoded SFX

SFX that must be synced to a specific scene have the timecode appended to the filename:
```
abacus_beads_dark_01_0015.mp3  <- for the 00:15 scene
abacus_beads_01_0134.mp3       <- for the 01:34 scene
```

## Audio Review (.audio_review.json)

JSON file that tracks unsuitable audio files.

```json
{
  "voice_samples/sfx/02_환경음_바람/wind_howl_01.mp3": {
    "status": "flagged",
    "reason": "타임코드 없음",
    "flaggedAt": "2026-03-16T05:44:55.228Z"
  }
}
```

### MCP Tools

- `list_audio_reviews`: View list of flagged items
- `update_audio_review`: Add/remove flags
