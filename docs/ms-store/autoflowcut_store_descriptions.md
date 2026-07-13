# AutoFlowCut — Microsoft Store Listing (v1.0.0)

---

## 📋 Notes for Certification Testers

```
AutoFlowCut has TWO ways to generate — you can test with EITHER one. Pick whichever
is easier; both call Google's official services directly from the app (no intermediary
server), and you can switch between them anytime from the toggle in the top bar.

── Option A · Flow Login mode (easiest — no API key needed) ──
1. Launch AutoFlowCut. On the first "Choose how to generate" screen, click "Flow Login".
2. Sign in with any Google account when prompted.
3. Enter a prompt and click Generate. Images (Gemini) and videos (Veo) are generated
   through your Google Flow session.

── Option B · API Key mode (BYOK) ──
1. Get a free key: go to https://aistudio.google.com, sign in with any Google account,
   then click "Get API key" → "Create API key" → copy the key.
2. Launch AutoFlowCut and choose "API Key" on the first screen (or switch via the top toggle).
3. Click "API Key" in the top-right header, paste the key, and click Save.
   The header badge turns green.
4. Enter a prompt and click Generate.

── Export (the only paid feature) ──
Export writes a ready-to-edit project for CapCut, Adobe Premiere (.prproj), or Vrew (.vrew).
It can be tested with the 5 free trial exports automatically credited to a new account.
Create a free account at touchizen.com, or use the test account provided separately.

── Story mode (v3.0.0 — optional, NOT required to certify) ──
Story mode can write a script for you and then split it into scenes, voices, and prompts.
The script step runs on an AI coding agent — Claude (Anthropic) or Codex (OpenAI). Both
command-line tools are BUNDLED INSIDE the package, so there is nothing to install, but
each needs a one-time sign-in with your own account, performed outside the app:
  - Claude: run `claude login` in a terminal (requires an Anthropic account).
  - Codex:  run `codex login` in a terminal and choose "Sign in with ChatGPT"
            (requires a ChatGPT subscription).
Without one of these sign-ins, the Script step stops with a "login required" message.
The Voice (TTS) step additionally uses an ElevenLabs, Typecast, or Gemini key.

None of this blocks certification. Image and video generation (Options A and B above),
importing your own script, scene splitting, and export all work WITHOUT a Claude or
ChatGPT account. If you would like to exercise Story mode end to end, contact us and we
will provide a pre-authenticated test setup.
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
Bulk-generate AI images & videos and export to CapCut, Premiere & Vrew — free login or your key.
```

