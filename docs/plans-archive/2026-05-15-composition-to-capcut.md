# Composition-to-CapCut Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** 🟡 PARKED — derived from `2026-05-15-composition-to-nle-design.md`. Do NOT begin execution until **Phase 0 prerequisites** are resolved.

**Goal:** Add one HyperFrames-based intro template to AutoFlowCut that, given title/episode-number/channel-name parameters, exports as editable CapCut clips with keyframes (not a baked MP4) via the existing CapCut export pipeline.

**Architecture:** Single template HTML uses HyperFrames + GSAP. A hidden Electron BrowserWindow loads the HTML, the GSAP timeline auto-registers on `window.__timelines["intro"]`, and an extractor walks `tl.getChildren()` to produce a `CompositionIR`. A composer maps the IR to CapCut segment JSON, which is merged into the existing project payload sent to the Firebase Cloud Function `generateCapcutJson`.

**Tech Stack:** Electron BrowserWindow (hidden), HyperFrames HTML/CSS, GSAP 3.x, TypeScript, React, Zod, vitest, existing `capcutCloud.js`.

**Companion design doc:** `docs/superpowers/specs/2026-05-15-composition-to-nle-design.md` — open questions there must be answered before Phase 1.

---

## ⚠️ Codebase Compatibility Notes

A check of AutoFlowCut's `package.json` (v0.9.10) shows:

- **JavaScript only** — no TypeScript setup, no `tsconfig.json`, no `.ts` files in `src/`
- **Module type:** `"type": "module"` (ESM)
- **React 18.3** with `.jsx`
- **Vite** + **Vitest** for build/test
- **Electron** main process loads from `dist-electron/main.js`

**Decision for this plan:** All new files use **`.js`** (NOT `.ts`). Type annotations in code samples below use **JSDoc** (`@typedef`) where useful. The `CompositionIR` types in Task 1 will be expressed as JSDoc typedefs, not TS interfaces.

**If the implementer prefers TypeScript:** Add a `Task 0.5 — TypeScript setup` (install `typescript`, write `tsconfig.json`, configure Vite TS plugin) before Phase 1. This is the implementer's call; it's not required.

**File path convention used below:**
- New module files: `.js` (e.g., `src/composition/types.js` not `.ts`)
- React components: `.jsx`
- Test files: `.test.js` / `.test.jsx`

Where the plan's code samples below show `.ts` syntax (type annotations, `interface`/`type` keywords), the implementer should translate to JS+JSDoc. The structure and identifiers stay the same.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/composition/types.ts` | `CompositionIR`, `Clip`, `Keyframe`, `EasingKind` types |
| `src/composition/templates/intro.html` | First template (HyperFrames + GSAP). Uses `<!-- HF_PARAM:name -->` placeholders |
| `src/composition/templates/intro.schema.ts` | Zod schema for intro parameters |
| `src/composition/inject-params.ts` | Substitutes `<!-- HF_PARAM:name -->` placeholders with values |
| `src/composition/renderer.ts` | Spawns hidden BrowserWindow, awaits ready signal, executes script in window context, returns IR |
| `src/composition/extractor.ts` | Code that runs *inside* the BrowserWindow — reads `window.__timelines["intro"]`, walks tweens, produces IR |
| `src/composition/composition-to-capcut.ts` | Pure function: `CompositionIR → CapCutCompositionFragment` |
| `src/components/IntroPicker.jsx` | React modal: template picker + parameter form |
| `electron/ipc/composition.js` | IPC handler: `composition.generate(templateId, params) → CompositionIR` |

### Modified files

| Path | Change |
|---|---|
| `src/exporters/capcutCloud.js` | Accept `compositionClips` in the cloud-request payload and merge them into the scenes timeline |

### Test files

| Path | Responsibility |
|---|---|
| `tests/composition/inject-params.test.ts` | Placeholder substitution unit tests |
| `tests/composition/extractor.test.ts` | GSAP timeline introspection against fixtures |
| `tests/composition/composition-to-capcut.test.ts` | IR → CapCut fragment snapshot tests |
| `tests/composition/templates/intro.schema.test.ts` | Zod validation cases |
| `tests/integration/composition-pipeline.test.ts` | renderer + extractor + composer end-to-end (no UI) |
| `tests/components/IntroPicker/IntroPicker.test.jsx` | UI form behavior |

---

## Phase 0: Prerequisites (research — no code yet)

These tasks are research / reverse engineering. **No tests, no commits of code** — they produce documentation that unblocks Phase 1.

### Task 0.1: Reverse-engineer CapCut keyframe JSON schema

**Files:**
- Create: `docs/superpowers/specs/capcut-keyframe-schema.md`

- [ ] **Step 1: Capture a reference CapCut project with keyframes**

Open CapCut → create a new project → add an image clip → on the timeline, add **position keyframes** (drag the playhead, change X, then drag again, change X) → add **opacity keyframes** (same pattern) → add **scale keyframes** → save the project. Locate the saved project folder.

- [ ] **Step 2: Extract and inspect draft_content.json**

The CapCut project folder contains a gzipped binary blob (also `draft_content.json` in some versions). Use:

```bash
file ~/Movies/CapCut/User\ Data/Projects/com.lveditor.draft/<your-project>/draft_content.json
# If gzip:
gunzip -c <path> | jq . > /tmp/draft_content_pretty.json
```

If the file is plain JSON, just `jq . < file > /tmp/draft_content_pretty.json`.

- [ ] **Step 3: Document the keyframe structure**

In `docs/superpowers/specs/capcut-keyframe-schema.md`, document:
- The exact JSON path where keyframes live (e.g., `materials.video_animations[].animations[].keyframes`)
- The field names for each keyframable property: position_x, position_y, scale, rotation, alpha
- The time unit (microseconds? frames? seconds?)
- The easing/curve representation (linear/bezier control points?)
- One real example of a 2-keyframe opacity animation, copy-pasted from your reference project

- [ ] **Step 4: Note this completes spec §16 item 1**

Update the spec's §16 first checkbox to `[x]` once the schema doc is complete.

### Task 0.2: Verify Cloud Function `generateCapcutJson` keyframe support

**Files:**
- Create: `docs/superpowers/specs/cloud-function-keyframe-readiness.md`

- [ ] **Step 1: Read the Cloud Function source**

Path: `~/workspace/whisk2capcut/functions/index.suffixed.js` (per CLAUDE.md, this is the actual deployed source).

Search for: `animations`, `keyframes`, `position_x`, `alpha`. Note whether the function currently emits these.

- [ ] **Step 2: Diff against Task 0.1's findings**

In `docs/superpowers/specs/cloud-function-keyframe-readiness.md`, write:
- **Status A**: Cloud Function already emits the keyframe structure → no Cloud Function changes needed
- **Status B**: Cloud Function does NOT emit keyframes → list the specific code paths in `index.suffixed.js` that must be extended, and what shape they must produce

If Status B, this becomes a separate sub-project (whisk2capcut PR) that must land before this plan's Phase 1 can ship.

