# Upscayl 이미지 업스케일 통합 — 설계 스펙 (v4, 스코프 재정렬)

> 씬 이미지를 로컬 Upscayl CLI(`upscayl-bin`)로 일괄/개별 업스케일. **mac/Windows/Linux 공통.**
>
> **핵심 원칙 (사용자 결정)**: 업스케일 = **"이 씬의 더 큰 해상도 생성 결과"** 로 모델링한다.
> 저장·history·확장자·롤백은 **기존 이미지 생성 파이프라인과 정확히 동일 경로**(`fileSystemAPI.saveImage`)
> 를 재사용하고, 업스케일만의 추가 트랜잭션 원자성·durability·프로젝트 생명주기 게이트는 요구하지
> 않는다(그건 생성도 동일 수준 = 선재 특성이며 이 기능의 스코프 밖). 프로젝트 전환 레이스는
> **projectName 스냅샷 귀속**(useAutomation의 `batchIdByProjectRef.get(projectName)` 관습과 동종)으로
> 회피한다 — **실측 결과 App `busy`는 New/Open/전환을 차단하지 않으므로** busy 의존은 거짓.
>
> **재설계 이력**: v1(별도 파일→리로드 증발) → v2/v3(정본 교체 트랜잭션이 앱 전반 불변식 건드려
> findings 12→10→11 안 줄음 = 스코프 미설정 신호) → **v4**: 생성 경로 동일 취급으로 축소 +
> 크로스플랫폼.

## 0. 실측 (2026-07-20, macOS)

- CLI: `upscayl-bin -i in -o out -s <2|3|4> -n <model> -m <modelsDir>` → exit 0, stderr `🏞️ Scaled image from WxH to W'xH'`. png 출력. (64→256 확인.)
- macOS 모델: `/Applications/Upscayl.app/Contents/Resources/models`의 `.param`↔`.bin` 페어(7종, 버전마다 다름) → 동적 스캔.
- 저장 재사용: `fileSystemAPI.saveImage(project, sceneId, base64, engine, metadata)` → `fs:save-resource`(정본 `scenes/<id>.<ext>` + `history/<id>_<ts>_<engine>.<ext>` + metadata). `imageFinalize.js`가 생성에 쓰는 그 경로. **업스케일도 동일 호출**(engine='upscayl').
- `resolveImageSrc`는 `generatedAt` 캐시버스트. `upscaled_size` 소비 2곳(prepareCloudRequest.js:113, PreviewPanel.jsx:189, `upscaled_size||image_size`).
- 리로드: `useProjectData`가 imagePath를 정본 `scenes/<id>`로 재유도 → 정본을 교체하면 리로드 자동 정합.
- 라이선스: 배포 안 함(설치본 호출) → AGPL 의무 없음.

## 1. 스코프

- **In**: 3 OS 감지(경로 추정 + "직접 찾기" + 기억)·미설치 안내, 씬 이미지 일괄/개별 업스케일(순차·취소), **생성 경로 동일 저장**(정본 교체 + history 자동 백업) + `image_size`/`generatedAt`/`upscaledAt`/`upscaled_size:null` patch, 대상 필터(스킵 카운트), 모델·배율 다이얼로그(기억), 진행 UI, 트리거 2곳+모달(Results 이미지·일반 Timeline·SceneDetailModal), **projectName 스냅샷 귀속(전환 시 patch 스킵)**.
- **Out (= 생성 파이프라인 선재 특성, 별개)**: 저장 트랜잭션 원자성/부분실패 롤백, history 메타 계약 재설계, 롤백 Save/Cancel 트랜잭션화, 종료 durability(autosave 연동), 프로젝트 생명주기 토큰 게이트(대신 busy 차단), 확장자 정규화, base64 대용량 왕복 최적화 — 전부 생성과 동일 수준으로 두고 이 기능이 새로 악화시키지 않는 선까지만. 레퍼런스·비디오·자동 다운로드·병렬·Story 타임라인(scenes=[]).

## 2. 감지 · 설치 안내 (크로스플랫폼)

