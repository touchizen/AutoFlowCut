# Flow2CapCut (AutoCraft Studio) - TODO

## 완료된 작업

### Phase 1: 프로젝트 부트스트랩
- [x] whisk2capcut-desktop → Flow2CapCut 복사
- [x] package.json 리네이밍 (name, productName, appId)
- [x] index.html title → AutoCraft Studio
- [x] npm install

### Phase 2: Flow API 코어 (이미지 MVP)
- [x] `src/config/defaults.js` — Flow 엔드포인트, 모델, PINHOLE tool
- [x] `electron/main.js` — 전면 재작성 (Flow IPC 핸들러)
- [x] `electron/preload.js` — flow:* 채널 브릿지
- [x] `electron/ipc/auth.js` — getFlowView 파라미터
- [x] `src/hooks/useFlowAPI.js` — Flow API Hook 생성
- [x] `src/utils/flowAPIClient.js` — renderer-side API 클라이언트
- [x] `src/utils/flowDOMClient.js` — DOM 모드 클라이언트
- [x] `src/hooks/useAutomation.js` — flowAPI 연결
- [x] `src/hooks/useSceneGeneration.js` — flowAPI 교체
- [x] `src/hooks/useReferenceGeneration.js` — flowAPI 교체
- [x] `src/hooks/useImageUpload.js` — uploadToFlow
- [x] `src/utils/guards.js` — flowAPI
- [x] `src/App.jsx` — useFlowAPI, localStorage 키 flow2capcut_*
- [x] `src/Shell.jsx` — flowStatus, flowPct
- [x] UI 컴포넌트 브랜딩 (Header, WelcomeScreen, SideDrawer 등)
- [x] i18n (en.js, ko.js) — Flow 브랜딩
- [x] Firebase APP_ID → flow2capcut
- [x] fileSystem engine default → 'flow'
- [x] 구 파일 삭제 (useWhiskAPI, whiskAPIClient, whiskDOMClient)
- [x] whisk 참조 완전 제거 확인 (grep 0건)
- [x] Vite 빌드 성공 확인

---

## 남은 작업

### Phase 2 검증: 실행 테스트 (최우선)
- [ ] `npm run dev` 앱 실행 확인
- [ ] Flow 탭 로딩 확인 (labs.google/fx/tools/flow)
- [ ] Google 로그인 → Flow 세션 토큰 추출 확인
- [ ] 프롬프트 입력 → 이미지 생성 → 결과 표시 확인
- [ ] XSSI prefix `)]}'` 파싱 동작 확인
- [ ] mediaId → redirect → fetch 2단계 미디어 조회 확인
- [ ] DOM 모드 셀렉터가 Flow 페이지에 맞는지 확인
- [ ] 레퍼런스 이미지 업로드 (flow/uploadImage) 확인
- [ ] CapCut Export → ZIP 생성 확인

### Phase 3: 비디오 생성 (신규 기능)
IPC 핸들러는 main.js에 이미 추가됨. UI/Hook 작업 필요.

- [ ] **3.1** `src/hooks/useVideoGeneration.js` 생성
  - 비동기 워크플로: 요청 → generationId → 10~15초 폴링 → 완료시 다운로드
  - T2V (Text-to-Video), I2V (Image-to-Video) 지원
- [ ] **3.2** `src/hooks/useScenes.js` 확장
  - scene에 `type: 'image' | 'video'` 필드 추가
  - `videoModel`, `videoPath`, `videoDuration`, `videoMediaId` 필드 추가
- [ ] **3.3** `src/hooks/useAutomation.js` 확장
  - `processVideoScene()` 함수 추가
  - scene.type에 따라 이미지/비디오 프로세서 분기
- [ ] **3.4** UI 컴포넌트
  - `SceneList.jsx` — 생성 타입 토글 (이미지/비디오)
  - `App.jsx` — 비디오 모델 셀렉터 (veo2_fast, veo3_quality 등)
  - `src/components/VideoPreview.jsx` 생성 — 비디오 플레이어
