# Per-clip 영상 on/off (export 큐레이션) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타임라인에서 영상 클립(i2v/t2v)을 호버 👁 로 on/off 해, 꺼진 클립을 export·프리뷰에서 제외(이미지는 베이스로 남음 → "스틸 씬" 큐레이션).

**Architecture:** 씬에 source별 boolean `videoI2VDisabled`/`videoT2VDisabled`(falsy=켜짐, true=꺼짐)를 단일 진실원천으로 둔다. export(`resolveExportVideos`)·프리뷰(`PreviewPanel`)·SceneList ✓·타임라인 dim 이 모두 이 플래그를 읽는다. `computeVideoClipPlacement`는 disabled-agnostic(타임라인은 dim 으로 유지, 프리뷰/export만 제외). 재생성/clear 시 플래그를 reset(null).

**Tech Stack:** React, Vitest + @testing-library/react. 기존 패턴: `TimelineFlagButton`(stopPropagation), `sceneMedia.js`(export 결정), `useAudioTimeline`(클립 빌드), `PreviewPanel`(모니터).

**Spec:** `docs/superpowers/specs/2026-06-04-per-clip-video-toggle-design.md`

---

### Task 1: Export — `resolveExportVideos` 가 disabled source 제외

**Files:**
- Modify: `src/utils/sceneMedia.js:44-52` (`resolveExportVideos`)
- Test: `tests/utils/sceneMedia.test.js` (기존 `resolveExportVideos` describe 에 추가)

- [ ] **Step 1: 실패 테스트 추가**

`tests/utils/sceneMedia.test.js` 의 `describe('resolveExportVideos ...')` 블록 안(마지막 `it` 다음)에 추가:

```js
  it('videoI2VDisabled=true → i2v 제외(t2v만)', () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, videoI2VDisabled: true }).map(v => v.source)).toEqual(['t2v'])
  })
  it('videoT2VDisabled=true → t2v 제외(i2v만)', () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, videoT2VDisabled: true }).map(v => v.source)).toEqual(['i2v'])
  })
  it('둘 다 disabled → 빈 배열(이미지만 export)', () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, videoI2VDisabled: true, videoT2VDisabled: true })).toEqual([])
  })
  it('disabled=null/false 는 켜짐(falsy)', () => {
    expect(resolveExportVideos({ ...i2v, videoI2VDisabled: null }).map(v => v.source)).toEqual(['i2v'])
    expect(resolveExportVideos({ ...i2v, videoI2VDisabled: false }).map(v => v.source)).toEqual(['i2v'])
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/utils/sceneMedia.test.js`
Expected: FAIL — disabled 무시하고 둘 다 반환(`['i2v','t2v']`).

- [ ] **Step 3: 구현**

`src/utils/sceneMedia.js` 의 `resolveExportVideos` 본문에서 i2v/t2v 후보 조건에 `&& !disabled` 추가:

```js
export function resolveExportVideos(scene) {
  if (!scene) return []
  const i2v = (scene.videoI2V || scene.videoI2VPath) && !scene.videoI2VDisabled
    ? { source: 'i2v', path: scene.videoI2VPath || null, data: scene.videoI2V || null, duration: scene.videoI2VDuration ?? null }
    : null
  const t2v = (scene.videoT2V || scene.videoT2VPath) && !scene.videoT2VDisabled
    ? { source: 't2v', path: scene.videoT2VPath || null, data: scene.videoT2V || null, duration: scene.videoT2VDuration ?? null }
    : null
  return [i2v, t2v].filter(Boolean) // 있는 영상 다 (i2v 먼저), disabled 제외
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/utils/sceneMedia.test.js`
Expected: PASS (전체). `getExportFilePaths` 는 `resolveExportVideos` 를 쓰므로 disabled path 자동 제외 — 별도 변경 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/utils/sceneMedia.js tests/utils/sceneMedia.test.js
git commit -m "feat(export): resolveExportVideos excludes disabled video sources"
```

---

### Task 2: SceneList ✓ 가 disabled 반영 (통합 가드)

`resolveExportVideos` 가 disabled 를 빼므로 SceneList 의 `exportedSources` 도 자동으로 빠진다(코드 변경 없음). 회귀 가드 테스트만 추가.

**Files:**
- Test: `tests/components/SceneList.exportMedia.test.jsx` (기존 describe 에 추가)

- [ ] **Step 1: 실패 테스트 추가**

`describe('SceneList Media 컬럼 — B1 ...')` 안에 추가:

```js
  it('videoI2VDisabled=true → I2V thumb ✓ 안 됨(썸네일은 렌더), T2V 는 ✓', () => {
    const { container } = renderRow(bothScene({ videoI2VDisabled: true }))
    expect(thumbFor(container, 'I2V').classList.contains('selected')).toBe(false)
    expect(thumbFor(container, 'T2V').classList.contains('selected')).toBe(true)
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/SceneList.exportMedia.test.jsx`
Expected: 만약 Task 1 이 머지됐다면 이 테스트는 **즉시 PASS**(자동 반영). 그 경우 RED 단계를 만들기 위해, 먼저 이 테스트만 추가하고 Task 1 전에 실행하면 FAIL. **권장 순서: Task 1 → Task 2** 이므로 여기선 PASS 확인이면 충분(통합 가드 목적). PASS 안 되면 SceneList 가 `resolveExportVideos` 가 아닌 다른 경로로 ✓ 를 계산하는 것이니 조사.

- [ ] **Step 3: 커밋**

```bash
git add tests/components/SceneList.exportMedia.test.jsx
git commit -m "test(scenelist): disabled video thumb is not marked exported"
```

---

### Task 3: 타임라인 — `buildVideoClips` 가 disabled 클립을 `disabled:true` 로 표시(렌더 유지)

**Files:**
- Modify: `src/components/AudioTimeline/useAudioTimeline.js:187-224` (`buildVideoClips`)
- Test: `tests/components/AudioTimeline/useAudioTimeline.test.js`

- [ ] **Step 1: 실패 테스트 추가**

`tests/components/AudioTimeline/useAudioTimeline.test.js` 에 새 테스트 추가(파일 상단 import 와 기존 helper 활용; `renderHook(() => useAudioTimeline(pkg, scenes, srt))` 패턴은 같은 파일의 기존 테스트를 그대로 따른다):

```js
  it('disabled 인 영상 클립도 트랙에 존재하되 disabled:true(타임라인 dim 유지)', () => {
    const scenes = [{
      id: 'scene_1', startTime: 0, endTime: 3, duration: 3,
      imagePath: '/i.png',
      videoI2VPath: '/i.mp4', videoI2VDuration: 2, videoI2VDisabled: true,
    }]
    const { result } = renderHook(() => useAudioTimeline(null, scenes, []))
    const i2vTrack = result.current.tracks.find(t => t.role === 'video-i2v')
    expect(i2vTrack).toBeTruthy()
    const clip = i2vTrack.clips.find(c => c.sceneRef.id === 'scene_1')
    expect(clip).toBeTruthy()          // 사라지면 안 됨
    expect(clip.disabled).toBe(true)   // dim 표시용
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/AudioTimeline/useAudioTimeline.test.js`
Expected: FAIL — `clip.disabled` 가 `undefined`.

- [ ] **Step 3: 구현**

`src/components/AudioTimeline/useAudioTimeline.js` 의 `buildVideoClips` 안에서, source 의 disabled 값을 한 번 계산하고 두 return(placeholder + full)에 `disabled` 를 넣는다.

`const isGenerating = ...` 다음 줄에 추가:

```js
        const isDisabled = source === 'i2v' ? !!s.videoI2VDisabled : !!s.videoT2VDisabled
```

placeholder return 객체에 `disabled` 추가:

```js
            return {
              id: `vid-${source}-${s.id}`, startMs: range.startMs, endMs: range.endMs,
              videoPath: null, videoSrc: null, generating: true, placeholder: true,
              sceneRef: s, color: COLORS.video, role: `video-${source}`, disabled: isDisabled,
            }
```

full return 객체에 `disabled` 추가(`role: \`video-${source}\`,` 다음 줄):

```js
          role: `video-${source}`,
          disabled: isDisabled,
        }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/AudioTimeline/useAudioTimeline.test.js`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/components/AudioTimeline/useAudioTimeline.js tests/components/AudioTimeline/useAudioTimeline.test.js
git commit -m "feat(timeline): mark disabled video clips (disabled:true) — kept dim, not removed"
```

---

### Task 4: 프리뷰 — disabled source 제외(헬퍼 분리 + PreviewPanel active/prefetch 적용)

placement 함수는 disabled-agnostic 유지. 프리뷰 가시성 판정을 순수 헬퍼로 분리해 unit 테스트.

**Files:**
- Modify: `src/components/AudioTimeline/useAudioTimeline.js` (헬퍼 `isPreviewVideoVisible` 추가, `computeVideoClipPlacement` 근처)
- Modify: `src/components/AudioTimeline/PreviewPanel.jsx:100-101, 128-129`
- Test: `tests/components/AudioTimeline/videoClipPlacement.test.js`

- [ ] **Step 1: 실패 테스트 추가**

`tests/components/AudioTimeline/videoClipPlacement.test.js` 상단 import 에 `isPreviewVideoVisible` 추가하고(같은 모듈에서 export), describe 추가:

```js
import { computeVideoClipPlacement, isPreviewVideoVisible } from '../../../src/components/AudioTimeline/useAudioTimeline'

describe('isPreviewVideoVisible', () => {
  const EMPTY = new Set()
  it('disabled 없으면 보임', () => {
    expect(isPreviewVideoVisible({}, 'i2v', EMPTY)).toBe(true)
  })
  it('videoI2VDisabled=true → i2v 안 보임', () => {
    expect(isPreviewVideoVisible({ videoI2VDisabled: true }, 'i2v', EMPTY)).toBe(false)
  })
  it('hiddenRoles(View off) 도 안 보임', () => {
    expect(isPreviewVideoVisible({}, 'i2v', new Set(['video-i2v']))).toBe(false)
  })
  it('t2v disabled 는 i2v 에 영향 없음', () => {
    expect(isPreviewVideoVisible({ videoT2VDisabled: true }, 'i2v', EMPTY)).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/AudioTimeline/videoClipPlacement.test.js`
Expected: FAIL — `isPreviewVideoVisible` is not a function (export 없음).

- [ ] **Step 3: 구현 — 헬퍼**

`src/components/AudioTimeline/useAudioTimeline.js` 에서 `computeVideoClipPlacement` 함수 바로 위에 추가:

```js
// 프리뷰 모니터에서 이 source 영상이 보이는지: View 토글(hiddenRoles)과 per-clip disabled 둘 다 고려.
// (export 는 disabled 만 보지만 — resolveExportVideos — 프리뷰는 View 토글도 합쳐서 본다.)
export function isPreviewVideoVisible(scene, source, hiddenRoles) {
  if (!scene) return false
  if (hiddenRoles && hiddenRoles.has(`video-${source}`)) return false
  return source === 'i2v' ? !scene.videoI2VDisabled : !scene.videoT2VDisabled
}
```

- [ ] **Step 4: 헬퍼 통과 확인**

Run: `npx vitest run tests/components/AudioTimeline/videoClipPlacement.test.js`
Expected: PASS.

- [ ] **Step 5: PreviewPanel active 적용**

`src/components/AudioTimeline/PreviewPanel.jsx` 상단 import 에 헬퍼 추가:

```js
import { computeVideoClipPlacement, getSceneTimeRangeMs, isPreviewVideoVisible } from './useAudioTimeline'
```

active 블록(100-101) 교체:

```js
    const i2v = isPreviewVideoVisible(scene, 'i2v', hiddenRoles) ? computeVideoClipPlacement(scene, range.startMs, range.endMs, 'i2v') : null
    const t2v = isPreviewVideoVisible(scene, 't2v', hiddenRoles) ? computeVideoClipPlacement(scene, range.startMs, range.endMs, 't2v') : null
```

prefetch 블록(128-129) 교체:

```js
      const i2v = isPreviewVideoVisible(r.scene, 'i2v', hiddenRoles) ? computeVideoClipPlacement(r.scene, r.startMs, r.endMs, 'i2v') : null
      const t2v = isPreviewVideoVisible(r.scene, 't2v', hiddenRoles) ? computeVideoClipPlacement(r.scene, r.startMs, r.endMs, 't2v') : null
```

- [ ] **Step 6: 컴포넌트 가드 — PreviewPanel 렌더 video src 가 disabled 제외**

`tests/components/AudioTimeline/PreviewPanel.test.jsx` 에 추가(기존 렌더 헬퍼/패턴 따름. disabled i2v + playhead 가 i2v 구간이면, 렌더된 visible `<video>` 의 src 가 i2v 가 아님):

```js
  it('videoI2VDisabled 면 i2v 구간 playhead 라도 i2v 영상은 모니터에 안 잡힘', () => {
    const scene = {
      id: 'scene_1', startTime: 0, endTime: 4, duration: 4, imagePath: '/i.png',
      videoI2VPath: '/i.mp4', videoI2VDuration: 4, videoI2VDisabled: true,
    }
    const { container } = render(<PreviewPanel playheadMs={1000} scenes={[scene]} srtEntries={[]} />)
    const vids = [...container.querySelectorAll('video')]
    expect(vids.every(v => !(v.getAttribute('src') || '').includes('i.mp4'))).toBe(true)
  })
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/components/AudioTimeline/PreviewPanel.test.jsx tests/components/AudioTimeline/videoClipPlacement.test.js`
Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add src/components/AudioTimeline/useAudioTimeline.js src/components/AudioTimeline/PreviewPanel.jsx tests/components/AudioTimeline/videoClipPlacement.test.js tests/components/AudioTimeline/PreviewPanel.test.jsx
git commit -m "feat(preview): exclude disabled video sources from monitor + prefetch"
```

---

### Task 5: 보존 — CSV 재파싱 allowlist 에 disabled 추가

CSV 새 형식 merge 는 `parsedScene` 기반 명시 allowlist 라 새 필드를 추가해야 보존된다. (SRT `parseFromSRT` 는 `{...scene}` spread 라 자동 보존 — 손대지 않음.)

**Files:**
- Modify: `src/hooks/useScenes.js:~196` (CSV merge 보존 블록, `videoI2VDuration: existing.videoI2VDuration,` 다음)
- Test: `tests/hooks/useScenes.preserveDisabled.test.js` (신규)

- [ ] **Step 1: 실패 테스트 작성**

`tests/hooks/useScenes.preserveDisabled.test.js` (신규). CSV 재파싱 경로(`parseFromCSV` 새 형식)가 기존 씬의 `videoI2VDisabled` 를 보존하는지. 기존 useScenes 테스트의 렌더/parse 패턴을 따른다. 새 CSV 형식 헤더는 `parseSceneCSVToTracks` 가 인식하는 형식이어야 하므로, 기존 useScenes CSV 테스트가 있으면 그 CSV 샘플을 재사용한다.

```js
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

// 새 CSV 형식 최소 샘플 — 기존 useScenes CSV 테스트의 헤더/행 형식을 그대로 사용할 것.
// (parseSceneCSVToTracks 가 isNewSceneCSVFormat 으로 인식해야 merge 분기로 들어감)
const CSV = `scene,subtitle,duration\n1,hello,3\n`

describe('useScenes — disabled 플래그 CSV 재파싱 보존', () => {
  it('videoI2VDisabled 설정 후 CSV 재파싱 → 보존', () => {
    const { result } = renderHook(() => useScenes(3))
    act(() => { result.current.parseFromCSV(CSV) })
    const id = result.current.scenes[0].id
    act(() => { result.current.updateScene(id, { videoI2VPath: '/i.mp4', videoI2VDisabled: true }) })
    act(() => { result.current.parseFromCSV(CSV) }) // 재파싱
    expect(result.current.scenes[0].videoI2VDisabled).toBe(true)
  })
})
```

> 구현자 노트: 위 CSV/`useScenes` 호출 시그니처는 **기존 useScenes 테스트 파일**(`tests/hooks/` 내)에서 실제 형식을 복사해 맞출 것. 핵심 단언은 "재파싱 후 `videoI2VDisabled` 보존".

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/hooks/useScenes.preserveDisabled.test.js`
Expected: FAIL — 재파싱 후 `videoI2VDisabled` 가 `undefined`.

- [ ] **Step 3: 구현**

`src/hooks/useScenes.js` CSV merge 보존 블록(`videoT2VDuration: existing.videoT2VDuration,` / `videoI2VDuration: existing.videoI2VDuration,` 줄들 근처)에 추가:

```js
          videoT2VDuration: existing.videoT2VDuration,
          videoI2VDuration: existing.videoI2VDuration,
          // per-clip export 토글 — 재파싱에도 보존
          videoT2VDisabled: existing.videoT2VDisabled,
          videoI2VDisabled: existing.videoI2VDisabled,
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/hooks/useScenes.preserveDisabled.test.js`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/useScenes.js tests/hooks/useScenes.preserveDisabled.test.js
git commit -m "fix(scenes): preserve video*Disabled across CSV re-parse merge"
```

---

### Task 6: 재생성/clear 라이프사이클 — disabled reset(null)

새 generation 제출(path clear)·완료(path set) 시 해당 source 의 `video*Disabled` 를 `null` 로 reset. 테스트 가능하도록 clear 패치를 순수 헬퍼로 묶는다.

**Files:**
- Modify: `src/utils/sceneMedia.js` (헬퍼 `videoClearPatch` 추가)
- Modify: `src/App.jsx` (clear: ~997 T2V, ~1098 I2V, ~1776 I2V복원 / 완료: ~987 T2V, ~1085 I2V)
- Test: `tests/utils/sceneMedia.test.js`

- [ ] **Step 1: 실패 테스트 추가**

`tests/utils/sceneMedia.test.js` 에 describe 추가:

```js
describe('videoClearPatch (재생성/clear 시 영상 필드 초기화 — disabled reset 포함)', () => {
  it("'i2v' → i2v 필드 전부 null + videoI2VDisabled:null", () => {
    expect(videoClearPatch('i2v')).toEqual({
      videoI2V: null, videoI2VPath: null, videoI2VDuration: null, videoI2VDisabled: null,
    })
  })
  it("'t2v' → t2v 필드 전부 null + videoT2VDisabled:null", () => {
    expect(videoClearPatch('t2v')).toEqual({
      videoT2V: null, videoT2VPath: null, videoT2VDuration: null, videoT2VDisabled: null,
    })
  })
})
```

import 줄(파일 상단)에 `videoClearPatch` 추가:

```js
import {
  resolveExportVideos,
  hasExportableMedia,
  getExportFilePaths,
  videoClearPatch,
} from '../../src/utils/sceneMedia'
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/utils/sceneMedia.test.js`
Expected: FAIL — `videoClearPatch` is not a function.

- [ ] **Step 3: 헬퍼 구현**

`src/utils/sceneMedia.js` 끝(또는 `isFilePath` 위)에 추가:

```js
/**
 * 새 generation 제출/clear 시 해당 source 의 영상 필드를 초기화하는 patch.
 * per-clip `video*Disabled` 도 reset(null) — 재생성한 클립은 "새 클립" = enabled.
 * @param {'i2v'|'t2v'} source
 */
export function videoClearPatch(source) {
  return source === 'i2v'
    ? { videoI2V: null, videoI2VPath: null, videoI2VDuration: null, videoI2VDisabled: null }
    : { videoT2V: null, videoT2VPath: null, videoT2VDuration: null, videoT2VDisabled: null }
}
```

- [ ] **Step 4: 헬퍼 통과 확인**

Run: `npx vitest run tests/utils/sceneMedia.test.js`
Expected: PASS.

- [ ] **Step 5: App clear 사이트에 헬퍼 적용**

`src/App.jsx` 상단 sceneMedia import 에 `videoClearPatch` 추가(기존 `import { ... } from './utils/sceneMedia'` 확인 후 없으면 추가).

T2V 새 제출 clear(약 line 997, `videoT2VPath: null` 들어간 `updateScene` 패치):
```js
                scenesHook.updateScene(sceneId, videoClearPatch('t2v'))
```
I2V 새 제출 clear(약 line 1096-1098):
```js
                  scenesHook.updateScene(fp.ownerSceneId, videoClearPatch('i2v'))
```
I2V clear/복원(약 line 1776, 기존에 `videoI2VGeneratedAt: null` 추가돼 있음 — 유지):
```js
              scenesHook.updateScene(fp.ownerSceneId, { ...videoClearPatch('i2v'), videoI2VGeneratedAt: null })
```

> 구현자 노트: 각 사이트의 **기존 패치 내용과 동일**하되 `videoClearPatch` 가 `video*`/`*Path`/`*Duration`/`*Disabled` 를 덮는다. 사이트가 추가 필드(예: GeneratedAt)를 갖고 있으면 위처럼 spread 후 덧붙인다.

- [ ] **Step 6: App 완료 사이트에 disabled reset 추가**

T2V 완료(약 line 985-990) 패치에 `videoT2VDisabled: null` 추가:
```js
              scenesHook.updateScene(sceneId, {
                ...(result?.base64 ? { videoT2V: result.base64 } : {}),
                videoT2VPath: result.videoPath || null,
                ...(result?.duration ? { videoT2VDuration: result.duration } : {}),
                videoT2VDisabled: null,
              })
```
I2V 완료(약 line 1083-1086, `videoI2VPath: result.videoPath` 패치)에 `videoI2VDisabled: null` 추가(같은 패턴).

- [ ] **Step 7: 적용 누락 가드(grep)**

Run: `grep -n "videoClearPatch\|videoT2VDisabled: null\|videoI2VDisabled: null" src/App.jsx`
Expected: clear 3곳(`videoClearPatch`) + 완료 2곳(`video*Disabled: null`) 모두 보임.

- [ ] **Step 8: 전체 통과 확인**

Run: `npm run test:run`
Expected: PASS (회귀 없음). App 핸들러는 deep wiring 이라 unit 대신 `videoClearPatch` 단위 + grep 으로 가드(실제 재생성은 Task 8 수동 검증).

- [ ] **Step 9: 커밋**

```bash
git add src/utils/sceneMedia.js src/App.jsx tests/utils/sceneMedia.test.js
git commit -m "feat(lifecycle): reset video*Disabled on (re)generation submit/complete/clear"
```

---

### Task 7: 타임라인 eye 버튼 + 배선(App→…→Clip)

**Files:**
- Create: `src/components/AudioTimeline/TimelineVideoToggleButton.jsx`
- Modify: `src/components/AudioTimeline/Clip.jsx` (props + 버튼 렌더 + dim)
- Modify: `src/components/AudioTimeline/TrackLane.jsx` (prop 통과)
- Modify: `src/components/AudioTimeline/AudioTimeline.jsx` (`onSceneUpdate` prop + `handleToggleVideo` + TrackLane 전달)
- Modify: `src/components/AudioPanel.jsx` (prop 통과)
- Modify: `src/components/LiveTimeline.jsx` (prop 통과)
- Modify: `src/App.jsx:1436, 1660` (`onSceneUpdate={scenesHook.updateScene}`)
- Modify: `src/components/AudioTimeline/AudioTimeline.css` (dim 스타일)
- Test: `tests/components/AudioTimeline/TimelineVideoToggleButton.test.jsx`, `tests/components/AudioTimeline/Clip.test.jsx`

- [ ] **Step 1: 버튼 실패 테스트**

`tests/components/AudioTimeline/TimelineVideoToggleButton.test.jsx` (신규):

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
vi.mock('../../../src/hooks/useI18n', () => ({ useI18n: () => ({ t: (k) => k }) }))
import TimelineVideoToggleButton from '../../../src/components/AudioTimeline/TimelineVideoToggleButton'

describe('TimelineVideoToggleButton', () => {
  it('클릭 → onToggle 호출', () => {
    const onToggle = vi.fn()
    const { getByRole } = render(<TimelineVideoToggleButton disabled={false} onToggle={onToggle} />)
    fireEvent.click(getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
  it('클릭 시 이벤트 전파 차단(stopPropagation)', () => {
    const onToggle = vi.fn()
    const parentClick = vi.fn()
    const { getByRole } = render(
      <div onClick={parentClick}><TimelineVideoToggleButton disabled onToggle={onToggle} /></div>
    )
    fireEvent.click(getByRole('button'))
    expect(onToggle).toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/AudioTimeline/TimelineVideoToggleButton.test.jsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 버튼 구현**

`src/components/AudioTimeline/TimelineVideoToggleButton.jsx` (신규):

```jsx
import { useI18n } from '../../hooks/useI18n'

// 영상 클립 export 포함/제외 토글 — Clip 의 video clip 에만 렌더.
// disabled=true 면 제외 상태(👁 off). TimelineFlagButton 과 동일한 전파 차단 패턴.
export default function TimelineVideoToggleButton({ disabled, narrow, onToggle }) {
  const { t } = useI18n()
  const label = disabled
    ? (t('timeline.includeClip') || 'Include in export')
    : (t('timeline.excludeClip') || 'Exclude from export')
  const handleClick = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onToggle?.()
  }
  return (
    <button
      type="button"
      className={`atl-clip-action-btn atl-clip-eye-btn${disabled ? ' is-off' : ''}${narrow ? ' is-narrow' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-pressed={disabled ? 'true' : 'false'}
    >
      {disabled ? '🚫' : '👁'}
    </button>
  )
}
```

- [ ] **Step 4: 버튼 통과 확인**

Run: `npx vitest run tests/components/AudioTimeline/TimelineVideoToggleButton.test.jsx`
Expected: PASS.

- [ ] **Step 5: Clip 실패 테스트(eye 렌더 + 전파)**

`tests/components/AudioTimeline/Clip.test.jsx` (신규 또는 기존에 추가):

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
vi.mock('../../../src/hooks/useI18n', () => ({ useI18n: () => ({ t: (k) => k }) }))
import Clip from '../../../src/components/AudioTimeline/Clip'

const vidClip = (extra = {}) => ({
  id: 'vid-i2v-scene_1', startMs: 0, endMs: 3000, color: '#888',
  role: 'video-i2v', sceneRef: { id: 'scene_1' }, ...extra,
})

describe('Clip — 영상 eye 토글', () => {
  it('video clip + onToggleVideo → eye 버튼 렌더', () => {
    const { container } = render(
      <Clip clip={vidClip()} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} onToggleVideo={vi.fn()} />
    )
    expect(container.querySelector('.atl-clip-eye-btn')).toBeTruthy()
  })
  it('eye 클릭 → onToggleVideo(clip) 호출, onClickClip 은 미발화(전파 차단)', () => {
    const onToggleVideo = vi.fn()
    const onClickClip = vi.fn()
    const clip = vidClip()
    const { container } = render(
      <Clip clip={clip} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000}
            onToggleVideo={onToggleVideo} onClickClip={onClickClip} />
    )
    fireEvent.click(container.querySelector('.atl-clip-eye-btn'))
    expect(onToggleVideo).toHaveBeenCalledWith(clip)
    expect(onClickClip).not.toHaveBeenCalled()
  })
  it('disabled 클립 → atl-clip-disabled 클래스(dim)', () => {
    const { container } = render(
      <Clip clip={vidClip({ disabled: true })} variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} onToggleVideo={vi.fn()} />
    )
    expect(container.querySelector('.atl-clip-disabled')).toBeTruthy()
  })
  it('non-video clip(이미지) → eye 버튼 없음', () => {
    const { container } = render(
      <Clip clip={{ id: 'img-1', startMs: 0, endMs: 3000, color: '#888', role: 'image', imagePath: '/i.png' }}
            variant="block" pxPerMs={0.1} height={40} totalDurationMs={3000} onToggleVideo={vi.fn()} />
    )
    expect(container.querySelector('.atl-clip-eye-btn')).toBeFalsy()
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run tests/components/AudioTimeline/Clip.test.jsx`
Expected: FAIL — eye 버튼/클래스 없음.

- [ ] **Step 7: Clip 구현**

`src/components/AudioTimeline/Clip.jsx`:

import 추가(상단):
```js
import TimelineVideoToggleButton from './TimelineVideoToggleButton'
```

props 에 `onToggleVideo` 추가(line 8):
```js
export default function Clip({ clip, variant, pxPerMs, height, onClickClip, onDragClip, totalDurationMs, isPlaying, onSceneHover, onFlag, isFlagged, onToggleVideo }) {
```

`showActionable` 다음(line 13 근처)에 추가:
```js
  const isVideoClip = clip.role === 'video-i2v' || clip.role === 'video-t2v'
  const showVideoToggle = isVideoClip && !!onToggleVideo
```

루트 div className(line 90)에 disabled dim 클래스 추가:
```js
      className={`atl-clip atl-clip-${variant}${isPlaying ? ' atl-clip-playing' : ''}${isDragging ? ' atl-clip-dragging' : ''}${flagged ? ' atl-clip-flagged' : ''}${clip.disabled ? ' atl-clip-disabled' : ''}`}
```

TimelineFlagButton 블록(line 116-124) 다음에 eye 버튼 추가:
```js
      {showVideoToggle && !isDragging && (
        <TimelineVideoToggleButton
          disabled={!!clip.disabled}
          narrow={width < 40}
          onToggle={() => onToggleVideo(clip)}
        />
      )}
```

- [ ] **Step 8: Clip 통과 확인**

Run: `npx vitest run tests/components/AudioTimeline/Clip.test.jsx`
Expected: PASS.

> 전파 차단 주: 버튼의 `onPointerDown` stopPropagation 이 Clip 루트 `onPointerDown`(드래그/클릭 판정)을 막아 `onClickClip` 이 안 터진다. jsdom 에서 `fireEvent.click` 은 pointerdown→pointerup→click 순서를 자동 합성하지 않으므로, 위 테스트는 click 단계의 stopPropagation(부모 onClick 미발화)으로 검증한다. 루트 onClickClip 은 pointerup 경로라 click 합성과 무관 — onToggleVideo 만 호출되는지로 충분.

- [ ] **Step 9: dim CSS 추가**

`src/components/AudioTimeline/AudioTimeline.css` 끝에 추가:
```css
/* per-clip export 제외(disabled) — dim 으로 표시(타임라인엔 남김) */
.atl-clip-disabled { opacity: 0.4; }
.atl-clip-eye-btn.is-off { opacity: 0.6; }
```

- [ ] **Step 10: 배선 — TrackLane**

`src/components/AudioTimeline/TrackLane.jsx`:
props(line 9)에 `onToggleVideo` 추가:
```js
  onClipClick, onClipDrag, totalDurationMs, playingClipIds, onSceneHover, onFlag, isFlagged, onToggleVideo,
```
`<Clip ... />`(line 71-83 블록)에 전달:
```js
          onFlag={onFlag}
          isFlagged={isFlagged}
          onToggleVideo={onToggleVideo}
```

- [ ] **Step 11: 배선 — AudioTimeline (onSceneUpdate + handleToggleVideo)**

`src/components/AudioTimeline/AudioTimeline.jsx`:
props(line 78)에 `onSceneUpdate` 추가:
```js
export default function AudioTimeline({ audioPackage, scenes, srtEntries, onClipSelect, onSaveTimecodeOverride, disabled = false, onFlag, isFlagged, onTrackDrop, compact = false, onPlayheadChange, onPlayingChange, onHiddenRolesChange, onSceneUpdate }) {
```
컴포넌트 본문(예: `const { t } = useI18n()` 다음)에 핸들러 추가:
```js
  const handleToggleVideo = useCallback((clip) => {
    if (!onSceneUpdate || !clip?.sceneRef) return
    const source = clip.role === 'video-i2v' ? 'i2v' : 't2v'
    const field = source === 'i2v' ? 'videoI2VDisabled' : 'videoT2VDisabled'
    onSceneUpdate(clip.sceneRef.id, { [field]: clip.sceneRef[field] ? null : true })
  }, [onSceneUpdate])
```
`<TrackLane ... />`(line 1133 근처, onFlag 전달부)에 추가:
```js
                  onFlag={onFlag}
                  isFlagged={isFlagged}
                  onToggleVideo={onSceneUpdate ? handleToggleVideo : undefined}
```

- [ ] **Step 12: 배선 — AudioPanel / LiveTimeline / App**

`src/components/AudioPanel.jsx`: 컴포넌트 props 에 `onSceneUpdate` 추가하고 `<AudioTimeline ... />`(line ~191)에 `onSceneUpdate={onSceneUpdate}` 전달.

`src/components/LiveTimeline.jsx`: 컴포넌트 props 에 `onSceneUpdate` 추가하고 `<AudioTimeline ... />`(line ~45)에 `onSceneUpdate={onSceneUpdate}` 전달.

`src/App.jsx`:
- `<AudioPanel`(line 1436)에 `onSceneUpdate={scenesHook.updateScene}` 추가.
- `<LiveTimeline`(line 1660)에 `onSceneUpdate={scenesHook.updateScene}` 추가.

- [ ] **Step 13: AudioTimeline 배선 통합 테스트**

`tests/components/AudioTimeline/AudioTimeline.test.jsx` 에 추가(기존 렌더 패턴 따름). i2v 영상 있는 씬 + `onSceneUpdate` → eye 클릭 시 `onSceneUpdate('scene_1', { videoI2VDisabled: true })`:

```jsx
  it('영상 클립 eye 클릭 → onSceneUpdate(sceneId, { videoI2VDisabled: true })', () => {
    const onSceneUpdate = vi.fn()
    const scenes = [{ id: 'scene_1', startTime: 0, endTime: 3, duration: 3, imagePath: '/i.png', videoI2VPath: '/i.mp4', videoI2VDuration: 3 }]
    const { container } = render(<AudioTimeline audioPackage={null} scenes={scenes} srtEntries={[]} onSceneUpdate={onSceneUpdate} />)
    const eye = container.querySelector('.atl-clip-eye-btn')
    expect(eye).toBeTruthy()
    fireEvent.click(eye)
    expect(onSceneUpdate).toHaveBeenCalledWith('scene_1', { videoI2VDisabled: true })
  })
```

> 구현자 노트: AudioTimeline 렌더에 필요한 mock(useI18n 등)은 기존 `AudioTimeline.test.jsx` 상단 설정을 그대로 사용. eye 가 안 보이면 비디오 트랙이 렌더됐는지(씬에 videoI2VPath/Duration) 확인.

- [ ] **Step 14: 전체 통과 확인**

Run: `npm run test:run`
Expected: PASS (전체).

- [ ] **Step 15: 커밋**

```bash
git add src/components/AudioTimeline/TimelineVideoToggleButton.jsx src/components/AudioTimeline/Clip.jsx src/components/AudioTimeline/TrackLane.jsx src/components/AudioTimeline/AudioTimeline.jsx src/components/AudioTimeline/AudioTimeline.css src/components/AudioPanel.jsx src/components/LiveTimeline.jsx src/App.jsx tests/components/AudioTimeline/TimelineVideoToggleButton.test.jsx tests/components/AudioTimeline/Clip.test.jsx tests/components/AudioTimeline/AudioTimeline.test.jsx
git commit -m "feat(timeline): per-clip video on/off eye toggle wired App->Clip"
```

---

### Task 8: i18n 라벨 + 수동 검증

**Files:**
- Modify: `src/locales/en.js`, `src/locales/ko.js` (timeline.includeClip / excludeClip)

- [ ] **Step 1: i18n 키 추가**

`src/locales/en.js` 의 적절한 섹션(예: `timeline` 또는 공통)에:
```js
    includeClip: 'Include in export',
    excludeClip: 'Exclude from export',
```
`src/locales/ko.js`:
```js
    includeClip: 'export 에 포함',
    excludeClip: 'export 에서 제외',
```
> 구현자 노트: `TimelineVideoToggleButton` 은 `t('timeline.includeClip')` 를 쓴다. 두 locale 의 `timeline` 객체 위치에 맞춰 넣고, 없으면 `timeline: { ... }` 키를 만든다. 키 경로가 다르면 컴포넌트의 `t('timeline.includeClip')` 도 맞춘다.

- [ ] **Step 2: 전체 테스트**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 3: 수동 검증(사용자)**

앱 실행 → i2v+t2v 씬의 타임라인에서:
1. 영상 클립 호버 → 👁 보임. 클릭 → 클립 dim + 모니터에서 그 영상 빠짐.
2. 둘 다 끄기 → 그 씬 모니터=이미지만.
3. CapCut export → 꺼진 영상은 트랙에서 빠짐(이미지/나머지 영상만).
4. 영상 재생성 → disabled 풀리고 새 영상 다시 보임.
5. CSV 재파싱 → 꺼둔 설정 유지.

- [ ] **Step 4: 커밋**

```bash
git add src/locales/en.js src/locales/ko.js
git commit -m "i18n: timeline clip include/exclude labels"
```

---

## Self-Review

**Spec coverage:**
- 데이터 모델(video*Disabled, falsy) → Task 1/3/4/6 전반.
- export 제외 → Task 1. SceneList ✓ → Task 2. 프리뷰 제외 → Task 4. placement 경계(timeline include/dim) → Task 3. 배선 → Task 7. 보존 → Task 5. 라이프사이클 reset → Task 6. 이벤트 전파 → Task 7(버튼/Clip). i18n → Task 8. ✅ 전부 매핑됨.

**Placeholder scan:** "구현자 노트"는 기존 테스트 형식 참조 안내(실제 코드/단언은 제시됨). CSV 샘플·locale 키 경로는 코드베이스 실형식에 맞추라는 명시적 안내 — 모호 지시 아님.

**Type consistency:** 필드명 `videoI2VDisabled`/`videoT2VDisabled` 전 task 일관. 헬퍼 `videoClearPatch(source)`/`isPreviewVideoVisible(scene, source, hiddenRoles)`/`handleToggleVideo(clip)` 시그니처 task 간 일치. reset 값은 `null`(falsy) 일관, 테스트는 `=== true`(set) / 자동 falsy 로 검증.

**Known integration-glue exception:** Task 6 의 App 핸들러 사이트는 독립 unit 이 어려워 `videoClearPatch` 단위 + grep 가드 + Task 8 수동 검증으로 커버(plan 내 명시).