### Description
```
A 200-image AI video used to take 4+ hours. With AutoFlowCut, one click — under a minute.

Choose how you generate — start free with a Google login, or bring your own Gemini & Veo API key for maximum speed. Load your script and AutoFlowCut handles the rest: batch-generate 100+ images and videos, watch them appear in real time, then export a complete project — timeline, audio, subtitles, and Ken Burns animations — to CapCut, Adobe Premiere, or Vrew in one click.

Two ways to generate, three ways to export, zero busywork.


🎬 COMPLETE AI VIDEO PIPELINE

AutoFlowCut covers the full workflow from script to timeline:

1. Import prompts — Load scene prompts from TXT, CSV, or SRT files.
2. Set references — Match character, background, and style references by tags — or drop them into any prompt with the @ picker — for visual consistency.
3. Generate images — Batch-create 100+ AI images via Google Gemini API. Auto-retry on errors, with smart re-download for server-success/client-fail cases.
4. Generate videos — Create T2V (Text-to-Video) or I2V (Image-to-Video) for selected scenes via Veo API.
5. Select media — Choose the best media (image, T2V, or I2V) per scene. Auto-priority: I2V > T2V > Image.
6. Place audio — Drop narration, dialogue, and SFX files with timecoded names; AutoFlowCut places them on separate CapCut tracks automatically.
7. Export — One click writes a complete project — timeline, media, audio, subtitles, and Ken Burns animations — for CapCut, Adobe Premiere, or Vrew.


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

1. Choose a generation mode — Start free with a Google login, or paste your own Gemini / Veo API key in Settings for faster, pay-as-you-go generation.
2. Prepare prompts — Type text, import CSV scene data, or load SRT subtitles. Each line or entry becomes a scene.
3. Set reference images — Tag references (character, background, style) to auto-match scenes, or type @ in any prompt to pick one and drop it in as a chip.
4. Generate images — Gemini API creates consistent visuals across all scenes. Images auto-save locally.
5. Generate videos (optional) — Select scenes for T2V or I2V video generation via Veo API. Videos are mapped back to their scenes automatically.
6. Place audio (optional) — Drop TTS, dialogue, or SFX files with timecoded names; AutoFlowCut auto-tracks them in CapCut.
7. Select export media — For each scene, choose image, T2V video, or I2V video. Or let auto-mode pick the best available.
8. Export — Generates a complete project for CapCut, Adobe Premiere, or Vrew. Premiere and Vrew open automatically, ready to edit.


⚡ KEY FEATURES

- Two Generation Modes — Start free with a Google Flow login (beginner-friendly), or bring your own Gemini / Veo API key (BYOK) for fast, bulk, pay-as-you-go generation. Switch anytime from the top toggle.
- API Key Mode (BYOK) — Connect your own Gemini / Veo key for direct, login-free calls straight to Google — no web automation, as fast as your quota allows.
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
- One-Click Multi-Editor Export — Write a complete project — timeline, media, audio tracks, subtitles, and Ken Burns animations — for CapCut, Adobe Premiere (.prproj), or Vrew (.vrew). Premiere and Vrew launch automatically after export.
- Style Presets — Choose from 87 built-in style presets (anime, watercolor, cinematic, ink wash, etc.) to apply consistent visual styles across all scenes. Optional "Require Style" setting ensures a style is always selected before generation.
- Auto Tag Matching — Tag references once, and they match to scenes automatically for visual consistency.
- @ Reference Picker & Chips — Type @ in any prompt to pick a character, scene, or style reference from a menu; it drops in as an inline chip with a thumbnail and attaches to that generation. Works for images and Veo videos.
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

- AI Video Creators — Generate images AND videos with a free Google login or your own API key, then export everything to CapCut, Premiere, or Vrew in one click.
- Faceless YouTube Channels — Automate AI slideshow and narration video production with T2V/I2V support.
- AI Story Channels — Keep characters, backgrounds, and styles consistent across 200+ scenes. Use Story Engine v2 to produce full episodes from a single topic.
- Shorts & TikTok Creators — Quickly turn AI-generated scenes into short-form video projects.
- Educators & Course Creators — Turn scripts into illustrated video lessons with AI visuals and auto-placed narration.


💰 PRICING

AutoFlowCut is free and open source.

- All features are free — Export (CapCut, Adobe Premiere, or Vrew) is the only paid feature
- 5 free exports every month — refreshes monthly, no time limit
- 5 signup bonus credits when you create an account
- Pro: $4.99/month or $39.99/year (unlimited exports)
- Google Gemini/Veo API usage billed directly by Google per your own account quota
- Source code available on GitHub: github.com/touchizen/AutoFlowCut


📋 REQUIREMENTS

- A Google account for free Flow-login generation — or a Google AI Studio API key (free) for BYOK mode
- CapCut, Adobe Premiere, or Vrew (whichever you export to)
- Internet connection for AI generation
- Windows 10 or later


🔒 PRIVACY & SAFETY

This app runs entirely on your local machine. All AI generation calls go directly from your device to the Google Gemini/Veo API using your own API key — we never proxy, store, or transmit your images, videos, or prompts through our servers. Your API key is stored encrypted in the OS keychain and never sent anywhere except to Google's official API endpoint. For details, see our Privacy Policy at touchizen.com/en/privacy.


💬 SUPPORT

Questions or feedback? Contact us at gordon.ahn@touchizen.com
GitHub Issues: github.com/touchizen/AutoFlowCut/issues

Made by Touchizen — touchizen.com

Disclaimer: This app is an independent product developed by Touchizen and is not affiliated with, endorsed by, or sponsored by Google, ByteDance (CapCut), Adobe and VoyagerX
```

### What's New
```
v3.0.2 — Privacy fix. If you are on 3.0.1, please update.

3.0.1's error reporting was also sending your sign-in token, API key, prompts, character names, and folder paths. All of it is blocked now — we collect only which step failed. Sorry.

Also fixed: narrowing the Flow panel made the submit button unreachable; opening a dialog mid-generation pushed the Flow panel off-screen; and when Flow failed to open a project, the app blamed the Agent toggle.

v3.0.1 — Generation fix. In v3.0.0, image and video generation failed on every scene, and the error blamed the Flow Agent toggle. The toggle was never the cause — the released build broke the check itself. Fixed. AutoFlowCut now also notices when Flow shows its error screen instead of your project, and reloads it automatically.

v3.0.0 — Story mode. From a blank page to a finished video, without leaving the app.

Write the story. Let the AI draft your script (Claude or Codex) — pick a genre, auto-generate a title, and continue where you left off — or paste in your own. Still looking for a subject? Research YouTube topics and check their viral score first.

Synopsis, characters, and self-review. Pull a logline, hook, and story arc out of the script along with the full cast. The AI scores immersion and runs its own review-and-revise loop until the story holds up.

Scenes and voices. Split the script into scenes by sentence or duration, and re-split whenever you want. Assign a voice per speaker (Typecast, ElevenLabs, or Gemini), search and preview voices, apply emotion to character lines, and get a separate narration track for each speaker. Sound effects are lifted from the script and placed on scenes for you.

Run it all. Tick "auto" on the steps you trust, press Run all, and the pipeline carries itself to the end — then export to CapCut, Premiere, or Vrew in one click.

Also: characters register themselves as reference cards you can @mention into any scene, a new Grid view in the results panel, and a download that's about 110MB smaller.

v2.1.0 — Two ways to generate, three ways to export.

Generation modes. Start free with a Google Flow login (no API key needed), or switch to your own Gemini / Veo key for fast, pay-as-you-go bulk generation — toggle anytime from the top bar.

Multi-editor export. Export a complete project to CapCut, Adobe Premiere (.prproj), or Vrew (.vrew) in one click. Premiere and Vrew open automatically, ready to edit.

Reference picker & chips. Type @ in any prompt to pick a character, scene, or style reference from a menu — it drops in as an inline chip with a thumbnail and carries into that generation, for images and videos alike.

v1.1.3 — More reliable generation and clearer English labels. Image generation now handles older Flow aspect-ratio values correctly, preventing failed requests when switching scene formats. English auto-style labels now stay fully in English, so presets are easier to scan and choose.

v1.1.2 Store update — Updated the Microsoft Store package assets so Windows tiles and app listings use AutoFlowCut-branded icons instead of generic placeholder imagery.

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
AI video automation, text to video, image to video, batch AI generation, BYOK, Flow login, Premiere export, Vrew export, reference chips, video timeline, subtitles, SRT, audio sync, Ken Burns, story engine, MCP, open source
```

