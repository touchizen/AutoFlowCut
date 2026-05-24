# AutoFlowCut — Microsoft Store Listing (v0.9.12)

---

## 🇺🇸 ENGLISH

### App Name
```
AutoFlowCut
```

### Short Description (100 chars)
```
Bulk-generate AI images & videos with Google Flow (Veo); export full CapCut projects in one click.
```

### Description
```
Still creating AI videos one scene at a time?

AutoFlowCut takes Google Flow (Veo) AI image and video generation all the way to a ready-to-edit CapCut project — batch-generate 100+ visuals, then export to CapCut in one click. Full AI-video automation, from Flow to CapCut.

Import your script, generate visuals, place narration and SFX automatically, select the best media per scene, and export everything with one click.


🎬 COMPLETE AI VIDEO PIPELINE

AutoFlowCut covers the full workflow from script to timeline:

1. Import prompts — Load scene prompts from TXT, CSV, or SRT files.
2. Set references — Match character, background, and style references by tags for visual consistency.
3. Generate images — Batch-create 100+ AI images with Google Flow AI. Auto-retry on errors, with smart re-download for server-success/client-fail cases.
4. Generate videos — Create T2V (Text-to-Video) or I2V (Image-to-Video) for selected scenes.
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

1. Prepare prompts — Type text, import CSV scene data, or load SRT subtitles. Each line or entry becomes a scene.
2. Set reference images — Tag your reference images (character, background, style) and they auto-match to scenes.
3. Generate images — Google Flow AI creates consistent visuals across all scenes. Images auto-save locally.
4. Generate videos (optional) — Select scenes for T2V or I2V video generation. Videos are mapped back to their scenes automatically.
5. Place audio (optional) — Drop TTS, dialogue, or SFX files with timecoded names; AutoFlowCut auto-tracks them in CapCut.
6. Select export media — For each scene, choose image, T2V video, or I2V video. Or let auto-mode pick the best available.
7. Export to CapCut — Generates a complete CapCut project. Open in CapCut and start editing immediately.


⚡ KEY FEATURES

- Google Flow AI Integration — Access Flow AI directly inside the app via built-in browser. No Chrome extension required.
- Batch Image Generation — Create 100+ images in minutes with reference-based style matching. Auto-retry on errors.
- Smart Video Retry — When videos succeed on the server but fail to download, AutoFlowCut detects this and re-downloads instead of regenerating, saving credits and time.
- T2V Video Generation — Generate Text-to-Video clips for scenes that need motion.
- I2V Video Generation — Generate Image-to-Video clips from your existing scene images.
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

- AI Video Creators — Generate images AND videos, then export everything to CapCut in one click.
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
- Google Flow AI usage is free during the experimental phase
- Source code available on GitHub: github.com/touchizen/AutoFlowCut


📋 REQUIREMENTS

- Google account (for Google Flow AI access)
- CapCut desktop app (free version works)
- Internet connection for AI generation
- Windows 10 or later


🔒 PRIVACY & SAFETY

This app runs entirely on your local machine. All AI generation is handled by Google Flow AI (labs.google) — we never process, store, or transmit your images or videos through our servers. For details, see our Privacy Policy at touchizen.com/en/privacy.


💬 SUPPORT

Questions or feedback? Contact us at gordon.ahn@touchizen.com
GitHub Issues: github.com/touchizen/AutoFlowCut/issues

Made by Touchizen — touchizen.com

Disclaimer: This app is an independent product developed by Touchizen and is not affiliated with, endorsed by, or sponsored by Google or ByteDance (CapCut).
```

### What's New
```
v0.9.12 — Token-expiry auto-refresh + Regenerate All + sticky scene rows

- 1-hour batch deaths fixed: Google's access token (~1 h) is now refreshed silently in the background — no prompt, no restart, no lost work. Covers images, T2V/I2V, upscale, gallery, and status polling.
- Regenerate All: split-menu on the generate button re-runs every item in the current view (images / videos / F→V) at once.
- Scene rows stay attached to their content: F→V rows are now permanently bound to their scene. Reorder, delete, or import a new SRT — rows and videos stay with the right scene.
- Scene count auto-adjusts to the largest of images / videos / F→V / SRT. Trailing empty scenes get cleaned up.
- Delete preview: shows image, subtitle, prompt, and generated T2V/I2V before you confirm.
- F→V "Add Row" creates scene + row together (instant feedback).
- Stops immediately on out_of_credits instead of failing every remaining scene.
- Import cleanup: CSV keeps row positions with blanks; video CSV accepts prompt_en aliases; SRT no longer overwrites prompts.
- i18n polish, IPC listener memory-leak fix, T2V clear now empties the scene.
```

