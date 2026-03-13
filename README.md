# AutoFlowCut

AI-powered video creation tool — Generate images & videos with Google Flow AI, then export to CapCut projects automatically.

[한국어 README](README.ko.md)

## What is AutoFlowCut?

AutoFlowCut is a desktop application that streamlines short-form video production:

1. **Write scenes** — Define your video scenes with subtitles and AI prompts
2. **Generate media** — AI creates images (Text-to-Image), then optionally generates videos (Text-to-Video, Image-to-Video)
3. **Export to CapCut** — One-click export to a CapCut project with all media and subtitles placed on the timeline

No more manual dragging of hundreds of images into your editor.

## Features

- **Google Flow AI Integration** — Text-to-Image, Text-to-Video (T2V), Image-to-Video (I2V)
- **Batch Generation** — Generate all scene images/videos in one go
- **Scene Management** — Add, edit, reorder scenes with subtitles and prompts
- **CapCut Export** — Automatically creates a CapCut draft project with images, videos, and subtitles
- **Project Save/Restore** — Save your work and resume later
- **Matching Tags** — Keep consistent characters/styles across scenes

## Download

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [AutoFlowCut-0.9.0-arm64.dmg](https://github.com/touchizen/AutoFlowCut/releases/latest) |
| Windows | [Microsoft Store](https://apps.microsoft.com/detail/9p2d9g1f4j7q) |

## Quick Start

### 1. Install & Launch

**macOS:**
- Download the `.dmg` file from [Releases](https://github.com/touchizen/AutoFlowCut/releases)
- Drag `AutoFlowCut` to your Applications folder
- On first launch, right-click → Open (to bypass Gatekeeper)

**Windows:**
- Install from the Microsoft Store

### 2. Sign in to Google

- AutoFlowCut opens Google Flow AI (labs.google/fx) in an embedded browser
- Sign in with your Google account
- The app will detect your login automatically

### 3. Create Scenes

- Go to the **Scene** tab
- Add scenes with subtitles and image prompts
- Optionally add **Matching Tags** to maintain consistent styles

### 4. Generate Images

- Click **Generate All** to create images for all scenes
- Images are generated via Google Flow AI
- Progress is shown in real-time

### 5. Generate Videos (Optional)

- Switch to the **T2V** (Text-to-Video) or **I2V** (Image-to-Video) tab
- Generate videos from your prompts or existing images
- Select which media (image/T2V/I2V) to use per scene

### 6. Export to CapCut

- Click **Export to CapCut**
- Choose your export settings (duration, resolution)
- A CapCut project is created with all media and subtitles on the timeline
- Open CapCut → Import → Your project appears ready to edit

## Workflow Overview

```
Scenes (subtitle + prompt)
    ↓
Generate Images (Google Flow AI)
    ↓ (optional)
Generate Videos (T2V / I2V)
    ↓
Select Media per Scene (image / T2V / I2V)
    ↓
Export to CapCut Project
    ↓
Edit & Publish in CapCut
```

## Requirements

- **macOS** 11.0+ (Apple Silicon) or **Windows** 10+
- **Google Account** (for Flow AI access)
- **CapCut** desktop app (for editing exported projects)
- Internet connection

## Tech Stack

- Electron + React 18 + Vite 6
- Google Flow AI (labs.google/fx)
- CapCut draft format export

## License

MIT License — see [LICENSE](LICENSE) for details.

## Links

- [YouTube](https://youtube.com/@touchizen)
- [Discord](https://discord.gg/DTMMs8TZDN)
- [Website](https://touchizen.com)