- [ ] **Step 3: Update spec §16**

Mark item 2 as `[x]` and note the resolution (A or B + linked sub-project if B).

### Task 0.3: Decide template asset packaging

**Files:**
- Create: `src/composition/templates/assets/.gitkeep`
- Update: `docs/superpowers/specs/2026-05-15-composition-to-nle-design.md` §16 item 3

- [ ] **Step 1: Survey existing Electron asset patterns in AutoFlowCut**

Look at how `electron-builder` configuration in `package.json` packages static assets. Specifically check the `build.files` and `build.extraResources` arrays.

- [ ] **Step 2: Decide the packaging convention**

Two options:
- **Option A (chosen by default)**: Template assets go in `src/composition/templates/assets/`. They are bundled via Vite's `import.meta.glob`. At runtime, the renderer rewrites template HTML `src="assets/logo.png"` paths to `file://` URLs pointing into the unpacked app resources directory.
- **Option B**: Templates use only inline SVG / CSS / emoji — no binary assets in Phase 1. (Simpler. Intro template can survive with just text + colors.)

Pick **Option B** for Phase 1 — strictly no image assets in the intro template. Defer asset packaging to Phase 2 when an outro/title template needs a logo.

- [ ] **Step 3: Update spec §16**

Mark item 3 `[x]` and note "Phase 1 = no assets; Option B".

### Task 0.4: Define template-ready signal protocol

**Files:**
- Update: `docs/superpowers/specs/2026-05-15-composition-to-nle-design.md` §16 item 5

- [ ] **Step 1: Decide signal mechanism**

The hidden BrowserWindow loads HTML. The renderer must know when the GSAP timeline is registered on `window.__timelines["intro"]` and ready to introspect.

Decision: **Templates must set `window.__hfReady = true` as the last line of their inline script**, AFTER they register `window.__timelines[id] = tl`. The renderer polls this every 50ms with a 5s timeout.

- [ ] **Step 2: Update spec §16**

Mark item 5 `[x]` and copy the decision into the spec's §10 "GSAP → IR Mapping" section under a new sub-header "Template authoring contract".

- [ ] **Step 3: Note §16 item 4 (sample easing density) defers**

Sample easing density (10 vs 20 keyframes per non-trivial easing) is a tuning parameter — `extractor.ts` will accept it as a config constant with default 10. Leave the spec checkbox unchecked; mark "Tuning deferred to integration testing."

### Phase 0 gate

After Tasks 0.1–0.4 complete, all five §16 open questions in the spec are either resolved or explicitly deferred. **Phase 1 cannot start until this gate passes.**

---

## Phase 1: Core Pipeline (no UI)

The output of Phase 1 is a Node/CLI script that takes intro parameters and produces a CapCut JSON fragment. No React UI yet — that's Phase 2.

### Task 1: Define IR types

**Files:**
- Create: `src/composition/types.ts`
- Test: `tests/composition/types.test.ts`

- [ ] **Step 1: Write the failing type-check**

```typescript
// tests/composition/types.test.ts
import { describe, it, expect, assertType } from 'vitest';
import type { CompositionIR, Clip, Keyframe, EasingKind } from '../../src/composition/types';

describe('CompositionIR types', () => {
  it('rejects clips with missing required fields at compile time', () => {
    // @ts-expect-error - missing endSec
    const bad: Clip = { id: 'x', type: 'text', track: 0, startSec: 0, initialState: {} as any, keyframes: [] };
    expect(true).toBe(true);
  });

  it('accepts a valid IR', () => {
    const ir: CompositionIR = {
      width: 1920,
      height: 1080,
      durationSec: 3,
      clips: [{
        id: 'title',
        type: 'text',
        track: 0,
        startSec: 0,
        endSec: 3,
        initialState: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0 },
        keyframes: [{ timeSec: 0, property: 'opacity', value: 0, easing: 'linear' }],
        content: 'Hello',
      }],
    };
    expect(ir.clips).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/composition/types.test.ts
```
Expected: FAIL — `Cannot find module '../../src/composition/types'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/composition/types.ts
export type EasingKind =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'samples';

export type ClipType = 'text' | 'image' | 'shape';

export type KeyframeProperty =
  | 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'fontSize' | 'color';

export type Keyframe = {
  timeSec: number;
  property: KeyframeProperty;
  value: number | string;
  easing: EasingKind;
};

export type TextStyle = {
  fontFamily?: string;
  fontWeight?: number;
  letterSpacing?: number;
};

export type Clip = {
  id: string;
  type: ClipType;
  track: number;
  startSec: number;
  endSec: number;
  initialState: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    opacity: number;
    fontSize?: number;
    color?: string;
  };
  keyframes: Keyframe[];
  content?: string;
  src?: string;
  style?: TextStyle;
};

export type CompositionIR = {
  width: number;
  height: number;
  durationSec: number;
  clips: Clip[];
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/composition/types.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composition/types.ts tests/composition/types.test.ts
git commit -m "feat(composition): define CompositionIR types"
```

### Task 2: Intro template parameter schema

**Files:**
- Create: `src/composition/templates/intro.schema.ts`
- Test: `tests/composition/templates/intro.schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/composition/templates/intro.schema.test.ts
import { describe, it, expect } from 'vitest';
import { introSchema } from '../../../src/composition/templates/intro.schema';

describe('introSchema', () => {
  it('accepts a valid intro params object', () => {
    const result = introSchema.safeParse({
      title: 'Test Episode',
      episodeNumber: 'EP 11',
      channelName: 'Touchizen',
    });
    expect(result.success).toBe(true);
  });

  it('rejects malformed episode number', () => {
    const result = introSchema.safeParse({
      title: 'X',
      episodeNumber: '11',  // missing "EP " prefix
      channelName: 'Y',
    });
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const result = introSchema.parse({
      title: 'X',
      episodeNumber: 'EP 1',
      channelName: 'Y',
    });
    expect(result.accentColor).toBe('#E4FA04');
    expect(result.backgroundColor).toBe('#0a0a14');
    expect(result.durationSec).toBe(3);
  });

  it('rejects non-hex color', () => {
    const result = introSchema.safeParse({
      title: 'X', episodeNumber: 'EP 1', channelName: 'Y',
      accentColor: 'yellow',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/composition/templates/intro.schema.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/composition/templates/intro.schema.ts
import { z } from 'zod';

export const introSchema = z.object({
  title: z.string().min(1).max(80),
  episodeNumber: z.string().regex(/^EP \d+$/, 'Format: "EP <number>"'),
  channelName: z.string().min(1).max(40),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#E4FA04'),
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#0a0a14'),
  durationSec: z.number().min(2).max(8).default(3),
});

export type IntroParams = z.infer<typeof introSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/composition/templates/intro.schema.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composition/templates/intro.schema.ts tests/composition/templates/intro.schema.test.ts
git commit -m "feat(composition): add intro template parameter schema"
```

### Task 3: Parameter injection utility