- `upscayl:detect`(main) 순서:
  1. **기억된 경로**(`localStorage`/설정의 사용자 지정 binPath) 우선 — 있으면 `fs.access(X_OK)` 확인.
  2. **플랫폼별 추정 경로**(전부 Electron 앱 = `resources/bin/upscayl-bin[.exe]` + `resources/models` 공통 구조):
     - **macOS**: `/Applications/Upscayl.app/Contents/Resources/{bin/upscayl-bin, models}`, `path.join(os.homedir(),'Applications',...)`.
     - **Windows**: `%LOCALAPPDATA%\Programs\Upscayl\resources\{bin\upscayl-bin.exe, models}`, `%ProgramFiles%\Upscayl\resources\...`.
     - **Linux**: `/opt/Upscayl/resources/...`, `/usr/lib/upscayl/resources/...` (`.deb`/설치형). **AppImage 한계**(Codex): 실행 중 transient SquashFS 마운트 안에 bin/models가 있어 안정 경로를 못 준다 → Locate로도 마운트 경로는 재시작 시 무효. v4는 `.deb`/설치형 또는 **수동 추출한 AppImage 경로**만 지원(안내에 명시), AppImage 자동 추출/앱관리 복사는 후속.
  3. modelsDir에서 `.param`↔`.bin` 페어 → `models[]`. 페어 없으면 `{ ok:false, reason:'no-models' }`.
  - 반환 `{ ok, platform, binPath, modelsDir, models[] }` 또는 `{ ok:false, reason:'missing'|'no-models' }`.
