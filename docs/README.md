# Flow2CapCut 데이터 스키마 문서

[한국어](#한국어) | [English](#english)

---

## 한국어

Flow2CapCut에서 사용하는 데이터 파일 스키마 문서입니다.
MCP 서버의 `get_schema` 도구로도 조회할 수 있습니다.

### 📄 스키마 문서

| # | 문서 | 설명 |
|---|------|------|
| 1 | [씬 CSV](./csv-scenes-schema.md) | 씬 단위 데이터 (프롬프트, 자막, 타임코드) |
| 2 | [레퍼런스 CSV](./csv-references-schema.md) | 인물/장소/스타일 레퍼런스 프롬프트 |
| 3 | [SRT 자막](./srt-schema.md) | SubRip 자막 파일 형식 |
| 4 | [오디오 & SFX](./audio-schema.md) | TTS 대사 음성 + 음향효과 구조 |
| 5 | [이미지 프롬프트](./prompt-image.md) | 이미지 생성용 프롬프트 작성 가이드 |
| 6 | [비디오 프롬프트](./prompt-video.md) | 비디오 생성용 프롬프트 작성 가이드 |

### 📁 예제 파일

| 파일 | 설명 |
|------|------|
| [scenes_example.csv](./examples/scenes_example.csv) | 씬 CSV 예제 (5개 씬) |
| [references_example.csv](./examples/references_example.csv) | 레퍼런스 CSV 예제 (인물3 + 장소2 + 스타일1) |
| [subtitle_example.srt](./examples/subtitle_example.srt) | SRT 자막 예제 |

### 🔧 MCP 도구

```
get_schema({ type: "scenes" })         → 씬 CSV 스키마
get_schema({ type: "references" })     → 레퍼런스 CSV 스키마
get_schema({ type: "srt" })            → SRT 자막 스키마
get_schema({ type: "audio" })          → 오디오/SFX 스키마
get_schema({ type: "prompt-image" })   → 이미지 프롬프트 가이드
get_schema({ type: "prompt-video" })   → 비디오 프롬프트 가이드
get_schema({ type: "all" })            → 전체 목록
get_schema({ type: "scenes", lang: "en" })  → 영문 버전
```

---

## English

Data file schema documentation for Flow2CapCut.
Also accessible via the `get_schema` tool in the MCP server.

### 📄 Schema Documents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Scenes CSV](./csv-scenes-schema_en.md) | Per-scene data (prompts, subtitles, timecodes) |
| 2 | [References CSV](./csv-references-schema_en.md) | Character/scene/style reference prompts |
| 3 | [SRT Subtitles](./srt-schema_en.md) | SubRip subtitle file format |
| 4 | [Audio & SFX](./audio-schema_en.md) | TTS voice + sound effects structure |
| 5 | [Image Prompts](./prompt-image_en.md) | Image generation prompt guidelines |
| 6 | [Video Prompts](./prompt-video_en.md) | Video generation prompt guidelines |

### 📁 Example Files

| File | Description |
|------|-------------|
| [scenes_example.csv](./examples/scenes_example.csv) | Scene CSV example (5 scenes) |
| [references_example.csv](./examples/references_example.csv) | Reference CSV example (3 chars + 2 scenes + 1 style) |
| [subtitle_example.srt](./examples/subtitle_example.srt) | SRT subtitle example |

### 🔧 MCP Tool

```
get_schema({ type: "scenes", lang: "en" })         → Scenes CSV schema
get_schema({ type: "references", lang: "en" })     → References CSV schema
get_schema({ type: "srt", lang: "en" })            → SRT subtitle schema
get_schema({ type: "audio", lang: "en" })          → Audio/SFX schema
get_schema({ type: "prompt-image", lang: "en" })   → Image prompt guidelines
get_schema({ type: "prompt-video", lang: "en" })   → Video prompt guidelines
get_schema({ type: "all" })                         → List all schemas
```
