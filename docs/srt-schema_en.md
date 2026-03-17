# SRT Schema (SubRip Subtitle)

Subtitle file for narration/dialogue. Uses the standard SRT format.
After TTS audio generation, once timecodes are finalized, the SRT is generated and can be used to create the scenes CSV.

## Format

```
{sequence number}
{start time} --> {end time}
{subtitle text}

```

- **Sequence number**: Integer starting from 1
- **Timecode**: `HH:MM:SS,mmm` format (hours:minutes:seconds,milliseconds)
- **Subtitle text**: 1–2 lines, separated by blank lines
- Encoding: UTF-8

## Rules

- Each subtitle block must be **15 seconds or less** (same as the maximum scene length)
- Long subtitles should be split into multiple blocks
- Dialogue is wrapped in double quotes: `"이 늙은이가 눈이 멀었었구나."`
- Narration is written in descriptive form without quotes

## Sample

```srt
1
00:00:00,000 --> 00:00:04,110
문중 어른들 앞에서, 거상(巨商)이 고개를 숙였습니다

2
00:00:04,110 --> 00:00:09,110
예순이 넘은 사내가, 열네 살 소녀 앞에 허리를 굽혔지요

3
00:00:09,110 --> 00:00:11,830
"이 늙은이가 눈이 멀었었구나."
```

## SRT to Scenes CSV Conversion

When an SRT file is imported in Flow2CapCut, it is automatically converted to the scenes CSV structure:
- `subtitle` <- subtitle text
- `start_time` <- start timecode (converted to seconds)
- `end_time` <- end timecode (converted to seconds)
- `duration` <- end_time - start_time
- `prompt` <- (empty, needs to be written separately)
