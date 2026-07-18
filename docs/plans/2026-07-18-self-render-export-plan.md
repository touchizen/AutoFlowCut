# Self-Render Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트를 로컬 ffmpeg로 MP4 렌더링하는 4번째 내보내기 타입 `render`를 추가한다 (Ken Burns 효과 + 자막 번인 + 나레이션/SFX 믹스, preview/final 2모드).

**Architecture:** 완전 로컬(GCF 미사용). 렌더러는 기존 `prepareCloudRequest()` payload만 재사용해 IPC `render:export-mp4`를 호출하고, main이 `validateRenderRequest`(순수 검증) → `resolveAndValidateInputs`(경로 해석/probe) → `buildRenderPlan`(순수, RenderJobPlan) → `runFfmpegRender`(ffmpeg 스테이지 트리)를 실행한다. 순수 계획과 부수효과를 분리해 순수 모듈은 골든/count 테스트로 고정한다.

**Tech Stack:** Electron(main/renderer/preload), React, vitest, ffmpeg(vendor 번들), music-metadata(기존 `probeDurationMs` 재사용).

**Spec:** [docs/plans/2026-07-18-self-render-export-design.md](2026-07-18-self-render-export-design.md) — 모든 필드명/필터 문자열/필드 스키마의 canonical 출처. 태스크에서 "스펙 §N"으로 참조.

## Global Constraints

- **TDD 필수** (CLAUDE.md): 모든 코드 변경에 단위+통합 테스트. `tests/`는 `src/`/`electron/` 구조 미러링. 러너 `npx vitest run <path>`.
- **커밋 메시지 영어** (CLAUDE.md).
- **API key/secret 소스 삽입 금지**.
- **`Math.random()`/`Date.now()` 금지** (결정론): Ken Burns 시드는 씬 인덱스, 임시 파일명은 jobId+인덱스.
- **과금 없음**: render는 GCF `callExportFunction` 호출 안 함. 기존 `canExport` 인증 게이트만 통과.
- **채널 규약** `namespace:action`: `render:export-mp4`, `render:cancel`, `render:progress`.
- **ffmpeg 소스 단일화**: `vendor/ffmpeg/<platform>-<arch>/` 만이 유일 소스. `ffmpeg-static` 런타임 dependency 금지. 폰트/라이선스=`extraResources`, ffmpeg=`afterPack` 복사.
- **오디오 필드 실측**: `srtEntries={startMs,endMs,text}`(ms), `sfxItems.duration`은 **초**, `audioDurationSec`는 **초**(null 가능), `audioTracks` 4형태(스펙 §2.2), `audioFiles={type,filename,path}`(sceneId 없음).

---

## File Structure

**신규 (main/electron):**
- `electron/render/ffmpegPath.js` — ffmpeg 바이너리 경로 해석(dev/packaged/arch).
- `electron/render/kenBurns.js` — 순수 Ken Burns 파라미터 `computeKenBurns`.
- `electron/render/subtitleAss.js` — 순수 `.ass` 생성 + 이스케이프 2종.
- `electron/render/validateRequest.js` — 순수 IPC 요청 검증 `validateRenderRequest`.
- `electron/render/resolveInputs.js` — effectful `resolveAndValidateInputs`.
- `electron/render/buildRenderPlan.js` — 순수 `buildRenderPlan` → RenderJobPlan.
- `electron/render/ffmpegRunner.js` — `runFfmpegRender` 스테이지 트리 spawn.
- `electron/ipc/render.js` — `registerRenderIPC(ipcMain)` (`render:export-mp4`/`render:cancel`, jobId 레지스트리).

**신규 (renderer):**
- `src/exporters/render.js` — `exportRenderVideo(project, options)`.

**수정:**
- `electron/main.js` — `registerRenderIPC` 등록.
- `electron/preload.js` — `renderMp4`/`renderCancel`/`onRenderProgress`.
- `src/utils/exportFormat.js` — `EXPORT_FORMATS`에 `'render'`.
- `src/components/ExportSplitButton.jsx` — FORMATS 항목.
- `src/components/ExportModal.jsx` — 탭/카드/handleExport/트라이얼 배지/자막 컨트롤/videoOverlays 확인.
- `src/hooks/useExport.js` — `handleExportRender`(Premiere 미러) + 진행/취소 상태.
- `src/hooks/useExportSettings.js` — `renderMode`/`renderBurnSubtitle`.
- `src/App.jsx` — `onExportRender`/진행/취소 배선.
- `src/locales/ko.js`/`en.js` — render 문자열.
- `package.json`/`scripts/afterPack.cjs`/`scripts/install-platform-binaries.cjs` — vendor 스테이징.

**재사용(수정 없음):** `electron/story/audioProbe.js` `probeDurationMs`.

---

## Task 1: Ken Burns pure module

**Files:**
- Create: `electron/render/kenBurns.js`
- Test: `tests/electron/render/kenBurns.test.js`

**Interfaces:**
- Produces: `computeKenBurns(scene, index, { mode, scaleMin, scaleMax }) → { startScale, endScale, startAnchor:{x,y}, endAnchor:{x,y} }`. `mode∈{'random','pattern'}`. scale은 ratio(1.0~). anchor는 0..1. (프레임 수는 이 모듈 밖 — `buildRenderPlan.allocateFrames`가 소유, §4.7. zoompan `d=frames`는 buildSceneChain에서 결합.)
- Produces: `mulberry32(seed) → () => number` (0..1 결정론 PRNG).

- [ ] **Step 1: Write failing tests**

