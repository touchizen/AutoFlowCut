# Audio Drop Persistence (Folder Normalization)

**Goal:** 드래그앤드롭으로 떨어뜨린 mp3가 오디오 패키지 폴더 구조 안에 복사되어, 다음 폴더 import / rescan 시 자동으로 픽업되도록 한다. 영속성 모델을 폴더 import 한 가지로 통일.

이전 phase ([2026-05-27-audio-tab-drag-drop.md](./2026-05-27-audio-tab-drag-drop.md))는 드롭을 **메모리에만** 보존했다. 본 phase는 그것을 디스크로 확장.

## 사용자 입장에서의 동작 (UX)

1. mp3를 Narration / SFX 라인에 끌어다 놓는다 → 트랙에 즉시 표시 (이전과 동일).
2. 동시에 파일이 **오디오 패키지 폴더 안으로 복사**됨 (사용자 모르게, 자동).
3. 새로고침/프로젝트 전환 후 돌아와도 그대로 보임 — 폴더 import가 자동으로 잡음.
4. 빈 상태에서 첫 드롭 시: 프로젝트 폴더 안에 `audio/` 디렉토리가 자동 생성되고 그것이 audioPackage 폴더가 됨.

복사 실패 시 (권한/디스크풀/소스파일 없어짐 등) → toast로 에러 + 메모리/트랙에도 반영 안 함. (메모리/디스크 일관성 유지)

---

## 결정사항

### 폴더 결정

- audioPackage가 이미 있으면 → `audioPackage.folderPath` 그대로 사용
- 없으면 → `<workFolder>/<project>/audio/` 자동 생성 (mkdir -p)
- 결정은 호출자(App.jsx)가 수행해서 IPC에 전달; hook이 settings에 직접 의존 안 함.

### 파일명 규칙 (기존 import 파서와 호환)

