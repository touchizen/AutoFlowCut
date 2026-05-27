# Audio Tab: Always-Open + Track-Lane Drag-and-Drop Plan

**Goal:** Audio 탭이 항상 열려있고, 씬의 이미지가 자동 표시되며, mp3/srt 파일을 **트랙 라인 위에 드롭**하여 각 트랙에 명시적으로 배치할 수 있게 한다.

## 사용자 입장에서의 동작 (UX)

매우 간단:

1. **Audio 탭은 언제나 클릭 가능**. 비어 있어도 탭 활성화.
2. **씬에 이미지가 있으면** Audio 탭을 열면 Image 트랙이 자동으로 보임. 동영상은 표시 안 함.
3. **mp3 파일을 트랙 라인 위에 끌어다 놓으면** 그 트랙으로 들어감:
   - **Narration 라인** → 전체 나레이션 (1개, 교체)
   - **SFX 라인** → 효과음 (여러 개 누적, **드롭한 가로 위치가 그대로 타임코드**가 됨)
4. **srt 파일을 끌어다 놓으면** (라인 무관, 패널 어디든) → 가져오기 모달 📺 SRT와 **완전 동일**. 자막 트랙 + 씬 자동 생성 + conflict 모달.
5. **빈 상태**에서도 Narration/SFX 트랙은 placeholder로 보임 → 어디에 드롭할지 명확.

사용자는 그저 끌어다 놓는다. 파일명 추측 없음, 모달 추가 없음.

---

## Architecture

**원칙: 파일 타입 우선 분류 → mp3는 트랙 라인으로 라우팅**

```
드롭 이벤트 ─┬─ srt 파일? ─→ handleImport('srt', content)  (Flow A 그대로)
              │
              └─ mp3/wav/m4a 파일? ─┬─ Narration 라인 위? → media.video 교체
                                     ├─ SFX 라인 위?       → sfx[]에 append (x좌표=timecodeMs)
                                     ├─ Voice 라인 위?     → toast "폴더 import 사용"
                                     └─ 그 외 라인/공간?   → toast "Narration 또는 SFX에 드롭"
```

**자막 트랙 표시**: `audioPackage.srtEntries`가 없어도 `srtTrack`에서 fallback. ImportModal SRT 경유든 드롭 경유든 모두 표시.