---

## 🇰🇷 한국어

### App Name
```
AutoFlowCut
```

### Short Description (100자 이내)
```
이미지·비디오를 대량 생성하고 CapCut·Premiere·Vrew 프로젝트로 원클릭 내보내기 — 무료 로그인 또는 내 API 키
```

### Description
```
200장짜리 AI 영상, 4시간 이상 걸리던 작업이, 클릭 한번 - 1분 안에 끝납니다.

생성 방식을 고르세요 — 구글 로그인으로 무료 시작하거나, 내 Gemini & Veo API 키로 최대 속도로. 대본만 불러오면 AutoFlowCut이 나머지를 처리합니다. 이미지·비디오를 일괄 생성하고, 실시간으로 결과를 확인하면서, 원클릭으로 타임라인·오디오·자막·Ken Burns 애니메이션이 모두 포함된 완성 프로젝트를 CapCut·Premiere·Vrew로 내보냅니다.

생성은 두 가지 방식, 내보내기는 세 가지, 번거로움은 제로.


🎬 AI 영상 제작 전체 파이프라인

AutoFlowCut은 대본부터 타임라인까지 전체 워크플로우를 커버합니다:

1. 프롬프트 가져오기 — TXT, CSV, SRT 파일에서 씬 프롬프트를 로드합니다.
2. 레퍼런스 설정 — 캐릭터·배경·스타일 레퍼런스를 태그로 매칭하거나, 프롬프트에서 @ picker로 골라 넣어 시각적 일관성을 유지합니다.
3. 이미지 생성 — Google Gemini API로 100장 이상의 AI 이미지를 일괄 생성. 에러 자동 재시도, 서버 성공·다운로드 실패 시 스마트 재다운로드.
4. 비디오 생성 — Veo API로 선택한 씬에 T2V(텍스트→비디오) 또는 I2V(이미지→비디오) 생성.
5. 미디어 선택 — 씬별로 이미지, T2V, I2V 중 최적의 미디어 선택. 자동 우선순위: I2V > T2V > 이미지.
6. 오디오 배치 — 타임코드 파일명을 가진 나레이션·대사·SFX 파일을 넣으면 CapCut의 별도 트랙에 자동 정렬.
7. 내보내기 — 원클릭으로 타임라인·미디어·오디오·자막·Ken Burns 애니메이션이 포함된 완성 프로젝트를 CapCut·Premiere·Vrew로 기록.


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

1. 생성 방식 선택 — 구글 로그인으로 무료 시작하거나, 설정에서 내 Gemini / Veo API 키를 입력해 더 빠른 종량제 생성 사용.
2. 프롬프트 준비 — 텍스트 입력, CSV 씬 데이터 가져오기, SRT 자막 파일 로드. 각 줄 또는 항목이 하나의 씬이 됩니다.
3. 레퍼런스 이미지 설정 — 레퍼런스(캐릭터·배경·스타일)에 태그를 붙여 씬에 자동 매칭하거나, 프롬프트에서 @를 입력해 골라 칩으로 넣기.
4. 이미지 생성 — Gemini API가 모든 씬에 걸쳐 일관된 비주얼을 생성. 이미지 자동 로컬 저장.
5. 비디오 생성 (선택) — 모션이 필요한 씬에 Veo API로 T2V 또는 I2V 비디오 생성. 해당 씬에 자동 매핑.
6. 오디오 배치 (선택) — 타임코드 파일명의 TTS/대사/SFX 파일을 넣으면 CapCut에 자동 트랙 배치.
7. 내보낼 미디어 선택 — 씬별로 이미지, T2V, I2V 중 선택. 자동 모드도 가능.
8. 내보내기 — CapCut·Premiere·Vrew용 완성 프로젝트를 생성. Premiere·Vrew는 자동으로 열려 바로 편집.


⚡ 주요 기능

- 두 가지 생성 모드 — 구글 Flow 로그인으로 무료 시작(초보자 친화)하거나, 내 Gemini / Veo API 키(BYOK)로 빠르게 대량·종량제 생성. 상단 토글로 언제든 전환.
- API 키 모드 (BYOK) — 내 Gemini / Veo 키로 Google에 직접 연결. 로그인·웹 자동화 없이 쿼터가 허용하는 한 최대 속도로.
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
- 원클릭 멀티 에디터 내보내기 — 타임라인·미디어·오디오 트랙·자막·Ken Burns 애니메이션이 담긴 완성 프로젝트를 CapCut·Adobe Premiere(.prproj)·Vrew(.vrew)로 기록. Premiere·Vrew는 내보내기 후 자동 실행.
- 스타일 프리셋 — 87가지 내장 스타일 프리셋(애니, 수채화, 시네마틱, 수묵화 등)으로 모든 씬에 일관된 비주얼 적용. '스타일 필수' 설정 가능.
- 자동 태그 매칭 — 레퍼런스에 태그를 한 번 붙이면 씬에 자동 매칭되어 시각적 일관성 유지.
- @ 레퍼런스 picker & 칩 — 프롬프트에서 @를 입력하면 캐릭터·장면·스타일 레퍼런스를 목록에서 골라 넣을 수 있고, 썸네일이 달린 인라인 칩으로 표시되어 해당 생성에 첨부됩니다. 이미지·Veo 비디오 공통.
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

- AI 영상 크리에이터 — 무료 구글 로그인 또는 내 API 키로 이미지·비디오를 모두 생성하고, 원클릭으로 CapCut·Premiere·Vrew로 내보내기.
- 얼굴 없는 YouTube 채널 — T2V/I2V 지원으로 AI 슬라이드쇼/나레이션 영상 제작 자동화.
- AI 스토리 채널 — 200개 이상의 씬에서도 캐릭터, 배경, 스타일 일관성 유지. Story Engine v2로 주제 하나에서 풀 에피소드 생산.
- 숏폼 & TikTok 크리에이터 — AI 생성 장면을 빠르게 숏폼 영상 프로젝트로 변환.
- 교육 콘텐츠 제작자 — 대본을 AI 비주얼 + 자동 배치 나레이션이 포함된 일러스트 영상 강의로 제작.


💰 가격

AutoFlowCut은 무료 오픈소스입니다.

- 모든 기능 무료 — 내보내기(CapCut·Premiere·Vrew)만 유료
- 매월 5회 무료 내보내기 — 매달 갱신, 기간 제한 없음
- 가입 보너스 5회 — 계정 생성 시 추가 크레딧 지급
- Pro: $4.99/월 또는 $39.99/년 (무제한 내보내기)
- Google Gemini/Veo API 사용량은 사용자 본인의 Google 계정 쿼터에 따라 Google에서 직접 청구
- 소스 코드: github.com/touchizen/AutoFlowCut


📋 필요 사항

- 무료 Flow 로그인 생성을 위한 구글 계정 — 또는 BYOK 모드용 Google AI Studio API 키 (무료)
- CapCut·Adobe Premiere·Vrew 중 내보낼 편집기
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
v3.0.2 — 프라이버시 수정. 3.0.1을 쓰고 계시다면 업데이트해 주세요.

3.0.1의 오류 리포팅이 로그인 토큰·API 키·프롬프트·캐릭터 이름·폴더 경로를 함께 전송하고 있었습니다. 전부 차단했습니다 — 이제 어느 단계가 실패했는지만 수집합니다. 죄송합니다.

그 밖의 수정: Flow 패널을 좁히면 제출 버튼을 누를 수 없던 문제, 생성 중 대화상자를 열면 Flow 패널이 화면 밖으로 밀려나던 문제, 프로젝트가 열리지 않았을 때 Agent 토글 탓으로 표시하던 문제를 고쳤습니다.

v3.0.1 — 생성 오류 수정. v3.0.0에서는 모든 씬에서 이미지·영상 생성이 실패했고, 오류 메시지는 Flow Agent 토글 탓으로 표시됐습니다. 토글은 원인이 아니었습니다 — 배포 빌드가 그 검사 자체를 깨뜨린 것이었습니다. 수정했습니다. 또한 Flow가 프로젝트 대신 오류 화면을 띄우면 이를 감지해 자동으로 다시 불러옵니다.

v3.0.0 — Story 모드. 빈 페이지에서 완성된 영상까지, 앱 하나로.

대본 쓰기. AI가 대본을 써줍니다(Claude · Codex) — 장르를 고르고, 제목을 자동 생성하고, 이어쓰기까지. 직접 쓴 대본을 붙여넣어도 됩니다. 소재가 아직 없다면 YouTube 리서치로 바이럴 지수와 상세 정보를 먼저 확인하세요.

시놉시스 · 등장인물 · 자체 검수. 대본에서 로그라인, 훅, 기승전결과 등장인물을 통째로 뽑아냅니다. AI가 몰입도 점수를 매기고, 스스로 검토·수정하는 루프를 돌려 완성도를 끌어올립니다.

씬 분리와 성우. 문장 단위 또는 시간 단위로 씬을 자동 분리하고, 마음에 안 들면 언제든 다시 분리하세요. 화자별로 성우를 따로 지정하고(Typecast · ElevenLabs · Gemini), 검색·미리듣기로 고르고, 캐릭터 대사에는 감정을 반영합니다. 화자마다 나레이션 트랙이 분리되고, 효과음도 대본에서 자동으로 뽑아 씬에 배치합니다.

전체 자동 실행. 믿고 맡길 스텝에 '자동'을 켜고 '전체 진행'을 누르면 파이프라인이 끝까지 알아서 돕니다 — 완성되면 CapCut · Premiere · Vrew로 한 번에 내보내기.

그 밖에: 대본 속 인물이 레퍼런스 카드로 자동 등록되어 @멘션으로 씬에 넣을 수 있고, 결과 패널에 그리드 보기가 추가됐으며, 다운로드 용량이 약 110MB 줄었습니다.

v2.1.0 — 생성은 두 가지 방식, 내보내기는 세 가지.

생성 모드. 구글 Flow 로그인으로 무료 시작(API 키 불필요)하거나, 내 Gemini / Veo 키로 빠른 종량제 대량 생성으로 전환 — 상단 바에서 언제든 토글.

멀티 에디터 내보내기. 완성 프로젝트를 CapCut·Adobe Premiere(.prproj)·Vrew(.vrew)로 원클릭 내보내기. Premiere·Vrew는 자동으로 열려 바로 편집.

레퍼런스 picker & 칩. 프롬프트에서 @를 입력해 캐릭터·장면·스타일 레퍼런스를 목록에서 선택 — 썸네일이 달린 인라인 칩으로 삽입되어 이미지·비디오 생성에 함께 반영됩니다.

v1.1.3 — 생성 안정성과 영어 UI 라벨을 개선했습니다. 예전 Flow 화면비 값이 남아 있어도 이미지 생성 요청이 올바르게 처리되어 장면 포맷을 바꿀 때 실패가 줄어듭니다. 영어 UI의 자동 스타일 라벨도 영어로 일관되게 표시되어 프리셋을 더 쉽게 고를 수 있습니다.

v1.1.2 Store 업데이트 — Windows 타일과 앱 목록에서 기본 자리표시자 이미지가 아닌 AutoFlowCut 브랜드 아이콘이 표시되도록 Microsoft Store 패키지 자산을 수정했습니다.

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
AI 영상 자동화, 텍스트투비디오, 이미지투비디오, AI 이미지 생성, 일괄 생성, BYOK, Flow 로그인, Premiere 내보내기, Vrew 내보내기, 레퍼런스 칩, 영상 타임라인, 자막, SRT, 오디오 싱크, Ken Burns, AI 스토리텔링, Story Engine, MCP, 오픈소스
```

