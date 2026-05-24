# SRT/CSV 자막 트랙 분리 모델 — Scene 컬럼 + srtTrack 도입

**Status:** Active (Multi-phase, sequential)
**Created:** 2026-05-25
**Target release:** v0.10.0 (다음 minor)
**Estimated:** 13 phase (각 phase 0.5~1일, 총 7~10일)

---

## Problem

현재 SRT/CSV import 모델은 자막과 씬을 분리하지 않아서, 사용자가 의도한 "여러 자막을 한 씬으로 묶기" 워크플로우에서 다음 네 가지 문제가 발생한다. 추가로 MCP / Audio package 경로에서 자막 출처가 분기되어 export 일관성이 깨지는 문제도 함께 다룬다.

### 문제 1 — 묶음 후 SRT 재import 시 데이터 손실

[src/utils/parsers.js:349](../../src/utils/parsers.js#L349) `mergeSRTIntoScenes` 의 max-driver 모델로 인해:

1. SRT import (자막 3개) → 씬 3개 생성 (1:1)
2. CSV import (1행으로 묶음, `subtitle="자막1+2+3"`) → scenes[0]만 묶이고 scenes[1,2]는 잉여로 잔존
3. 다시 SRT import → scenes[0].subtitle 이 "자막1" 로 덮어써짐 → **묶음 손실**

추가로 ID 재할당으로 F→V 링크 / 생성된 이미지 포인터도 손실 가능.

### 문제 2 — CapCut export 시 묶인 자막이 한꺼번에 표시

[src/exporters/capcut.js:53-81](../../src/exporters/capcut.js#L53) `generateSRT` 는 씬당 자막 블록 1개를 생성한다. 묶인 씬의 subtitle 이 `"자막1\n자막2\n자막3"` 이면:

```
1
00:00:00,000 --> 00:00:11,830
자막1
자막2
자막3
```

→ CapCut에서 그 씬이 보이는 11.8초 내내 **세 줄이 한꺼번에 화면에 떠 있음**. 자막 가독성 저하 + 잉여 씬이 같이 export 되면 자막 중복까지 발생.

### 문제 3 — 현재 CSV 샘플도 같은 구조적 문제

[docs/examples/scenes_example.csv](../../examples/scenes_example.csv) 도 묶음 텍스트를 한 셀에 평문으로 합친 형태라서:
- 원본 SRT 라인 경계 정보 손실 (복원 불가)
- 개별 자막 시간 정보 없음
- 따옴표 이스케이프 지옥

### 문제 4 — MCP / Audio package 경로에서 자막 출처가 꼬임

CapCut export 의 자막은 [src/exporters/capcutCloud.js:543-560](../../src/exporters/capcutCloud.js#L543) 에서 두 출처 중 하나로 결정된다:

```js
if (audioPackage?.srtContent && (subtitleOption === 'ko' || 'both')) {
  srtContent = audioPackage.srtContent   // 1순위: audio 폴더 SRT 원본
} else {
  srtContent = generateSRT(project, 'ko')  // 2순위: scenes.subtitle 재생성
}
```

이로 인해 같은 SRT 입력이라도 어느 경로로 들어왔는지에 따라 export 결과가 달라진다:

| 경로 | audioPackage | 사용 자막 | 문제 |
|------|--------------|-----------|------|
| ImportModal SRT | null | generateSRT 재생성 | 자막 1:1 → 거의 OK |
| ImportModal CSV(묶음) | null | generateSRT 재생성 | 묶음 자막 한꺼번에 표시 |
| MCP load_csv | null | generateSRT 재생성 | 위와 동일 |
| MCP + audioFolderPath | non-null | audioPackage.srtContent | **MCP scenes 묶기와 어긋남** — audioPackage 가 이김 |
| Audio 폴더 import | non-null | audioPackage.srtContent | 원본 보존 ✓ |

특히 **MCP + audioFolderPath 케이스에서는 사용자가 MCP 로 scenes 묶기를 적용해도 audioPackage SRT 가 export 를 이겨서 묶기 의도가 무시**된다. 자동 복원([useMcpServer.js:125-128](../../src/hooks/useMcpServer.js#L125))이 같이 작동하면 어느 SRT 가 export 됐는지 추적도 어려움.

---

## Root Cause

**자막(SRT 시간 기반)** 과 **씬(이미지 묶음 단위)** 이 같은 데이터 구조에 합쳐져 있어서 책임이 충돌한다.

- SRT 라인 1개 = 시간 기반 자막
- 씬 1개 = 이미지 생성/표시 단위 (여러 자막을 묶을 수 있음)
- 현재 모델: 씬 1개 = 자막 1개 또는 묶음 텍스트 1개 → 묶음 시 자막 시간 손실

---

## New Model

자막 트랙과 씬 트랙을 **분리**한다. 사용자 UI는 지금처럼 씬 목록만 보이지만 내부적으로 자막 원본이 보존된다.

### 데이터 구조

```js
project = {
  name: "...",

  // 신규: 원본 자막 트랙 (시간 정확)
  srtTrack: [
    { id: "sub_1", startTime: 0,     endTime: 3.5,   text: "자막1" },
    { id: "sub_2", startTime: 3.5,   endTime: 7.0,   text: "자막2" },
    { id: "sub_3", startTime: 7.0,   endTime: 11.83, text: "자막3" },
    { id: "sub_4", startTime: 11.83, endTime: 15.5,  text: "자막4" },
    // ...
  ],

  scenes: [
    {
      id: "scene_1",
      srtLineIds: ["sub_1", "sub_2", "sub_3"],  // 이 씬은 자막 1~3 묶음
      prompt: "...",
      image: "...",
      // subtitle 필드는 srtLineIds 에서 계산해서 표시 (저장 안 함)
      // duration 도 srtLineIds 시간 합으로 자동 계산
    },
    {
      id: "scene_2",
      srtLineIds: ["sub_4"],
      prompt: "...",
      image: "...",
    },
  ]
}
```

### 동작

| 시점 | 동작 |
|------|------|
| SRT import | `srtTrack` 채움 + scenes 1:1 생성 (각 씬 `srtLineIds=[하나]`) |
| 새 CSV import | scenes 의 `srtLineIds` 갱신 (묶기 적용), `srtTrack` 도 CSV 행에서 갱신 |
| 씬 목록 표시 | 각 씬의 `srtLineIds` 따라가서 텍스트 합쳐 보여줌 |
| CapCut export — SRT | `srtTrack` 그대로 출력 → 원본 타이밍 유지 |
| CapCut export — 이미지 | scenes 순서대로, 각 씬 duration = srtLineIds 시간 합 |
| SRT 재import | `srtTrack` 갱신, 라인 수 같으면 묶음 유지 / 변경되면 경고 다이얼로그 |

---

## New CSV Format

**단일 형식**: 자막마다 1행, `scene` 컬럼이 같으면 같은 씬에 묶임.

```csv
scene,prompt,prompt_ko,subtitle,characters,scene_tag,style_tag,start_time,end_time
1,"A wealthy nobleman bowing","장부 든 소녀 앞에 고개 숙인 양반","문중 어른들 앞에서, 거상이 고개를 숙였습니다","장대인,소은",courtyard,"Korean historical",0.000,3.500
1,,,"예순이 넘은 사내가, 열네 살 소녀 앞에 허리를 굽혔지요",,,,3.500,7.000
1,,,"이 늙은이가 눈이 멀었었구나.",,,,7.000,11.830
2,"Close-up of hands clutching ledgers","장부와 주판을 쥔 소녀의 두 손","소녀의 손에는 장부 두 권이 들려 있었습니다",소은,courtyard,"Korean historical",11.830,15.500
2,,,"품속에서는 낡은 주판이 달그락거렸지요",,,,15.500,19.500
2,,,"구슬 몇 개가 빠진, 아버지가 쥐여준 것이었습니다",,,,19.500,23.840
```

### 규칙

- `scene` 번호가 같은 행 = 같은 씬에 묶임
- 씬 속성(prompt/prompt_ko/characters/scene_tag/style_tag/shot_type)은 그 씬의 **첫 행에만** 채움 (이후 행은 빈칸)
- `subtitle` / `start_time` / `end_time` 은 **행마다** (자막 1개씩)
- `duration` 컬럼은 제거 — 자막 시간 합으로 자동 계산
- `parent_scene` 컬럼은 제거 — `scene` 번호가 대체

### 옛 컬럼과의 차이

| 컬럼 | 옛 | 새 | 변경 |
|------|----|----|------|
| `scene` | ❌ | ✅ | 신규 — 묶기 식별자 |
| `subtitle` | 묶음 텍스트 | 자막 1개 | 의미 변경 |
| `start_time` / `end_time` | 묶음 범위 | 자막 단위 | 의미 변경 |
| `duration` | ✅ | ❌ | 제거 (자동 계산) |
| `parent_scene` | ✅ | ❌ | 제거 |
| `prompt`, `prompt_ko`, `characters`, `scene_tag`, `style_tag`, `shot_type` | 매 행 | 씬 첫 행만 | 작성 부담 감소 |

---

## Compatibility Policy

### 두 가지 CSV 형식 공존

CSV import 시 헤더로 자동 판별:

```js
if (headers.includes('scene')) {
  // 새 모델: scene 번호로 묶기, 자막마다 정확한 시간
  parseNewFormat(csv)
} else {
  // 옛 모델: 한 행 = 한 씬, subtitle 통째 + parent_scene 무시
  parseLegacyFormat(csv)
}
```

- 옛 CSV: 받아주되 옛 동작 그대로 (1행=1씬, subtitle 통째)
  - srtTrack 에는 그 씬의 묶음 텍스트가 자막 1개로 등록됨
  - export 시 자막 가독성 문제는 그대로 (옛 데이터 한계 — 복구 불가)
- 새 CSV: 새 모델 적용

### SRT import Guard (옛 방식 프로젝트 보호)

옛 CSV로 만든 프로젝트(`srtTrack` 의 라인 수 < scenes 의 누적 자막 수)에서 SRT import 시도 시:

```
┌────────────────────────────────────────────────────────────┐
│ ⚠ 이 프로젝트는 옛 형식 CSV로 만들어졌습니다.              │
│                                                            │
│ SRT를 import하면 자막 트랙이 새 SRT로 교체되어             │
│ 기존 씬과 자막 매핑이 깨질 수 있습니다.                    │
│                                                            │
│ 계속하려면 새 모델로 마이그레이션이 필요합니다.            │
│ (자막이 1개씩 새 씬으로 펼쳐지고, 묶음 정보는 사라집니다)  │
│                                                            │
│      [ 마이그레이션 후 import ]  [ 취소 ]                  │
└────────────────────────────────────────────────────────────┘
```

- 사용자가 명시적으로 마이그레이션 선택 → 펼치고 import
- 취소 → 아무 변경 없음

### Existing Project Migration

이미 저장된 프로젝트는 처음 열릴 때 자동으로 새 모델로 변환:

- `srtTrack` 없는 프로젝트 → 각 씬의 subtitle 을 자막 1개로 보고 srtTrack 생성, `srtLineIds = [그 한 개]`
- 즉 1자막=1씬으로 펼침 (묶음 정보가 옛 데이터에 없어서 어쩔 수 없음)
- 사용자가 다시 묶고 싶으면 새 CSV import로 묶기 작성

마이그레이션 완료 표시(`schemaVersion: 2`) 를 프로젝트에 남겨서 재실행 방지.

---

## Phase Sequence

각 phase 는 독립 commit 단위. 모든 phase 는 단위 테스트 + 통합 테스트 동반 (CLAUDE.md TDD 규칙).

### Phase 1 — 데이터 모델 + 유틸리티

**Goal:** `srtTrack`/`srtLineIds` 데이터 모델 + 변환 헬퍼 도입. 옛 코드는 아직 건드리지 않음.

**Files:**
- `src/utils/srtTrack.js` (신규) — `createSrtTrackFromScenes`, `getSceneSubtitle`, `getSceneDuration`, `allocateSrtLineId`
- `tests/utils/srtTrack.test.js` (신규)

**Tasks:**
- `srtTrack` 자료구조 헬퍼 (라인 추가/조회/매핑/시간 합산)
- `getSceneSubtitle(scene, srtTrack)` — 씬의 표시용 묶음 자막 텍스트 계산
- `getSceneDuration(scene, srtTrack)` — 시간 합산
- `migrateLegacyProject(project)` — 옛 프로젝트 → 새 모델 변환

**Tests:** 모든 헬퍼 단위 테스트, 마이그레이션 시나리오 (빈 자막, 묶음 자막, 시간 없는 자막)

### Phase 2 — SRT Import (새 모델 출력)

**Goal:** SRT 파일 import 시 `srtTrack` 채우고 scenes 1:1 생성. 옛 `mergeSRTIntoScenes` 는 호환 경로로 유지.

**Files:**
- `src/utils/parsers.js` — `parseSRTToTrack(srtText)` 신규
- `src/hooks/useScenes.js` — `parseFromSRT` 가 srtTrack 갱신하도록 수정
- 테스트

**Tasks:**
- SRT 텍스트 → `{ srtTrack, scenes }` 변환 함수
- 기존 `parseFromSRT` 호출부에서 두 트랙 모두 반환
- 옛 동작 호환 모드 분기 (옛 프로젝트는 옛 경로로)

### Phase 3 — 새 CSV Import (`scene` 컬럼 인식)

**Goal:** 새 형식 CSV 파싱. `scene` 번호로 행 그룹화, `srtTrack` + `scenes` 동시 생성.

**Files:**
- `src/utils/parsers.js` — `parseSceneCSVToTracks(csvText)` 신규
- `src/hooks/useScenes.js` — `parseFromCSV` 에서 헤더 판별 → 새 경로
- 테스트

**Tasks:**
- 헤더 판별 (`scene` 컬럼 유무)
- 행 그룹화 + 씬 속성은 그룹 첫 행에서 추출
- `srtTrack` 라인 ID 안정적 할당
- 씬 `srtLineIds` 채움

### Phase 4 — 옛 CSV 호환 Import

**Goal:** `scene` 컬럼 없는 옛 CSV 도 받음. 옛 동작 그대로 + `srtTrack` 에는 자막 1개로 등록.

**Files:**
- `src/utils/parsers.js` — `parseLegacyCSVToTracks(csvText)` (기존 `mergeCSVIntoScenes` 재활용)
- 테스트 — 옛 샘플 CSV import 검증

**Tasks:**
- 헤더 분기 — 옛 경로 호출
- 옛 결과를 새 모델로 래핑 (각 씬의 묶음 텍스트 = 자막 1개로 srtTrack 등록)
- 옛 동작 회귀 없는지 확인

### Phase 5 — CapCut Export 갱신

**Goal:** `generateSRT` 가 `srtTrack` 을 사용. 이미지는 씬 묶음 단위로 출력.

**Files:**
- `src/exporters/capcut.js` — `generateSRT(project)` 가 `project.srtTrack` 사용
- `src/hooks/useExport.js` — export payload 에 srtTrack 포함
- 테스트 — 자막 타이밍 보존 / 묶음 씬 duration 합산 검증

**Tasks:**
- `generateSRT` 시그니처 유지하되 내부 로직 교체
- scenes 의 `srtLineIds` 미사용 → 자막은 srtTrack 그대로
- 이미지 duration = `getSceneDuration(scene, srtTrack)`

### Phase 6 — Scene List UI 갱신

**Goal:** 씬 목록에서 묶인 자막을 한 셀에 합쳐 표시. duration 도 자동 계산값 표시.

**Files:**
- `src/components/SceneList.jsx` (또는 관련 컴포넌트)
- `tests/components/SceneList/` 통합 테스트

**Tasks:**
- `getSceneSubtitle(scene, srtTrack)` 호출로 표시 텍스트 결정
- `getSceneDuration` 으로 표시 시간 결정
- 묶인 자막이 시각적으로 구분되도록 (예: 줄바꿈 또는 항목별 마커)

### Phase 7 — Existing Project Migration

**Goal:** 옛 형식 프로젝트가 처음 열릴 때 자동으로 새 모델 변환.

**Files:**
- `src/hooks/useProjectLoad.js` (또는 프로젝트 로드 진입점)
- `tests/hooks/useProjectLoad.test.js`

**Tasks:**
- 프로젝트 로드 시 `schemaVersion` 체크
- 없으면 `migrateLegacyProject` 호출 후 저장
- 마이그레이션 결과 토스트로 안내 ("X개 씬을 새 모델로 변환했습니다")

### Phase 8 — CSV Sample + Guide Update

**Goal:** 새 형식 CSV 샘플 + LLM 프롬프트 가이드 갱신.

**Files:**
- `docs/examples/scenes_example.csv` — 새 형식으로 교체 (옛 파일은 `scenes_example_legacy.csv` 로 백업)
- 가이드 사이트 (`touchizen.github.io`) — `#ai-csv-prompt` / `#ai-srt-to-csv` 섹션 업데이트 (별도 PR)
- `src/components/ImportModal.jsx` — `hint` 텍스트 갱신 (`scene, prompt, subtitle, ...`)

**Tasks:**
- 새 샘플 작성 (한국어/영어 모두 포함, 6행 정도)
- 가이드 anchor 변경 시 ImportModal 의 URL도 동기화

### Phase 9 — SRT 재import 가드 + 경고 다이얼로그

**Goal:** 옛 방식 프로젝트에서 SRT import 차단. 새 방식 프로젝트에서도 라인 수 변경 시 경고.

**Files:**
- `src/App.jsx` (handleImport)
- 새 다이얼로그 컴포넌트
- 테스트

**Tasks:**
- 옛 형식 프로젝트 감지 → 마이그레이션 다이얼로그
- 새 형식 + 라인 수 변경 감지 → "묶음 유지 시도 / 초기화 / 취소" 다이얼로그
- 라인 수 동일하면 무경고로 통과

### Phase 10 — Integration Test + E2E 시나리오

**Goal:** 두 형식 혼용 / 마이그레이션 / 재import 등 E2E 시나리오 통합 테스트.

**Files:**
- `tests/integration/srt-csv-track-separation.test.jsx` (신규)

**Scenarios:**
1. 새 SRT import → 1자막=1씬, srtTrack 보존
2. 새 SRT import → 새 CSV import (묶기) → 묶음 적용
3. 새 CSV (자체 완결) import → srtTrack + 묶음 동시 생성
4. 옛 CSV import → 옛 동작 (회귀 검증)
5. 옛 프로젝트 로드 → 자동 마이그레이션 → SRT import 가능
6. 묶기 후 동일 SRT 재import → 묶음 유지
7. 묶기 후 다른 SRT (라인 수 변경) → 경고 다이얼로그
8. 묶기 후 CapCut export → 자막은 원본 타이밍, 이미지는 묶음 duration

### Phase 11 — MCP SRT 경로 통합

**Goal:** MCP 를 통한 자막 수신 시에도 `srtTrack` 이 채워지도록 통합. MCP scenes 묶기와 export 결과 일치.

**Files:**
- `mcp-server/index.js` — `load_csv` 가 새 형식 CSV 인식
- `mcp-server/lib/csv.js` — `parseSceneCSVToTracks` 와 같은 결과 반환
- `src/hooks/useMcpServer.js` — `update-scenes` 수신 시 `srtTrack` 도 갱신
- 테스트 — MCP 수신 → srtTrack 채움 / export 일치

**Tasks:**
- `load_csv` 가 새 형식 CSV (scene 컬럼) 자동 인식, srtTrack + scenes 동시 반환
- 옛 형식 CSV 도 받아주되 srtTrack 에 자막 1개씩 등록 (호환)
- `useMcpServer.js:221` `update-scenes` 핸들러를 `update-scenes-and-srt-track` 로 확장
- 새 메서드 `update-srt-track` 추가 (자막만 갱신하고 싶을 때)
- 기존 MCP 도구 (`load_csv` 등) 의 응답 스펙 문서 갱신

### Phase 12 — Audio Package SRT 통합

**Goal:** Audio 폴더 import 시 SRT 를 `project.srtTrack` 으로 흡수. [capcutCloud.js:544](../../src/exporters/capcutCloud.js#L544) 의 audioPackage 분기 제거.

**Files:**
- `src/hooks/useAudioImport.js` — `_processScanResult` 에서 폴더 SRT → srtTrack 동기화
- `src/exporters/capcutCloud.js` — `audioPackage.srtContent` 분기 제거, 항상 `project.srtTrack` 기반 SRT 사용
- `src/exporters/capcut.js` — 동일 (로컬 export 경로)
- `src/hooks/useExport.js` — export payload 에서 srtTrack 필수, audioPackage.srtEntries 는 timeline 표시용으로만 유지
- 테스트

**Tasks:**
- Audio 폴더 SRT 와 `project.srtTrack` 비교
  - 둘 다 비어있음 → 폴더 SRT 로 srtTrack 채움
  - srtTrack 비어있고 폴더 SRT 있음 → 흡수
  - 둘 다 있고 다름 → 다이얼로그: "audio 폴더 SRT 로 교체 / 현재 유지 / 양쪽 비교"
  - 둘 다 있고 같음 → 무동작
- `audioPackage.srtContent` / `audioPackage.srtEntries` 를 export 의 자막 소스에서 제외
  - AudioTimeline UI 표시용으로만 유지 (deprecated 표시, 후방 호환)
- capcutCloud.js 분기 제거 — 항상 `generateSRT(project)` 호출 (이젠 srtTrack 기반)

**Dialog UX:**
```
┌────────────────────────────────────────────────────────────┐
│ Audio 폴더의 자막이 프로젝트 자막과 다릅니다.              │
│                                                            │
│ 폴더 SRT: 12 라인  /  프로젝트 srtTrack: 8 라인            │
│                                                            │
│   [ 폴더 SRT 로 교체 ]  [ 현재 유지 ]  [ 비교 보기 ]       │
└────────────────────────────────────────────────────────────┘
```

### Phase 13 — Multi-source 통합 테스트 + Export 일관성 검증

**Goal:** 세 import 경로 + audioPackage 가 모두 같은 export SRT 를 만드는지 검증.

**Files:**
- `tests/integration/srt-csv-track-separation.test.jsx` (Phase 10 확장)
- `tests/integration/mcp-srt-track.test.jsx` (신규)
- `tests/integration/audio-package-srt-integration.test.jsx` (신규)

**Scenarios:**
1. **동일 SRT 세 경로 비교** — 같은 SRT 텍스트를 ImportModal / MCP load_csv / Audio 폴더 세 경로로 입력 → export SRT 가 byte-identical 까지는 아니지만 라인 수 / 시간 / 텍스트가 동일
2. **MCP 묶기 → export** — MCP 로 scene 컬럼 있는 CSV 전송 → 묶음 적용 → export SRT 는 원본 자막 타이밍 유지
3. **MCP + audioFolderPath** — MCP 가 scenes + audio 둘 다 전달 → srtTrack 일관성 검증
4. **audioPackage 충돌** — 프로젝트에 이미 srtTrack 있는 상태에서 다른 SRT 가진 audio 폴더 import → 다이얼로그 동작 확인 (3가지 선택지 각각)
5. **자동 복원 + MCP** — 프로젝트 전환 시 옛 audioFolderPath 자동 복원 → MCP load_csv 도 함께 들어옴 → srtTrack 어긋남 없이 통합
6. **세 경로 + 묶기 + export** — Audio 폴더 SRT → MCP CSV 묶기 → CapCut export → 자막 원본 타이밍 + 이미지 묶음 duration

---

## Verification

각 phase 종료 시:

- 해당 phase 의 단위 테스트 통과
- `npm run test:run` 전체 통과 (회귀 없음)
- (UI phase 는) `npm run dev` 로 수동 검증

전체 milestone 종료 시:

1. `npm run test:run` 전체 통과
2. 옛 샘플 CSV (`scenes_example_legacy.csv`) import → 옛 동작 그대로 작동
3. 새 샘플 CSV (`scenes_example.csv`) import → 묶기 적용 + 자막 타이밍 보존
4. SRT import (자막 6개) → CSV import (`scene=1` 3행 + `scene=2` 3행) → 2씬으로 묶임
5. CapCut export → 생성된 SRT 가 원본 자막 6줄 타이밍 그대로 출력
6. 이미지 트랙 → 각 씬이 묶인 자막 시간 합 동안 표시
7. 동일 SRT 재import → 묶음 유지 (경고 없음)
8. **MCP 경로 일치** — MCP `load_csv` 로 같은 CSV 전송 시 ImportModal 결과와 srtTrack 동일
9. **Audio 폴더 SRT 흡수** — 빈 프로젝트에 audio 폴더 import → 폴더 SRT 가 srtTrack 으로 들어가고, 다음 CSV import (묶기) → 묶음 적용된 채로 export
10. **충돌 다이얼로그** — srtTrack 있는 상태에서 다른 audio 폴더 SRT → 다이얼로그 3개 선택지 모두 동작

---

## Out of Scope

- 씬 목록 UI 에서 직접 자막 묶기/풀기 버튼 (별도 phase 로, 본 milestone 이후)
- 자막 트랙 별도 편집 패널 UI (필요시 별도 milestone)
- 자막 시간 fine-tuning UI (현재는 import 후 CSV 재작성으로만 변경 가능)
- 가이드 페이지 (`touchizen.github.io`) 의 anchor 변경 — 별도 PR/배포 사이클
- 옛 CSV 자동 변환 (B 모드 — subtitle 분해 휴리스틱). 사용자가 명시적으로 새 형식 CSV 다시 작성하도록 안내
- `audioPackage.srtEntries` / `srtContent` 의 완전 제거 — Phase 12 에서 deprecated 표시만, 다음 major 까지 후방 호환 유지
- MCP 도구의 binary protocol 변경 — JSON over HTTP 그대로 유지, 추가 메서드만 도입

---

## Risk & Mitigation

| 위험 | 영향 | 대응 |
|------|------|------|
| 마이그레이션 실패로 기존 프로젝트 로드 깨짐 | 사용자 작업 손실 | 마이그레이션 전 자동 백업 (`project.json.bak`) |
| 옛 CSV 회귀 | 기존 사용자 워크플로우 깨짐 | Phase 4 + Phase 10 통합 테스트로 검증 |
| 가이드 페이지 anchor 미동기화 | AI Gen 버튼이 옛 가이드로 점프 | Phase 8 에서 ImportModal URL 검토, 가이드 PR 병행 |
| srtTrack 데이터 부풀림 | 큰 프로젝트에서 메모리/저장소 증가 | 자막 객체가 작아서 무시 가능 (1만 라인 ≈ 1MB) |
| F→V 링크 / 이미지 포인터 손실 | 사용자가 생성한 미디어 잃음 | Phase 7 마이그레이션에서 씬 ID 안정적 유지 + framePairs `ownerSceneId` 보존 |
| MCP 클라이언트(외부 스크립트) 회귀 | 사용자 자동화 깨짐 | Phase 11 에서 옛 응답 스펙 유지, 새 필드만 추가 — MCP 도구 문서에 변경점 명시 |
| Audio 폴더 SRT 와 srtTrack 충돌 시 사용자 혼란 | 잘못된 SRT 가 export 됨 | Phase 12 다이얼로그 + AudioSummary UI 에 "현재 export 자막 출처" 표시 |
| capcutCloud.js:544 분기 제거로 옛 export 경로 회귀 | 기존 Cloud export 사용자 영향 | Phase 12 에서 옛 동작과 byte-identical 비교 테스트 추가 (audioPackage SRT == srtTrack 일 때) |

---

## Notes

- 본 plan 은 큰 변경이라 v0.10.0 minor bump 대상
- 각 phase 완료 시 본 plan 의 해당 phase 섹션을 `**Completed:** YYYY-MM-DD (commit hash)` 로 갱신
- 모든 phase 완료 후 본 문서를 `docs/plans-archive/` 로 이동 (CLAUDE.md 규칙)