```js
// tests/electron/render/kenBurns.test.js
import { describe, it, expect } from 'vitest'
import { computeKenBurns, mulberry32 } from '../../../electron/render/kenBurns.js'

const base = { mode: 'random', scaleMin: 1.0, scaleMax: 1.3 }

describe('mulberry32', () => {
  it('is deterministic for same seed', () => {
    const a = mulberry32(5), b = mulberry32(5)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })
  it('returns values in [0,1)', () => {
    const r = mulberry32(1)
    for (let i = 0; i < 100; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
})

describe('computeKenBurns', () => {
  it('is deterministic by index (same index → same output)', () => {
    const a = computeKenBurns({}, 3, base)
    const b = computeKenBurns({}, 3, base)
    expect(a).toEqual(b)
  })
  it('differs across indices', () => {
    const a = computeKenBurns({}, 1, base)
    const b = computeKenBurns({}, 2, base)
    expect(a).not.toEqual(b)
  })
  it('keeps scales within [scaleMin, scaleMax]', () => {
    for (let i = 0; i < 20; i++) {
      const k = computeKenBurns({}, i, base)
      expect(k.startScale).toBeGreaterThanOrEqual(1.0)
      expect(k.startScale).toBeLessThanOrEqual(1.3)
      expect(k.endScale).toBeGreaterThanOrEqual(1.0)
      expect(k.endScale).toBeLessThanOrEqual(1.3)
    }
  })
  it('keeps anchors within [0,1]', () => {
    for (let i = 0; i < 20; i++) {
      const k = computeKenBurns({}, i, base)
      for (const a of [k.startAnchor, k.endAnchor]) {
        expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x).toBeLessThanOrEqual(1)
        expect(a.y).toBeGreaterThanOrEqual(0); expect(a.y).toBeLessThanOrEqual(1)
      }
    }
  })
  it('swaps when scaleMin > scaleMax', () => {
    const k = computeKenBurns({}, 0, { ...base, scaleMin: 1.3, scaleMax: 1.0 })
    expect(k.startScale).toBeLessThanOrEqual(1.3)
    expect(k.startScale).toBeGreaterThanOrEqual(1.0)
  })
  it('clamps sub-1.0 scale to 1.0 and defaults NaN', () => {
    const k = computeKenBurns({}, 0, { ...base, scaleMin: 0.5, scaleMax: NaN })
    expect(k.startScale).toBeGreaterThanOrEqual(1.0)
    expect(Number.isFinite(k.endScale)).toBe(true)
  })
  it('pattern mode is deterministic without randomness (even index zoom-in)', () => {
    const even = computeKenBurns({}, 2, { ...base, mode: 'pattern' })
    expect(even.endScale).toBeGreaterThanOrEqual(even.startScale) // zoom-in
    const odd = computeKenBurns({}, 3, { ...base, mode: 'pattern' })
    expect(odd.endScale).toBeLessThanOrEqual(odd.startScale) // zoom-out
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/electron/render/kenBurns.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// electron/render/kenBurns.js
// 순수 Ken Burns 파라미터 생성 — 결정론(인덱스 시드), Math.random 금지.
const DEFAULT_MIN = 1.0
const DEFAULT_MAX = 1.3
const ANCHORS = [
  { x: 0.5, y: 0.5 }, { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 },
  { x: 0.0, y: 1.0 }, { x: 1.0, y: 1.0 },
]

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sanitizeScales(scaleMin, scaleMax) {
  let lo = Number.isFinite(scaleMin) ? scaleMin : DEFAULT_MIN
  let hi = Number.isFinite(scaleMax) ? scaleMax : DEFAULT_MAX
  if (lo > hi) [lo, hi] = [hi, lo]
  lo = Math.max(1.0, lo)
  hi = Math.max(lo, hi)
  return { lo, hi }
}

export function computeKenBurns(scene, index, { mode = 'random', scaleMin, scaleMax } = {}) {
  const { lo, hi } = sanitizeScales(scaleMin, scaleMax)
  if (mode === 'pattern') {
    const zoomIn = index % 2 === 0
    return {
      startScale: zoomIn ? lo : hi,
      endScale: zoomIn ? hi : lo,
      startAnchor: ANCHORS[index % ANCHORS.length],
      endAnchor: ANCHORS[(index + 1) % ANCHORS.length],
    }
  }
  const rnd = mulberry32(index + 1)
  const zoomIn = rnd() < 0.5
  const a1 = ANCHORS[Math.floor(rnd() * ANCHORS.length)]
  const a2 = ANCHORS[Math.floor(rnd() * ANCHORS.length)]
  return {
    startScale: zoomIn ? lo : hi,
    endScale: zoomIn ? hi : lo,
    startAnchor: a1,
    endAnchor: a2,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/electron/render/kenBurns.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add electron/render/kenBurns.js tests/electron/render/kenBurns.test.js
git commit -m "feat(render): add deterministic Ken Burns parameter module"
```

---

## Task 2: Subtitle ASS pure module

**Files:**
- Create: `electron/render/subtitleAss.js`
- Test: `tests/electron/render/subtitleAss.test.js`

**Interfaces:**
- Consumes: entries `[{ startMs, endMs, text }]` (스펙 §2.2, ms).
- Produces: `msToAssTime(ms) → 'h:mm:ss.cs'`.
- Produces: `escapeAssText(s) → string` (백슬래시/중괄호/개행→`\N`).
- Produces: `assFontsize({ subtitleFontSize, outputHeight }) → number`.
- Produces: `buildAss(entries, { subtitleFontSize, outputWidth, outputHeight, offsetMs = 0 }) → string` (offsetMs 차감 후 [0,∞) 교집합만, 경계 clamp).

- [ ] **Step 1: Write failing tests**

```js
// tests/electron/render/subtitleAss.test.js
import { describe, it, expect } from 'vitest'
import { msToAssTime, escapeAssText, assFontsize, buildAss } from '../../../electron/render/subtitleAss.js'

describe('msToAssTime', () => {
  it('formats ms to h:mm:ss.cs (centiseconds)', () => {
    expect(msToAssTime(0)).toBe('0:00:00.00')
    expect(msToAssTime(3610)).toBe('0:00:03.61')
    expect(msToAssTime(3661230)).toBe('1:01:01.23')
  })
})

describe('escapeAssText', () => {
  it('escapes braces, backslash, and newline', () => {
    expect(escapeAssText('a{b}c')).toBe('a\\{b\\}c')
    expect(escapeAssText('a\\b')).toBe('a\\\\b')
    expect(escapeAssText('a\nb')).toBe('a\\Nb')
  })
})

describe('assFontsize', () => {
  it('scales relative to output height', () => {
    expect(assFontsize({ subtitleFontSize: 8, outputHeight: 1920 })).toBe(Math.round(8 * 1920 / 100))
  })
})

describe('buildAss', () => {
  const opts = { subtitleFontSize: 8, outputWidth: 1080, outputHeight: 1920 }
  it('emits a Dialogue line per entry with rebased times when offsetMs>0', () => {
    const ass = buildAss([{ startMs: 20000, endMs: 22000, text: '안녕' }], { ...opts, offsetMs: 20000 })
    expect(ass).toContain('Dialogue:')
    expect(ass).toContain('0:00:00.00,0:00:02.00')
    expect(ass).toContain('안녕')
  })
  it('drops entries fully before the offset window', () => {
    const ass = buildAss([{ startMs: 0, endMs: 1000, text: 'x' }], { ...opts, offsetMs: 20000 })
    expect(ass).not.toContain('Dialogue:')
  })
  it('clamps a boundary-crossing entry start to 0', () => {
    const ass = buildAss([{ startMs: 19000, endMs: 21000, text: 'y' }], { ...opts, offsetMs: 20000 })
    expect(ass).toContain('0:00:00.00,0:00:01.00')
  })
  it('drops entries with endMs<=startMs', () => {
    const ass = buildAss([{ startMs: 1000, endMs: 1000, text: 'z' }], opts)
    expect(ass).not.toContain('Dialogue:')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/electron/render/subtitleAss.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// electron/render/subtitleAss.js
// 순수 .ass 생성. 스펙 §4.4. offsetMs 차감(세그먼트 리베이스) + [0) clamp.
export function msToAssTime(ms) {
  const totalCs = Math.round(ms / 10)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`
}

export function escapeAssText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

export function assFontsize({ subtitleFontSize = 8, outputHeight = 1080 }) {
  return Math.round(subtitleFontSize * outputHeight / 100)
}

function assHeader({ outputWidth, outputHeight, subtitleFontSize }) {
  const fs = assFontsize({ subtitleFontSize, outputHeight })
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${outputWidth}`,
    `PlayResY: ${outputHeight}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Noto Sans KR,${fs},&H00FFFFFF,&H00000000,&H80000000,0,2,1,2,40,40,60,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')
}