---

## 🇯🇵 日本語

### Short Description
```
画像・動画を一括生成し、CapCut・Premiere・Vrewプロジェクトへワンクリックでエクスポート — 無料ログインまたは自分のAPIキー
```

### Description
```
200シーンのAI動画、丸一日かかっていた作業が1時間以内に終わります。

生成方法を選べます — Googleログインで無料スタート、または自分のGemini & Veo APIキーで最速に。スクリプトを読み込めば、あとはAutoFlowCutが自動処理。画像・動画を一括生成し、リアルタイムで結果を確認しながら、タイムライン・音声・字幕・Ken Burnsアニメーション込みの完成プロジェクトをCapCut・Adobe Premiere・Vrewへワンクリックでエクスポート。

生成は2通り、エクスポートは3通り、手間はゼロ。


⚡ 主な機能

- 2つの生成モード — Google Flowログインで無料スタート（初心者向け）、または自分のGemini / Veo APIキー（BYOK）で高速・大量・従量制の生成。上部トグルでいつでも切替
- API接続（BYOK） — 自分のGemini / Veoキーでログイン不要の直接接続。ウェブ自動化なし、クォータの許す限り最速で
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
- ワンクリック・マルチエディターエクスポート — タイムライン・メディア・音声・字幕・Ken Burnsアニメーション込みの完成プロジェクトをCapCut・Adobe Premiere（.prproj）・Vrew（.vrew）へ書き出し。Premiere・Vrewはエクスポート後に自動起動
- スタイルプリセット — 87種類の内蔵スタイルプリセット（アニメ、水彩画、シネマティックなど）
- 自動タグマッチング — キャラクター、背景、スタイルの視覚的一貫性を維持
- @リファレンスピッカー & チップ — プロンプトで@を入力してキャラクター・シーン・スタイルのリファレンスをメニューから選択。サムネイル付きインラインチップとして挿入され、その生成に添付（画像・Veo動画共通）
- リアルタイム進捗バナー — アプリ全体で生成状態をリアルタイム表示
- Story Engine v2 — 9-Wave自動パイプライン（スクリプト → TTS → ストーリーボード → 画像 → CapCut → アップロードメタデータ）
- MCPサーバー（Claude Code連携） — 内蔵MCPサーバーでClaude Codeからシーン、プロンプト、リファレンスを直接編集・生成トリガー可能
- 100%無料＆オープンソース


🎙️ STORY ENGINE v2

内蔵のStory Engine v2は、1つのトピックから完成した動画制作を9-Wave自動パイプラインで生成します：スクリプト設計、20章シノプシス、5パートスクリプト執筆（自動レビュー）、TTS/SFX生成、ストーリーボード作成、画像生成（W7）、CapCutアセンブリ（W8）、YouTubeアップロードメタデータ（W9）まで。日本語のサポートは進行中です。


🤖 Claude Code連携
内蔵MCP（Model Context Protocol）サーバーにより、Claude Codeから動画制作ワークフローを自動化できます。プロンプトの一括編集、リファレンス管理、画像・動画生成のトリガー、カスタムスキルのインストール、STATE.mdベースのワークフロー状態管理が可能です。


💰 価格
- 全機能無料 — エクスポート（CapCut・Premiere・Vrew）のみ有料
- 毎月5回の無料エクスポート — 月次リフレッシュ、期間制限なし
- 登録ボーナス5回 — アカウント作成時に追加クレジット
- Pro: $4.99/月 または $39.99/年（無制限）
- Google Gemini/Veo API利用料はご自身のGoogleアカウントのクォータに従いGoogleに直接請求
- ソースコード: github.com/touchizen/AutoFlowCut


📋 必要環境: 無料Flowログイン生成用のGoogleアカウント（またはBYOK用のGoogle AI Studio APIキー・無料）、CapCut・Adobe Premiere・Vrewのいずれか、インターネット接続、Windows 10以降

💬 サポート: gordon.ahn@touchizen.com
```