### Keywords
```
Google Flow, Flow to CapCut, CapCut export, AI video to CapCut, Veo to CapCut, video automation, text to video
```

---

## 🇰🇷 한국어

### App Name
```
AutoFlowCut
```

### Short Description (100자 이내)
```
Google Flow(Veo)로 이미지·비디오를 대량 생성하고 CapCut 프로젝트로 원클릭 내보내기하는 데스크톱 앱
```

### Description
```
AI 영상, 아직도 한 장면씩 만들고 계신가요?

AutoFlowCut은 Google Flow(Veo)의 AI 이미지·비디오 생성을 바로 편집 가능한 CapCut 프로젝트까지 한 번에 이어줍니다 — 100장 이상의 비주얼을 일괄 생성하고 원클릭으로 CapCut에 내보내세요. Flow에서 CapCut까지, AI 영상 제작 전 과정 자동화.

대본을 가져오고, 비주얼을 생성하고, 나레이션·효과음을 자동 배치하고, 씬별 최적 미디어를 선택하고, 원클릭으로 내보내세요.


🎬 AI 영상 제작 전체 파이프라인

AutoFlowCut은 대본부터 타임라인까지 전체 워크플로우를 커버합니다:

1. 프롬프트 가져오기 — TXT, CSV, SRT 파일에서 씬 프롬프트를 로드합니다.
2. 레퍼런스 설정 — 캐릭터, 배경, 스타일 레퍼런스를 태그별로 매칭하여 시각적 일관성을 유지합니다.
3. 이미지 생성 — Google Flow AI로 100장 이상의 AI 이미지를 일괄 생성. 에러 자동 재시도, 서버 성공·다운로드 실패 시 스마트 재다운로드.
4. 비디오 생성 — 선택한 씬에 T2V(텍스트→비디오) 또는 I2V(이미지→비디오) 생성.
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

1. 프롬프트 준비 — 텍스트 입력, CSV 씬 데이터 가져오기, SRT 자막 파일 로드. 각 줄 또는 항목이 하나의 씬이 됩니다.
2. 레퍼런스 이미지 설정 — 레퍼런스 이미지에 태그를 붙이면 씬에 자동 매칭됩니다.
3. 이미지 생성 — Google Flow AI가 모든 씬에 걸쳐 일관된 비주얼을 생성. 이미지 자동 로컬 저장.
4. 비디오 생성 (선택) — 모션이 필요한 씬에 T2V 또는 I2V 비디오를 생성. 비디오가 해당 씬에 자동 매핑.
5. 오디오 배치 (선택) — 타임코드 파일명의 TTS/대사/SFX 파일을 넣으면 CapCut에 자동 트랙 배치.
6. 내보낼 미디어 선택 — 씬별로 이미지, T2V, I2V 중 선택. 자동 모드도 가능.
7. CapCut 내보내기 — CapCut 프로젝트를 생성. 바로 CapCut에서 열어 편집을 시작하세요.


⚡ 주요 기능

- Google Flow AI 통합 — 내장 브라우저로 앱 안에서 바로 Flow AI 접근. Chrome 확장 불필요.
- 일괄 이미지 생성 — 레퍼런스 기반 스타일 매칭으로 수 분 내에 100장 이상 생성. 에러 자동 재시도.
- 스마트 비디오 재시도 — 서버 성공·클라이언트 다운로드 실패 시 재생성 없이 다운로드만 다시 수행, 크레딧과 시간 절약.
- T2V 비디오 생성 — 모션이 필요한 씬에 텍스트에서 비디오 클립 생성.
- I2V 비디오 생성 — 기존 씬 이미지에서 이미지→비디오 클립 생성.
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

- AI 영상 크리에이터 — 이미지와 비디오를 모두 생성하고, 원클릭으로 CapCut 프로젝트로 내보내기.
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
- Google Flow AI 사용은 실험 단계에서 무료
- 소스 코드: github.com/touchizen/AutoFlowCut


📋 필요 사항

- Google 계정 (Google Flow AI 접근용)
- CapCut 데스크톱 앱 (무료 버전 가능)
- AI 생성을 위한 인터넷 연결
- Windows 10 이상


🔒 개인정보 및 안전

본 앱은 전적으로 사용자의 로컬 PC에서 작동합니다. 모든 AI 생성은 Google Flow AI(labs.google)에서 처리되며, 당사 서버를 통해 이미지나 비디오를 처리, 저장 또는 전송하지 않습니다. 자세한 내용은 touchizen.com/ko/privacy에서 확인하세요.


💬 지원

질문이나 피드백은 gordon.ahn@touchizen.com으로 문의해주세요.
GitHub Issues: github.com/touchizen/AutoFlowCut/issues

Touchizen 제작 — touchizen.com

면책 조항: 이 앱은 Touchizen에서 개발한 독립적인 제품이며, Google 또는 ByteDance(CapCut)와 제휴, 보증 또는 후원 관계가 없습니다.
```