- [ ] **3.5** i18n — 비디오 관련 키 추가

### Phase 4: CapCut Export (비디오 지원)
- [ ] **4.1** `src/hooks/useExport.js` — 비디오 씬을 project videos 배열에 포함
- [ ] **4.2** `electron/ipc/capcut.js` — mp4 파일 쓰기 지원 확인
- [ ] **4.3** 비디오 포함 CapCut 프로젝트 Export → CapCut에서 열기 테스트

### Phase 5: 빌드 & 배포
- [ ] **5.1** `package.json` — appx identityName, displayName 확인
- [ ] **5.2** `scripts/notarize.cjs` — 하드코딩 참조 업데이트
- [ ] **5.3** 아이콘 교체 (`assets/icon.png`, `icon.icns`)
- [ ] **5.4** `npm run dist:mac` — macOS 빌드 테스트
- [ ] **5.5** `npm run dist:win` — Windows 빌드 테스트
- [ ] **5.6** macOS 공증 (notarize) 확인

---

### Tech Debt / Cleanup (다음 사이클)

- [ ] **테스트 인프라**: Node 18 + jsdom 27 ESM 충돌로 `npm run test:run` 풀 스위트가 깨짐 (`@exodus/bytes/encoding-lite.js` ERR_REQUIRE_ESM). `.nvmrc`/`engines`로 Node 20+ 강제하거나 jsdom 다운그레이드 — 풀 스위트 그린 복구 필요.
- [ ] **`uploadReference(base64, category)` cleanup**: `category` 인자가 IPC payload까지 전달되지 않고 로그용으로만 쓰임 ([useFlowAPI.js:124](src/hooks/useFlowAPI.js:124), [flow-api.js:1455](electron/ipc/flow-api.js:1455)). Flow `/flow/uploadImage` 스펙상 category를 안 받으니, 시그니처에서 빼거나(권장) 정말 필요하면 IPC body에 추가. 현재 호출처: reference 업로드(`'style'`), F2V 디스크 업로드(`'frame'`).
- [ ] **Gallery: Flow archive 뷰 미디어 포함**: 사용자가 Flow webview UI로 직접 업로드한 이미지(`/project/<id>/archive` 날짜별 뷰)가 우리 Gallery 드롭다운에 안 뜸. 현재 `fetchGallery` ([flow-api.js:1564](electron/ipc/flow-api.js:1564))는 `projectInitialData.projectContents.media[]`만 읽는데, archive 업로드는 다른 namespace에 들어가는 듯. Flow archive 뷰가 호출하는 API endpoint를 DevTools Network에서 캡쳐해서 추가 fetch + merge 필요.
- [ ] **Gallery refresh 버튼**: [FrameToVideoPanel.jsx:174](src/components/FrameToVideoPanel.jsx:174) 현재 `galleryItems`가 비어 있을 때만 `📂 Load Gallery` 버튼 노출. 1개라도 로드되면 다시 fetch할 UI가 없어서 stale 상태. 항목 유무와 무관하게 "🔄 Refresh Gallery" 항상 노출 (또는 드롭다운 open 시 stale > 30s면 자동 refresh).
- [ ] **story-engine: Hook을 별도 W3 출력 파일로 분리**: 현재 hook이 `part1_setup.md` 안에 묻혀 있어서 (a) writer가 hook craft를 본편 narrative와 같은 head-space에서 처리 → 평범한 도입부 양산, (b) hook만 A/B 테스트/재생성 불가, (c) 리뷰 시 hook이 약점일 때 발견하기 어려움. 5번째 W3 출력 `{title}_hook.md` 추가 + W4~W8 cascade. 상세 계획: [docs/plans/hook-file-split.md](docs/plans/hook-file-split.md). Estimated 1-2일.
- [x] **story-engine: Audio import를 W8 → W5-5로 이동**: 기존 W8-1에서야 오디오 임포트되어 사용자가 W7(최장 wave) 끝난 다음에야 TTS 검토 가능했음. W5-4 mechanic QA 통과 직후로 옮겨서 W6/W7 도는 동안 Audio 탭에서 병렬 검토. W8-1은 명시적 folderPath로 `/api/audio-import` idempotent 재호출하는 안전망으로 단순화 (audio-reviews-비교 verify는 폴더-agnostic이라 사용 불가). 상세 계획: [docs/plans/audio-import-early.md](docs/plans/audio-import-early.md). Done (docs-only).
- [ ] **story-engine: Production-scope gate (W4-0) — SFX/dialogue 선택적 스킵**: W5의 가장 비싼 두 단계(W5-1f dialogue TTS, W5-2 SFX)를 에피소드별로 끌 수 있게. W4-0에서 한 번 묻고 STATE.md `production_scope.{dialogue,sfx}`에 저장. Full/Narration+Dialogue/Narration+SFX/Narration-only 4가지 조합 — 마지막 조합은 W5 ~10-15분으로 단축 (draft/preview 용). 상세 계획: [docs/plans/production-scope-gate.md](docs/plans/production-scope-gate.md). Estimated 1시간 (docs+subagent prompts only).
- [ ] **AudioTab에 SFX 프롬프트 노출**: 현재 AudioTab은 SFX mp3만 재생하고 prompt/anchor 정보는 안 보임 → 사용자가 `08_sfx_list.md`로 cross-reference해야 함. W5-5 import 직후부터 AudioTab의 SFX row 옆에 anchor 나레이션 / placement / English prompt / duration 4개 필드 표시. `08_sfx_list.md` 파싱 → filename stem (no `_MMSS`) 으로 join. v1은 read-only (편집/regenerate는 v2). 상세 계획: [docs/plans/audiotab-sfx-prompts.md](docs/plans/audiotab-sfx-prompts.md). Estimated ~3시간 (app code).
- [ ] **TTS / SFX API key 사전 검증 (W5-0-prep preflight)**: 현재 ElevenLabs / Typecast 키는 lazy load라 W5 중간에 ENOENT / 401로 실패 — 5~10분 작업 손실. Google AI Studio (Gemini) 지원은 spec에 "TBD"로만 있고 `readApiKey` 미구현. 해결: W5-0-prep에서 provider 선택 직후 필요한 키 셋만 cheap GET (`/v1/voices`, `models?key=`)으로 검증, 누락/실패 시 AskUserQuestion. **첫 등록(key 없음)과 만료(401) 케이스 구분** + "키 얻는 곳 알려줘" 옵션으로 signup URL 안내. v1에 "Other / 직접 등록" 옵션으로 사용자 정의 provider 지원; v2 plan으로 한국(클로바/Supertone) / 일본(VOICEVOX/COEIROINK/Coefont) / 중국(ByteDance/Aliyun) / 글로벌(OpenAI/Azure/Polly) 1급 plug-in 등록 등재. 상세 계획: [docs/plans/tts-api-key-preflight.md](docs/plans/tts-api-key-preflight.md). Estimated ~3시간 (v1).

---

## 리스크 & 주의사항

| 항목 | 설명 | 대응 |
|------|------|------|
| reCAPTCHA | 비디오 생성에 필수 | WebContentsView에서 grecaptcha.enterprise.execute() 호출 |
| projectId | 일부 엔드포인트에 필수 | URL 파싱으로 추출, 없으면 fallback |
| 미디어 리다이렉트 | Flow는 mediaId→redirect→fetch 2단계 | 병렬 fetch로 지연 최소화 |
| XSSI prefix | Flow API 응답에 `)]}'` 포함 | parseFlowResponse()에서 제거 |
| DOM 셀렉터 | Flow 페이지 업데이트 시 깨질 수 있음 | defaults.js selectors 분리, 쉽게 업데이트 가능 |

## 참조 파일

- 구현 플랜: `~/.claude/plans/snoopy-juggling-fox.md`
- Auto Flow 역공학: `AutoFlow_10.7.58_pretty/`
- 기반 프로젝트: `~/workspace/whisk2capcut-desktop/`