### What's New
```
v3.0.2 — プライバシーの修正。3.0.1をお使いの方は、アップデートしてください。

3.0.1のエラーレポートが、ログイントークン・APIキー・プロンプト・キャラクター名・フォルダーパスも一緒に送信していました。すべて遮断しました — 現在はどのステップで失敗したかのみを収集します。申し訳ありません。

その他の修正：Flowパネルを狭めると送信ボタンが押せなくなる問題、生成中にダイアログを開くとFlowパネルが画面外へ押し出される問題、プロジェクトが開けなかったときにAgentトグルのせいだと表示していた問題。

v3.0.1 — 生成の不具合を修正。v3.0.0では、すべてのシーンで画像・動画の生成が失敗し、エラーはFlow Agentトグルのせいだと表示していました。トグルは原因ではなく、リリースビルドがそのチェック自体を壊していました。修正済みです。また、Flowがプロジェクトの代わりにエラー画面を表示した場合、それを検知して自動的に再読み込みします。

v3.0.0 — Storyモード。白紙から完成した動画まで、アプリひとつで。

脚本を書く。AIが脚本を書きます（Claude・Codex）— ジャンルを選び、タイトルを自動生成し、続きから書き足せます。自分で書いた脚本の貼り付けも可能。題材が決まっていなければ、YouTubeリサーチでバイラル指数と詳細を先に確認できます。

シノプシス・登場人物・自己レビュー。脚本からログライン、フック、起承転結と登場人物をまとめて抽出します。AIが没入度をスコア化し、自ら推敲・修正するループを回して完成度を高めます。

シーン分割と音声。文単位または時間単位でシーンを自動分割し、気に入らなければ何度でも再分割できます。話者ごとに音声を指定でき（Typecast・ElevenLabs・Gemini）、検索とプレビューで選び、キャラクターのセリフには感情を反映します。話者ごとにナレーショントラックが分かれ、効果音も脚本から自動抽出してシーンに配置します。

まとめて実行。任せたいステップに「自動」を入れて「全実行」を押せば、パイプラインが最後まで進みます — 完成したらCapCut・Premiere・Vrewへワンクリックで書き出し。

その他：脚本の登場人物がリファレンスカードとして自動登録され、@メンションでシーンに指定できます。結果パネルにグリッド表示を追加。ダウンロードサイズが約110MB軽くなりました。

v2.1.0 — 生成は2通り、エクスポートは3通り。

生成モード。Google Flowログインで無料スタート（APIキー不要）、または自分のGemini / Veoキーで高速・従量制の大量生成に切替 — 上部バーでいつでもトグル。

マルチエディターエクスポート。完成プロジェクトをCapCut・Adobe Premiere（.prproj）・Vrew（.vrew）へワンクリックでエクスポート。Premiere・Vrewは自動で開いてすぐ編集。

リファレンスピッカー & チップ。プロンプトで@を入力してキャラクター・シーン・スタイルのリファレンスを選択 — サムネイル付きインラインチップとして挿入され、画像・動画の生成に反映されます。

v1.1.3 — 生成の安定性と英語UIのラベルを改善しました。古いFlow形式のアスペクト比が残っていても画像生成リクエストが正しく処理され、シーン形式を切り替えたときの失敗が減ります。英語UIの自動スタイルラベルも英語で統一され、プリセットを選びやすくなりました。

v1.1.2 Store update — Microsoft Storeパッケージのアセットを更新し、Windowsタイルとアプリ一覧で汎用プレースホルダーではなくAutoFlowCutブランドのアイコンが表示されるようにしました。

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
KI-Bilder und -Videos generieren und per Klick nach CapCut, Premiere & Vrew exportieren — Gratis-Login oder eigener API-Schlüssel.
```