**CapCut export 호환**: [capcutCloud.js:247-307](src/exporters/capcutCloud.js#L247)이 이미 narration / voice / sfx_timed 멀티트랙 지원. 우리 드롭은 그저 `audioPackage` 채널에 넣기만 하면 export 자동.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/components/AudioTimeline/useAudioTimeline.js` | audioPackage null 가드 제거, 빈 상태도 Narration/SFX placeholder 트랙 생성 |
| Modify | `src/components/AudioTimeline/TrackLane.jsx` | onDragOver/onDrop 핸들러 (drop accept type 트랙별 분기) |
| Modify | `src/components/AudioTimeline/AudioTimeline.jsx` | TrackLane에 onTrackDrop, dragOverTrackId 전달 |
| Modify | `src/components/AudioPanel.jsx` | 빈 상태 early return 제거, 패널 레벨 SRT 드롭만 받음 |
| Modify | `src/components/AudioPanel.css` + `AudioTimeline.css` | 드래그오버 시각 피드백 (트랙 라인 하이라이트) |
| Modify | `src/App.jsx` | 탭 disabled 제거, srtEntries fallback, 새 콜백 연결 |
| Modify | `src/hooks/useAudioImport.js` | `importMp3ToTrack({ mp3Path, trackType, timecodeMs })` 메소드 |
| Modify | `electron/ipc/filesystem.js` | `fs:probe-audio-file` IPC (단순 메타 측정), audioPackage 빌드는 hook 측에서 |
| Modify | `electron/preload.js` | `probeAudioFile`, `getPathForFile` 노출 |
| Modify | `src/locales/{ko,en,ja,de}.js` | 드롭 안내 / 거부 toast 카피 |
| Create | `tests/components/AudioTimeline/useAudioTimeline.empty.test.js` | 단위: 빈 audioPackage에서도 placeholder 트랙 |
| Create | `tests/components/AudioTimeline/TrackLane.drop.test.jsx` | 단위: 트랙별 드롭 accept/reject |
| Create | `tests/components/AudioPanel.dragdrop.test.jsx` | 통합: SRT 드롭 → handleImport, MP3 드롭 → 트랙별 라우팅 |
| Create | `tests/hooks/useAudioImport.importMp3ToTrack.test.js` | 단위: narration 교체 / sfx 누적 |
| Create | `tests/electron/ipc/filesystem.probe-audio.test.js` | 단위: 새 IPC (duration 측정) |

---

## Phase 1: Audio 탭 항상 열림 + Placeholder 트랙

목표: audioPackage가 없어도 탭 열림 + scenes의 이미지/srtTrack의 자막 표시 + Narration/SFX 트랙이 빈 상태로 visible (드롭 타겟 제공).

### Task 1.1: useAudioTimeline 가드 제거 + placeholder 트랙

**File:** `src/components/AudioTimeline/useAudioTimeline.js`

- [ ] `if (!audioPackage) return null` 제거 → `const pkg = audioPackage || {}` 처리
- [ ] `folderPath`, `media`, `voices`, `sfx` 모두 옵셔널 처리
- [ ] `imageClips`, `subtitleClips`는 `scenes`/`srtEntries` prop만 사용 → 변경 없음
- [ ] **Narration 트랙은 audioPackage.media.video가 없어도 빈 트랙으로 생성** (드롭 타겟용):
  ```js
  const narrationTrack = {
    id: 'narration',
    label: t('audioTab.trackNarration') || 'Narration',
    color: COLORS.narration,
    clips: narrationClips,  // 빈 배열일 수 있음
    acceptsDrop: 'audio',
    role: 'narration',
  }
  ```
- [ ] **SFX 트랙도 동일** — 빈 sfxCategories여도 placeholder 트랙 1개 (`role: 'sfx'`)
- [ ] Voice / Image / Subtitle 트랙은 데이터 있을 때만 생성 (이전과 동일, 단 image/subtitle은 scenes/srtEntries 있으면 생성)
- [ ] `totalDurationMs`: max clip end로 fallback (이미 그렇게 작동하는지 검증, 빈 상태면 기본값 60_000 등)

**검증 단위**: scenes만 있는 상태에서 호출 → image + narration(빈) + sfx(빈) 트랙. audioPackage + scenes 둘 다 있으면 전체 트랙.

### Task 1.2: 단위 테스트 - useAudioTimeline

**File (Create):** `tests/components/AudioTimeline/useAudioTimeline.empty.test.js`

- [ ] `audioPackage=null`, `scenes=[]`, `srtEntries=[]` → narration/sfx 트랙은 빈 clips로 존재
- [ ] `audioPackage=null`, `scenes=[{ imagePath, startTime, endTime }]` → image 트랙 1개 + narration/sfx 빈
- [ ] `audioPackage=null`, `srtEntries=[{ startMs, endMs, text }]` → subtitle 트랙 + narration/sfx 빈
- [ ] 회귀: 기존 audioPackage 풀 케이스 그대로 작동

### Task 1.3: AudioPanel 빈 상태 분기 제거

**File:** `src/components/AudioPanel.jsx`

- [ ] `if (!audioPackage && loading)` 분기는 유지 (import 진행 중 표시)
- [ ] `if (!audioPackage)` early return 제거 → AudioTimeline 항상 렌더
- [ ] **진짜 빈 상태** 안내는 AudioTimeline의 빈 트랙 위에 overlay로 "🎵 mp3는 트랙 위에, srt는 어디든 끌어다 놓으세요" 같은 hint 표시 (드롭이 처음이 사용자에게 작동 방식 안내)
  - 조건: `!audioPackage && (!scenes?.length) && (!srtEntries?.length)`

### Task 1.4: App.jsx 탭 disabled 제거 + srtEntries fallback

**File:** `src/App.jsx`

- [ ] L1118-1125 audio 탭 버튼:
  - `tab-disabled` 클래스 제거
  - `disabled={!audioPackage}` 제거
  - `onClick={() => setActiveTab('audio')}` (조건 제거)
  - count 표시는 `audioPackage` 있을 때만 (현행 유지)
- [ ] L1285 srtEntries prop:
  ```js
  srtEntries={audioPackage?.srtEntries || srtTrackToEntries(scenesHook.srtTrack)}
  ```
  - import: `import { srtTrackToEntries } from './utils/srtTrack'`

### Task 1.5: i18n - 빈 상태/트랙 라벨

**Files:** `src/locales/{ko,en,ja,de}.js`

- [ ] `audioTab.emptyHint`: "🎵 mp3는 Narration 또는 SFX 트랙에, srt는 어디든 끌어다 놓으세요"
- [ ] `audioTab.trackNarration`, `audioTab.trackSfx` (이미 있는지 확인하고 없으면 추가)

---

## Phase 2: 트랙 라인 드래그앤드롭

목표: TrackLane이 자체적으로 드롭을 받고, 트랙 타입에 따라 처리. 패널 레벨에서는 SRT만 받음.

### Task 2.1: Electron IPC - probe-audio-file

**File:** `electron/ipc/filesystem.js`

audioPackage 빌드는 hook 측에서 (이미 가지고 있는 audioPackage에 merge해야 하므로). IPC는 단순히 파일 메타데이터(존재 확인 + duration) 측정만.

`fs:rescan-audio-package` 다음에 추가:

```javascript
// ----------------------------------------------------------
// 23-c. fs:probe-audio-file — 단일 오디오 파일 메타 측정
// 드래그앤드롭 경로용. 파일 존재 확인 + duration 측정.
// ----------------------------------------------------------
ipcMain.handle('fs:probe-audio-file', async (_event, { filePath }) => {
  try {
    if (!filePath || !(await pathExists(filePath))) {
      return { success: false, error: 'File not found' }
    }
    const ext = path.extname(filePath).toLowerCase()
    if (!['.mp3', '.wav', '.m4a', '.mp4'].includes(ext)) {
      return { success: false, error: 'Unsupported format' }
    }
    const durationMs = await getAudioDurationMs(filePath)
    return {
      success: true,
      path: filePath,
      filename: path.basename(filePath),
      durationMs: durationMs || null,
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})
```

- [ ] 위 핸들러 추가
- [ ] `getAudioDurationMs`, `pathExists`는 같은 파일에 이미 존재

### Task 2.2: preload.js - 노출

**File:** `electron/preload.js`

- [ ] `rescanAudioPackage` 다음 줄:
  ```js
  probeAudioFile: (params) => ipcRenderer.invoke('fs:probe-audio-file', params),
  ```
- [ ] `webUtils` import + `getPathForFile` 노출 (Electron 36에서 `File.path` deprecated):
  ```js
  const { contextBridge, ipcRenderer, webUtils } = require('electron')
  // contextBridge.exposeInMainWorld('electronAPI', { ... 안에:
  getPathForFile: (file) => webUtils.getPathForFile(file),
  ```

### Task 2.3: useAudioImport - importMp3ToTrack

**File:** `src/hooks/useAudioImport.js`

```js
const importMp3ToTrack = useCallback(async ({ mp3Path, trackType, timecodeMs }) => {
  if (!mp3Path || !window.electronAPI?.probeAudioFile) return null
  if (!['narration', 'sfx'].includes(trackType)) return null

  const probe = await window.electronAPI.probeAudioFile({ filePath: mp3Path })
  if (!probe?.success) {
    toast.error(t('audioImport.probeFailed').replace('{error}', probe?.error || 'unknown'))
    return null
  }

  setAudioPackage(prev => {
    const folderPath = prev?.folderPath || dirname(mp3Path)  // helper 필요
    const base = prev || { folderPath, media: { video: null, srt: null }, voices: [], sfx: [], srtEntries: [], srtContent: null, sfxTimecodes: [] }

    if (trackType === 'narration') {
      return {
        ...base,
        media: { ...base.media, video: { path: mp3Path, filename: probe.filename, durationMs: probe.durationMs } }
      }
    }

    if (trackType === 'sfx') {
      const next = { ...base, sfx: [...(base.sfx || [])] }
      let cat = next.sfx.find(c => c.category === '_dropped')
      if (!cat) {
        cat = { category: '_dropped', files: [] }
        next.sfx = [...next.sfx, cat]
      } else {
        cat = { ...cat, files: [...cat.files] }
        next.sfx = next.sfx.map(c => c.category === '_dropped' ? cat : c)
      }
      cat.files.push({
        path: mp3Path,
        filename: probe.filename,
        timecodeMs: Math.max(0, Math.round(timecodeMs || 0)),
        durationMs: probe.durationMs,
      })
      return next
    }
    return prev
  })

  // 새 audioTracks 빌드
  setAudioTracks(prev => /* 또는 useEffect로 audioPackage 변경 시 재빌드 */)

  return { success: true }
}, [t])
```

- [ ] `dirname(filePath)` helper (path 모듈은 renderer에서 안 됨 → 문자열 split 또는 path-browserify 사용 또는 IPC가 folderPath도 반환)
  - 더 깔끔: probe IPC가 `folderPath = path.dirname(filePath)`도 반환하게 추가
- [ ] audioTracks 재빌드: audioPackage 변경을 useEffect로 감지해서 `buildAudioTracks` 호출, 또는 setter 안에서 명시
  - 이미 `_processScanResult`가 buildAudioTracks 호출하는 패턴 → 같은 패턴 차용
- [ ] return object에 `importMp3ToTrack` 추가

### Task 2.4: 단위 테스트 - importMp3ToTrack

**File (Create):** `tests/hooks/useAudioImport.importMp3ToTrack.test.js`

- [ ] narration: 빈 상태 → 새 audioPackage with media.video
- [ ] narration: 기존 narration 있음 → 교체
- [ ] sfx: 빈 상태 → 새 audioPackage with sfx=[{ category: '_dropped', files: [1] }]
- [ ] sfx: 기존 SFX 있음 → 같은 `_dropped` 카테고리에 append
- [ ] sfx: 기존 폴더 import 한 sfx 있음 → `_dropped` 카테고리는 별도로 추가됨 (기존 카테고리 보존)
- [ ] probe 실패 → audioPackage 변경 없음 + toast

### Task 2.5: TrackLane 드롭 핸들러

**File:** `src/components/AudioTimeline/TrackLane.jsx`

- [ ] props 추가: `onTrackDrop`, `onTrackDragOver`, `dragOverTrackId`, `pxPerSec`
- [ ] role이 `'narration'` 또는 `'sfx'`인 트랙만 드롭 accept:
  ```js
  const acceptsAudioDrop = track.role === 'narration' || track.role === 'sfx'
  ```
- [ ] 핸들러:
  ```js
  const handleDragOver = (e) => {
    if (!acceptsAudioDrop) return
    // 드래그 중 파일이 오디오일 가능성만 체크 (e.dataTransfer.types에 'Files' 있는지)
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    onTrackDragOver?.(track.id)
  }
  const handleDrop = (e) => {
    if (!acceptsAudioDrop) return
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files || [])
    const mp3s = files.filter(f => /\.(mp3|wav|m4a)$/i.test(f.name))
    if (mp3s.length === 0) return
    // 드롭 x좌표 → ms (라벨 영역 제외)
    const rect = e.currentTarget.getBoundingClientRect()
    const xInLane = e.clientX - rect.left - labelW
    const timecodeMs = Math.max(0, (xInLane / pxPerSec) * 1000)
    onTrackDrop?.({ trackRole: track.role, files: mp3s, timecodeMs })
  }
  ```
- [ ] dragover일 때 className에 `is-drop-target` 추가
- [ ] SRT는 여기서 안 받음 (e.preventDefault 안 함 → bubbling으로 패널 레벨 핸들러로)
  - 또는 명시적으로 srt 파일 발견 시 stopPropagation 안 함

### Task 2.6: AudioTimeline - prop 전달

**File:** `src/components/AudioTimeline/AudioTimeline.jsx`

- [ ] props 추가: `onTrackDrop` (AudioPanel에서 받음)
- [ ] `dragOverTrackId` state 관리
- [ ] TrackLane에 `onTrackDrop`, `onTrackDragOver={setDragOverTrackId}`, `dragOverTrackId`, `pxPerSec={PX_PER_SEC_BASE * zoom}` 전달

### Task 2.7: AudioPanel - SRT 드롭 + 트랙 드롭 라우팅

**File:** `src/components/AudioPanel.jsx`

- [ ] props 추가: `onImportMp3` (= `importMp3ToTrack`), `onSrtImport` (= `handleImport('srt', ...)` 위임)
- [ ] 패널 레벨 onDragOver/onDrop — SRT 파일만 처리 (mp3는 TrackLane이 처리):
  ```js
  const handlePanelDragOver = (e) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
    }
  }
  const handlePanelDrop = async (e) => {
    const files = Array.from(e.dataTransfer.files || [])
    const srt = files.find(f => /\.srt$/i.test(f.name))
    if (!srt) return  // mp3는 TrackLane에서 이미 처리됨
    e.preventDefault()
    const text = await srt.text()
    onSrtImport?.(text)
  }
  ```
- [ ] AudioTimeline에 `onTrackDrop` 핸들러 전달:
  ```js
  const handleTrackDrop = async ({ trackRole, files, timecodeMs }) => {
    for (const file of files) {
      const mp3Path = window.electronAPI?.getPathForFile?.(file)
      if (!mp3Path) continue
      await onImportMp3?.({ mp3Path, trackType: trackRole, timecodeMs })
      // narration은 1개만 의미 있음 → 첫 파일 후 break
      if (trackRole === 'narration') break
    }
  }
  ```

### Task 2.8: CSS - 시각 피드백

**Files:** `src/components/AudioTimeline/AudioTimeline.css`

- [ ] `.track-lane.is-drop-target` → 배경색 강조 + 점선 inner border
- [ ] `.track-lane.is-drop-reject` (선택사항) → 빨강 hint (Image/Subtitle/Voice 라인 위에 드래그 시)

### Task 2.9: App.jsx - 콜백 연결

**File:** `src/App.jsx`

- [ ] useAudioImport에서 `importMp3ToTrack` destructure 추가
- [ ] AudioPanel props:
  ```jsx
  onImportMp3={importMp3ToTrack}
  onSrtImport={(content) => handleImport('srt', content)}
  ```

### Task 2.10: i18n - 드롭 안내/거부

**Files:** ko/en/ja/de

- [ ] `audioImport.probeFailed`
- [ ] `audioTab.dropVoiceUseFolder`: "Voice는 폴더로 가져오기를 사용하세요"
- [ ] `audioTab.dropOnNarrationOrSfx`: "Narration 또는 SFX 트랙 위에 끌어다 놓으세요" (선택)

### Task 2.11: 테스트 - TrackLane 드롭

**File (Create):** `tests/components/AudioTimeline/TrackLane.drop.test.jsx`

- [ ] narration role + mp3 드롭 → `onTrackDrop` 호출 with `trackRole: 'narration'`, timecodeMs ≈ 계산값
- [ ] sfx role + mp3 드롭, x좌표=300px, pxPerSec=100 → `timecodeMs ≈ 3000`
- [ ] image role + mp3 드롭 → `onTrackDrop` 호출 안 됨 (preventDefault 안 함)
- [ ] dragOver 시 className에 `is-drop-target` 추가

### Task 2.12: 테스트 - AudioPanel 라우팅

**File (Create):** `tests/components/AudioPanel.dragdrop.test.jsx`

- [ ] mock electronAPI: `getPathForFile`, `probeAudioFile`
- [ ] 패널에 SRT 파일 드롭 → `onSrtImport(content)` 호출
- [ ] TrackLane onTrackDrop → `onImportMp3({ mp3Path, trackType, timecodeMs })` 호출
- [ ] mp3 + srt 동시 드롭(여러 파일) → mp3는 트랙으로, srt는 패널 onSrtImport로

### Task 2.13: 테스트 - IPC probe

**File (Create):** `tests/electron/ipc/filesystem.probe-audio.test.js`

- [ ] 유효한 mp3 → success, filename, durationMs
- [ ] 잘못된 경로 → success: false
- [ ] 미지원 확장자 → success: false

---

## 검증 (수동 + 자동)

### 자동
- [ ] `npm run test:run` 전체 통과
- [ ] 신규 테스트 5개 파일 통과

### 수동
- [ ] 빈 프로젝트 → Audio 탭 클릭 → 빈 Narration/SFX 트랙 placeholder 표시 + hint overlay
- [ ] Text/CSV import로 씬 생성 → Audio 탭 → Image 트랙 표시 (이미지 썸네일 또는 빈 슬롯)
- [ ] SRT 파일을 Audio 탭 어디든 드롭 → SceneList에 씬 생성 + 자막 트랙 표시
- [ ] mp3 파일을 Narration 라인 위에 드롭 → Narration 트랙에 표시
- [ ] mp3 파일을 SFX 라인의 x=12:34 위치에 드롭 → SFX 클립이 12:34에 배치
- [ ] mp3 파일을 Image 라인에 드롭 → 무시 (반응 없음 or 거부 toast)
- [ ] mp3 + srt 동시 드롭 (Narration 라인 위에) → mp3는 narration, srt는 import 모달 흐름
- [ ] 기존 srtTrack 있는 상태에서 SRT 드롭 → SrtImportConflictModal
- [ ] CapCut 내보내기 → Narration + SFX 트랙 모두 export됨 (수동 확인)
- [ ] 회귀: 기존 ImportModal → 🎵 폴더 import 그대로 동작

---

## Out of Scope (이번 작업 제외)

- Voice 트랙 드롭 (캐릭터 선택 UI 필요)
- 여러 mp3 동시 드롭에서 각각 다른 위치 (현재는 동일 timecode로 들어감, 후처리 드래그로 보정)
- 비-오디오/SRT 파일 드롭 시 명시적 거부 toast (현재는 무시)
- 드롭 undo
- 패널 외부에서 글로벌 드롭 받기
- SRT를 특정 라인 위에 명시적으로 드롭 vs 패널 어디든 — 후자로 통일