기존 [filesystem.js:1244-1253](../../../electron/ipc/filesystem.js#L1244)가 `<stem>_<NNNN>.mp3` (MMSS, 4자리) 또는 `<stem>_<NNNNNN>.mp3` (HHMMSS, 6자리)를 파싱해 timecodeMs로 변환한다. 우리도 정확히 같은 포맷으로 복사:

- **Narration** → `<folder>/media/<원본 파일명>` (timecode 인코딩 없음 — 기존 코드는 media/ 안의 첫 mp3를 narration으로 잡음)
- **SFX** → `<folder>/media/sfx/<원본스템>_<timecode>.mp3`
  - timecode가 3600초 미만 → 4자리 MMSS (예: 5000ms → `0005`)
  - 3600초 이상 → 6자리 HHMMSS (예: 3665000ms → `010105`)

### 충돌 처리

같은 파일명이 이미 존재하면 → suffix 증가: `narration.mp3` → `narration_1.mp3` → `narration_2.mp3` → ...

SFX의 경우 같은 stem + 같은 timecode가 충돌할 수 있으니 동일 규칙 적용.

### 동기/비동기

복사 IPC `await` → 성공해야 `setAudioPackage`. 실패 시 toast + audioPackage 변경 없음.

### 복사 후 흐름

복사 성공 후 → 새 디스크 경로로 audioPackage 갱신 (즉시 메모리 반영). 다음 rescan은 폴더 구조에 그대로 있는 파일을 픽업 — 영속성 자동.

---

## 구조

```
드롭 ─→ TrackLane onTrackDrop ─→ AudioPanel onTrackDrop wrap ─→ App.jsx onImportMp3 wrap
                                                                       │
                                                                       │ fallbackFolderPath = <workFolder>/<project>/audio
                                                                       ▼
                                              useAudioImport.importMp3ToTrack
                                                       │
                                                       ▼
                                          1) probeAudioFile (기존)
                                          2) copyDroppedAudio (신규 IPC)
                                                       │
                                                       ▼
                                          3) setAudioPackage(prev → 디스크 경로로 갱신)
```

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `electron/ipc/filesystem.js` | `fs:copy-dropped-audio` IPC: 폴더 mkdir + 파일 복사 + 정규화 이름 + 충돌 회피 |
| Modify | `electron/preload.js` | `copyDroppedAudio` 노출 |
| Modify | `src/hooks/useAudioImport.js` | `importMp3ToTrack`이 copy IPC 호출 후 디스크 경로로 setAudioPackage |
| Modify | `src/App.jsx` | `handleImportMp3` wrap — settings 기반 fallback 폴더 결정 |
| Create | `tests/electron/ipc/filesystem.copy-dropped-audio.test.js` | IPC 단위 (복사/정규화/충돌) |
| Modify | `tests/hooks/useAudioImport.importMp3ToTrack.test.js` | copy IPC mock 추가, 디스크 경로 반영 검증 |

---

## Phase B-1: IPC + preload

### Task B-1.1: fs:copy-dropped-audio 핸들러

**File:** `electron/ipc/filesystem.js`

기존 `fs:probe-audio-file` 다음에 추가:

```js
ipcMain.handle('fs:copy-dropped-audio', async (_event, { sourcePath, audioFolderPath, trackType, timecodeMs }) => {
  // 1) 가드: source 존재, audioFolderPath 결정
  // 2) audio/, media/, media/sfx/ mkdir -p
  // 3) 파일명 결정 (narration vs sfx, 충돌 시 _1 suffix)
  // 4) fs.copyFile
  // 5) 반환: { success, destPath, audioFolderPath, filename }
})
```

- [ ] sourcePath 존재 + 지원 확장자 검증
- [ ] audioFolderPath가 없으면 에러 반환 (호출자가 결정)
- [ ] mkdir -p로 `<audioFolderPath>/media[/sfx]` 생성
- [ ] timecodeMs → MMSS / HHMMSS 변환 헬퍼
- [ ] 충돌 시 `_1`, `_2` 증분 suffix
- [ ] 복사 후 새 path, audioFolderPath, filename 반환

### Task B-1.2: preload 노출

**File:** `electron/preload.js`

```js
copyDroppedAudio: (params) => ipcRenderer.invoke('fs:copy-dropped-audio', params),
```

---

## Phase B-2: importMp3ToTrack copy 통합

**File:** `src/hooks/useAudioImport.js`

- [ ] importMp3ToTrack 시그니처에 `fallbackFolderPath` 추가
- [ ] probe 후 audioFolderPath 결정: `audioPackage.folderPath ?? fallbackFolderPath`
- [ ] copy IPC 호출. 실패 시 toast + return null (메모리 변경 없음)
- [ ] setAudioPackage 시 `mp3Path` 대신 `copyResult.destPath` 사용
- [ ] 새 audioPackage의 `folderPath`는 copy 결과의 `audioFolderPath` (자동 생성 케이스 커버)

---

## Phase B-3: App.jsx wrap

**File:** `src/App.jsx`

- [ ] `handleImportMp3 = useCallback`로 fallback 폴더 결정 후 importMp3ToTrack 호출
- [ ] AudioPanel `onImportMp3={handleImportMp3}`
- [ ] settings.workFolder + settings.projectName이 둘 다 있을 때만 fallback 제공; 없으면 null → IPC가 에러 반환 → toast

---

## Phase B-4: 테스트

### Task B-4.1: IPC 단위 (Create)

**File:** `tests/electron/ipc/filesystem.copy-dropped-audio.test.js`

- [ ] narration 복사 → `<folder>/media/<filename>` 존재
- [ ] sfx 복사 (timecodeMs=5000) → `<folder>/media/sfx/<stem>_0005.mp3` 존재
- [ ] sfx HHMMSS (timecodeMs=3665000) → `_010105.mp3`
- [ ] 같은 이름 충돌 → `_1`, `_2` 증분
- [ ] media/ 자동 생성 (mkdir -p)
- [ ] sourcePath 없음 → success: false
- [ ] audioFolderPath 누락 → success: false

### Task B-4.2: importMp3ToTrack 갱신 (Modify)

**File:** `tests/hooks/useAudioImport.importMp3ToTrack.test.js`

기존 테스트가 mp3Path를 그대로 audioPackage에 박는 걸 검증했었음. 이제 copy IPC mock 추가 + 디스크 경로(`destPath`) 반영 검증.

- [ ] copy IPC mock 추가
- [ ] narration 드롭 → media.video.path가 copy 결과의 destPath
- [ ] sfx 드롭 → sfx[].files[].path가 destPath
- [ ] copy 실패 → audioPackage 변경 없음 + toast
- [ ] fallbackFolderPath 전달 → IPC에 그대로 전달됨
- [ ] audioPackage 있을 때 → IPC에 audioPackage.folderPath 전달

---

## 검증

### 자동
- [ ] `npm run test:run` 전체 통과
- [ ] 새 테스트 파일 1개 + 기존 테스트 갱신 통과

### 수동
- [ ] 빈 프로젝트 + mp3 드롭 (Narration) → `<workFolder>/<project>/audio/media/<filename>` 생성, 트랙 즉시 표시
- [ ] 같은 프로젝트 + mp3 드롭 (SFX, 5초) → `<...>/audio/media/sfx/<stem>_0005.mp3` 생성
- [ ] 같은 파일명 두 번 드롭 → `_1`, `_2` 증분
- [ ] 앱 종료 후 재시작 → 드롭한 파일이 그대로 보임 (폴더 import 자동 픽업)
- [ ] 프로젝트 전환 → 메모리 비워짐, 다른 프로젝트의 audio 폴더 자동 로드
- [ ] 권한 없는 폴더로 복사 시 → toast 에러 + 메모리 변경 없음

---

## Out of Scope

- 드롭한 파일에 대한 "원본 자동 삭제" 옵션 (사용자가 원본을 옮길지 결정)
- 폴더 외부에서 같은 mp3가 여러 위치에서 드롭됐을 때 중복 감지 (filename + timecode 같으면 충돌 처리에서 _1 suffix로 회피)
- audioFolderPath 사용자 명시 모달 (자동 생성으로 충분; 사용자가 원하면 폴더 import로 다른 위치 지정 가능)