### Description
```
Ein KI-Video mit 200 Szenen dauerte früher einen ganzen Tag. Mit AutoFlowCut schaffen Sie es in unter einer Stunde.

Wählen Sie, wie Sie generieren — gratis starten mit einem Google-Login oder mit Ihrem eigenen Gemini & Veo API-Schlüssel für maximale Geschwindigkeit. Skript laden, den Rest erledigt AutoFlowCut: Bilder und Videos im Stapel generieren, Ergebnisse in Echtzeit verfolgen und mit einem Klick ein vollständiges Projekt — Timeline, Audio, Untertitel und Ken Burns-Animationen — nach CapCut, Adobe Premiere oder Vrew exportieren.

Zwei Wege zu generieren, drei Wege zu exportieren, null Aufwand.


⚡ HAUPTFUNKTIONEN

- Zwei Generierungsmodi — Gratis starten mit einem Google-Flow-Login (anfängerfreundlich) oder mit eigenem Gemini / Veo API-Schlüssel (BYOK) für schnelle, stapelweise, nutzungsbasierte Generierung. Jederzeit über den oberen Umschalter wechseln
- API-Modus (BYOK) — Eigener Gemini / Veo-Schlüssel für direkte, login-freie Aufrufe zu Google — keine Web-Automatisierung, so schnell wie Ihr Kontingent es erlaubt
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
- Ein-Klick Multi-Editor-Export — Vollständiges Projekt (Timeline, Medien, Audio, Untertitel, Ken Burns-Animationen) für CapCut, Adobe Premiere (.prproj) oder Vrew (.vrew). Premiere und Vrew starten nach dem Export automatisch
- Stil-Presets — 87 integrierte Stil-Presets (Anime, Aquarell, Cinematic usw.)
- Automatisches Tag-Matching — Visuelle Konsistenz über alle Szenen
- @-Referenz-Picker & Chips — Tippen Sie @ in einem Prompt, um eine Charakter-, Szenen- oder Stilreferenz aus einem Menü zu wählen; sie wird als Inline-Chip mit Vorschaubild eingefügt und dieser Generierung angehängt (Bilder und Veo-Videos)
- Live-Fortschrittsbanner — Echtzeit-Generierungsstatus über die gesamte App
- Story Engine v2 — 9-Wave automatisierte Pipeline (Skript → TTS → Storyboard → Bilder → CapCut → Upload-Metadaten)
- MCP-Server (Claude Code) — Integrierter MCP-Server für direkte Bearbeitung und Generierungssteuerung über Claude Code
- 100% kostenlos & Open Source


🎙️ STORY ENGINE v2

Die integrierte Story Engine v2 verwandelt ein einzelnes Thema in eine komplette Videoproduktion über eine 9-Wave-automatisierte Pipeline: Story-Design, 20-Kapitel-Synopsis, 5-Akt-Skript mit automatischer Überprüfung, TTS/SFX-Generierung, Storyboard, Bilderzeugung (W7), CapCut-Assembly (W8) und YouTube-Metadaten (W9). Deutsche Sprachunterstützung in Entwicklung.


🤖 Claude Code Integration
Der integrierte MCP-Server (Model Context Protocol) verbindet sich direkt mit Claude Code. Automatisieren Sie Ihren gesamten Videoproduktions-Workflow mit KI-Codierungsassistenten.


💰 Preise
- Alle Funktionen kostenlos — nur der Export (CapCut, Adobe Premiere oder Vrew) ist kostenpflichtig
- 5 kostenlose Exporte pro Monat — monatliche Erneuerung, keine Zeitbeschränkung
- 5 Bonus-Credits bei Anmeldung — zusätzliches Guthaben bei Kontoerstellung
- Pro: 4,99 $/Monat oder 39,99 $/Jahr (unbegrenzt)
- Google Gemini/Veo API-Nutzung wird direkt von Google gemäß Ihrem eigenen Kontokontingent abgerechnet
- Quellcode: github.com/touchizen/AutoFlowCut


📋 Voraussetzungen: Google-Konto für die kostenlose Flow-Login-Generierung (oder Google AI Studio API-Schlüssel für den BYOK-Modus, kostenlos), CapCut, Adobe Premiere oder Vrew, Internetverbindung, Windows 10+

💬 Support: gordon.ahn@touchizen.com
```