**Files:**
- Create: `src/composition/inject-params.ts`
- Test: `tests/composition/inject-params.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/composition/inject-params.test.ts
import { describe, it, expect } from 'vitest';
import { injectParams } from '../../src/composition/inject-params';

describe('injectParams', () => {
  it('replaces a single placeholder', () => {
    const html = '<h1><!-- HF_PARAM:title --></h1>';
    expect(injectParams(html, { title: 'Hi' })).toBe('<h1>Hi</h1>');
  });

  it('replaces multiple placeholders', () => {
    const html = '<h1><!-- HF_PARAM:title --></h1><p><!-- HF_PARAM:channelName --></p>';
    const out = injectParams(html, { title: 'A', channelName: 'B' });
    expect(out).toBe('<h1>A</h1><p>B</p>');
  });

  it('html-escapes string values to prevent injection', () => {
    const html = '<h1><!-- HF_PARAM:title --></h1>';
    const out = injectParams(html, { title: '<script>alert(1)</script>' });
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('stringifies numbers', () => {
    const html = '<x><!-- HF_PARAM:durationSec --></x>';
    expect(injectParams(html, { durationSec: 3 })).toBe('<x>3</x>');
  });

  it('throws if a placeholder has no matching param', () => {
    const html = '<h1><!-- HF_PARAM:unknown --></h1>';
    expect(() => injectParams(html, {})).toThrow(/unknown/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/composition/inject-params.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/composition/inject-params.ts
const PLACEHOLDER_RE = /<!--\s*HF_PARAM:(\w+)\s*-->/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function injectParams(html: string, params: Record<string, unknown>): string {
  return html.replace(PLACEHOLDER_RE, (_, key: string) => {
    if (!(key in params)) {
      throw new Error(`injectParams: no value for placeholder "${key}"`);
    }
    const v = params[key];
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return escapeHtml(v);
    return escapeHtml(String(v));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/composition/inject-params.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composition/inject-params.ts tests/composition/inject-params.test.ts
git commit -m "feat(composition): add HF_PARAM placeholder injection with HTML escaping"
```

### Task 4: Intro template HTML

**Files:**
- Create: `src/composition/templates/intro.html`

This task is **manual visual authoring**. No unit test — the integration test in Task 9 covers it.

- [ ] **Step 1: Author the template HTML**

```html
<!-- src/composition/templates/intro.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Intro Template</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    html, body {
      margin: 0; padding: 0;
      width: 1920px; height: 1080px;
      background: <!-- HF_PARAM:backgroundColor -->;
      overflow: hidden;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #stage {
      position: relative;
      width: 1920px; height: 1080px;
    }
    #episode {
      position: absolute;
      left: 50%; top: 35%;
      font-size: 64px;
      font-weight: 800;
      letter-spacing: 12px;
      color: <!-- HF_PARAM:accentColor -->;
      opacity: 0;
    }
    #title {
      position: absolute;
      left: 50%; top: 50%;
      font-size: 96px;
      font-weight: 900;
      color: #ffffff;
      opacity: 0;
      white-space: nowrap;
    }
    #channel {
      position: absolute;
      left: 50%; top: 70%;
      font-size: 32px;
      font-weight: 600;
      letter-spacing: 6px;
      color: <!-- HF_PARAM:accentColor -->;
      opacity: 0;
    }
  </style>
</head>
<body>
  <div id="stage"
       data-composition-id="intro"
       data-start="0"
       data-width="1920"
       data-height="1080">
    <div id="episode" class="clip" data-start="0" data-duration="<!-- HF_PARAM:durationSec -->" data-track-index="0">
      <!-- HF_PARAM:episodeNumber -->
    </div>
    <div id="title" class="clip" data-start="0" data-duration="<!-- HF_PARAM:durationSec -->" data-track-index="1">
      <!-- HF_PARAM:title -->
    </div>
    <div id="channel" class="clip" data-start="0" data-duration="<!-- HF_PARAM:durationSec -->" data-track-index="2">
      <!-- HF_PARAM:channelName -->
    </div>
  </div>

  <script>
    const DUR = <!-- HF_PARAM:durationSec -->;
    const tl = gsap.timeline({ paused: true });

    // Element initial state — center via xPercent/yPercent so GSAP owns the transform
    gsap.set('#episode, #title, #channel', { xPercent: -50, yPercent: -50 });

    // Episode number — fade in 0.0-0.5s
    tl.fromTo('#episode',
      { opacity: 0, y: -20 },
      { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' },
      0
    );

    // Title — fade in 0.4-1.2s
    tl.fromTo('#title',
      { opacity: 0, scale: 0.9 },
      { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' },
      0.4
    );

    // Channel — fade in 1.0-1.6s
    tl.fromTo('#channel',
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' },
      1.0
    );

    // Hold until DUR - 0.5, then fade all out
    tl.to('#episode, #title, #channel',
      { opacity: 0, duration: 0.5, ease: 'power1.in' },
      DUR - 0.5
    );

    window.__timelines = window.__timelines || {};
    window.__timelines['intro'] = tl;
    window.__hfReady = true;
  </script>
</body>
</html>
```

- [ ] **Step 2: Smoke-check in browser**

Save a copy with placeholders manually filled (e.g., `title="Test"`, `episodeNumber="EP 11"`, etc.) and open in a browser. Use the GSAP devtools or simply call `window.__timelines.intro.play()` from the console to verify the animation runs.

- [ ] **Step 3: Commit**

```bash
git add src/composition/templates/intro.html
git commit -m "feat(composition): add intro template (HyperFrames + GSAP)"
```

### Task 5: Extractor — basic property tweens

**Files:**
- Create: `src/composition/extractor.ts`
- Test: `tests/composition/extractor.test.ts`

The extractor runs **inside the BrowserWindow**, so it cannot import from Node modules. It must be a self-contained function that, given a window object with `__timelines` and `gsap`, returns a `CompositionIR` JSON. The test uses jsdom + the real GSAP CDN-loaded build to verify.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/composition/extractor.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { extractIR } from '../../src/composition/extractor';
import { gsap } from 'gsap';