- **"직접 찾기"**(폴백, 1급): 미감지 시 다이얼로그에서 파일 선택(`dialog.showOpenDialog`) → upscayl-bin 지정 → 형제 `../models` 자동 → 검증 후 기억. 추정이 빗나가는 설치(포터블·비표준·**수동 추출한 AppImage**)를 커버. (실행 중 마운트되는 raw `.AppImage`는 안정 경로가 없어 미지원 — §위 한계.)
- 미설치 안내: [upscayl.org](https://upscayl.org)(`shell.openExternal`) + OS별 설치 힌트(mac `brew install --cask upscayl` / win·linux 다운로드) + "직접 찾기" + "다시 확인".

## 3. 실행 · 저장 (생성 경로 재사용)

- **IPC** `electron/ipc/upscayl.js`(신규, `register(ipcMain)` 관습):
  - `upscayl:detect` → §2. `upscayl:locate` → 파일 선택 + 검증.
  - `upscayl:run` `{ inputPath, model, scale }` → 검증(inputPath 존재, model∈감지목록, scale∈{2,3,4}) → 임시 출력(`os.tmpdir()`) → spawn(인자 배열, 셸 미경유) → 성공라인 dims 파싱(PNG IHDR 폴백) → 출력 base64 read → `{ ok, base64, width, height }`, temp `finally` unlink. 실패 → `{ ok:false, error, stderrTail }`.
  - `upscayl:cancel`: 단일 활성 child SIGTERM→SIGKILL. 실행 중 다른 run → busy.
  - `before-quit`: 활성 child kill(기존 배리어 합류).
  - (base64 왕복은 생성 저장과 동일 방식 — 대용량 최적화는 §1 Out.)
- **오케스트레이션** `src/hooks/useUpscayl.js`:
  - **projectName 스냅샷 귀속**(전환 레이스 회피, 실측: busy는 전환 미차단): 배치 시작 시 `capturedProject = projectNameRef.current` 캡처. `saveImage`는 **capturedProject**로 호출(전환돼도 올바른 폴더). **`updateScene` patch 직전 `projectNameRef.current === capturedProject` 확인**(Codex BLOCKER — state 변수는 async 콜백서 stale closure; `projectNameRef`(useAppSettings.js:66)로 **라이브** 비교) → 불일치면 그 patch(및 이후) 스킵·배치 중단. run→saveImage→비교→patch 사이 각 await 후 ref로 재확인.
  - running은 App `busy`에 기여(mode-selector·in-app 토글은 기존 busy가 차단 — New/Open native menu는 원래 미차단이나 위 patch 가드가 안전망).
  - 대상: `scenes.filter(s => isSceneGenerationDone(s) && s.imagePath && !s.upscaledAt)`. base64-only·upscaledAt은 스킵+카운트.
  - 순차: `run(inputPath=s.imagePath)` → `fileSystemAPI.saveImage(capturedProject, s.id, base64, 'upscayl', { upscaleModel: model, scale, timestamp })`(성공 시 `{path}`) → projectName 비교 → §4 patch. 실패 기록+계속, 종료 시 요약. 취소 중단.
    - **history metadata 격리**(Codex BLOCKER 정정): `model`/`seed` 키를 빼도 `mediaMeta` backfill(mediaMeta.js:34)이 **`timestamp`만으로 매칭**해 `{seed:null, model:null, generatedAt:upscaleTs}`를 반환하고 멈춘다 → 레거시 씬의 생성모델/seed 복구 불가 + generatedAt 오귀속. → **backfill이 `hist.engine === 'upscayl'` 항목을 스킵**하도록 수정(`getHistory`가 engine 노출). 업스케일 metadata는 `{ upscaleModel, scale, timestamp }`(생성 model/seed 미사용) 유지.
  - 상태 `{ running, current, total, failures[], skipped }`. 언마운트 시 cancel.

## 4. 데이터 모델 · 롤백 · 보존

- **성공 patch**(saveImage 성공 후): `updateScene(sceneId, { imagePath: savePath, image: null, image_size: { width, height }, upscaled_size: null, generatedAt: Date.now(), upscaledAt: Date.now() })`.
  - `image_size` = 업스케일본 dims(정본과 일치). `upscaled_size:null`로 새 씬은 레거시 override 없음. `generatedAt` 캐시버스트.
- **롤백**: SceneDetailModal **기존 history 복원 UI** 재사용. 단 업스케일 dims가 커서 눈에 띄므로 복원 patch에 **`image_size` 재계산(복원 파일 dims) + `generatedAt` 갱신 + `upscaledAt:null` + `upscaled_size:null`** 보강(작은 정당한 수정, 나머지 Save/Cancel 의미는 기존 그대로 = 선재).
- **`upscaledAt` 클리어**(이미지가 실제로 교체되는 성공 경로에서만): 공통 `baseImageReplacementPatch(extra)` = `{ upscaledAt:null, upscaled_size:null, ...extra }` →
  - `imageFinalize.js`의 **성공 sceneUpdate에만**(no-image/save-fail 실패 patch엔 미적용 — 파일 안 바뀜),
  - Results/모달 이미지 clear,
  - MCP `update-scene`이 `image`/`imagePath` 포함 시(upscaledAt 명시 없으면).
- **영속 보존**: **`upscaledAt` + `generatedAt`**(Codex — generatedAt은 캐시버스터이나 세 경로가 드롭 → 리로드 후 `?v=` 유실로 stale 캐시 표시)을 CSV 재파싱(useScenes.js:192)·MCP reload(useMcpServer.js:389)·MCP premerge(mcp-server/index.js:902 `_sceneNum`+index 폴백) 보존 리스트에 추가. premerge엔 `image_size`도 없으므로 함께 추가(리로드 dims 유실 방지).

## 5. UI

- **`UpscaylDialog.jsx`**(App 소유 단일, `targetSceneIds`): 미설치/모델없음(직접찾기 포함) | 옵션(동적 models, 폴백; 2x/4x; 대상 요약 "N 대상·M 업스케일됨·K 스킵") | 진행(n/total·현재·취소) | 완료. 옵션 `localStorage('upscaylOptions')`(기본 ultrasharp-4x/4x).
- **트리거**:
  1. `ResultsTable`: layout 분기 **전 공유 액션 툴바** 신설(기존 header는 table 전용) → `mediaType==='image'` + App이 씬-이미지 인스턴스에만 `onUpscaleClick` 전달.
  2. `AudioTimeline` 툴바(KB 옆) `onUpscaleClick` — `LiveTimeline`(main)/`AudioPanel` passthrough. **Story 제외**(scenes=[]).
  3. `SceneDetailModal`: 클릭 → 모달 닫고 다이얼로그 `targetSceneIds:[scene.id]` pre-target. + upscaledAt 표시. **모달은 App + `SceneList` 두 곳에서 마운트**(Codex) → `onUpscaleClick`을 App→SceneList→SceneDetailModal 경로도 전달(양쪽 호스트 커버).
- 다이얼로그·진행·취소는 `useUpscayl` 1회(App).

## 6. 파일

| 파일 | 변경 |
|---|---|
| `electron/ipc/upscayl.js` (신규) | detect(3 OS·페어스캔)/locate/run(파일→base64+dims)/cancel, 단일 child, before-quit |
| `electron/preload.js` / `electron/main.js` | `upscaylAPI` 노출 + 등록 |
| `src/hooks/useUpscayl.js` (신규) | busy 기여·대상 필터·순차(run→saveImage→patch)·진행/취소/요약 |
| `src/utils/imagePatch.js` (신규 또는 기존 util) | `baseImageReplacementPatch()` |
| `src/components/UpscaylDialog.jsx` (+css) (신규) | 다이얼로그 |
| `src/components/ResultsTable.jsx` | 공유 액션 툴바(image 인스턴스) |
| `src/components/AudioTimeline/AudioTimeline.jsx` | 툴바 버튼 |
| `src/components/LiveTimeline.jsx`/`AudioPanel.jsx` | `onUpscaleClick` passthrough(Story 제외) |
| `src/components/SceneDetailModal.jsx` | 업스케일 버튼(pre-target) + upscaledAt 표시 + 복원 patch 보강 |
| `src/services/imageFinalize.js` | 성공 sceneUpdate에 `baseImageReplacementPatch` |
| `src/utils/mediaMeta.js` | backfill이 `hist.engine==='upscayl'` 스킵 |
| `src/components/SceneList.jsx` | `onUpscaleClick` passthrough(SceneDetailModal 호스트) |
| `src/hooks/useMcpServer.js`·`mcp-server/index.js`·`useScenes.js` | 보존(upscaledAt+generatedAt, premerge에 image_size) + update-scene 이미지 교체 시 리셋 |
| `src/App.jsx` | `useUpscayl` 1회 + 다이얼로그 + 배선 + busy |
| `src/locales/{ko,en}.js` | 문구 |

## 7. 테스트 (TDD)

- **IPC**(spawn/fs mock): detect 3 OS 경로·기억 우선·페어스캔·X_OK·no-models, locate 검증, run 파싱·IHDR 폴백·temp unlink·실패, cancel/busy·before-quit.
- **훅**(IPC·saveImage mock): 대상 필터(`!upscaledAt`), 순차, patch(image_size/upscaled_size:null/generatedAt/upscaledAt), 실패 계속·요약, 취소, 스킵, **projectName 전환 시 patch 스킵·중단**(캡처값으로 saveImage, 현재값 불일치 시 updateScene 미적용).
- **정합**: CSV/MCP reload가 upscaledAt 보존; imageFinalize 성공만 리셋(실패 patch 미적용); MCP image-update·clear·복원이 리셋; 복원 patch image_size 재계산.
- **다이얼로그/라우팅**: 미설치·직접찾기, 동적 모델·폴백, 진행/취소, 카운트; 트리거 3곳→동일 다이얼로그; Results image 한정; Story 미노출; 모달 pre-target.
- 회귀 `npm run test:run`. 실 바이너리·win/linux E2E는 눈검증(개발기 mac; win/linux는 경로 단위테스트 + 사용자 확인).

## 8. 검증 게이트

1. 테스트 그린 + 핵심(대상 필터·patch·파싱·upscaledAt 리셋·복원 patch·3 OS 경로) 뮤테이션 스팟체크.
2. Codex(gpt-5.6-sol xhigh) + 나(Opus 오케스트레이션·실측) findings 0 loop.
3. **실앱 눈검증(mac)**: 일괄 업스케일 → 선명 + Grid/프리뷰/Export 반영 + 리로드 후 유지 + history 롤백 + 실행 중 전환 차단 + 미설치·직접찾기. (win/linux는 경로 테이블 검증 + 사용자 실기기 확인.)
