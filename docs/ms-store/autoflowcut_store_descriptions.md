# AutoFlowCut — Microsoft Store Listing (v1.0.0)

---

## 📋 Notes for Certification Testers

```
Testing this app requires a free Google AI Studio API key. Steps:

1. Go to https://aistudio.google.com and sign in with any Google account.
2. Click "Get API key" → "Create API key" → copy the key.
3. Launch AutoFlowCut → click "API Key" in the top-right header.
4. Paste the key and click Save. The header badge turns green.

Image generation (Google Gemini) and video generation (Veo) are now available.
All AI calls go directly from the app to Google's official API — no intermediary server.

CapCut Export (the only paid feature) can be tested with the 5 free trial exports
automatically credited to a new account. Create a free account at touchizen.com,
or use the existing test account below if one has been provided separately.
```

---

## 🇺🇸 ENGLISH

### App Name
```
AutoFlowCut
```

### Slogan / Tagline (for use next to the title)
```
Prompts in, video project out
```
Notes:
- Avoid "CapCut" here — it's a ByteDance trademark and risky next to the app
  title/name in store listings (body Description may still mention "export to
  CapCut" for compatibility).
- Alternatives:
  - `Prompts in, edit-ready project out`
  - `Prompts in, full timeline out`
  - `Batch AI video, ready to edit`

### Short Description (100 chars)
```
Bulk-generate AI images & videos with Google Gemini/Veo API; export full CapCut projects in one click.
```

### Description
```
A 200-image AI video used to take 4+ hours. With AutoFlowCut, one click — under a minute.

Connect your Google AI Studio key once, load your script, and let AutoFlowCut handle the rest: batch-generate 100+ images and videos via Google Gemini & Veo, watch them appear in real time, then export a complete CapCut project — timeline, audio, subtitles, and Ken Burns animations — in one click.

No web automation. No logins. No reCAPTCHA. Just direct API calls from your machine to Google, as fast as your quota allows.


🎬 COMPLETE AI VIDEO PIPELINE

AutoFlowCut covers the full workflow from script to timeline:

1. Import prompts — Load scene prompts from TXT, CSV, or SRT files.
2. Set references — Match character, background, and style references by tags for visual consistency.
3. Generate images — Batch-create 100+ AI images via Google Gemini API. Auto-retry on errors, with smart re-download for server-success/client-fail cases.
4. Generate videos — Create T2V (Text-to-Video) or I2V (Image-to-Video) for selected scenes via Veo API.
5. Select media — Choose the best media (image, T2V, or I2V) per scene. Auto-priority: I2V > T2V > Image.
6. Place audio — Drop narration, dialogue, and SFX files with timecoded names; AutoFlowCut places them on separate CapCut tracks automatically.
7. Export to CapCut — One click exports a complete project with timeline, media, audio, subtitles, and Ken Burns animations.


🎙️ STORY ENGINE v2 — SCRIPT TO PRODUCTION, AUTOMATED

The built-in Story Engine v2 turns a single topic into a complete video production through a 9-Wave automated pipeline:

- W1: Story design (success-factor analysis, fact-checking, genre tone)
- W2: 20-chapter synopsis & preflight checks
- W3: Full 5-act script writing with sub-agent review (max 5 rounds, auto-advance on 0 issues)
- W4: Production data extraction (narration, dialogue, SFX cues)
- W5: TTS voice and SFX generation with timecoded filenames
- W6: Storyboard CSV creation
- W7: Image production in AutoFlowCut (references + scenes + image QA)
- W8: Assembly (SFX scene-match, audio import, CapCut export, optional video clips)
- W9: YouTube upload metadata (titles, descriptions, thumbnails)

Three genres supported: Korean historical tales (yadam), Western dark history, and bespoke (per-episode meta-prompts from your own reference scripts). Just say "start a new episode" in Claude Code and the pipeline runs automatically — with two user checkpoints (script confirmation after W3, image QA after W7). Prefer reviewing each wave's output before continuing? Use `/story-step` to run one wave at a time.


🔧 HOW TO USE

1. Get a Google API key — Create a free key at Google AI Studio (aistudio.google.com). Enter it once in Settings.
2. Prepare prompts — Type text, import CSV scene data, or load SRT subtitles. Each line or entry becomes a scene.
3. Set reference images — Tag your reference images (character, background, style) and they auto-match to scenes.
4. Generate images — Gemini API creates consistent visuals across all scenes. Images auto-save locally.
5. Generate videos (optional) — Select scenes for T2V or I2V video generation via Veo API. Videos are mapped back to their scenes automatically.
6. Place audio (optional) — Drop TTS, dialogue, or SFX files with timecoded names; AutoFlowCut auto-tracks them in CapCut.
7. Select export media — For each scene, choose image, T2V video, or I2V video. Or let auto-mode pick the best available.
8. Export to CapCut — Generates a complete CapCut project. Open in CapCut and start editing immediately.


⚡ KEY FEATURES

- Google Gemini & Veo API — Direct API connection. Bring your own Google API key; no web automation, no login required.
- Per-Type Model Selection — Choose the exact Gemini model for image generation and Veo model for video, independently per generation type (T2I / T2V / F2V).
- Batch Image Generation — Create 100+ images in minutes with reference-based style matching. Auto-retry on errors.
- Live Generation Grid — Watch images populate in real time as each scene completes, with progress indicators per cell.
- Smart Video Retry — When videos succeed on the server but fail to download, AutoFlowCut detects this and re-downloads instead of regenerating, saving credits and time.
- T2V Video Generation — Generate Text-to-Video clips for scenes that need motion.
- I2V Video Generation — Generate Image-to-Video clips from your existing scene images.
- Per-Clip Video Include/Exclude Toggle — Choose which scenes to include or exclude from the CapCut export, right from the timeline.
- Per-Scene Media Selection — Choose image, T2V, or I2V per scene. Smart auto-mode picks the best available media.
- Audio Auto-Placement — Narration, dialogue, and SFX files with timecoded filenames are automatically placed on separate CapCut tracks. Bring your own audio or let Story Engine generate it.
- AudioTimeline (Multi-Track Preview) — Remotion-style timeline view of every audio track with resizable rows, rich tooltips, and a playhead that stays visible across zoom changes. Preview the full audio mix before exporting.
- One-Click CapCut Export — Timeline, media files, audio tracks, subtitles, and Ken Burns animations in one project file.
- Style Presets — Choose from 87 built-in style presets (anime, watercolor, cinematic, ink wash, etc.) to apply consistent visual styles across all scenes. Optional "Require Style" setting ensures a style is always selected before generation.
- Auto Tag Matching — Tag references once, and they match to scenes automatically for visual consistency.
- Ken Burns Effect — Auto zoom/pan animations on image clips to bring static images to life.
- Live Progress Banner — Real-time top-strip banner shows generation status across the entire app, with completion rate and one-click dismiss.
- Multiple Input Formats — TXT (one prompt per line), CSV (structured data), SRT (subtitles with timing).
- Auto-Save — All generated images and videos save to local storage automatically.
- Duration Auto-Adjust — Video clip durations auto-adjust in the timeline. Image durations are configurable.
- Subtitle Editing — Edit subtitles directly in the scene list. Import from CSV or SRT.
- Story Engine v2 — 9-Wave automated pipeline for full episodes (script → TTS → storyboard → images → CapCut → upload metadata).
- MCP Server (Claude Code) — Built-in MCP server lets Claude Code edit scenes, prompts, references, and trigger generation directly. Workflow state is tracked in STATE.md for reliable resumption.
- Open Source — Free forever. View and contribute on GitHub.


🤖 CLAUDE CODE INTEGRATION

AutoFlowCut includes a built-in MCP (Model Context Protocol) server that connects directly to Claude Code. AI coding assistants can drive the entire video production workflow:

- Edit scene prompts and subtitles in bulk via natural language
- Manage references (characters, backgrounds, styles) programmatically
- Trigger image/video generation from Claude Code
- Review and fix problem scenes automatically
- Install custom skills for specialized workflows (e.g., story scripting)
- Workflow state tracked via STATE.md — resume safely across sessions
- Skills auto-install on first launch when Claude Code is detected

Story Engine v2 commands available in Claude Code:
- /story-new — Initialize an episode, pick a genre, discuss the topic
- /story-execute — Run W1~W9 automatically (with W3 + W7 user gates)
- /story-step — Run the next single wave only and exit (manual mode, no in-wave prompts)
- /story-next — Resume from where you left off
- /story-rewrite — Improve an existing episode (engagement-gap diagnosis → fork → partial wave re-run)

Enable the HTTP API (port 3210) in Settings to allow external tools to interact with your project.


🎯 WHO IS THIS FOR?

- AI Video Creators — Generate images AND videos via Google's official API, then export everything to CapCut in one click.
- Faceless YouTube Channels — Automate AI slideshow and narration video production with T2V/I2V support.
- AI Story Channels — Keep characters, backgrounds, and styles consistent across 200+ scenes. Use Story Engine v2 to produce full episodes from a single topic.
- Shorts & TikTok Creators — Quickly turn AI-generated scenes into short-form video projects.
- Educators & Course Creators — Turn scripts into illustrated video lessons with AI visuals and auto-placed narration.


💰 PRICING

AutoFlowCut is free and open source.

- All features are free — CapCut Export is the only paid feature
- 5 free CapCut exports every month — refreshes monthly, no time limit
- 5 signup bonus credits when you create an account
- Pro: $4.99/month or $39.99/year (unlimited exports)
- Google Gemini/Veo API usage billed directly by Google per your own account quota
- Source code available on GitHub: github.com/touchizen/AutoFlowCut


📋 REQUIREMENTS

- Google AI Studio API key (free at aistudio.google.com)
- CapCut desktop app (free version works)
- Internet connection for AI generation
- Windows 10 or later


🔒 PRIVACY & SAFETY

This app runs entirely on your local machine. All AI generation calls go directly from your device to the Google Gemini/Veo API using your own API key — we never proxy, store, or transmit your images, videos, or prompts through our servers. Your API key is stored encrypted in the OS keychain and never sent anywhere except to Google's official API endpoint. For details, see our Privacy Policy at touchizen.com/en/privacy.


💬 SUPPORT

Questions or feedback? Contact us at gordon.ahn@touchizen.com
GitHub Issues: github.com/touchizen/AutoFlowCut/issues

Made by Touchizen — touchizen.com

Disclaimer: This app is an independent product developed by Touchizen and is not affiliated with, endorsed by, or sponsored by Google or ByteDance (CapCut).
```

### What's New
```
v1.1.2 — More predictable image and video results. Image generations now follow the selected aspect ratio more reliably, and video clips better match each scene's duration, using the closest supported 4, 6, or 8 second length when available. This makes exported CapCut timelines easier to review and edit.

v1.1.1 — Reference images for video. Attach character and style references to Veo video generation (T2V & I2V) with the same @mention syntax you already use for images — consistent characters now carry into your video clips, not just stills. Plus stability fixes for prompt editing, video reference handling, and CapCut export.

v1.1.0 — 5× to 10× faster image and video generation. 100 images take about 2 to 5 minutes. Type @character in the prompt to instantly attach a reference image inline.

v1.0.0 — Your own API key. Faster. No logins. Ever.

AutoFlowCut now calls Google Gemini and Veo directly with your own Google AI Studio key. No web automation, no reCAPTCHA interruptions, no sudden session blocks — just stable generation as fast as your quota allows.

Watch it generate live. A real-time grid shows each image the moment it completes. Spot a bad scene early and pause the batch — no more waiting until the end to see what went wrong.

Choose your model. Pick the exact Gemini image model and Veo video model independently for T2I, T2V, and F2V. Tune quality vs. speed per generation type.

Include or exclude clips without re-exporting. A per-clip eye toggle on the timeline lets you keep or drop individual scenes from the CapCut export instantly.

Export I2V and T2V at the same time. Both image-to-video and text-to-video tracks land in CapCut as separate lanes in one operation — no second export needed.

Safer regeneration. Previous images and videos are held in reserve and restored automatically if regeneration fails — you never lose what was already good.

Generate up to 5 scenes in parallel. Concurrency is configurable in Settings; default is 5 simultaneous scenes.
```

### Keywords
```
AI video automation, text to video, image to video, batch AI generation, BYOK, video timeline, subtitles, SRT, audio sync, Ken Burns, story engine, MCP, open source
```

---

## 🇰🇷 한국어

### App Name
```
AutoFlowCut
```

### Short Description (100자 이내)
```
Google Gemini/Veo API로 이미지·비디오를 대량 생성하고 CapCut 프로젝트로 원클릭 내보내기하는 데스크톱 앱
```

### Description
```
200장짜리 AI 영상, 4시간 이상 걸리던 작업이, 클릭 한번 - 1분 안에 끝납니다.

Google AI Studio 키를 한 번 등록하고, 대본을 불러오면 AutoFlowCut이 나머지를 처리합니다. Gemini & Veo로 이미지·비디오를 일괄 생성하고, 실시간으로 결과를 확인하면서, 원클릭으로 타임라인·오디오·자막·Ken Burns 애니메이션이 모두 포함된 완성 CapCut 프로젝트를 내보냅니다.

웹 자동화 없음. 로그인 없음. reCAPTCHA 없음. 내 기기에서 Google 공식 API로 직접, 쿼터가 허용하는 한 최대 속도로.


🎬 AI 영상 제작 전체 파이프라인

AutoFlowCut은 대본부터 타임라인까지 전체 워크플로우를 커버합니다:

1. 프롬프트 가져오기 — TXT, CSV, SRT 파일에서 씬 프롬프트를 로드합니다.
2. 레퍼런스 설정 — 캐릭터, 배경, 스타일 레퍼런스를 태그별로 매칭하여 시각적 일관성을 유지합니다.
3. 이미지 생성 — Google Gemini API로 100장 이상의 AI 이미지를 일괄 생성. 에러 자동 재시도, 서버 성공·다운로드 실패 시 스마트 재다운로드.
4. 비디오 생성 — Veo API로 선택한 씬에 T2V(텍스트→비디오) 또는 I2V(이미지→비디오) 생성.
5. 미디어 선택 — 씬별로 이미지, T2V, I2V 중 최적의 미디어 선택. 자동 우선순위: I2V > T2V > 이미지.
6. 오디오 배치 — 타임코드 파일명을 가진 나레이션·대사·SFX 파일을 넣으면 CapCut의 별도 트랙에 자동 정렬.
7. CapCut 내보내기 — 원클릭으로 타임라인, 미디어, 오디오, 자막, Ken Burns 애니메이션이 포함된 완성 프로젝트 내보내기.


🎙️ STORY ENGINE v2 — 대본부터 프로덕션까지 자동화

내장 Story Engine v2는 단 하나의 주제로 완성된 영상 프로덕션을 9-Wave 자동 파이프라인으로 만듭니다:

- W1: 스토리 설계 (성공 요인 분석, 팩트체크, 장르 톤)
- W2: 20챕터 시놉시스 & 프리플라이트 점검
- W3: 5파트 대본 작성 + 서브에이전트 리뷰 (Wave당 최대 5라운드, 문제 0이면 즉시 다음)
- W4: 프로덕션 데이터 추출 (나레이션, 대사, SFX 큐)
- W5: TTS 음성 및 SFX 생성 (타임코드 파일명)
- W6: 스토리보드 CSV 작성
- W7: AutoFlowCut에서 이미지 생성 (레퍼런스 + 씬 + 이미지 QA)
- W8: 어셈블리 (SFX 씬 매칭, 오디오 임포트, CapCut 내보내기, 영상 클립 선택)
- W9: YouTube 업로드 메타데이터 (제목, 설명, 썸네일)

야담(한국 사극), 다크 히스토리(서구 미스터리/실화), 맞춤형(bespoke — 사용자 레퍼런스 대본으로 메타프롬프트 합성) 세 장르 지원. Claude Code에서 "새 에피소드 시작"이라고만 하면 자동 진행됩니다 — W3 대본 확정 / W7 이미지 QA 두 번 사용자 확인. 한 웨이브씩 결과물 보면서 가고 싶다면 `/story-step` 사용.


🔧 사용 방법

1. Google API 키 준비 — Google AI Studio(aistudio.google.com)에서 무료 키를 발급받아 설정에서 한 번 입력.
2. 프롬프트 준비 — 텍스트 입력, CSV 씬 데이터 가져오기, SRT 자막 파일 로드. 각 줄 또는 항목이 하나의 씬이 됩니다.
3. 레퍼런스 이미지 설정 — 레퍼런스 이미지에 태그를 붙이면 씬에 자동 매칭됩니다.
4. 이미지 생성 — Gemini API가 모든 씬에 걸쳐 일관된 비주얼을 생성. 이미지 자동 로컬 저장.
5. 비디오 생성 (선택) — 모션이 필요한 씬에 Veo API로 T2V 또는 I2V 비디오 생성. 해당 씬에 자동 매핑.
6. 오디오 배치 (선택) — 타임코드 파일명의 TTS/대사/SFX 파일을 넣으면 CapCut에 자동 트랙 배치.
7. 내보낼 미디어 선택 — 씬별로 이미지, T2V, I2V 중 선택. 자동 모드도 가능.
8. CapCut 내보내기 — CapCut 프로젝트를 생성. 바로 CapCut에서 열어 편집을 시작하세요.


⚡ 주요 기능

- Google Gemini & Veo 공식 API — 직접 API 연결. 내 Google API 키를 사용하며 웹 자동화·로그인 불필요.
- 타입별 모델 선택 — 이미지 생성용 Gemini 모델과 비디오 생성용 Veo 모델을 T2I / T2V / F2V 별로 독립적으로 선택.
- 일괄 이미지 생성 — 레퍼런스 기반 스타일 매칭으로 수 분 내에 100장 이상 생성. 에러 자동 재시도.
- 라이브 생성 그리드 — 각 씬이 완료될 때마다 실시간으로 이미지가 채워지는 모습을 확인.
- 스마트 비디오 재시도 — 서버 성공·클라이언트 다운로드 실패 시 재생성 없이 다운로드만 다시 수행, 크레딧과 시간 절약.
- T2V 비디오 생성 — 모션이 필요한 씬에 텍스트에서 비디오 클립 생성.
- I2V 비디오 생성 — 기존 씬 이미지에서 이미지→비디오 클립 생성.
- 클립별 영상 포함/제외 토글 — 타임라인에서 씬마다 CapCut 내보내기에 포함할지 제외할지 선택.
- 씬별 미디어 선택 — 씬마다 이미지, T2V, I2V 중 선택. 스마트 자동 모드로 최적 미디어 자동 선택.
- 오디오 자동 배치 — 타임코드 파일명의 나레이션·대사·SFX를 CapCut의 별도 트랙에 자동 정렬. 직접 준비한 오디오와 Story Engine 생성 오디오 모두 지원.
- AudioTimeline (멀티 트랙 미리보기) — Remotion 스타일 타임라인 뷰로 모든 오디오 트랙을 한눈에 확인. 트랙 크기 조절, 풍부한 툴팁, 줌 변경 후에도 항상 보이는 플레이헤드. 내보내기 전에 전체 오디오 믹스를 미리보기.
- 원클릭 CapCut 내보내기 — 타임라인, 미디어, 오디오 트랙, 자막, Ken Burns 애니메이션을 하나의 프로젝트 파일로.
- 스타일 프리셋 — 87가지 내장 스타일 프리셋(애니, 수채화, 시네마틱, 수묵화 등)으로 모든 씬에 일관된 비주얼 적용. '스타일 필수' 설정 가능.
- 자동 태그 매칭 — 레퍼런스에 태그를 한 번 붙이면 씬에 자동 매칭되어 시각적 일관성 유지.
- Ken Burns 효과 — 이미지 클립에 자동 줌/팬 애니메이션 적용.
- 실시간 진행 배너 — 앱 상단에 실시간 생성 상태 표시. 완료율 + 원클릭 닫기.
- 다양한 입력 형식 — TXT(줄 단위 프롬프트), CSV(구조화 데이터), SRT(타이밍 포함 자막).
- 자동 저장 — 생성된 모든 이미지와 비디오가 로컬 저장소에 자동 저장.
- 재생시간 자동 조정 — 비디오 클립 재생시간이 타임라인에서 자동 조정. 이미지 재생시간 설정 가능.
- 자막 편집 — 씬 목록에서 바로 자막 편집. CSV/SRT에서 가져오기 가능.
- Story Engine v2 — 9-Wave 자동 파이프라인 (대본→TTS→스토리보드→이미지→CapCut→업로드 메타) 으로 풀 에피소드 생산.
- MCP 서버 (Claude Code 연동) — 내장 MCP 서버로 Claude Code에서 씬·프롬프트·레퍼런스를 직접 편집하고 생성 트리거 가능. STATE.md 기반 상태 추적으로 안정적 재개.
- 오픈 소스 — 영구 무료. GitHub에서 소스 코드 확인 및 기여 가능.


🤖 Claude Code 연동

AutoFlowCut에는 Claude Code와 직접 연결되는 내장 MCP(Model Context Protocol) 서버가 포함되어 있습니다. AI 코딩 어시스턴트로 영상 제작 워크플로우 전체를 자동화할 수 있습니다:

- 자연어로 씬 프롬프트와 자막을 일괄 편집
- 레퍼런스(캐릭터, 배경, 스타일)를 프로그래밍 방식으로 관리
- Claude Code에서 이미지/비디오 생성 트리거
- 문제 씬을 자동으로 검토하고 수정
- 전문 워크플로우용 커스텀 스킬 설치 (예: 스토리 대본 작성)
- STATE.md 기반 워크플로우 상태 추적으로 세션 간 안정 재개
- 첫 실행 시 Claude Code 감지되면 스킬 자동 설치

Claude Code에서 사용 가능한 Story Engine v2 명령:
- /story-new — 에피소드 초기화, 장르 선택, 주제 논의
- /story-execute — W1~W9 자동 실행 (W3/W7 사용자 게이트 포함)
- /story-step — 다음 한 웨이브만 실행 후 종료 (수동 모드, 웨이브 내부 질문 없음)
- /story-next — 중단한 곳에서 이어서 실행
- /story-rewrite — 기존 에피소드 개선 (몰입도 진단 → fork → 부분 웨이브 재실행)

설정에서 HTTP API(포트 3210)를 활성화하면 외부 도구에서도 프로젝트에 접근할 수 있습니다.


🎯 이런 분께 추천합니다

- AI 영상 크리에이터 — Google 공식 API로 이미지와 비디오를 모두 생성하고, 원클릭으로 CapCut 프로젝트로 내보내기.
- 얼굴 없는 YouTube 채널 — T2V/I2V 지원으로 AI 슬라이드쇼/나레이션 영상 제작 자동화.
- AI 스토리 채널 — 200개 이상의 씬에서도 캐릭터, 배경, 스타일 일관성 유지. Story Engine v2로 주제 하나에서 풀 에피소드 생산.
- 숏폼 & TikTok 크리에이터 — AI 생성 장면을 빠르게 숏폼 영상 프로젝트로 변환.
- 교육 콘텐츠 제작자 — 대본을 AI 비주얼 + 자동 배치 나레이션이 포함된 일러스트 영상 강의로 제작.


💰 가격

AutoFlowCut은 무료 오픈소스입니다.

- 모든 기능 무료 — CapCut 내보내기만 유료
- 매월 5회 무료 CapCut 내보내기 — 매달 갱신, 기간 제한 없음
- 가입 보너스 5회 — 계정 생성 시 추가 크레딧 지급
- Pro: $4.99/월 또는 $39.99/년 (무제한 내보내기)
- Google Gemini/Veo API 사용량은 사용자 본인의 Google 계정 쿼터에 따라 Google에서 직접 청구
- 소스 코드: github.com/touchizen/AutoFlowCut


📋 필요 사항

- Google AI Studio API 키 (aistudio.google.com에서 무료 발급)
- CapCut 데스크톱 앱 (무료 버전 가능)
- AI 생성을 위한 인터넷 연결
- Windows 10 이상


🔒 개인정보 및 안전

본 앱은 전적으로 사용자의 로컬 PC에서 작동합니다. 모든 AI 생성 요청은 사용자의 기기에서 Google Gemini/Veo 공식 API로 직접 전송됩니다 — 당사 서버를 통해 이미지, 비디오, 프롬프트를 중계·저장·전송하지 않습니다. API 키는 OS 키체인에 암호화 저장되며 Google 공식 API 엔드포인트 이외의 어디에도 전송되지 않습니다. 자세한 내용은 touchizen.com/ko/privacy에서 확인하세요.


💬 지원

질문이나 피드백은 gordon.ahn@touchizen.com으로 문의해주세요.
GitHub Issues: github.com/touchizen/AutoFlowCut/issues

Touchizen 제작 — touchizen.com

면책 조항: 이 앱은 Touchizen에서 개발한 독립적인 제품이며, Google 또는 ByteDance(CapCut)와 제휴, 보증 또는 후원 관계가 없습니다.
```

### What's New (새로운 기능)
```
v1.1.2 — 이미지와 영상 결과가 더 예측 가능해졌습니다. 선택한 이미지 화면비가 더 정확하게 반영되고, 영상 클립은 각 장면 길이에 맞춰 가능한 경우 4초, 6초, 8초 중 가장 가까운 길이로 생성됩니다. 덕분에 CapCut으로 내보낸 타임라인을 더 쉽게 확인하고 편집할 수 있습니다.

v1.1.1 — 비디오에도 레퍼런스 이미지. 이미지에서 쓰던 @멘션 방식 그대로 Veo 비디오 생성(T2V·I2V)에 캐릭터·스타일 레퍼런스를 첨부할 수 있습니다 — 이제 정지 이미지뿐 아니라 영상 클립에서도 캐릭터 일관성이 유지됩니다. 프롬프트 편집, 비디오 레퍼런스 처리, CapCut 내보내기 안정성도 함께 개선했습니다.

v1.1.0 — 이미지·비디오 생성 속도 5배~10배 향상. 프롬프트 입력창에서 @캐릭터이름을 타이핑하면 레퍼런스 이미지를 바로 인라인으로 첨부할 수 있습니다.

v1.0.0 — 내 API 키로, 더 빠르게. 로그인 없이. 영구적으로.

AutoFlowCut이 이제 내 Google AI Studio 키로 Gemini·Veo에 직접 연결됩니다. 웹 자동화·reCAPTCHA·세션 만료가 사라졌습니다. 쿼터가 허용하는 한 끊김 없이 생성됩니다.

생성되는 걸 실시간으로 확인. 각 씬이 완료되는 즉시 그리드에 이미지가 나타납니다. 배치 전체가 끝나기 전에 문제 씬을 발견하고 바로 멈출 수 있습니다.

모델을 직접 선택. T2I·T2V·F2V별로 Gemini 이미지 모델과 Veo 비디오 모델을 독립적으로 선택해 품질과 속도를 조율하세요.

내보내기 전에 클립 포함/제외. 타임라인의 눈 토글로 씬마다 CapCut 내보내기에 포함할지 제외할지 즉시 결정 — 재내보내기 없음.

I2V + T2V 동시 내보내기. 이미지→비디오와 텍스트→비디오 두 트랙을 CapCut 별도 레인으로 한 번에 내보냅니다.

더 안전한 재생성. 재생성 실패 시 이전 이미지·비디오가 자동으로 복원됩니다 — 이미 완성된 결과물을 잃지 않습니다.

최대 5개 씬 동시 생성. 기본값 5, 설정에서 변경 가능.
```

### Keywords (한국어)
```
AI 영상 자동화, 텍스트투비디오, 이미지투비디오, AI 이미지 생성, 일괄 생성, 영상 타임라인, 자막, SRT, 오디오 싱크, Ken Burns, AI 스토리텔링, Story Engine, MCP, 오픈소스
```

---

## 🇯🇵 日本語

### Short Description
```
Google Gemini/Veo APIで画像・動画を一括生成し、CapCutプロジェクトをワンクリックでエクスポートするデスクトップアプリ
```

### Description
```
200シーンのAI動画、丸一日かかっていた作業が1時間以内に終わります。

Google AI StudioキーをSettings に一度登録してスクリプトを読み込めば、あとはAutoFlowCutが自動処理。Gemini & Veoで画像・動画を一括生成し、リアルタイムで結果を確認しながら、タイムライン・音声・字幕・Ken Burnsアニメーション込みの完成CapCutプロジェクトをワンクリックでエクスポート。

ウェブ自動化なし。ログインなし。reCAPTCHAなし。デバイスからGoogle公式APIへ直接、クォータの許す限り最速で。公式APIベースの安定した生成ワークフローで、AutoFlowCutをスムーズに利用できます。


⚡ 主な機能

- Google Gemini & Veo公式API — 直接API接続。ご自身のAPIキーを使用。ウェブ自動化・ログイン不要
- タイプ別モデル選択 — 画像生成用GeminiモデルとVeoモデルをT2I/T2V/F2Vごとに個別選択
- 一括画像生成 — リファレンスベースのスタイルマッチングで100枚以上を数分で生成
- ライブ生成グリッド — 各シーン完了時にリアルタイムで画像が表示
- スマート動画リトライ — サーバー成功・ダウンロード失敗時に再生成せず再ダウンロードのみ実行
- T2V動画生成 — テキストから動画クリップを生成
- I2V動画生成 — 画像から動画クリップを生成
- クリップ別動画トグル — タイムラインでシーンごとにCapCutエクスポートへの含め/除外を選択
- シーン別メディア選択 — 画像、T2V、I2Vから選択。スマート自動モード搭載
- 音声自動配置 — タイムコード付きファイル名のナレーション、セリフ、SFXをCapCutの別トラックに自動配置
- AudioTimeline（マルチトラック・プレビュー） — Remotionスタイルのタイムラインビューで全オーディオトラックを一覧表示
- ワンクリックCapCutエクスポート — タイムライン、メディア、音声、字幕、Ken Burnsアニメーション
- スタイルプリセット — 87種類の内蔵スタイルプリセット（アニメ、水彩画、シネマティックなど）
- 自動タグマッチング — キャラクター、背景、スタイルの視覚的一貫性を維持
- リアルタイム進捗バナー — アプリ全体で生成状態をリアルタイム表示
- Story Engine v2 — 9-Wave自動パイプライン（スクリプト → TTS → ストーリーボード → 画像 → CapCut → アップロードメタデータ）
- MCPサーバー（Claude Code連携） — 内蔵MCPサーバーでClaude Codeからシーン、プロンプト、リファレンスを直接編集・生成トリガー可能
- 100%無料＆オープンソース


🎙️ STORY ENGINE v2

内蔵のStory Engine v2は、1つのトピックから完成した動画制作を9-Wave自動パイプラインで生成します：スクリプト設計、20章シノプシス、5パートスクリプト執筆（自動レビュー）、TTS/SFX生成、ストーリーボード作成、画像生成（W7）、CapCutアセンブリ（W8）、YouTubeアップロードメタデータ（W9）まで。日本語のサポートは進行中です。


🤖 Claude Code連携
内蔵MCP（Model Context Protocol）サーバーにより、Claude Codeから動画制作ワークフローを自動化できます。プロンプトの一括編集、リファレンス管理、画像・動画生成のトリガー、カスタムスキルのインストール、STATE.mdベースのワークフロー状態管理が可能です。


💰 価格
- 全機能無料 — CapCutエクスポートのみ有料
- 毎月5回の無料CapCutエクスポート — 月次リフレッシュ、期間制限なし
- 登録ボーナス5回 — アカウント作成時に追加クレジット
- Pro: $4.99/月 または $39.99/年（無制限）
- Google Gemini/Veo API利用料はご自身のGoogleアカウントのクォータに従いGoogleに直接請求
- ソースコード: github.com/touchizen/AutoFlowCut


📋 必要環境: Google AI Studio APIキー（aistudio.google.comで無料取得）、CapCutデスクトップアプリ、インターネット接続、Windows 10以降

💬 サポート: gordon.ahn@touchizen.com
```

### What's New
```
v1.1.2 — 画像と動画の結果がより予測しやすくなりました。選択した画像のアスペクト比がより正確に反映され、動画クリップは各シーンの長さに合わせて、利用可能な場合は4秒・6秒・8秒の最も近い長さで生成されます。CapCutへ書き出したタイムラインを確認・編集しやすくなりました。

v1.1.1 — 動画にも参照画像。画像で使う@メンション記法そのままで、Veo動画生成（T2V・I2V）にキャラクター・スタイル参照を添付できます — 静止画だけでなく動画クリップでもキャラクターの一貫性を維持。プロンプト編集、動画参照の処理、CapCutエクスポートの安定性も改善しました。

v1.1.0 — 画像・動画の生成速度が5〜10倍に向上。プロンプト入力欄で@キャラクター名を入力すると、参照画像をその場でインラインに添付できます。

v1.0.0 — 自分のAPIキーで、速く、ログイン不要。

AutoFlowCutがGoogle Gemini & Veo公式APIに直接接続。ウェブ自動化・reCAPTCHA・セッション切れがなくなり、クォータの許す限り安定して生成できます。

リアルタイムで生成を確認。各シーンが完了した瞬間にグリッドへ表示。バッチ全体を待たずに問題シーンを発見して一時停止できます。

モデルを選択。T2I/T2V/F2Vごとに使用するGemini/Veoモデルを独立して設定 — 品質と速度をユースケース別に調整。

クリップの含め/除外を即座に切替。タイムラインの目アイコンでシーンごとにCapCutエクスポートへの含め/除外を決定。再エクスポート不要。

I2V+T2V同時エクスポート。画像→動画とテキスト→動画の両トラックをCapCutの別レーンに一括エクスポート。

安全な再生成。再生成失敗時に以前の画像・動画が自動復元 — 完成済みのメディアを失いません。

最大5シーン同時生成（設定で変更可能）。
```

---

## 🇩🇪 DEUTSCH

### Short Description
```
KI-Bilder und -Videos mit der Google Gemini/Veo API generieren und CapCut-Projekte mit einem Klick exportieren.
```

### Description
```
Ein KI-Video mit 200 Szenen dauerte früher einen ganzen Tag. Mit AutoFlowCut schaffen Sie es in unter einer Stunde.

Google AI Studio-Schlüssel einmal eintragen, Skript laden — der Rest läuft automatisch. Gemini & Veo generieren Bilder und Videos im Stapel, Sie verfolgen die Ergebnisse in Echtzeit, und mit einem Klick exportieren Sie ein vollständiges CapCut-Projekt inklusive Timeline, Audio, Untertiteln und Ken Burns-Animationen.

Keine Web-Automatisierung. Keine Logins. Kein reCAPTCHA. Direkte API-Aufrufe von Ihrem Gerät zu Google — so schnell wie Ihr Kontingent es erlaubt.


⚡ HAUPTFUNKTIONEN

- Google Gemini & Veo API — Direkte API-Verbindung. Eigener Google API-Schlüssel, keine Web-Automatisierung nötig
- Modellauswahl pro Typ — Gemini-Modell für Bilder und Veo-Modell für Videos unabhängig pro Generierungstyp wählen (T2I / T2V / F2V)
- Stapelweise Bildgenerierung — 100+ Bilder in Minuten mit referenzbasiertem Style-Matching
- Live-Generierungsraster — Bilder erscheinen in Echtzeit, sobald jede Szene fertig ist
- Smart Video Retry — Bei Server-Erfolg/Download-Fehler wird nur erneut heruntergeladen, ohne neu zu generieren
- T2V-Videogenerierung — Text-to-Video-Clips für dynamische Szenen
- I2V-Videogenerierung — Image-to-Video-Clips aus Szenenbildern
- Clip-Video-Toggle — Szenen per Schalter in der Timeline vom CapCut-Export ein- oder ausschließen
- Medienauswahl pro Szene — Bild, T2V oder I2V pro Szene wählen. Smart-Auto-Modus verfügbar
- Audio-Auto-Platzierung — Narration, Dialog und SFX mit Timecode-Dateinamen werden automatisch auf separaten CapCut-Tracks platziert
- AudioTimeline (Multi-Track-Vorschau) — Remotion-Stil Timeline-Ansicht aller Audio-Tracks
- Ein-Klick CapCut-Export — Timeline, Medien, Audio, Untertitel und Ken Burns-Animationen
- Stil-Presets — 87 integrierte Stil-Presets (Anime, Aquarell, Cinematic usw.)
- Automatisches Tag-Matching — Visuelle Konsistenz über alle Szenen
- Live-Fortschrittsbanner — Echtzeit-Generierungsstatus über die gesamte App
- Story Engine v2 — 9-Wave automatisierte Pipeline (Skript → TTS → Storyboard → Bilder → CapCut → Upload-Metadaten)
- MCP-Server (Claude Code) — Integrierter MCP-Server für direkte Bearbeitung und Generierungssteuerung über Claude Code
- 100% kostenlos & Open Source


🎙️ STORY ENGINE v2

Die integrierte Story Engine v2 verwandelt ein einzelnes Thema in eine komplette Videoproduktion über eine 9-Wave-automatisierte Pipeline: Story-Design, 20-Kapitel-Synopsis, 5-Akt-Skript mit automatischer Überprüfung, TTS/SFX-Generierung, Storyboard, Bilderzeugung (W7), CapCut-Assembly (W8) und YouTube-Metadaten (W9). Deutsche Sprachunterstützung in Entwicklung.


🤖 Claude Code Integration
Der integrierte MCP-Server (Model Context Protocol) verbindet sich direkt mit Claude Code. Automatisieren Sie Ihren gesamten Videoproduktions-Workflow mit KI-Codierungsassistenten.


💰 Preise
- Alle Funktionen kostenlos — nur CapCut-Export ist kostenpflichtig
- 5 kostenlose CapCut-Exporte pro Monat — monatliche Erneuerung, keine Zeitbeschränkung
- 5 Bonus-Credits bei Anmeldung — zusätzliches Guthaben bei Kontoerstellung
- Pro: 4,99 $/Monat oder 39,99 $/Jahr (unbegrenzt)
- Google Gemini/Veo API-Nutzung wird direkt von Google gemäß Ihrem eigenen Kontokontingent abgerechnet
- Quellcode: github.com/touchizen/AutoFlowCut


📋 Voraussetzungen: Google AI Studio API-Schlüssel (kostenlos unter aistudio.google.com), CapCut Desktop-App, Internetverbindung, Windows 10+

💬 Support: gordon.ahn@touchizen.com
```

### What's New
```
v1.1.2 — Bild- und Videoergebnisse sind jetzt besser vorhersehbar. Das gewählte Seitenverhältnis für Bilder wird zuverlässiger übernommen, und Videoclips passen sich der Szenenlänge besser an, wenn möglich mit der nächstliegenden unterstützten Länge von 4, 6 oder 8 Sekunden. Dadurch lassen sich exportierte CapCut-Timelines leichter prüfen und bearbeiten.

v1.1.1 — Referenzbilder jetzt auch für Videos. Hängen Sie Charakter- und Stilreferenzen mit derselben @Mention-Syntax wie bei Bildern an die Veo-Videogenerierung (T2V & I2V) an — konsistente Charaktere gibt es jetzt nicht nur in Standbildern, sondern auch in Ihren Videoclips. Dazu Stabilitätsverbesserungen für Prompt-Bearbeitung, Videoreferenz-Handling und CapCut-Export.

v1.1.0 — 5× bis 10× schnellere Bild- und Videogenerierung. 100 Bilder dauern etwa 2 bis 5 Minuten. Tippen Sie @Charaktername im Prompt-Feld, um ein Referenzbild direkt inline anzuhängen.

v1.0.0 — Eigener API-Schlüssel. Schneller. Nie wieder Login-Probleme.

AutoFlowCut verbindet sich jetzt direkt mit Google Gemini & Veo über Ihren eigenen Google AI Studio-Schlüssel. Keine Web-Automatisierung, kein reCAPTCHA, keine Sitzungsunterbrechungen — stabile Generierung so schnell wie Ihr Kontingent es zulässt.

Live-Generierungsraster. Jedes Bild erscheint sofort nach Fertigstellung im Raster. Erkennen Sie fehlerhafte Szenen früh und stoppen Sie den Batch — ohne auf das Ende warten zu müssen.

Modell pro Typ wählen. Gemini-Bildmodell und Veo-Videomodell unabhängig für T2I, T2V und F2V einstellen — Qualität und Geschwindigkeit je nach Anwendungsfall abstimmen.

Clips ein- oder ausschließen ohne Re-Export. Ein Auge-Toggle pro Clip in der Timeline entscheidet sofort, ob eine Szene im CapCut-Export landet.

I2V und T2V gleichzeitig exportieren. Beide Video-Tracks landen als separate Spuren in einem einzigen CapCut-Export.

Sichere Neugenerierung. Bei Fehlern werden frühere Bilder und Videos automatisch wiederhergestellt — bereits fertige Ergebnisse gehen nicht verloren.

Bis zu 5 Szenen gleichzeitig generieren (in den Einstellungen konfigurierbar).
```

---

## 📊 Store Assets Checklist

### Required Images
- [ ] App Icon: 300x300 (min), 512x512 (recommended)
- [ ] Screenshots: 1366x768 or 1920x1080 (min 1, max 10)
  - Screenshot 1: Full app view — prompt input + image generation
  - Screenshot 2: Generated images gallery with reference matching
  - Screenshot 3: Video generation (T2V / I2V) tab
  - Screenshot 4: Media selection per scene
  - Screenshot 5: CapCut export result
- [ ] Trailer thumbnail: 1920x1080
- [ ] Trailer video: ≤60s, MP4 (H.264), 1920x1080, ≤1GB
- [ ] Poster Art: 720x1080
- [ ] Box Art: 1080x1080

### Store Settings
- Category: Multimedia design
- Sub-category: Photo & video production
- Age rating: 3+ (no objectionable content)
- Languages: English, Korean, Japanese, German
- Pricing: Free (with optional in-app subscription for unlimited CapCut exports)
- Privacy Policy URL: https://touchizen.com/en/privacy
- Website: https://touchizen.com/en/autoflowcut
- Support: gordon.ahn@touchizen.com
- Additional terms: A Google AI Studio API key is required for AI image and video generation. A Google account may be required to create and manage the API key. Google Gemini API and Veo API terms of service, quotas, and billing policies apply.