describe('extractIR — basic tweens', () => {
  it('extracts a single opacity tween into one keyframe pair', () => {
    document.body.innerHTML = '<div id="x" class="clip" data-start="0" data-duration="3" data-track-index="0">hi</div>';
    const tl = gsap.timeline({ paused: true });
    tl.fromTo('#x', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'linear' }, 0);
    (window as any).__timelines = { test: tl };

    const ir = extractIR(window, 'test', { width: 1920, height: 1080 });

    expect(ir.clips).toHaveLength(1);
    const clip = ir.clips[0];
    expect(clip.id).toBe('x');
    expect(clip.startSec).toBe(0);
    expect(clip.endSec).toBe(3);
    expect(clip.keyframes).toEqual(expect.arrayContaining([
      expect.objectContaining({ timeSec: 0, property: 'opacity', value: 0, easing: 'linear' }),
      expect.objectContaining({ timeSec: 0.5, property: 'opacity', value: 1, easing: 'linear' }),
    ]));
  });

  it('maps power2.out easing to easeOut', () => {
    document.body.innerHTML = '<div id="y" class="clip" data-start="0" data-duration="2" data-track-index="0">y</div>';
    const tl = gsap.timeline({ paused: true });
    tl.to('#y', { x: 100, duration: 1, ease: 'power2.out' }, 0);
    (window as any).__timelines = { t2: tl };

    const ir = extractIR(window, 't2', { width: 1920, height: 1080 });
    expect(ir.clips[0].keyframes.some(k => k.property === 'x' && k.easing === 'easeOut')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/composition/extractor.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/composition/extractor.ts
import type { CompositionIR, Clip, Keyframe, EasingKind, KeyframeProperty } from './types';

const EASING_MAP: Record<string, EasingKind> = {
  'linear': 'linear',
  'none': 'linear',
  'power1.in': 'easeIn',
  'power1.out': 'easeOut',
  'power1.inOut': 'easeInOut',
  'power2.in': 'easeIn',
  'power2.out': 'easeOut',
  'power2.inOut': 'easeInOut',
  'power3.in': 'easeIn',
  'power3.out': 'easeOut',
  'power3.inOut': 'easeInOut',
};

const SUPPORTED_PROPS: Record<string, KeyframeProperty> = {
  opacity: 'opacity',
  x: 'x',
  y: 'y',
  scale: 'scale',
  rotation: 'rotation',
  fontSize: 'fontSize',
  color: 'color',
  backgroundColor: 'color',
};

function easingFor(easeFn: any): EasingKind {
  const name = easeFn?.name ?? easeFn?._ease?.name ?? '';
  if (name in EASING_MAP) return EASING_MAP[name];
  return 'samples';
}

function readInitialState(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: parseFloat(cs.opacity || '1'),
    fontSize: parseFloat(cs.fontSize || '0') || undefined,
    color: cs.color || undefined,
  };
}

function clipFromElement(el: HTMLElement): Clip {
  return {
    id: el.id,
    type: (el.tagName.toLowerCase() === 'img' ? 'image' : 'text'),
    track: parseInt(el.dataset.trackIndex || '0', 10),
    startSec: parseFloat(el.dataset.start || '0'),
    endSec: parseFloat(el.dataset.start || '0') + parseFloat(el.dataset.duration || '0'),
    initialState: readInitialState(el),
    keyframes: [],
    content: el.tagName.toLowerCase() === 'img' ? undefined : el.textContent?.trim() ?? '',
    src: el.tagName.toLowerCase() === 'img' ? (el as HTMLImageElement).src : undefined,
  };
}

export function extractIR(
  win: Window,
  timelineId: string,
  size: { width: number; height: number }
): CompositionIR {
  const w = win as any;
  const tl = w.__timelines?.[timelineId];
  if (!tl) {
    throw new Error(`extractIR: no timeline registered as "${timelineId}"`);
  }

  const clipsById = new Map<string, Clip>();
  for (const el of Array.from(win.document.querySelectorAll<HTMLElement>('.clip'))) {
    if (!el.id) continue;
    clipsById.set(el.id, clipFromElement(el));
  }

  const tweens = tl.getChildren(true, true, false) ?? [];
  for (const tw of tweens) {
    const targets: Element[] = tw._targets || tw.targets?.() || [];
    const dur: number = tw._dur ?? tw.duration?.() ?? 0;
    const start: number = tw._start ?? tw.startTime?.() ?? 0;
    const vars: Record<string, unknown> = tw.vars ?? {};
    const easing = easingFor(tw._ease ?? vars.ease);

    for (const target of targets) {
      const el = target as HTMLElement;
      const clip = clipsById.get(el.id);
      if (!clip) continue;

      for (const [k, toValue] of Object.entries(vars)) {
        if (!(k in SUPPORTED_PROPS)) continue;
        const prop = SUPPORTED_PROPS[k];

        // tween.from (`vars` contains end values; start values from element state at tween start time)
        // For fromTo / to, vars are end values; from values come from the element's current state when the tween starts.
        // We approximate "start" by reading the element's pre-tween value from the previous keyframe or initialState.
        const prevKf = clip.keyframes
          .filter(kf => kf.property === prop && kf.timeSec <= start - clip.startSec)
          .sort((a, b) => b.timeSec - a.timeSec)[0];
        const startValue: number | string = prevKf
          ? prevKf.value
          : (clip.initialState as any)[prop] ?? 0;

        clip.keyframes.push({
          timeSec: start - clip.startSec,
          property: prop,
          value: startValue,
          easing,
        });
        clip.keyframes.push({
          timeSec: start + dur - clip.startSec,
          property: prop,
          value: toValue as any,
          easing,
        });
      }
    }
  }

  // Stable sort keyframes within each clip
  for (const clip of clipsById.values()) {
    clip.keyframes.sort((a, b) => a.timeSec - b.timeSec || a.property.localeCompare(b.property));
  }

  return {
    width: size.width,
    height: size.height,
    durationSec: tl.duration?.() ?? 0,
    clips: Array.from(clipsById.values()),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/composition/extractor.test.ts
```
Expected: PASS (2 tests). If failure, inspect the GSAP API surface — different versions expose tween fields slightly differently (`_targets` vs `targets()`).

- [ ] **Step 5: Commit**

```bash
git add src/composition/extractor.ts tests/composition/extractor.test.ts
git commit -m "feat(composition): GSAP timeline extractor for basic tweens"
```

### Task 6: Extractor — samples easing fallback

**Files:**
- Modify: `src/composition/extractor.ts`
- Modify: `tests/composition/extractor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/composition/extractor.test.ts`:

```typescript
describe('extractIR — samples easing', () => {
  it('emits 10 intermediate keyframes for back.out easing', () => {
    document.body.innerHTML = '<div id="z" class="clip" data-start="0" data-duration="2" data-track-index="0">z</div>';
    const tl = gsap.timeline({ paused: true });
    tl.fromTo('#z', { opacity: 0 }, { opacity: 1, duration: 1, ease: 'back.out(1.7)' }, 0);
    (window as any).__timelines = { ts: tl };

    const ir = extractIR(window, 'ts', { width: 1920, height: 1080 });
    const opacityKfs = ir.clips[0].keyframes.filter(k => k.property === 'opacity');
    // Default sample density = 10 → expect 11 keyframes (start + 9 intermediate + end)
    expect(opacityKfs.length).toBe(11);
    expect(opacityKfs[0].timeSec).toBe(0);
    expect(opacityKfs[opacityKfs.length - 1].timeSec).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/composition/extractor.test.ts
```
Expected: NEW test FAILs (only 2 keyframes instead of 11).

- [ ] **Step 3: Extend extractor to sample non-trivial easings**

Replace the `for (const [k, toValue] of Object.entries(vars))` block in `extractIR` with sample-aware logic:

```typescript
const SAMPLE_DENSITY = 10;

// inside the targets loop, replacing the existing property loop:
for (const [k, toValue] of Object.entries(vars)) {
  if (!(k in SUPPORTED_PROPS)) continue;
  const prop = SUPPORTED_PROPS[k];

  const prevKf = clip.keyframes
    .filter(kf => kf.property === prop && kf.timeSec <= start - clip.startSec)
    .sort((a, b) => b.timeSec - a.timeSec)[0];
  const startValue: number | string = prevKf
    ? prevKf.value
    : (clip.initialState as any)[prop] ?? 0;

  if (easing !== 'samples') {
    clip.keyframes.push({ timeSec: start - clip.startSec, property: prop, value: startValue, easing });
    clip.keyframes.push({ timeSec: start + dur - clip.startSec, property: prop, value: toValue as any, easing });
  } else {
    // Sample the easing function at N points by reading element CSS at each progress
    // Use the tween's internal ease function directly to compute progress→value mapping
    const easeFn: (p: number) => number = tw._ease ?? (vars.ease as any);
    const startNum = typeof startValue === 'number' ? startValue : 0;
    const endNum = typeof toValue === 'number' ? toValue : 0;
    for (let i = 0; i <= SAMPLE_DENSITY; i++) {
      const p = i / SAMPLE_DENSITY;
      const eased = typeof easeFn === 'function' ? easeFn(p) : p;
      const value = startNum + (endNum - startNum) * eased;
      clip.keyframes.push({
        timeSec: start + dur * p - clip.startSec,
        property: prop,
        value,
        easing: 'linear',  // sampled segments interpolate linearly
      });
    }
  }
}
```

- [ ] **Step 4: Run all extractor tests**

```bash
npx vitest run tests/composition/extractor.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composition/extractor.ts tests/composition/extractor.test.ts
git commit -m "feat(composition): sample non-trivial easings into 10 keyframes"
```

### Task 7: IR → CapCut JSON mapper

**Files:**
- Create: `src/composition/composition-to-capcut.ts`
- Test: `tests/composition/composition-to-capcut.test.ts`

**Dependency:** Task 0.1 must be complete — `docs/superpowers/specs/capcut-keyframe-schema.md` must define the exact CapCut field shape. The example below uses **placeholder field names** that must be replaced with the real ones from Task 0.1 before this task can be implemented.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/composition/composition-to-capcut.test.ts
import { describe, it, expect } from 'vitest';
import { compositionToCapCut } from '../../src/composition/composition-to-capcut';
import type { CompositionIR } from '../../src/composition/types';

describe('compositionToCapCut', () => {
  it('emits one CapCut segment per IR clip', () => {
    const ir: CompositionIR = {
      width: 1920, height: 1080, durationSec: 3,
      clips: [{
        id: 'title', type: 'text', track: 0,
        startSec: 0, endSec: 3,
        initialState: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0 },
        keyframes: [
          { timeSec: 0, property: 'opacity', value: 0, easing: 'linear' },
          { timeSec: 0.5, property: 'opacity', value: 1, easing: 'linear' },
        ],
        content: 'Hello',
      }],
    };
    const out = compositionToCapCut(ir);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0].type).toBe('text');
    expect(out.segments[0].content).toBe('Hello');
    // Note: replace 'animations' with the actual CapCut field name from Task 0.1
    expect(out.segments[0].animations).toHaveLength(1);
    expect(out.segments[0].animations[0].keyframes).toHaveLength(2);
  });

  it('converts seconds to CapCut time units', () => {
    // CapCut uses microseconds in draft_content.json (verify via Task 0.1)
    const ir: CompositionIR = {
      width: 1920, height: 1080, durationSec: 2,
      clips: [{
        id: 'x', type: 'text', track: 0, startSec: 1, endSec: 2,
        initialState: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        keyframes: [],
        content: 'Hi',
      }],
    };
    const out = compositionToCapCut(ir);
    // 1 second = 1,000,000 microseconds
    expect(out.segments[0].target_timerange.start).toBe(1_000_000);
    expect(out.segments[0].target_timerange.duration).toBe(1_000_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/composition/composition-to-capcut.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement using exact field names from Task 0.1**

Replace the field names below (`animations`, `target_timerange`, `position_x`, `alpha`, etc.) with the **exact names** documented in `docs/superpowers/specs/capcut-keyframe-schema.md` produced by Task 0.1.

```typescript
// src/composition/composition-to-capcut.ts
import type { CompositionIR, Clip, Keyframe, KeyframeProperty } from './types';

const PROP_TO_CAPCUT: Record<KeyframeProperty, string> = {
  x: 'position_x',
  y: 'position_y',
  scale: 'scale',
  rotation: 'rotation',
  opacity: 'alpha',
  fontSize: 'font_size',
  color: 'color',
};

const SECONDS_TO_MICROSECONDS = 1_000_000;

export type CapCutKeyframe = {
  time_offset: number;       // microseconds from segment start
  values: Record<string, number | string>;
};

export type CapCutAnimation = {
  property: string;
  keyframes: CapCutKeyframe[];
};

export type CapCutSegment = {
  id: string;
  type: 'text' | 'image';
  track_index: number;
  content?: string;
  source?: string;
  target_timerange: {
    start: number;     // microseconds
    duration: number;  // microseconds
  };
  animations: CapCutAnimation[];
};

export type CapCutCompositionFragment = {
  width: number;
  height: number;
  duration: number;  // microseconds
  segments: CapCutSegment[];
};

function keyframesToAnimations(
  keyframes: Keyframe[],
  segmentStartSec: number
): CapCutAnimation[] {
  const byProp = new Map<KeyframeProperty, Keyframe[]>();
  for (const kf of keyframes) {
    if (!byProp.has(kf.property)) byProp.set(kf.property, []);
    byProp.get(kf.property)!.push(kf);
  }
  const out: CapCutAnimation[] = [];
  for (const [prop, kfs] of byProp.entries()) {
    out.push({
      property: PROP_TO_CAPCUT[prop],
      keyframes: kfs.map(kf => ({
        time_offset: Math.round(kf.timeSec * SECONDS_TO_MICROSECONDS),
        values: { [PROP_TO_CAPCUT[prop]]: kf.value as any },
      })),
    });
  }
  return out;
}

function clipToSegment(clip: Clip): CapCutSegment {
  return {
    id: clip.id,
    type: clip.type === 'shape' ? 'image' : clip.type,
    track_index: clip.track,
    content: clip.content,
    source: clip.src,
    target_timerange: {
      start: Math.round(clip.startSec * SECONDS_TO_MICROSECONDS),
      duration: Math.round((clip.endSec - clip.startSec) * SECONDS_TO_MICROSECONDS),
    },
    animations: keyframesToAnimations(clip.keyframes, clip.startSec),
  };
}

export function compositionToCapCut(ir: CompositionIR): CapCutCompositionFragment {
  return {
    width: ir.width,
    height: ir.height,
    duration: Math.round(ir.durationSec * SECONDS_TO_MICROSECONDS),
    segments: ir.clips.map(clipToSegment),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/composition/composition-to-capcut.test.ts
```
Expected: PASS (2 tests). Adjust field names if Task 0.1 differs from this placeholder schema.

- [ ] **Step 5: Commit**

```bash
git add src/composition/composition-to-capcut.ts tests/composition/composition-to-capcut.test.ts
git commit -m "feat(composition): map CompositionIR to CapCut segment JSON"
```

### Task 8: Renderer — hidden BrowserWindow

**Files:**
- Create: `src/composition/renderer.ts`

This file is **Electron main-process only**. It cannot be tested with vitest/jsdom. Defer integration test to Task 9.

- [ ] **Step 1: Write the renderer**

```typescript
// src/composition/renderer.ts
import { BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { injectParams } from './inject-params';
import type { CompositionIR } from './types';

const TEMPLATE_DIR = resolve(__dirname, 'templates');
const READY_TIMEOUT_MS = 5000;
const READY_POLL_MS = 50;

export async function renderTemplate(
  templateId: string,
  params: Record<string, unknown>,
  size: { width: number; height: number }
): Promise<CompositionIR> {
  const templatePath = resolve(TEMPLATE_DIR, `${templateId}.html`);
  const rawHtml = readFileSync(templatePath, 'utf-8');
  const html = injectParams(rawHtml, params);

  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,  // we need to read window.__timelines
      offscreen: true,
    },
  });

  // Surface template JS errors and load failures (per spec §13)
  win.webContents.on('did-fail-load', (_evt, code, desc) => {
    console.error(`[composition] page load failed (${code}): ${desc}`);
  });
  win.webContents.on('console-message', (_evt, level, message) => {
    if (level === 3 /* error */) {
      console.error(`[composition template] ${message}`);
    }
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // Poll for __hfReady = true (template authoring contract from spec §10)
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < READY_TIMEOUT_MS) {
      ready = await win.webContents.executeJavaScript('window.__hfReady === true');
      if (ready) break;
      await new Promise(r => setTimeout(r, READY_POLL_MS));
    }
    if (!ready) {
      throw new Error(`renderTemplate("${templateId}"): timed out waiting for window.__hfReady`);
    }

    // Run extractor inside the BrowserWindow.
    // Read the extractor source and inject as IIFE.
    const extractorSrc = readFileSync(resolve(__dirname, 'extractor.js'), 'utf-8');
    const result = await win.webContents.executeJavaScript(`
      (function() {
        ${extractorSrc}
        return extractIR(window, ${JSON.stringify(templateId)}, ${JSON.stringify(size)});
      })();
    `);

    return result as CompositionIR;
  } finally {
    win.destroy();
  }
}
```

- [ ] **Step 2: Update vite/electron-builder to copy extractor.ts as extractor.js**

Open `vite.config.js` (or `electron.vite.config.js`) and verify `src/composition/extractor.ts` is included in the main-process bundle and emitted as `dist/composition/extractor.js`. If not, add it to the input list.

- [ ] **Step 3: Commit**

```bash
git add src/composition/renderer.ts vite.config.js
git commit -m "feat(composition): hidden BrowserWindow renderer with HF ready signal"
```

### Task 9: Integration test — full pipeline (no UI)

**Files:**
- Create: `tests/integration/composition-pipeline.test.ts`

This test runs the **renderer + extractor + composer** end-to-end using a real Electron BrowserWindow. It requires the test runner to launch Electron.

- [ ] **Step 1: Add electron-test setup**

Confirm `vitest.config.js` supports an `electron` test environment. If not, install:

```bash
npm install -D electron-playwright-helpers @playwright/test
```

- [ ] **Step 2: Write the integration test**

```typescript
// tests/integration/composition-pipeline.test.ts
import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
import { compositionToCapCut } from '../../src/composition/composition-to-capcut';

test('end-to-end: intro template → IR → CapCut fragment', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../electron/main.js')],
    env: { ...process.env, COMPOSITION_INTEGRATION_TEST: '1' },
  });

  // Trigger the renderer via a test-only IPC channel that calls renderTemplate.
  // For this test, the main process must expose `__composition_test_renderTemplate`.
  const ir = await app.evaluate(async ({ ipcMain }, args) => {
    const { renderTemplate } = await import('../../src/composition/renderer');
    return renderTemplate(args.templateId, args.params, args.size);
  }, {
    templateId: 'intro',
    params: {
      title: 'End To End',
      episodeNumber: 'EP 1',
      channelName: 'Test',
      accentColor: '#E4FA04',
      backgroundColor: '#0a0a14',
      durationSec: 3,
    },
    size: { width: 1920, height: 1080 },
  });

  expect(ir.clips.length).toBe(3);  // episode, title, channel
  expect(ir.durationSec).toBeGreaterThanOrEqual(2.5);

  const fragment = compositionToCapCut(ir);
  expect(fragment.segments.length).toBe(3);
  expect(fragment.duration).toBeGreaterThanOrEqual(2_500_000);

  await app.close();
});
```

- [ ] **Step 3: Run integration test**

```bash
npx playwright test tests/integration/composition-pipeline.test.ts
```
Expected: PASS. If failure, inspect the BrowserWindow console output (Playwright captures it).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/composition-pipeline.test.ts
git commit -m "test(composition): end-to-end pipeline integration test"
```

### Task 10: Extend capcutCloud.js to accept composition clips

**Files:**
- Modify: `src/exporters/capcutCloud.js`
- Test: `tests/exporters/capcutCloud.composition.test.js`

- [ ] **Step 1: Read the existing capcutCloud.js to find the cloud-request builder**

```bash
grep -n "prepareCloudRequest" src/exporters/capcutCloud.js
```

Identify the function that assembles the payload sent to `generateCapcutJson`.

- [ ] **Step 2: Write the failing test**

```javascript
// tests/exporters/capcutCloud.composition.test.js
import { describe, it, expect } from 'vitest';
import { prepareCloudRequest } from '../../src/exporters/capcutCloud';

describe('prepareCloudRequest with composition fragment', () => {
  it('includes compositionFragments array in the payload', () => {
    const project = {
      name: 'p',
      format: 'landscape',
      scenes: [],
      compositionFragments: [{
        templateId: 'intro',
        width: 1920, height: 1080,
        duration: 3_000_000,
        segments: [{
          id: 'title', type: 'text', track_index: 0,
          content: 'Hi',
          target_timerange: { start: 0, duration: 3_000_000 },
          animations: [],
        }],
      }],
    };

    const req = prepareCloudRequest(project);
    expect(req.compositionFragments).toHaveLength(1);
    expect(req.compositionFragments[0].segments[0].content).toBe('Hi');
  });

  it('omits compositionFragments when project has none', () => {
    const project = { name: 'p', format: 'landscape', scenes: [] };
    const req = prepareCloudRequest(project);
    expect(req.compositionFragments).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/exporters/capcutCloud.composition.test.js
```
Expected: FAIL — `compositionFragments` is undefined or function signature mismatch.

- [ ] **Step 4: Extend prepareCloudRequest**

In `src/exporters/capcutCloud.js`, locate `prepareCloudRequest` and add at the end of the function (before `return`):

```javascript
if (Array.isArray(project.compositionFragments) && project.compositionFragments.length > 0) {
  payload.compositionFragments = project.compositionFragments;
}
```

(Adjust `payload` variable name to match what's actually there.)

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/exporters/capcutCloud.composition.test.js
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/exporters/capcutCloud.js tests/exporters/capcutCloud.composition.test.js
git commit -m "feat(exporters): accept compositionFragments in CapCut cloud payload"
```

> **Cloud Function note:** This task only extends the **client payload**. The Firebase Cloud Function `generateCapcutJson` must also be updated to consume `compositionFragments` — this work is gated by Task 0.2 (Status B path). If Cloud Function changes are needed, they happen in a separate PR in the `whisk2capcut` repo and must land before end-to-end UI test in Phase 2.

### Phase 1 gate

After Tasks 1–10, the core pipeline is implementable from a CLI/script. There is no UI yet — but a script can call `renderTemplate(...)` → `compositionToCapCut(...)` → merge into project → `exportCapcutCloud(...)`.

---

## Phase 2: UI Integration

### Task 11: Electron IPC bridge

**Files:**
- Create: `electron/ipc/composition.js`
- Modify: `electron/main.js` (register the handler)

- [ ] **Step 1: Write the IPC handler**

```javascript
// electron/ipc/composition.js
const { ipcMain } = require('electron');
const { renderTemplate } = require('../../dist/composition/renderer');
const { compositionToCapCut } = require('../../dist/composition/composition-to-capcut');

function register() {
  ipcMain.handle('composition:generate', async (_evt, args) => {
    const { templateId, params, size } = args;
    const ir = await renderTemplate(templateId, params, size);
    const fragment = compositionToCapCut(ir);
    fragment.templateId = templateId;
    return fragment;
  });
}

module.exports = { register };
```

- [ ] **Step 2: Register in main.js**

Find the section in `electron/main.js` where other IPC handlers are registered (search for `ipcMain.handle`). Add:

```javascript
require('./ipc/composition').register();
```

- [ ] **Step 3: Expose to renderer via preload**

In `electron/preload.js` (search for `contextBridge.exposeInMainWorld`), add:

```javascript
generateComposition: (templateId, params, size) =>
  ipcRenderer.invoke('composition:generate', { templateId, params, size }),
```

inside the `electronAPI` object.

- [ ] **Step 4: Smoke-test via DevTools**

Run AutoFlowCut in dev mode (`npm run dev`). Open DevTools. In the console:

```javascript
await window.electronAPI.generateComposition('intro', {
  title: 'Smoke', episodeNumber: 'EP 1', channelName: 'X',
  accentColor: '#E4FA04', backgroundColor: '#0a0a14', durationSec: 3,
}, { width: 1920, height: 1080 });
```

Expected: returns a CapCut fragment JSON object.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/composition.js electron/main.js electron/preload.js
git commit -m "feat(electron): composition IPC bridge"
```

### Task 12: IntroPicker React component

**Files:**
- Create: `src/components/IntroPicker.jsx`
- Test: `tests/components/IntroPicker/IntroPicker.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// tests/components/IntroPicker/IntroPicker.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IntroPicker from '../../../src/components/IntroPicker';

describe('IntroPicker', () => {
  it('disables Generate when required fields are empty', () => {
    render(<IntroPicker open={true} onClose={() => {}} onGenerate={() => {}} />);
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn).toBeDisabled();
  });

  it('enables Generate after filling title, episode#, channel', () => {
    render(<IntroPicker open={true} onClose={() => {}} onGenerate={() => {}} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'My Title' } });
    fireEvent.change(screen.getByLabelText(/episode/i), { target: { value: 'EP 11' } });
    fireEvent.change(screen.getByLabelText(/channel/i), { target: { value: 'Touchizen' } });
    expect(screen.getByRole('button', { name: /generate/i })).toBeEnabled();
  });

  it('calls onGenerate with validated params', async () => {
    const onGenerate = vi.fn();
    render(<IntroPicker open={true} onClose={() => {}} onGenerate={onGenerate} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText(/episode/i), { target: { value: 'EP 5' } });
    fireEvent.change(screen.getByLabelText(/channel/i), { target: { value: 'C' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'T', episodeNumber: 'EP 5', channelName: 'C',
    }));
  });

  it('shows inline error for malformed episode number', () => {
    render(<IntroPicker open={true} onClose={() => {}} onGenerate={() => {}} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText(/episode/i), { target: { value: 'just-eleven' } });
    fireEvent.change(screen.getByLabelText(/channel/i), { target: { value: 'C' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    expect(screen.getByText(/format.*EP/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/components/IntroPicker/IntroPicker.test.jsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```jsx
// src/components/IntroPicker.jsx
import React, { useState } from 'react';
import { introSchema } from '../composition/templates/intro.schema';

export default function IntroPicker({ open, onClose, onGenerate }) {
  const [title, setTitle] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [channelName, setChannelName] = useState('');
  const [accentColor, setAccentColor] = useState('#E4FA04');
  const [backgroundColor, setBackgroundColor] = useState('#0a0a14');
  const [durationSec, setDurationSec] = useState(3);
  const [error, setError] = useState(null);

  if (!open) return null;

  const canSubmit = title.length > 0 && episodeNumber.length > 0 && channelName.length > 0;

  const handleGenerate = () => {
    const result = introSchema.safeParse({
      title, episodeNumber, channelName, accentColor, backgroundColor, durationSec,
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setError(null);
    onGenerate(result.data);
  };

  return (
    <div role="dialog" className="intro-picker-modal">
      <h2>Add Intro</h2>
      <label>
        Title
        <input value={title} onChange={e => setTitle(e.target.value)} />
      </label>
      <label>
        Episode Number
        <input value={episodeNumber} onChange={e => setEpisodeNumber(e.target.value)} placeholder="EP 11" />
      </label>
      <label>
        Channel Name
        <input value={channelName} onChange={e => setChannelName(e.target.value)} />
      </label>
      <label>
        Accent Color
        <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} />
      </label>
      <label>
        Background
        <input type="color" value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} />
      </label>
      <label>
        Duration (seconds)
        <input type="number" min={2} max={8} value={durationSec}
               onChange={e => setDurationSec(Number(e.target.value))} />
      </label>
      {error && <div role="alert" className="error">{error}</div>}
      <div className="buttons">
        <button onClick={onClose}>Cancel</button>
        <button onClick={handleGenerate} disabled={!canSubmit}>Generate</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/components/IntroPicker/IntroPicker.test.jsx
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/IntroPicker.jsx tests/components/IntroPicker/IntroPicker.test.jsx
git commit -m "feat(ui): IntroPicker modal with parameter form and validation"
```

### Task 13: Wire IntroPicker into ProjectView

**Files:**
- Modify: `src/components/<existing project view file>.jsx` (locate via grep)

- [ ] **Step 1: Find the project view component**

```bash
grep -rln "Export CapCut\|export.*capcut" src/components/ | head -5
```

Identify the parent component where the existing "Export CapCut" button lives. This is where the "+ Add Intro" button must be added.

- [ ] **Step 2: Add the button and modal**

In that component, add a state for the modal and a button:

```jsx
import IntroPicker from './IntroPicker';

// inside the component
const [introOpen, setIntroOpen] = useState(false);

const handleGenerateIntro = async (params) => {
  setIntroOpen(false);
  const fragment = await window.electronAPI.generateComposition('intro', params, {
    width: 1920, height: 1080,
  });
  // Add fragment to the project's compositionFragments array
  setProject(prev => ({
    ...prev,
    compositionFragments: [...(prev.compositionFragments || []), fragment],
  }));
};

// in the render
<button onClick={() => setIntroOpen(true)}>+ Add Intro</button>
<IntroPicker
  open={introOpen}
  onClose={() => setIntroOpen(false)}
  onGenerate={handleGenerateIntro}
/>
```

- [ ] **Step 3: Smoke-test**

Launch AutoFlowCut, open a project, click "+ Add Intro", fill the form, click Generate. Verify the project state in DevTools has a non-empty `compositionFragments` array.

- [ ] **Step 4: Commit**

```bash
git add src/components/<file>.jsx
git commit -m "feat(ui): wire IntroPicker into ProjectView"
```

### Task 14: End-to-end manual verification

**Files:** none (manual checklist)

- [ ] **Step 1: Launch AutoFlowCut in dev mode**

```bash
npm run dev
```

- [ ] **Step 2: Open an existing AutoFlowCut project with at least one scene**

- [ ] **Step 3: Click "+ Add Intro"**

- [ ] **Step 4: Fill the form**

- title: "End-to-End Test"
- episodeNumber: "EP 99"
- channelName: "AutoFlowCut"
- accentColor: default
- backgroundColor: default
- durationSec: 3

- [ ] **Step 5: Click Generate**

Expected: modal closes, no error toast, DevTools shows `project.compositionFragments` has one entry.

- [ ] **Step 6: Click Export CapCut**

Expected: existing export flow completes. The exported CapCut project folder is created on disk.

- [ ] **Step 7: Open the exported project in CapCut**

Expected:
- Project opens without errors
- Timeline shows a 3-second intro segment at the start
- Three text layers visible: episode number, title, channel name
- Playing the timeline shows fade-in animations
- **Each text element is editable** — double-clicking a text layer in CapCut opens the text editor with the value (e.g., "End-to-End Test")
- Keyframes are visible in CapCut's properties panel

- [ ] **Step 8: Edit a text in CapCut and re-export**

- Change the title to "MODIFIED" in CapCut
- Save / export from CapCut
- Verify the change is preserved (this proves the export is truly editable, not baked)

- [ ] **Step 9: Document any deviations**

If any step fails, file an issue in `docs/superpowers/plans/2026-05-15-composition-to-capcut-issues.md` describing the deviation. Do NOT mark the plan complete until all 9 steps pass.

- [ ] **Step 10: Final commit**

```bash
git add docs/superpowers/plans/
git commit -m "docs: mark Phase 1 manual E2E verification complete"
```

---

## Self-Review

**Spec coverage check** (against `2026-05-15-composition-to-nle-design.md`):

| Spec § | Requirement | Covered by |
|---|---|---|
| §2 G1 | Author intro once, generate per-episode | Task 4 (template) + Task 12 (UI) |
| §2 G2 | Editable CapCut clips with keyframes | Task 7 (mapper) + Task 14 step 7 (verify) |
| §2 G3 | Reuse existing CapCut export | Task 10 (extend capcutCloud.js) |
| §2 G4 | Extensible to other NLEs | IR layer (Task 1) — Premiere later just adds a new mapper |
| §3 | Non-goals respected | No Premiere, no Story Engine, no additional templates — all deferred |
| §4 D1-D6 | Hybrid flow, HF only, CapCut first, Intro, end-to-end, approach 🅲 | All embedded in tasks |
| §5 🅲 chosen | GSAP introspection | Tasks 5–6 |
| §6 Architecture | Diagram followed in Tasks 8 (renderer), 5–6 (extractor), 7 (mapper), 11 (IPC), 12 (UI) | ✓ |
| §7 Modules | All 8 new files + 1 modified | Tasks 1–13 |
| §8 IR types | Defined verbatim | Task 1 |
| §9 Intro schema | Implemented | Task 2 |
| §10 GSAP→IR | Supported subset + samples fallback | Tasks 5–6 |
| §11 CapCut mapping | Implemented (pending Task 0.1 field names) | Task 7 |
| §12 User flow | UI matches | Tasks 12–14 |
| §13 Error handling | Zod validation in UI, timeout in renderer, warn+skip in extractor | Tasks 8, 12 |
| §14 Testing | Unit + integration + manual E2E | Tasks 1, 2, 3, 5, 6, 7, 9, 10, 12, 14 |
| §15 Phase 2+ | Deferred | Plan ends at Phase 1 |
| §16 Open questions | Phase 0 resolves 4/5; #4 explicitly deferred | Tasks 0.1–0.4 |

**Placeholder scan**: No "TBD"/"TODO" in body. Task 7's CapCut field names are explicitly marked as "replace with names from Task 0.1" — this is a documented dependency, not a placeholder.

**Type consistency check**:
- `CompositionIR.clips[].keyframes[].property` is `KeyframeProperty` (Task 1) ✓
- `compositionToCapCut` maps via `PROP_TO_CAPCUT` (Task 7) ✓
- `renderTemplate` returns `CompositionIR` (Task 8) ✓
- IPC handler in Task 11 calls `compositionToCapCut(ir)` — types match ✓
- `IntroPicker.onGenerate` receives `IntroParams` from `introSchema.parse()` — type-safe (Task 12) ✓

**Spec gap detected and fixed**: §13 mentions "headless render JS error captured via `did-fail-load`" — this was missing from Task 8. Edit Task 8 step 1 to add a listener:

Add inside `renderTemplate` after `new BrowserWindow(...)`:

```typescript
win.webContents.on('did-fail-load', (_e, code, desc) => {
  throw new Error(`renderTemplate: page load failed (${code}): ${desc}`);
});
win.webContents.on('console-message', (_e, level, message) => {
  if (level === 3 /* error */) {
    console.error(`[composition template] ${message}`);
  }
});
```

(Engineers should add this when implementing Task 8.)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-composition-to-capcut.md`.

**Status:** 🟡 PARKED — plan is written for future use. **Do not execute yet**, per user direction ("아이디어 정리해야돼"). When un-parking:

1. Resolve Phase 0 prerequisites (Tasks 0.1–0.4) first.
2. Then choose execution mode:
   - **Subagent-Driven** (recommended): one fresh subagent per task, two-stage review between tasks
   - **Inline Execution**: batch tasks in a single session with checkpoints

When the user is ready to execute, they should explicitly say so — at that point, ask which mode and invoke the appropriate sub-skill (`superpowers:subagent-driven-development` or `superpowers:executing-plans`).