export function buildAss(entries, { subtitleFontSize = 8, outputWidth = 1080, outputHeight = 1920, offsetMs = 0 } = {}) {
  const lines = [assHeader({ outputWidth, outputHeight, subtitleFontSize })]
  for (const e of (entries || [])) {
    const start = Number(e.startMs)
    const end = Number(e.endMs)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const rebasedStart = start - offsetMs
    const rebasedEnd = end - offsetMs
    if (rebasedEnd <= 0) continue                 // fully before window
    const clampedStart = Math.max(0, rebasedStart)
    lines.push(
      `Dialogue: 0,${msToAssTime(clampedStart)},${msToAssTime(rebasedEnd)},Default,,0,0,0,,${escapeAssText(e.text)}`
    )
  }
  return lines.join('\n') + '\n'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/electron/render/subtitleAss.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/render/subtitleAss.js tests/electron/render/subtitleAss.test.js
git commit -m "feat(render): add ASS subtitle builder with segment rebase"
```

---

## Task 3: Render request validator (pure)

**Files:**
- Create: `electron/render/validateRequest.js`
- Test: `tests/electron/render/validateRequest.test.js`

**Interfaces:**
- Consumes: `{ prepared:{ cloudRequest }, options:{ renderMode, renderBurnSubtitle }, jobId }`.
- Produces: `validateRenderRequest(request) → { ok:true } | { ok:false, error }` — resolve/temp 이전 순수 검증(스펙 §3). enum/유한/양수/씬 id 유일/sfxItems.sceneId 참조/subtitleFontSize 범위.

- [ ] **Step 1: Write failing tests**

```js
// tests/electron/render/validateRequest.test.js
import { describe, it, expect } from 'vitest'
import { validateRenderRequest } from '../../../electron/render/validateRequest.js'

const good = () => ({
  jobId: 'job_1',
  options: { renderMode: 'final', renderBurnSubtitle: true },
  prepared: { cloudRequest: {
    format: 'portrait', scaleMode: 'fill', subtitleFontSize: 8,
    kenBurns: { enabled: true, mode: 'random', cycle: 5, scaleMin: 1.0, scaleMax: 1.3 },
    scenes: [{ id: 'scene_1', duration: 3 }, { id: 'scene_2', duration: 4 }],
    sfxItems: [{ sceneId: 'scene_1', filename: 'a.wav', duration: 2 }],
    audioTracks: [],
  } },
})

describe('validateRenderRequest', () => {
  it('accepts a well-formed request', () => {
    expect(validateRenderRequest(good())).toEqual({ ok: true })
  })
  it('rejects bad renderMode', () => {
    const r = good(); r.options.renderMode = 'ultra'
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects missing jobId', () => {
    const r = good(); delete r.jobId
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects duplicate scene ids', () => {
    const r = good(); r.prepared.cloudRequest.scenes[1].id = 'scene_1'
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects sfx referencing an unknown scene', () => {
    const r = good(); r.prepared.cloudRequest.sfxItems[0].sceneId = 'scene_9'
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects non-finite scene duration', () => {
    const r = good(); r.prepared.cloudRequest.scenes[0].duration = NaN
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects non-positive subtitleFontSize', () => {
    const r = good(); r.prepared.cloudRequest.subtitleFontSize = 0
    expect(validateRenderRequest(r).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/electron/render/validateRequest.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// electron/render/validateRequest.js
// 순수 IPC 요청 검증 — resolve/temp 이전. 스펙 §3.
const MODES = new Set(['preview', 'final'])
const FORMATS = new Set(['portrait', 'landscape'])
const SCALE_MODES = new Set(['fill', 'fit', 'none'])
const KB_MODES = new Set(['random', 'pattern'])
const FONT_MAX = 100

const fail = (error) => ({ ok: false, error })
const finitePos = (n) => Number.isFinite(n) && n > 0
const finiteNonNeg = (n) => Number.isFinite(n) && n >= 0

export function validateRenderRequest(request) {
  if (!request || typeof request !== 'object') return fail('request missing')
  const { prepared, options, jobId } = request
  if (typeof jobId !== 'string' || !jobId) return fail('jobId missing')
  if (!options || !MODES.has(options.renderMode)) return fail(`bad renderMode: ${options?.renderMode}`)
  if (typeof options.renderBurnSubtitle !== 'boolean') return fail('renderBurnSubtitle must be boolean')

  const cr = prepared?.cloudRequest
  if (!cr || typeof cr !== 'object') return fail('cloudRequest missing')
  if (!FORMATS.has(cr.format)) return fail(`bad format: ${cr.format}`)
  if (!SCALE_MODES.has(cr.scaleMode)) return fail(`bad scaleMode: ${cr.scaleMode}`)
  if (!finitePos(cr.subtitleFontSize) || cr.subtitleFontSize > FONT_MAX) return fail(`bad subtitleFontSize: ${cr.subtitleFontSize}`)

  const kb = cr.kenBurns || {}
  if (kb.enabled) {
    if (!KB_MODES.has(kb.mode)) return fail(`bad kenBurns.mode: ${kb.mode}`)
    if (!finitePos(kb.scaleMin) || !finitePos(kb.scaleMax)) return fail('bad kenBurns scale')
  }

  const scenes = Array.isArray(cr.scenes) ? cr.scenes : null
  if (!scenes || scenes.length === 0) return fail('no scenes')
  const ids = new Set()
  for (const s of scenes) {
    if (typeof s.id !== 'string' || !s.id) return fail('scene id missing')
    if (ids.has(s.id)) return fail(`duplicate scene id: ${s.id}`)
    ids.add(s.id)
    if (!finitePos(s.duration)) return fail(`bad scene duration: ${s.id}`)
  }
  for (const sfx of (cr.sfxItems || [])) {
    if (!ids.has(sfx.sceneId)) return fail(`sfx references unknown scene: ${sfx.sceneId}`)
    if (!finitePos(sfx.duration)) return fail(`bad sfx duration: ${sfx.filename}`)
  }
  for (const t of (cr.audioTracks || [])) {
    if (t.timecodeMs != null && !finiteNonNeg(t.timecodeMs)) return fail(`bad audioTrack timecode: ${t.filename}`)
    if (t.durationMs != null && !finitePos(t.durationMs)) return fail(`bad audioTrack duration: ${t.filename}`)
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/electron/render/validateRequest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/render/validateRequest.js tests/electron/render/validateRequest.test.js
git commit -m "feat(render): add pure render-request validator"
```

---

## Task 4: Input resolver (effectful)

**Files:**
- Create: `electron/render/resolveInputs.js`
- Test: `tests/electron/render/resolveInputs.test.js`

**Interfaces:**
- Consumes: `prepared = { cloudRequest, mediaFiles, sfxFiles, audioFiles, pathMap }`. `mediaFiles=[{sceneId,type,filename,path}]`, `sfxFiles=[{sceneId,filename,path}]`, `audioFiles=[{type,filename,path}]` (스펙 §2.2).
- Consumes injectable deps `{ existsSync, probeDurationMs, decodeDataUrl }` for testability (default = real fs / `electron/story/audioProbe.js` / local).
- Produces: `resolveAndValidateInputs(prepared, deps?) → Promise<{ images:Map<sceneId,absPath>, sfx:Map<sceneId,absPath>, audio:Map<filename,absPath>, narrationDurationMs:(filename)=>number }>`. 실패 시 throw (fail-closed, 어느 씬/클립인지). `type:'video'` mediaFiles 제외.

- [ ] **Step 1: Write failing tests**

```js
// tests/electron/render/resolveInputs.test.js
import { describe, it, expect } from 'vitest'
import { resolveAndValidateInputs } from '../../../electron/render/resolveInputs.js'

const deps = (present = ['/img1.png', '/sfx1.wav', '/nar.mp3']) => ({
  existsSync: (p) => present.includes(p),
  probeDurationMs: async () => 30000,
  decodeDataUrl: async () => { throw new Error('not used') },
})

const prepared = () => ({
  cloudRequest: { audioDurationSec: null, scenes: [{ id: 'scene_1' }], audioTracks: [] },
  mediaFiles: [
    { sceneId: 'scene_1', type: 'image', filename: 's1.png', path: '/img1.png' },
    { sceneId: 'scene_1', type: 'video', filename: 's1.mp4', path: '/vid1.mp4' }, // excluded
  ],
  sfxFiles: [{ sceneId: 'scene_1', filename: 'sfx1.wav', path: '/sfx1.wav' }],
  audioFiles: [{ type: 'narration', filename: 'nar.mp3', path: '/nar.mp3' }],
})

describe('resolveAndValidateInputs', () => {
  it('resolves images/sfx/audio and excludes video media', async () => {
    const r = await resolveAndValidateInputs(prepared(), deps())
    expect(r.images.get('scene_1')).toBe('/img1.png')
    expect(r.sfx.get('scene_1')).toBe('/sfx1.wav')
    expect(r.audio.get('nar.mp3')).toBe('/nar.mp3')
  })
  it('throws fail-closed when an image is missing', async () => {
    await expect(resolveAndValidateInputs(prepared(), deps(['/sfx1.wav', '/nar.mp3'])))
      .rejects.toThrow(/scene_1/)
  })
  it('rejects ambiguous duplicate audio filename', async () => {
    const p = prepared()
    p.audioFiles.push({ type: 'sfx', filename: 'nar.mp3', path: '/other.mp3' })
    await expect(resolveAndValidateInputs(p, deps(['/img1.png', '/sfx1.wav', '/nar.mp3', '/other.mp3'])))
      .rejects.toThrow(/ambiguous|nar\.mp3/)
  })
  it('probes legacy narration length when audioDurationSec is null', async () => {
    const r = await resolveAndValidateInputs(prepared(), deps())
    expect(await r.narrationDurationMs('nar.mp3')).toBe(30000)
  })
  it('uses audioDurationSec*1000 when present', async () => {
    const p = prepared(); p.cloudRequest.audioDurationSec = 12.5
    const r = await resolveAndValidateInputs(p, { ...deps(), probeDurationMs: async () => 0 })
    expect(await r.narrationDurationMs('nar.mp3')).toBe(12500)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/electron/render/resolveInputs.test.js` → FAIL.

- [ ] **Step 3: Implement**

```js
// electron/render/resolveInputs.js
// effectful: filename→절대경로 해석(컬렉션별 키), 존재 검증, narration 길이 probe. 스펙 §3.
import fs from 'fs'
import { probeDurationMs as realProbe } from '../story/audioProbe.js'

const defaultDeps = {
  existsSync: (p) => fs.existsSync(p),
  probeDurationMs: (p) => realProbe(p),
}

export async function resolveAndValidateInputs(prepared, deps = {}) {
  const { existsSync, probeDurationMs } = { ...defaultDeps, ...deps }
  const cr = prepared.cloudRequest || {}
  const images = new Map()
  const sfx = new Map()
  const audio = new Map()

  for (const m of (prepared.mediaFiles || [])) {
    if (m.type === 'video') continue                    // v1 미지원
    if (!existsSync(m.path)) throw new Error(`render: missing image for ${m.sceneId} (${m.filename})`)
    images.set(m.sceneId, m.path)                        // key: sceneId+type(image)+filename → sceneId 충분(이미지 1/씬)
  }
  for (const s of (prepared.sfxFiles || [])) {
    if (!existsSync(s.path)) throw new Error(`render: missing sfx for ${s.sceneId} (${s.filename})`)
    sfx.set(s.sceneId, s.path)
  }
  const seen = new Set()
  for (const a of (prepared.audioFiles || [])) {
    if (seen.has(a.filename)) throw new Error(`render: ambiguous audio filename ${a.filename}`)
    seen.add(a.filename)
    if (!existsSync(a.path)) throw new Error(`render: missing audio ${a.filename}`)
    audio.set(a.filename, a.path)
  }

  const durSec = cr.audioDurationSec
  const narrationDurationMs = async (filename) => {
    if (Number.isFinite(durSec) && durSec > 0) return Math.round(durSec * 1000)
    const p = audio.get(filename)
    const ms = await probeDurationMs(p)
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`render: cannot probe narration length ${filename}`)
    return ms
  }
  return { images, sfx, audio, narrationDurationMs }
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/render/resolveInputs.js tests/electron/render/resolveInputs.test.js
git commit -m "feat(render): add effectful input resolver with fail-closed validation"
```

---

## Task 5: Render plan builder (pure, golden + count)

**Files:**
- Create: `electron/render/buildRenderPlan.js`
- Test: `tests/electron/render/buildRenderPlan.test.js`

**Interfaces:**
- Consumes: `resolved = { images, sfx, audioClips }` — `images`/`sfx`는 Task 4 출력 Map, `audioClips`는 Task 8 `adaptAudioClips` 출력 배열(IPC 파이프라인 Task 7이 resolve→adapt 후 `resolved`에 붙여 전달). `options={ renderMode, renderBurnSubtitle, cloudRequest }`.
- Produces: `buildRenderPlan(resolved, options) → RenderJobPlan = { stages: Stage[], totalDurationMs, sceneCount, audioClipCount }`. `Stage = { kind:'audio'|'video'|'final', inputs:string[], filtergraphScript:string, output:string, dependsOn:string[] }`.
- Produces helpers (exported for unit test): `allocateFrames(sceneDurationsSec, fps) → number[]` (누적 경계), `outputSpec(format, renderMode) → { width, height, fps, crf, preset }`, `computeTotalDurationMs({ sceneEndMs, audioTracks, sfxStarts, subtitleEndMs }) → number`.

**Note:** 정확한 filtergraph 문자열은 **골든 스냅샷 테스트로 고정**하되, count/타이밍 불변식(아래)이 1차 게이트다. filtergraph 세부(zoompan 좌표식)는 스펙 §4.3의 anchor→pixel 공식을 그대로 옮기고 Task 12 눈검증에서 확정한다.

- [ ] **Step 1: Write failing tests (count/timing 불변식 우선)**

```js
// tests/electron/render/buildRenderPlan.test.js
import { describe, it, expect } from 'vitest'
import { buildRenderPlan, allocateFrames, outputSpec, computeTotalDurationMs } from '../../../electron/render/buildRenderPlan.js'

describe('allocateFrames (cumulative boundaries, no per-scene rounding drift)', () => {
  it('sums to round(totalSec*fps)', () => {
    const durs = [3, 4, 3.5]
    const frames = allocateFrames(durs, 30)
    const total = durs.reduce((a, b) => a + b, 0)
    expect(frames.reduce((a, b) => a + b, 0)).toBe(Math.round(total * 30))
  })
  it('gives each scene ≥1 frame', () => {
    for (const f of allocateFrames([0.01, 0.01], 24)) expect(f).toBeGreaterThanOrEqual(1)
  })
})

describe('outputSpec', () => {
  it('portrait final is 1080x1920@30', () => {
    expect(outputSpec('portrait', 'final')).toMatchObject({ width: 1080, height: 1920, fps: 30 })
  })
  it('landscape preview is 1280x720@24', () => {
    expect(outputSpec('landscape', 'preview')).toMatchObject({ width: 1280, height: 720, fps: 24 })
  })
})

describe('computeTotalDurationMs (max of all endpoints)', () => {
  it('takes subtitle endMs when it exceeds video/audio', () => {
    const t = computeTotalDurationMs({ sceneEndMs: 5000, audioTracks: [{ timecodeMs: 0, durationMs: 4000 }], sfxStarts: [], subtitleEndMs: 8000 })
    expect(t).toBe(8000)
  })
  it('ignores null audioDuration and uses clip ends', () => {
    const t = computeTotalDurationMs({ sceneEndMs: 3000, audioTracks: [{ timecodeMs: 20000, durationMs: 2000 }], sfxStarts: [], subtitleEndMs: 0 })
    expect(t).toBe(22000)
  })
})

describe('buildRenderPlan', () => {
  const resolved = {
    images: new Map([['scene_1', '/a.png'], ['scene_2', '/b.png']]),
    sfx: new Map(),
    audioClips: [{ filename: 'nar.wav', path: '/nar.wav', startMs: 0, durationMs: 7000, gain: 1.0 }],
  }
  const options = { renderMode: 'final', renderBurnSubtitle: false, cloudRequest: {
    format: 'portrait', scaleMode: 'fill',
    kenBurns: { enabled: true, mode: 'random', scaleMin: 1.0, scaleMax: 1.3 },
    scenes: [{ id: 'scene_1', duration: 3 }, { id: 'scene_2', duration: 4 }],
    audioTracks: [], sfxItems: [], srtEntries: null,
  } }

  it('reports scene and audio clip counts (count assert)', () => {
    const plan = buildRenderPlan(resolved, options)
    expect(plan.sceneCount).toBe(2)
    expect(plan.audioClipCount).toBe(1)
  })
  it('produces at least a final stage', () => {
    const plan = buildRenderPlan(resolved, options)
    expect(plan.stages.some(s => s.kind === 'final')).toBe(true)
  })
  it('total duration covers the 7s narration past the 7s of scenes', () => {
    const plan = buildRenderPlan(resolved, options)
    expect(plan.totalDurationMs).toBe(7000)
  })
  it('matches golden filtergraph snapshot', () => {
    const plan = buildRenderPlan(resolved, options)
    expect(plan.stages.map(s => s.filtergraphScript)).toMatchSnapshot()
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL (module not found).

- [ ] **Step 3: Implement** (helpers first, then plan assembly using `computeKenBurns`/`buildAss`; emit `filtergraphScript` per stage — zoompan chain per scene with `scale` upscale, `setsar=1`, concat; audio stages per spec §4.10 when clip count exceeds `K=32`. Copy the anchor→pixel formula from spec §4.3 verbatim. Keep the function returning the documented shape so counts/timing tests pass; the golden snapshot is authored on first green run.)

Skeleton (fill filtergraph strings to satisfy golden + spec §4.3/§4.6/§4.10):

```js
// electron/render/buildRenderPlan.js
import { computeKenBurns } from './kenBurns.js'
import { buildAss } from './subtitleAss.js'

const K_AUDIO = 32
const SPECS = {
  portrait: { final: { width: 1080, height: 1920, fps: 30, crf: 20, preset: 'medium' }, preview: { width: 720, height: 1280, fps: 24, crf: 26, preset: 'veryfast' } },
  landscape: { final: { width: 1920, height: 1080, fps: 30, crf: 20, preset: 'medium' }, preview: { width: 1280, height: 720, fps: 24, crf: 26, preset: 'veryfast' } },
}
export function outputSpec(format, renderMode) { return SPECS[format]?.[renderMode] || SPECS.landscape.final }

export function allocateFrames(durationsSec, fps) {
  const frames = []
  let cumSec = 0, prevFrame = 0
  for (const d of durationsSec) {
    cumSec += d
    const boundary = Math.round(cumSec * fps)
    frames.push(Math.max(1, boundary - prevFrame))
    prevFrame = boundary
  }
  return frames
}

export function computeTotalDurationMs({ sceneEndMs, audioTracks = [], sfxStarts = [], subtitleEndMs = 0 }) {
  let max = sceneEndMs
  for (const t of audioTracks) max = Math.max(max, (t.timecodeMs || 0) + (t.durationMs || 0))
  for (const s of sfxStarts) max = Math.max(max, s.startMs + s.durationMs)
  return Math.max(max, subtitleEndMs || 0)
}

export function buildRenderPlan(resolved, options) {
  const cr = options.cloudRequest
  const spec = outputSpec(cr.format, options.renderMode)
  const durs = cr.scenes.map(s => Number(s.duration) || 3)
  const frames = allocateFrames(durs, spec.fps)
  const sceneEndMs = Math.round(durs.reduce((a, b) => a + b, 0) * 1000)
  const audioClips = resolved.audioClips || []
  const subtitleEndMs = options.renderBurnSubtitle
    ? (cr.srtEntries || []).reduce((m, e) => Math.max(m, Number(e.endMs) || 0), 0) : 0
  const totalDurationMs = computeTotalDurationMs({ sceneEndMs, audioTracks: cr.audioTracks, sfxStarts: [], subtitleEndMs })

  // Per-scene video chain (zoompan) — anchor→pixel per spec §4.3.
  const videoChains = cr.scenes.map((s, i) => {
    const kb = cr.kenBurns?.enabled ? computeKenBurns(s, i, cr.kenBurns) : null
    return buildSceneChain({ index: i, frames: frames[i], spec, scaleMode: cr.scaleMode, kb })
  })
  const stages = []
  // audioStages when clips exceed K (spec §4.10) — omitted here, see Task 6 note; single final when small.
  const assText = options.renderBurnSubtitle
    ? buildAss(cr.srtEntries, { subtitleFontSize: cr.subtitleFontSize, outputWidth: spec.width, outputHeight: spec.height })
    : null
  stages.push(buildFinalStage({ videoChains, audioClips, spec, assText, totalDurationMs }))

  return { stages, totalDurationMs, sceneCount: cr.scenes.length, audioClipCount: audioClips.length }
}

// buildSceneChain / buildFinalStage: assemble filtergraph strings per spec §4.3/§4.6.
// (Author on first green run; golden snapshot fixes the exact strings.)
function buildSceneChain({ index, frames, spec, scaleMode, kb }) { /* returns { label, filter } */ return { index, frames, filter: `/* scene ${index} zoompan */` } }
function buildFinalStage({ videoChains, audioClips, spec, assText, totalDurationMs }) {
  return { kind: 'final', inputs: [], filtergraphScript: videoChains.map(v => v.filter).join(';\n'), output: 'OUT.mp4', dependsOn: [] }
}
```

- [ ] **Step 4: Run to verify pass** — count/timing PASS; on first run `--update` the golden snapshot after eyeballing it.

- [ ] **Step 5: Commit**

```bash
git add electron/render/buildRenderPlan.js tests/electron/render/buildRenderPlan.test.js tests/electron/render/__snapshots__
git commit -m "feat(render): add pure render plan builder with golden filtergraph"
```

> **Follow-up in Task 12:** verify the emitted zoompan/concat filtergraph actually renders without jitter on a real 1-scene clip, then lock the golden snapshot.

---

## Task 6: ffmpeg path resolver + runner (mocked spawn)

**Files:**
- Create: `electron/render/ffmpegPath.js`, `electron/render/ffmpegRunner.js`
- Test: `tests/electron/render/ffmpegPath.test.js`, `tests/electron/render/ffmpegRunner.test.js`

**Interfaces:**
- Produces: `resolveFfmpegPath({ isPackaged, resourcesPath, appRoot, platform, arch }) → string` (dev=`<appRoot>/vendor/ffmpeg/<platform>-<arch>/ffmpeg[.exe]`, packaged=`<resourcesPath>/ffmpeg/ffmpeg[.exe]`).
- Produces: `runFfmpegRender(jobPlan, jobCtx, onProgress, deps?) → Promise<{ outPath }>`. `jobCtx={ signal, cancelled, currentChild, tempFiles, phase }`. deps injectable `{ spawn, ffmpegPath, rename, unlink }`. 매 stage spawn 전 `jobCtx.cancelled` 체크, stderr `-progress pipe` 파싱→`onProgress({percent,...})`, 실패/취소 시 tempFiles 정리.

- [ ] **Step 1: Write failing tests**

```js
// tests/electron/render/ffmpegPath.test.js
import { describe, it, expect } from 'vitest'
import { resolveFfmpegPath } from '../../../electron/render/ffmpegPath.js'
describe('resolveFfmpegPath', () => {
  it('dev path from vendor', () => {
    expect(resolveFfmpegPath({ isPackaged: false, appRoot: '/app', platform: 'darwin', arch: 'arm64' }))
      .toBe('/app/vendor/ffmpeg/darwin-arm64/ffmpeg')
  })
  it('packaged path from resources', () => {
    expect(resolveFfmpegPath({ isPackaged: true, resourcesPath: '/res', platform: 'win32', arch: 'x64' }))
      .toBe('/res/ffmpeg/ffmpeg.exe')
  })
})
```

```js
// tests/electron/render/ffmpegRunner.test.js
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { runFfmpegRender } from '../../../electron/render/ffmpegRunner.js'

function fakeChild() {
  const c = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = vi.fn()
  return c
}
const plan = { stages: [{ kind: 'final', inputs: [], filtergraphScript: 'x', output: '/tmp/out.tmp.mp4' }] }

describe('runFfmpegRender', () => {
  it('parses -progress and reports, then resolves on exit 0', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const rename = vi.fn(async () => {})
    const onProgress = vi.fn()
    const ctx = { cancelled: false, tempFiles: [] }
    const p = runFfmpegRender(plan, ctx, onProgress, { spawn, ffmpegPath: '/ff', rename, unlink: async () => {}, outPath: '/final.mp4', totalDurationMs: 1000 })
    child.stderr.emit('data', Buffer.from('out_time_ms=500000\n'))
    child.emit('close', 0)
    const res = await p
    expect(onProgress).toHaveBeenCalled()
    expect(rename).toHaveBeenCalledWith('/tmp/out.tmp.mp4', '/final.mp4')
    expect(res.outPath).toBe('/final.mp4')
  })
  it('does not spawn when already cancelled and cleans temp', async () => {
    const spawn = vi.fn(() => fakeChild())
    const unlink = vi.fn(async () => {})
    const ctx = { cancelled: true, tempFiles: ['/tmp/out.tmp.mp4'] }
    await expect(runFfmpegRender(plan, ctx, () => {}, { spawn, ffmpegPath: '/ff', rename: async () => {}, unlink, outPath: '/f.mp4' }))
      .rejects.toThrow(/cancel/i)
    expect(spawn).not.toHaveBeenCalled()
    expect(unlink).toHaveBeenCalledWith('/tmp/out.tmp.mp4')
  })
  it('rejects with stderr tail on non-zero exit', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const ctx = { cancelled: false, tempFiles: [] }
    const p = runFfmpegRender(plan, ctx, () => {}, { spawn, ffmpegPath: '/ff', rename: async () => {}, unlink: async () => {}, outPath: '/f.mp4' })
    child.stderr.emit('data', Buffer.from('boom error\n'))
    child.emit('close', 1)
    await expect(p).rejects.toThrow(/boom error/)
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** ffmpegPath.js and ffmpegRunner.js. Runner runs stages sequentially, checks `ctx.cancelled` before each `spawn`, accumulates stderr tail (last ~20 lines), parses `out_time_ms=` for progress percent (`out_time_ms/1000/totalDurationMs`), renames temp→outPath after final stage exit 0, and on error/cancel unlinks `ctx.tempFiles`.

```js
// electron/render/ffmpegPath.js
export function resolveFfmpegPath({ isPackaged, resourcesPath, appRoot, platform, arch }) {
  const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return isPackaged
    ? `${resourcesPath}/ffmpeg/${exe}`
    : `${appRoot}/vendor/ffmpeg/${platform}-${arch}/${exe}`
}
```

```js
// electron/render/ffmpegRunner.js  (deps injectable for tests)
export async function runFfmpegRender(jobPlan, jobCtx, onProgress, deps) {
  const { spawn, ffmpegPath, rename, unlink, outPath, totalDurationMs = 1 } = deps
  const cleanup = async () => { for (const f of (jobCtx.tempFiles || [])) { try { await unlink(f) } catch {} } }
  try {
    for (const stage of jobPlan.stages) {
      if (jobCtx.cancelled) { await cleanup(); throw new Error('render cancelled') }
      await runStage(stage)
    }
  } catch (e) { await cleanup(); throw e }
  const finalStage = jobPlan.stages[jobPlan.stages.length - 1]
  await rename(finalStage.output, outPath)
  return { outPath }

  function runStage(stage) {
    return new Promise((resolve, reject) => {
      const args = buildArgs(stage)          // -filter_complex_script + inputs + -progress pipe:2 + output
      const child = spawn(ffmpegPath, args)
      jobCtx.currentChild = child
      let tail = []
      child.stderr.on('data', (buf) => {
        const s = buf.toString()
        const m = s.match(/out_time_ms=(\d+)/)
        if (m && onProgress) onProgress({ percent: Math.min(100, (Number(m[1]) / 1000) / totalDurationMs * 100), stage: stage.kind })
        tail.push(s); if (tail.length > 20) tail = tail.slice(-20)
      })
      child.on('close', (code) => {
        jobCtx.currentChild = null
        code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${tail.join('')}`))
      })
    })
  }
  function buildArgs(stage) { return ['-y', '-filter_complex_script', 'GRAPH', stage.output] } // full args authored with plan shape
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/render/ffmpegPath.js electron/render/ffmpegRunner.js tests/electron/render/ffmpegPath.test.js tests/electron/render/ffmpegRunner.test.js
git commit -m "feat(render): add ffmpeg path resolver and staged runner"
```

---

## Task 7: Render IPC + main/preload wiring

**Files:**
- Create: `electron/ipc/render.js`
- Modify: `electron/main.js` (import + `registerRenderIPC(ipcMain, { getMainWindow })` near `:312`), `electron/preload.js` (add methods)
- Test: `tests/electron/ipc/render.test.js`, `tests/electron/preloadContract.test.js` (extend)

**Interfaces:**
- `registerRenderIPC(ipcMain, deps)` registers `render:export-mp4`, `render:cancel`. Maintains `jobId→jobCtx` registry (duplicate jobId reject). Pipeline: `validateRenderRequest` → save dialog (main) → `resolveAndValidateInputs` → adapt audio (spec §4.6) → `buildRenderPlan` → `runFfmpegRender` with `onProgress` → `webContents.send('render:progress', {...})`. Returns `{ ok, outPath, durationSec, width, height } | { ok:false, cancelled } | { ok:false, error, stderrTail }`.
- preload: `renderMp4(payload)→invoke('render:export-mp4')`, `renderCancel({jobId})→invoke('render:cancel')`, `onRenderProgress(cb)→unsubscribe` (pattern from `onStoryEvent`).

- [ ] **Step 1: Write failing tests** (register handlers with a fake ipcMain; assert `render:export-mp4`/`render:cancel` registered, duplicate jobId rejected, cancel routes to jobCtx). Extend preloadContract to assert `renderMp4`/`renderCancel`/`onRenderProgress` exposed and `onRenderProgress` returns a function.

```js
// tests/electron/ipc/render.test.js
import { describe, it, expect, vi } from 'vitest'
import { registerRenderIPC } from '../../../electron/ipc/render.js'

function fakeIpc() { const h = {}; return { handle: (c, fn) => { h[c] = fn }, _h: h } }

describe('registerRenderIPC', () => {
  it('registers export and cancel channels', () => {
    const ipc = fakeIpc(); registerRenderIPC(ipc, { getMainWindow: () => null })
    expect(typeof ipc._h['render:export-mp4']).toBe('function')
    expect(typeof ipc._h['render:cancel']).toBe('function')
  })
  it('rejects when the same jobId is already running', async () => {
    const ipc = fakeIpc()
    const deps = { getMainWindow: () => ({ webContents: { send: vi.fn() } }),
      validate: () => ({ ok: true }), pickOutPath: async () => '/out.mp4',
      resolve: async () => ({ images: new Map(), sfx: new Map(), audioClips: [] }),
      build: () => ({ stages: [], totalDurationMs: 1, sceneCount: 0, audioClipCount: 0 }),
      run: () => new Promise(() => {}) } // never resolves → stays running
    registerRenderIPC(ipc, deps)
    const req = { jobId: 'dup', options: { renderMode: 'final', renderBurnSubtitle: false }, prepared: { cloudRequest: {} } }
    ipc._h['render:export-mp4']({}, req)             // first: running
    const second = await ipc._h['render:export-mp4']({}, req)
    expect(second).toMatchObject({ ok: false })
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** `electron/ipc/render.js` with injectable deps (default = real modules + `dialog.showSaveDialog`). Add preload methods mirroring `onStoryEvent` unsubscribe pattern. Register in `electron/main.js`:

```js
// electron/main.js — near other register*IPC calls (~:312)
import { registerRenderIPC } from './ipc/render.js'
// ...
registerRenderIPC(ipcMain, { getMainWindow: () => mainWindow })
```

```js
// electron/preload.js — add to electronAPI object
renderMp4: (payload) => ipcRenderer.invoke('render:export-mp4', payload),
renderCancel: (payload) => ipcRenderer.invoke('render:cancel', payload),
onRenderProgress: (cb) => {
  const listener = (_e, p) => cb(p)
  ipcRenderer.on('render:progress', listener)
  return () => ipcRenderer.removeListener('render:progress', listener)
},
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/electron/ipc/render.test.js tests/electron/preloadContract.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/render.js electron/main.js electron/preload.js tests/electron/ipc/render.test.js tests/electron/preloadContract.test.js
git commit -m "feat(render): wire render IPC, main registration, and preload"
```

---

## Task 8: Audio adapter (payload → clips)

**Files:**
- Create: `electron/render/audioAdapter.js`
- Test: `tests/electron/render/audioAdapter.test.js`

**Interfaces:**
- Produces: `adaptAudioClips(cloudRequest, resolved, sceneStartsMs) → Promise<[{ filename, path, startMs, durationMs, gain }]>`. Maps the 4 `audioTracks` shapes + `sfxItems` (초→ms, sceneId→누적 start) + legacy narration (probe). gain: narration/voice/story_narration=1.0, sfx=0.7 (스펙 §4.6).

- [ ] **Step 1: Write failing tests**

```js
// tests/electron/render/audioAdapter.test.js
import { describe, it, expect } from 'vitest'
import { adaptAudioClips } from '../../../electron/render/audioAdapter.js'

const resolved = {
  audio: new Map([['nar.wav', '/nar.wav'], ['sfxA.wav', '/sfxA.wav']]),
  sfx: new Map([['scene_2', '/scene2sfx.wav']]),
  narrationDurationMs: async () => 30000,
}
const sceneStartsMs = { scene_1: 0, scene_2: 3000 }

describe('adaptAudioClips', () => {
  it('maps story_narration with timecodeMs and gain 1.0', async () => {
    const cr = { audioTracks: [{ type: 'story_narration', filename: 'nar.wav', timecodeMs: 1000, durationMs: 2000, trackIndex: 0 }], sfxItems: [] }
    const [c] = await adaptAudioClips(cr, resolved, sceneStartsMs)
    expect(c).toMatchObject({ path: '/nar.wav', startMs: 1000, durationMs: 2000, gain: 1.0 })
  })
  it('maps sfx_timed with gain 0.7', async () => {
    const cr = { audioTracks: [{ type: 'sfx_timed', filename: 'sfxA.wav', timecodeMs: 500, durationMs: 800, category: 'story' }], sfxItems: [] }
    const [c] = await adaptAudioClips(cr, resolved, sceneStartsMs)
    expect(c.gain).toBe(0.7)
  })
  it('maps legacy narration with probed length and start 0', async () => {
    const cr = { audioTracks: [{ type: 'narration', filename: 'nar.wav', path: '/nar.wav' }], sfxItems: [] }
    const [c] = await adaptAudioClips(cr, resolved, sceneStartsMs)
    expect(c).toMatchObject({ startMs: 0, durationMs: 30000 })
  })
  it('converts sfxItems seconds→ms and places at scene cumulative start', async () => {
    const cr = { audioTracks: [], sfxItems: [{ sceneId: 'scene_2', filename: 'x', duration: 3 }] }
    const [c] = await adaptAudioClips(cr, resolved, sceneStartsMs)
    expect(c).toMatchObject({ path: '/scene2sfx.wav', startMs: 3000, durationMs: 3000, gain: 0.7 })
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** per spec §4.6 (four track shapes + sfxItems). `buildRenderPlan` (Task 5) consumes `resolved.audioClips` = output of this adapter; wire it in the IPC pipeline (Task 7 deps) so the runner mixes with `amix=normalize=0` + `adelay=…:all=1` + final `alimiter=level=false:latency=1`, intermediates `pcm_f32le` (spec §4.10).

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/render/audioAdapter.js tests/electron/render/audioAdapter.test.js
git commit -m "feat(render): add heterogeneous audio-track adapter"
```

---

## Task 9: Renderer exporter + useExport/App wiring

**Files:**
- Create: `src/exporters/render.js`
- Modify: `src/hooks/useExport.js` (add `handleExportRender`, progress/cancel state; update `:104` comment to include Render), `src/App.jsx` (destructure + pass props), `src/hooks/useExportSettings.js` (`renderMode`/`renderBurnSubtitle` defaults)
- Test: `tests/exporters/render.test.js`, `tests/hooks/useExport.render.test.js`

**Interfaces:**
- Produces: `exportRenderVideo(project, options, deps?) → Promise<result>`. Calls `prepareCloudRequest(project, options)` (NO `callExportFunction`), generates `jobId` (from `project.name`+counter, no `Date.now`), calls `window.electronAPI.renderMp4({ prepared, options:{ renderMode, renderBurnSubtitle }, jobId })`.
- `useExport.handleExportRender` mirrors `handleExportPremiere` (calls `loadStoryAudio()`), owns `renderProgress`/`renderJobId` state, exposes `onCancelRender`.

- [ ] **Step 1: Write failing tests** (render.js: asserts `prepareCloudRequest` called, `callExportFunction` NOT called, `renderMp4` called with `{prepared,options,jobId}`; useExport: asserts `loadStoryAudio` invoked for story project — mirror `tests/hooks/useExport.*` patterns).

```js
// tests/exporters/render.test.js
import { describe, it, expect, vi } from 'vitest'
import { exportRenderVideo } from '../../src/exporters/render.js'

describe('exportRenderVideo', () => {
  it('prepares payload locally and calls renderMp4 without GCF', async () => {
    const prepareCloudRequest = vi.fn(() => ({ cloudRequest: { format: 'portrait' }, mediaFiles: [], audioFiles: [], sfxFiles: [], pathMap: {} }))
    const renderMp4 = vi.fn(async () => ({ ok: true, outPath: '/o.mp4' }))
    const callExportFunction = vi.fn()
    const res = await exportRenderVideo({ name: 'p' }, { renderMode: 'final', renderBurnSubtitle: true },
      { prepareCloudRequest, renderMp4, callExportFunction, makeJobId: () => 'job_1' })
    expect(prepareCloudRequest).toHaveBeenCalled()
    expect(callExportFunction).not.toHaveBeenCalled()
    expect(renderMp4).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job_1', options: { renderMode: 'final', renderBurnSubtitle: true } }))
    expect(res.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** `render.js`, add `handleExportRender` to `useExport.js` (mirror `handleExportPremiere` at `:320`, incl. `loadStoryAudio()`), add settings defaults, wire `App.jsx` (`onExportRender`, `renderProgress`, `onCancelRender` to `<ExportModal>`).

```js
// src/hooks/useExportSettings.js — extend DEFAULT_SETTINGS
renderMode: 'final',
renderBurnSubtitle: true,
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/exporters/render.js src/hooks/useExport.js src/App.jsx src/hooks/useExportSettings.js tests/exporters/render.test.js tests/hooks/useExport.render.test.js
git commit -m "feat(render): add renderer exporter and useExport/App wiring"
```

---

## Task 10: UI — format registration, modal tab/card, i18n

**Files:**
- Modify: `src/utils/exportFormat.js` (`EXPORT_FORMATS`), `src/components/ExportSplitButton.jsx` (`FORMATS`), `src/components/ExportModal.jsx` (tab/card/handleExport/trial-badge hide/subtitle control/videoOverlays confirm/progress bar+cancel), `src/locales/ko.js`+`en.js`
- Test: `tests/utils/exportFormat.test.js` (extend), `tests/components/ExportModal.render.test.jsx`, `tests/locales/renderKeys.test.js`

**Interfaces:**
- Consumes: `onExportRender`, `renderProgress`, `onCancelRender` props (Task 9).

- [ ] **Step 1: Write failing tests** — `exportFormat` includes `'render'`; ExportModal renders a render tab, shows progress bar when `renderProgress`, hides trial badge for render, shows videoOverlays confirm when `cloudRequest.videoOverlays?.length`; locale keys exist in both ko/en.

```js
// tests/utils/exportFormat.test.js (add)
import { EXPORT_FORMATS } from '../../src/utils/exportFormat'
import { expect, it } from 'vitest'
it('includes render', () => { expect(EXPORT_FORMATS).toContain('render') })
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** — add `'render'` to `EXPORT_FORMATS`; add `{ key: 'render', label: '🎞️ Render' }` to `FORMATS`; add ExportModal render tab + `FormatCard` (mode radio preview/final, `renderBurnSubtitle` checkbox, hide common `includeSubtitle` for render), `handleExport` branch → `onExportRender`, hide trial badge when `format==='render'`, videoOverlays confirm before calling, progress bar bound to `renderProgress` + cancel button → `onCancelRender`; add ko/en strings.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/exportFormat.js src/components/ExportSplitButton.jsx src/components/ExportModal.jsx src/locales/ko.js src/locales/en.js tests/utils/exportFormat.test.js tests/components/ExportModal.render.test.jsx tests/locales/renderKeys.test.js
git commit -m "feat(render): add render format tab, card, and i18n"
```

---

## Task 11: Packaging — vendor ffmpeg staging + fonts

**Files:**
- Modify: `package.json` (build `extraResources` fonts/licenses, dist entries call staging), `scripts/install-platform-binaries.cjs` (stage vendor/ffmpeg + checksum), `scripts/afterPack.cjs` (copy target ffmpeg → resources + chmod + arch header check)
- Create: `vendor/ffmpeg/.gitkeep`, `assets/fonts/NotoSansKR-Regular.otf` (+ LICENSE), `scripts/verifyBinaryArch.cjs`
- Test: `tests/packaging/verifyBinaryArch.test.js`, `tests/packaging/afterPackFfmpeg.test.js`

**Interfaces:**
- Produces: `verifyBinaryArch(filePath, { platform, arch }) → boolean` (parse PE Machine / ELF e_machine+class / Mach-O cputype/fat — spec §6).

- [ ] **Step 1: Write failing test** — `verifyBinaryArch` returns true for a matching header fixture and false for a swapped one (use tiny byte fixtures for Mach-O cputype x86_64=0x01000007 vs arm64=0x0100000C).

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** `verifyBinaryArch.cjs` (magic + arch-field parse), extend `afterPack.cjs` to copy `vendor/ffmpeg/<target>/` → `resources/ffmpeg/`, chmod +x, and call `verifyBinaryArch` (throw on mismatch). Add `extraResources` for `assets/fonts/**` + `LICENSES/**`. Add `install:platform-binaries` to win/linux dist entries; verify libass at stage time (`ffmpeg -filters | grep ass`).

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/afterPack.cjs scripts/install-platform-binaries.cjs scripts/verifyBinaryArch.cjs vendor/ffmpeg/.gitkeep assets/fonts LICENSES tests/packaging
git commit -m "chore(render): stage vendor ffmpeg + fonts with arch verification"
```

---

## Task 12: Integration smoke + real-app visual gate

**Files:**
- Create: `tests/integration/render.smoke.test.js`
- Manual: real-app render (no test file)

- [ ] **Step 1: Write smoke test** — with a tiny 2-scene fixture + short WAV, run the real assembled pipeline (validate→resolve→adapt→buildPlan→runFfmpegRender against a real staged ffmpeg) into a temp MP4, then assert via bundled ffmpeg stderr parse: resolution/fps/duration/audio codec. Long-project variant: 300 synthetic image paths + 300 audio clips → assert render succeeds (argv/FD ceiling + staged mix). Guard the whole file behind `describe.skipIf(!ffmpegPresent)`.

- [ ] **Step 2: Run** — `npx vitest run tests/integration/render.smoke.test.js` → PASS (or SKIP if ffmpeg not staged locally).

- [ ] **Step 3: Lock golden filtergraph** — after the smoke test produces a visually-correct clip, re-run Task 5 with `--update` to lock the golden snapshot; eyeball the snapshot diff.

- [ ] **Step 4: Manual visual gate (spec §7)** — run the packaged/dev app and render a real 3–5 scene project across: preview/final × 16:9/9:16 × subtitle on/off. Confirm by eye: **no Ken Burns jitter, no Korean-subtitle tofu, audio sync, last-frame hold when audio longer**. This is a required gate (reviewers can't catch these).

- [ ] **Step 5: Commit**

```bash
git add tests/integration/render.smoke.test.js tests/electron/render/__snapshots__
git commit -m "test(render): add render smoke + long-project integration"
```

---

## Full-suite gate (before merge)

- [ ] `npm run test:run` — 전체 통과 (기존 export 3종/`prepareCloudRequest` 회귀 없음).
- [ ] Codex + Fable 리뷰 루프(구현 diff, findings 0).
- [ ] 완료 후 이 plan/spec을 `docs/plans-archive/`로 `git mv` (CLAUDE.md).