### What's New
```
v3.0.2 — Datenschutz-Fix. Wenn Sie 3.0.1 verwenden, aktualisieren Sie bitte.

Die Fehlerberichte in 3.0.1 haben auch Ihr Anmelde-Token, Ihren API-Schlüssel, Prompts, Charakternamen und Ordnerpfade mitgesendet. All das ist jetzt blockiert — wir erfassen nur noch, welcher Schritt fehlgeschlagen ist. Entschuldigung.

Außerdem behoben: Beim Verschmälern des Flow-Panels war die Senden-Schaltfläche nicht mehr erreichbar; ein während der Generierung geöffneter Dialog schob das Flow-Panel aus dem Bild; und wenn Flow ein Projekt nicht öffnen konnte, gab die App dem Agent-Umschalter die Schuld.

v3.0.1 — Generierungsfehler behoben. In v3.0.0 schlug die Bild- und Videogenerierung in jeder Szene fehl, und die Fehlermeldung machte den Flow-Agent-Umschalter dafür verantwortlich. Der Umschalter war nie die Ursache — der ausgelieferte Build hatte die Prüfung selbst beschädigt. Behoben. AutoFlowCut erkennt jetzt außerdem, wenn Flow statt Ihres Projekts einen Fehlerbildschirm anzeigt, und lädt es automatisch neu.

v3.0.0 — Story-Modus. Vom leeren Blatt zum fertigen Video, ohne die App zu verlassen.

Die Geschichte schreiben. Lassen Sie die KI Ihr Skript entwerfen (Claude oder Codex) — Genre wählen, Titel automatisch generieren, dort weitermachen, wo Sie aufgehört haben — oder fügen Sie Ihr eigenes Skript ein. Noch kein Thema? Recherchieren Sie YouTube-Themen und prüfen Sie vorab deren Viral-Score.

Synopsis, Charaktere und Selbstprüfung. Logline, Hook und Handlungsbogen werden samt vollständiger Besetzung aus dem Skript herausgezogen. Die KI bewertet die Immersion und durchläuft eine eigene Prüf- und Überarbeitungsschleife, bis die Geschichte trägt.

Szenen und Stimmen. Teilen Sie das Skript satzweise oder nach Dauer in Szenen auf — und jederzeit neu auf. Weisen Sie jeder Sprecherrolle eine Stimme zu (Typecast, ElevenLabs oder Gemini), suchen und probehören Sie Stimmen, versehen Sie Charakterdialoge mit Emotionen und erhalten Sie pro Sprecher eine eigene Erzählspur. Soundeffekte werden aus dem Skript übernommen und für Sie auf den Szenen platziert.

Alles laufen lassen. Setzen Sie „Auto" bei den Schritten, denen Sie vertrauen, drücken Sie „Alle ausführen", und die Pipeline läuft bis zum Ende durch — anschließend mit einem Klick nach CapCut, Premiere oder Vrew exportieren.

Außerdem: Charaktere registrieren sich selbst als Referenzkarten, die Sie per @Mention in jede Szene einfügen können, eine neue Rasteransicht im Ergebnisbereich und ein rund 110 MB kleinerer Download.

v2.1.0 — Zwei Wege zu generieren, drei Wege zu exportieren.

Generierungsmodi. Gratis starten mit einem Google-Flow-Login (kein API-Schlüssel nötig) oder zu Ihrem eigenen Gemini / Veo-Schlüssel für schnelle, nutzungsbasierte Stapelgenerierung wechseln — jederzeit über die obere Leiste umschalten.

Multi-Editor-Export. Vollständiges Projekt nach CapCut, Adobe Premiere (.prproj) oder Vrew (.vrew) mit einem Klick exportieren. Premiere und Vrew öffnen sich automatisch, bereit zum Bearbeiten.

Referenz-Picker & Chips. Tippen Sie @ in einem Prompt, um eine Charakter-, Szenen- oder Stilreferenz aus einem Menü zu wählen — sie wird als Inline-Chip mit Vorschaubild eingefügt und fließt in die Generierung ein, für Bilder und Videos.

v1.1.3 — Zuverlässigere Generierung und klarere englische UI-Beschriftungen. Die Bildgenerierung verarbeitet ältere Flow-Seitenverhältniswerte jetzt korrekt, sodass beim Wechseln von Szenenformaten weniger Anfragen fehlschlagen. Englische Auto-Style-Labels bleiben nun vollständig auf Englisch, damit Presets leichter zu überblicken sind.

v1.1.2 Store-Update — Die Microsoft Store-Paketassets wurden aktualisiert, damit Windows-Kacheln und App-Listen AutoFlowCut-Branding statt generischer Platzhalterbilder verwenden.

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