### What's New (새로운 기능)
```
v0.9.12 — 토큰 만료 자동 갱신 + 전체 재생성 + 안 떨어지는 씬 행

- 1시간 배치 끊김 해결: Google 액세스 토큰(약 1시간)을 백그라운드에서 조용히 갱신합니다 — 팝업·재시작·작업 손실 없음. 이미지/T2V/I2V/업스케일/갤러리/상태 폴링까지 모두 포함.
- 전체 재생성(Regenerate All): 생성 버튼에 분할 메뉴 추가 — 현재 뷰의 모든 항목(이미지/비디오/F→V)을 한 번에 재생성.
- 씬 행이 콘텐츠에 묶입니다: F→V 행은 생성된 씬에 영구 바인딩. 순서 변경·삭제·새 SRT 임포트해도 행과 비디오가 올바른 씬에 그대로 남습니다.
- 씬 개수 자동 조정: 이미지/비디오/F→V/SRT 중 최대값에 맞춰 늘어나고, 뒤쪽 빈 씬은 자동 정리.
- 삭제 미리보기: 확정 전에 이미지·자막·프롬프트·생성된 T2V/I2V를 함께 표시.
- F→V "Add Row"가 씬+행을 함께 생성 (즉시 피드백).
- out_of_credits 응답 시 남은 씬에서 줄줄이 실패하지 않고 배치를 즉시 정지.
- 임포트 정리: CSV가 빈 행에서도 행 위치 유지, 비디오 CSV는 prompt_en 등 컬럼 별칭 인식, SRT가 프롬프트를 덮어쓰지 않음.
- i18n 다듬기, 장시간 세션 IPC 메모리 누수 수정, T2V 클리어가 씬을 실제로 비웁니다.
```

### Keywords (한국어)
```
AI 영상, CapCut, Google Flow, 텍스트투비디오, 이미지투비디오, AI 이미지 생성, 영상 자동화, 대량 생성, Ken Burns, 자막, SRT, 얼굴없는 유튜브, AI 스토리텔링, Story Engine, MCP, Claude Code, 오픈소스
```

---

## 🇯🇵 日本語

### Short Description
```
Google Flow（Veo）で画像・動画を生成し、CapCutプロジェクトをワンクリックでエクスポートするデスクトップアプリ
```

