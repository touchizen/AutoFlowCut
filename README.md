# AutoFlowCut

Google Flow AI로 이미지/비디오를 **대량 생성**하고, CapCut 영상 프로젝트로 원클릭 내보내기하는 데스크톱 앱.

[![Release](https://img.shields.io/github/v/release/touchizen/AutoFlowCut)](https://github.com/touchizen/AutoFlowCut/releases)
[![License](https://img.shields.io/badge/license-UNLICENSED-red)](LICENSE)

## 개요

AI 영상, 아직도 한 장면씩 만들고 계신가요?

AutoFlowCut은 AI 영상 제작 전 과정을 자동화합니다. Google Flow AI(labs.google/fx)로 이미지와 비디오를 생성하고, 바로 편집 가능한 CapCut 프로젝트로 변환합니다. 대본을 가져오고, 비주얼을 생성하고, 씬별로 최적의 미디어를 선택한 뒤, 원클릭으로 내보내세요.

## 주요 기능

### AI 이미지/비디오 생성
- **일괄 이미지 생성** — Google Flow AI로 100장 이상의 AI 이미지를 배치 생성. 에러 자동 재시도
- **T2V (Text-to-Video)** — 텍스트 프롬프트에서 비디오 클립 생성 (Veo 3.1)
- **I2V (Image-to-Video)** — 생성된 이미지를 비디오로 변환
- **이미지 업스케일** — 2K/4K 해상도 업스케일 지원
- **씬별 미디어 선택** — 이미지, T2V, I2V 중 최적 미디어 자동 선택 (우선순위: I2V > T2V > Image)

### 레퍼런스 시스템
- **캐릭터/배경/스타일 레퍼런스** — 태그 기반 자동 매칭으로 200개 이상 씬에서 시각적 일관성 유지
- **87개 스타일 프리셋** — 애니메이션, 사진, 영화 등 11개 카테고리
- **스타일 프롬프트 자동 주입** — 레퍼런스 스타일이 생성 프롬프트에 자동 합성

### CapCut 내보내기
- **원클릭 내보내기** — 타임라인, 미디어, 자막, Ken Burns 애니메이션을 포함한 완성 프로젝트
- **CapCut 프로젝트 폴더 직접 쓰기** — ZIP 다운로드 불필요
- **CapCut 자동 실행** — 내보내기 후 CapCut 앱 자동 실행
- **SRT 자막** — 다국어 자막 포함 내보내기

### 오디오/SFX 통합
- **오디오 패키지 임포트** — 나레이션, 보이스, SFX 파일 자동 인식
- **SRT 타임코드 매칭** — 자막 타이밍 기반 오디오 배치
- **멀티 트랙 타임라인** — 오디오 트랙 분리 (나레이션/보이스/SFX)
- **오디오 리뷰 시스템** — 부적합 오디오 마킹 및 교체

### MCP 서버 (Claude Code 연동)
- **내장 MCP 서버** — Claude Code에서 직접 씬/레퍼런스/프롬프트 편집
- **HTTP API 브릿지** — 외부 도구 연동 (포트 3210)
- **워크플로우 게이트** — R_progress.json 기반 단계별 검증 시스템
- **스킬 시스템** — Claude Code 스킬 설치/관리

### 기타
- **듀얼 뷰 레이아웃** — 탭 / 좌우분할 / 상하분할 모드
- **다국어** — 한국어, 영어
- **프로젝트 관리** — 여러 프로젝트를 독립 관리, project.json 기반
- **다양한 입력 형식** — TXT, CSV, SRT 파일 가져오기

## 기술 스택

| 카테고리 | 기술 |
|----------|------|
| **Frontend** | React 18 + Vite 6 |
| **Desktop** | Electron 34 |
| **AI Engine** | Google Flow AI (labs.google/fx) |
| **Backend** | Firebase (Auth, Firestore, Cloud Functions) |
| **MCP** | @modelcontextprotocol/sdk |
| **결제** | Lemon Squeezy |
| **빌드** | electron-builder (DMG, ZIP, NSIS, APPX) |
| **테스트** | Vitest |

## 아키텍처

```
Electron BrowserWindow
├── [Layout Mode] — 탭 / 좌우분할 / 상하분할 (Shell.jsx)
│
├── [App View] — React (BrowserWindow webContents)
│   ├── Header — 프로젝트 선택, Export, Settings
│   ├── PromptInput — 프롬프트 입력
│   ├── SceneList — 씬 목록 (이미지/비디오/자막)
│   ├── ReferencePanel — 레퍼런스 관리
│   ├── AudioPanel — 오디오/SFX 임포트
│   └── StatusBar — 생성 진행 상태
│
├── [Flow View] — WebContentsView (labs.google/fx/tools/whisk)
│   └── Google 로그인 + Flow AI 내장 브라우저
│
└── [MCP Server] — stdio + HTTP (포트 3210)
    └── 씬/레퍼런스/스타일/오디오 관리 도구
```

### IPC 네임스페이스

| 네임스페이스 | 역할 | 파일 |
|-------------|------|------|
| `fs:*` | 파일 I/O | `electron/ipc/filesystem.js` |
| `flow:*` | Flow API (토큰, 이미지/비디오 생성) | `electron/ipc/flow-api.js` |
| `flow:dom-*` | DOM 자동화 (프롬프트 주입, 생성 트리거) | `electron/ipc/dom.js` |
| `flow:video-*` | 비디오 생성 (T2V, I2V, 업스케일) | `electron/ipc/video.js` |
| `capcut:*` | CapCut 경로 감지, 프로젝트 쓰기, 앱 실행 | `electron/ipc/capcut.js` |
| `auth:*` | Google OAuth | `electron/ipc/auth.js` |

### 비디오 생성 파이프라인 (3-Phase Async)

```
Phase 1: Submit     → 여러 비디오 요청을 순차 제출 (7~15초 간격)
Phase 2: Poll       → 모든 generationId를 병렬 폴링 (최대 20분)
Phase 3: Download   → 완료된 비디오를 순차 다운로드 + 저장
```

## 프로젝트 구조

```
Flow2CapCut/
├── electron/                    # Electron 메인 프로세스
│   ├── main.js                 # 메인 프로세스 + WebContentsView 관리
│   ├── preload.js              # Context bridge (window.electronAPI)
│   └── ipc/                    # IPC 핸들러
│       ├── filesystem.js       # 파일 I/O
│       ├── flow-api.js         # Flow API (이미지/비디오 생성)
│       ├── dom.js              # DOM 자동화 (프롬프트 주입, 생성)
│       ├── video.js            # 비디오 (T2V, I2V, 업스케일)
│       ├── capcut.js           # CapCut 경로 탐지, 프로젝트 쓰기
│       ├── auth.js             # Google OAuth
│       └── shared.js           # 공통 유틸리티
│
├── src/                        # React 프론트엔드
│   ├── App.jsx                 # 메인 앱 로직
│   ├── Shell.jsx               # 레이아웃 관리 (탭/분할)
│   ├── components/             # UI 컴포넌트 (35+)
│   │   ├── Header.jsx
│   │   ├── SceneList.jsx
│   │   ├── ReferencePanel.jsx
│   │   ├── AudioPanel.jsx
│   │   ├── ExportModal.jsx
│   │   ├── SettingsModal.jsx
│   │   ├── SceneDetailModal.jsx
│   │   ├── VideoDetailModal.jsx
│   │   └── ...
│   ├── hooks/                  # React 훅 (15+)
│   │   ├── useFlowAPI.js       # Flow API 래퍼 (토큰, 이미지, 비디오)
│   │   ├── useAutomation.js    # 배치 이미지 생성 파이프라인
│   │   ├── useVideoAutomation.js # 비디오 생성 (3-Phase Async)
│   │   ├── useSceneGeneration.js # 개별 씬 재생성
│   │   ├── useReferenceGeneration.js # 레퍼런스 생성
│   │   ├── useGenerationQueue.js # 통합 생성 큐
│   │   ├── useExport.js        # CapCut 내보내기
│   │   ├── useAudioImport.js   # 오디오 임포트 + SRT 매칭
│   │   ├── useScenes.js        # 씬 상태 관리
│   │   ├── useProjectData.js   # project.json 관리
│   │   └── ...
│   ├── exporters/              # CapCut JSON 생성 + 디스크 쓰기
│   ├── firebase/               # Auth, Firestore, Cloud Functions
│   ├── contexts/               # AuthContext
│   ├── config/                 # 기본값, 스타일 프리셋 (87개)
│   ├── locales/                # ko, en
│   ├── utils/                  # 유틸리티 (파서, 태그 매칭 등)
│   └── stripe/                 # 결제 (Lemon Squeezy)
│
├── mcp-server/                 # MCP 서버 (Claude Code 연동)
│   └── index.js                # 씬/레퍼런스/스타일/오디오/스킬 도구
│
├── skills/                     # Claude Code 스킬
├── docs/                       # 문서 (스키마, 스토어 설명 등)
├── assets/                     # 앱 아이콘 (icon.icns, icon.png)
├── public/                     # 정적 에셋 (스타일 썸네일)
├── vite.config.js
└── package.json
```

## 시작하기

### 요구사항

- Node.js 18+
- npm
- Google 계정 (Flow AI 접근용)
- CapCut 데스크톱 앱

### 설치

```bash
git clone https://github.com/touchizen/AutoFlowCut.git
cd AutoFlowCut
npm install
```

### 개발

```bash
# 개발 모드 (test 환경 — _test GCF 사용)
npm run dev

# 개발 모드 (prod 환경 — _prod GCF 사용)
npm run dev:prod
```

### 빌드

```bash
# macOS 배포 (DMG + ZIP, 코드 서명 + 공증)
npm run dist:mac

# Windows 배포 (NSIS + ZIP + APPX)
npm run dist:win

# Windows 개별 타겟
npm run dist:win:nsis    # 웹사이트 다운로드용 (.exe)
npm run dist:win:appx    # MS Store용 (.appx)

# 테스트 환경 배포
npm run dist:test:mac
npm run dist:test:win

# 패키징 테스트 (설치 파일 없이)
npm run pack
```

빌드 결과물은 `release/` 디렉토리에 생성됩니다.

### 환경 분리 (test / prod)

Cloud Functions는 `_test` / `_prod` 접미사로 분리 배포되어 있습니다.

| 스크립트 | 환경 | GCF 접미사 |
|----------|------|-----------|
| `npm run dev` | test | `_test` |
| `npm run dev:prod` | prod | `_prod` |
| `npm run dist:mac` / `dist:win` | prod | `_prod` |
| `npm run dist:test:mac` / `dist:test:win` | test | `_test` |

## 사용 방법

1. 앱 실행 후 **Flow 탭**에서 Google 로그인
2. **App 탭**으로 전환
3. 프롬프트 입력 (텍스트 / CSV / SRT 가져오기)
4. 레퍼런스 이미지 설정 (캐릭터, 배경, 스타일 태그)
5. **이미지 생성** → 배치 생성 시작
6. (선택) **비디오 생성** → T2V 또는 I2V
7. **Export** → CapCut 프로젝트 폴더에 자동 저장 → CapCut 실행

## MCP 서버

Claude Code에서 AutoFlowCut의 씬/레퍼런스/프롬프트를 직접 편집할 수 있습니다.

### 주요 도구

| 도구 | 설명 |
|------|------|
| `load_csv` | CSV 파일 + 이미지 로드 |
| `list_scenes` / `get_scene` | 씬 조회 |
| `update_prompt` / `batch_update_prompts` | 프롬프트 수정 |
| `list_references` / `update_reference_prompt` | 레퍼런스 관리 |
| `list_problem_scenes` | 문제 씬 필터링 |
| `list_styles` | 스타일 프리셋 조회 |
| `export_capcut` | CapCut 내보내기 |
| `install_skill` / `list_skills` | 스킬 관리 |
| `mark_step_done` / `get_progress` | 워크플로우 게이트 |
| `app_generate_scene` / `app_start_scene_batch` | 앱 연동 생성 |

### HTTP API

설정에서 HTTP 서버 활성화 시 (기본 포트 3210):

```
GET  /api/current-project  — 현재 프로젝트 상태
POST /api/scenes           — 씬 조회
POST /api/references       — 레퍼런스 조회
POST /api/generate         — 이미지 생성 트리거
```

## 다운로드

- **macOS / Windows**: [GitHub Releases](https://github.com/touchizen/AutoFlowCut/releases)
- **Windows (MS Store)**: Microsoft Store에서 "AutoFlowCut" 검색

## 링크

- **홈페이지**: [touchizen.com](https://touchizen.com)
- **YouTube**: [@touchizen](https://youtube.com/@touchizen)
- **Discord**: [touchizen](https://discord.gg/DTMMs8TZDN)
- **문의**: gordon.ahn@touchizen.com

## 라이선스

MIT License

---

*Disclaimer: This app is an independent product developed by Touchizen and is not affiliated with, endorsed by, or sponsored by Google or ByteDance (CapCut).*