### Description
```
AI動画、まだ1シーンずつ作っていますか？

AutoFlowCutは、Google Flow（Veo）のAI画像・動画生成を、すぐに編集できるCapCutプロジェクトまで一気につなぎます。100枚以上のビジュアルを一括生成し、ワンクリックでCapCutにエクスポート。FlowからCapCutまで、AI動画制作の全プロセスを自動化。

スクリプトをインポートし、ビジュアルを生成し、ナレーションとSFXを自動配置、シーンごとに最適なメディアを選択して、ワンクリックでエクスポート。


⚡ 主な機能

- Google Flow AI統合 — 内蔵ブラウザでアプリ内からFlow AIに直接アクセス
- 一括画像生成 — リファレンスベースのスタイルマッチングで100枚以上を数分で生成
- スマート動画リトライ — サーバー成功・ダウンロード失敗時に再生成せず再ダウンロードのみ実行
- T2V動画生成 — テキストから動画クリップを生成
- I2V動画生成 — 画像から動画クリップを生成
- シーン別メディア選択 — 画像、T2V、I2Vから選択。スマート自動モード搭載
- 音声自動配置 — タイムコード付きファイル名のナレーション、セリフ、SFXをCapCutの別トラックに自動配置
- AudioTimeline（マルチトラック・プレビュー） — Remotionスタイルのタイムラインビューで全オーディオトラックを一覧表示。トラックサイズ変更、リッチツールチップ、ズーム変更後も常に見えるプレイヘッド。エクスポート前にオーディオミックス全体をプレビュー
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
- ソースコード: github.com/touchizen/AutoFlowCut


📋 必要環境: Googleアカウント、CapCutデスクトップアプリ、インターネット接続、Windows 10以降

💬 サポート: gordon.ahn@touchizen.com
```

### What's New
```
v0.9.12 — トークン期限切れ自動更新 + 全件再生成 + ズレないシーン行

- 1時間バッチ落ち解消：Google アクセストークン（約1時間）をバックグラウンドで静かに更新 — ポップアップ・再起動・作業損失なし。画像/T2V/I2V/アップスケール/ギャラリー/ステータスに対応。
- 全件再生成（Regenerate All）：生成ボタンの分割メニューで現在のビュー（画像/動画/F→V）の全項目を一度に再生成。
- シーン行がコンテンツに紐づいたまま：F→V 行は生成元シーンに恒久バインド。並べ替え・削除・新しい SRT 取り込みでも行と動画が正しいシーンに残ります。
- シーン数の自動調整：画像/動画/F→V/SRT の最大値に合わせて伸び、末尾の空シーンは自動整理。
- プレビュー付き削除確認：確定前に画像・字幕・プロンプト・生成済み T2V/I2V を表示。
- F→V「Add Row」がシーン+行を同時生成（即時反映）。
- out_of_credits で残り全シーン失敗ではなくバッチを即停止。
- インポート整理：CSV は空行があっても行位置を保持、動画 CSV は prompt_en などの列エイリアスを認識、SRT がプロンプトを上書きしない。
- i18n の磨き直し、長時間セッションでの IPC メモリリーク修正、T2V クリアがシーンを実際に空に。
```

---

## 🇩🇪 DEUTSCH

### Short Description
```
KI-Bilder und -Videos mit Google Flow (Veo) generieren und CapCut-Projekte mit einem Klick exportieren.
```

### Description
```
Erstellen Sie Ihre KI-Videos immer noch Szene für Szene?

AutoFlowCut bringt die KI-Bild- und Videogenerierung von Google Flow (Veo) bis zum fertigen, bearbeitbaren CapCut-Projekt — generieren Sie 100+ Visuals im Stapel und exportieren Sie sie mit einem Klick nach CapCut. Komplette KI-Video-Automatisierung, von Flow zu CapCut.

Importieren Sie Ihr Skript, generieren Sie Visuals, lassen Sie Narration und SFX automatisch platzieren, wählen Sie das beste Medium pro Szene und exportieren Sie alles mit einem Klick.


⚡ HAUPTFUNKTIONEN

- Google Flow AI Integration — Zugriff direkt in der App über integrierten Browser
- Stapelweise Bildgenerierung — 100+ Bilder in Minuten mit referenzbasiertem Style-Matching
- Smart Video Retry — Bei Server-Erfolg/Download-Fehler wird nur erneut heruntergeladen, ohne neu zu generieren
- T2V-Videogenerierung — Text-to-Video-Clips für dynamische Szenen
- I2V-Videogenerierung — Image-to-Video-Clips aus Szenenbildern
- Medienauswahl pro Szene — Bild, T2V oder I2V pro Szene wählen. Smart-Auto-Modus verfügbar
- Audio-Auto-Platzierung — Narration, Dialog und SFX mit Timecode-Dateinamen werden automatisch auf separaten CapCut-Tracks platziert
- AudioTimeline (Multi-Track-Vorschau) — Remotion-Stil Timeline-Ansicht aller Audio-Tracks mit größenanpassbaren Zeilen, Rich-Tooltips und einem Playhead, der bei Zoom-Änderungen sichtbar bleibt. Vorschau des gesamten Audio-Mixes vor dem Export
- Ein-Klick CapCut-Export — Timeline, Medien, Audio, Untertitel und Ken Burns-Animationen
- Stil-Presets — 87 integrierte Stil-Presets (Anime, Aquarell, Cinematic usw.) für einheitliche visuelle Stile
- Automatisches Tag-Matching — Visuelle Konsistenz über alle Szenen
- Live-Fortschrittsbanner — Echtzeit-Generierungsstatus über die gesamte App
- Story Engine v2 — 9-Wave automatisierte Pipeline (Skript → TTS → Storyboard → Bilder → CapCut → Upload-Metadaten)
- MCP-Server (Claude Code) — Integrierter MCP-Server für direkte Bearbeitung und Generierungssteuerung über Claude Code
- 100% kostenlos & Open Source


🎙️ STORY ENGINE v2

Die integrierte Story Engine v2 verwandelt ein einzelnes Thema in eine komplette Videoproduktion über eine 9-Wave-automatisierte Pipeline: Story-Design, 20-Kapitel-Synopsis, 5-Akt-Skript mit automatischer Überprüfung, TTS/SFX-Generierung, Storyboard, Bilderzeugung (W7), CapCut-Assembly (W8) und YouTube-Metadaten (W9). Deutsche Sprachunterstützung in Entwicklung.


🤖 Claude Code Integration
Der integrierte MCP-Server (Model Context Protocol) verbindet sich direkt mit Claude Code. Automatisieren Sie Ihren gesamten Videoproduktions-Workflow mit KI-Codierungsassistenten: Prompts bearbeiten, Referenzen verwalten, Generierung auslösen, Skills installieren und STATE.md-basiertes Workflow-Tracking nutzen.


💰 Preise
- Alle Funktionen kostenlos — nur CapCut-Export ist kostenpflichtig
- 5 kostenlose CapCut-Exporte pro Monat — monatliche Erneuerung, keine Zeitbeschränkung
- 5 Bonus-Credits bei Anmeldung — zusätzliches Guthaben bei Kontoerstellung
- Pro: 4,99 $/Monat oder 39,99 $/Jahr (unbegrenzt)
- Quellcode: github.com/touchizen/AutoFlowCut


📋 Voraussetzungen: Google-Konto, CapCut Desktop-App, Internetverbindung, Windows 10+

💬 Support: gordon.ahn@touchizen.com
```

### What's New
```
v0.9.12 — Token-Ablauf-Auto-Refresh + Alles neu generieren + klebende Szenenzeilen

- Schluss mit Stapel-Abbrüchen nach 1 Stunde: Googles Access Token (~1 h) wird jetzt still im Hintergrund erneuert — kein Popup, kein Neustart, kein Datenverlust. Deckt Bilder, T2V/I2V, Upscale, Gallery und Status ab.
- Alles neu generieren (Regenerate All): Split-Menü am Generieren-Button erzeugt alle Einträge der aktuellen Ansicht (Bilder/Videos/F→V) auf einmal neu.
- Szenenzeilen bleiben an ihrem Inhalt: F→V-Zeilen sind jetzt dauerhaft an die Szene gebunden. Umsortieren, Löschen, neuer SRT-Import — Zeilen und Videos bleiben bei der richtigen Szene.
- Szenenanzahl passt sich automatisch an das Maximum aus Bildern/Videos/F→V/SRT an; leere Szenen am Ende werden aufgeräumt.
- Löschvorschau: zeigt Bild, Untertitel, Prompt und erzeugte T2V/I2V vor dem Bestätigen.
- F→V „Add Row" erzeugt Szene + Zeile zusammen (sofortiges Feedback).
- Stoppt sofort bei out_of_credits statt jede verbleibende Szene fehlschlagen zu lassen.
- Importbereinigung: CSV behält Zeilenpositionen auch bei Leerzeilen, Video-CSV akzeptiert prompt_en und andere Spaltenaliase, SRT überschreibt Prompts nicht mehr.
- i18n-Feinschliff, IPC-Memory-Leak in langen Sessions behoben, T2V-Clear leert die Szene jetzt tatsächlich.
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
