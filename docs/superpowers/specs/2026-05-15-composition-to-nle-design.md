# Composition-to-NLE Export (HyperFrames → CapCut/Premiere)

**Status**: 🟡 **PARKED — idea capture, not ready for implementation**

**Date**: 2026-05-15

**Author**: Brainstorming session with Claude (gifted-chaum-d20b4a worktree)

**Re-evaluation trigger**: Revisit when the demand for procedural intros/outros/lower-thirds becomes concrete (e.g., Story Engine producing series at scale where repetitive intro authoring becomes a bottleneck).

---

## 1. Background

AutoFlowCut today is an **"AI media → CapCut" converter**: it generates AI images/videos (via Google Flow / Veo) and serializes a CapCut project that the user fine-tunes in CapCut. The user manually authors intros, outros, lower-thirds, and procedural graphics inside CapCut for every episode.

This spec explores extending AutoFlowCut so that **code-authored compositions** (HyperFrames HTML+GSAP templates) become a second input source, exported into the **same CapCut project** as editable clips with keyframes — not as a baked MP4.

The strategic reframing: AutoFlowCut becomes a **universal "X → NLE converter"** where X is either AI-generated media OR code-authored procedural graphics.

---

## 2. Goals

- **G1**: Author one intro template in HyperFrames once. Generate per-episode intros via parameters (title, episode number, channel name, accent color).
- **G2**: Export the resulting composition as **editable** CapCut clips with keyframes — text/colors/timing must remain editable in CapCut, NOT baked to MP4.
- **G3**: Reuse AutoFlowCut's existing CapCut export pipeline (`capcutCloud.js` + Firebase Cloud Function `generateCapcutJson`) without forking it.
- **G4**: Architecture must extend to additional NLE targets (Premiere Pro) and additional templates (outro, lower-third, password-reveal) without rewriting the core.

## 3. Non-Goals (explicitly out of scope for Phase 1)

- Premiere Pro export (deferred to Phase 2)
- Story Engine automatic invocation (deferred to Phase 2; Phase 1 is manual UI only)
- Templates beyond Intro (outro, lower-third, etc. — deferred)
- User-supplied arbitrary HyperFrames code (only built-in templates supported)
- Real-time editor for templates (templates are authored in code, not GUI)
- Animation primitives beyond opacity/position/scale/rotation/color/fontSize
- Custom shaders, particles, WebGL, MotionPath, SplitText, ScrollTrigger
- Audio inside composition templates (audio handled elsewhere in AutoFlowCut)

---

## 4. Decisions Captured (from brainstorming)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| D1 | User flow | **Hybrid**: built-in template library + Story Engine auto-fill | Story Engine has episode metadata; users may also pick manually |
| D2 | Framework | **HyperFrames only** | Apache 2.0 (compatible with AutoFlowCut AGPL); no build step (simpler Electron embed); LLM-friendly source |
| D3 | NLE targets | **CapCut + Premiere** long-term; **CapCut first** | CapCut reuses existing infra; Premiere borrowed from `whisk2premiere` later |
| D4 | First template | **Intro** | Highest demand, clear parameter shape (title + ep# + channel) |
| D5 | Phase 1 DoD | **End-to-end working**: UI → fill params → export → opens in CapCut → intro plays as editable clips | One framework, one template, one output — but fully functional |
| D6 | Architecture approach | **🅲 GSAP Timeline Introspection** | Single source of truth (HTML+GSAP); LLM/Story Engine can author templates as HTML; introspection via documented GSAP API |

---

## 5. Architectural Alternatives Considered

### 🅰 Bake MP4 + Wrap *(rejected)*

Render the HyperFrames template to MP4 via `npx hyperframes render`, then import the MP4 as a single video clip in CapCut.

- ✅ Simplest implementation
- ✅ 100% visual fidelity
- ❌ **Violates G2** — clip is not editable in CapCut; defeats the entire premise of "export to NLE"

### 🅱 Template + Parallel Exporter *(viable fallback)*

Each template ships as two files: `intro.html` (preview only) + `intro.exporter.ts` (CapCut JSON generator). Both consume the same parameters.

- ✅ Deterministic, fast, no headless browser
- ✅ Each exporter directly emits CapCut keyframes — no introspection complexity
- ❌ Two sources of truth — every template change requires editing two files in sync
- ❌ LLM/Story Engine must author both halves; less natural

### 🅲 GSAP Timeline Introspection *(chosen)*

Each template is a single HTML file with HyperFrames structure + GSAP timeline. At export time, AutoFlowCut loads the HTML in a hidden Electron BrowserWindow, lets the timeline initialize (`paused: true`), then reads `window.__timelines["X"]` and walks `tl.getChildren()` to enumerate tweens. Each tween becomes one or more keyframes in a `CompositionIR`. Per-target exporters (CapCut, later Premiere) consume the IR.

- ✅ Single source of truth (HTML + GSAP)
- ✅ Same HTML is used for live preview AND export — no drift possible
- ✅ Future LLM-authored templates need only one file
- ✅ Future NLE targets just add a new IR consumer
- ⚠️ Headless rendering infrastructure required — but Electron already provides BrowserWindow
- ⚠️ Templates must use a **supported subset** of GSAP properties (documented in §8)

**Fallback policy**: If GSAP introspection turns out harder than expected during implementation, retreat to 🅱 for the Intro template. Phase 1 has only one template, so the rework cost is bounded.

---

## 6. System Architecture (Phase 1)

```
┌─────────────────────────────────────────────────────────────────┐
│  AutoFlowCut (Electron renderer process)                         │
│                                                                  │
│  [IntroPicker.jsx]                                              │
│       │ user picks template + fills params (zod-validated)     │
│       │ IPC: composition.generate(templateId, params)           │
│       ↓                                                          │
│  ─────────────────────────────────────────────  Electron IPC ── │
│       ↓                                                          │
│  [electron/ipc/composition.js]                                  │
│       │ 1. resolve template path                                │
│       │ 2. inject params into HTML (template literals)          │
│       │ 3. spawn hidden BrowserWindow                           │
│       │ 4. wait for window.__timelines["intro"] to exist        │
│       │ 5. execute extractor in renderer context                │
│       ↓                                                          │
│  [composition/renderer.ts]  (hidden BrowserWindow)              │
│       │ loads injected HTML                                     │
│       │ GSAP timeline created (paused: true)                    │
│       ↓                                                          │
│  [composition/extractor.ts]  (executed in BrowserWindow)        │
│       │ reads window.__timelines["intro"]                       │
│       │ walks tl.getChildren()                                  │
│       │ captures initial DOM state per element                  │
│       │ returns CompositionIR via IPC                           │
│       ↓                                                          │
│  ─────────────────────────────────────────────────────────────  │
│       ↓                                                          │
│  [composition/composition-to-capcut.ts]  (main process)         │
│       │ IR → CapCut clip JSON fragment                          │
│       ↓                                                          │
│  [exporters/capcutCloud.js]  (existing)                         │
│       │ merge composition clips into project's scene timeline   │
│       │ POST to Firebase Cloud Function `generateCapcutJson`    │
│       ↓                                                          │
│  [Cloud Function generateCapcutJson]                            │
│       │ produces draft_content.json + draft_meta_info.json      │
│       ↓                                                          │
│  [User opens project in CapCut]                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Module Inventory

| Module | Responsibility | New / Changed |
|---|---|---|
| `src/composition/types.ts` | IR type definitions | 🆕 new |
| `src/composition/templates/intro.html` | First template (HyperFrames + GSAP) | 🆕 new |
| `src/composition/templates/intro.schema.ts` | Zod schema for intro params | 🆕 new |
| `src/composition/renderer.ts` | Hidden BrowserWindow runner | 🆕 new |
| `src/composition/extractor.ts` | GSAP timeline → IR | 🆕 new |
| `src/composition/composition-to-capcut.ts` | IR → CapCut clip JSON | 🆕 new |
| `src/components/IntroPicker.jsx` | Template-picker + parameter form UI | 🆕 new |
| `electron/ipc/composition.js` | IPC bridge for composition.generate | 🆕 new |
| `src/exporters/capcutCloud.js` | Accept composition clips alongside scenes | ✏️ extended |

---

## 8. Data Model — `CompositionIR`

```typescript
type CompositionIR = {
  width: number;            // px
  height: number;           // px
  durationSec: number;
  clips: Clip[];
};

type Clip = {
  id: string;               // DOM element id
  type: 'text' | 'image' | 'shape';
  track: number;
  startSec: number;
  endSec: number;
  initialState: {
    x: number;              // px
    y: number;              // px
    scale: number;
    rotation: number;       // degrees
    opacity: number;        // 0..1
    fontSize?: number;      // px (text only)
    color?: string;         // hex (text only)
  };
  keyframes: Keyframe[];
  content?: string;         // text type
  src?: string;             // image type
  style?: TextStyle;        // text type
};

type Keyframe = {
  timeSec: number;          // relative to clip start
  property: 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'fontSize' | 'color';
  value: number | string;
  easing: EasingKind;
};

type EasingKind =
  | 'linear'
  | 'easeIn' | 'easeOut' | 'easeInOut'
  | 'samples';              // for complex easings: emit N intermediate keyframes
```

---

## 9. Intro Template — Parameters

```typescript
export const introSchema = z.object({
  title: z.string().min(1).max(80),
  episodeNumber: z.string().regex(/^EP \d+$/),    // "EP 11"
  channelName: z.string().min(1).max(40),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#E4FA04'),
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#0a0a14'),
  durationSec: z.number().min(2).max(8).default(3),
});

export type IntroParams = z.infer<typeof introSchema>;
```

The template HTML uses `<!-- HF_PARAM:title -->` style placeholders that the renderer substitutes before loading.

---

## 10. GSAP → IR Mapping (Phase 1 supported subset)

| GSAP property | IR property | Notes |
|---|---|---|
| `opacity` | `opacity` | 1:1 |
| `x`, `y` | `x`, `y` | pixels |
| `scale` (uniform) | `scale` | non-uniform `scaleX`/`scaleY` → warn + take `scaleX` |
| `rotation` | `rotation` | degrees |
| `color`, `backgroundColor` | `color` | normalize to hex |
| `fontSize` | `fontSize` | resolve to px (strip "px") |

**Easings**:
- `linear`, `power1.in`, `power1.out`, `power1.inOut`, `none` → mapped directly
- `back.out`, `elastic`, `bounce`, custom → flagged as `samples`; extractor emits ~10 intermediate keyframes by seeking the timeline at evenly spaced times within the tween's duration and recording the value at each

**Unsupported (Phase 1 — warn + skip)**:
- `filter`, `boxShadow`, `transform-origin`
- `clipPath`, `mask`
- SVG-specific attrs
- `width`, `height` animation on `<video>` (per HyperFrames common-mistakes)

---

## 11. CapCut Mapping

CapCut's `draft_content.json` has per-segment `clip` objects with optional `animations` arrays containing keyframes for `position_x`, `position_y`, `scale`, `rotation`, `alpha`.

- **One IR `Clip`** → **one CapCut segment** on the corresponding track
- **One IR `Keyframe`** → **one CapCut keyframe**
- `samples` easing keyframes are emitted as multiple linear-interpolated keyframes (CapCut supports bezier per-keyframe but Phase 1 uses linear for simplicity)
- **Text styling** (`fontSize`, `color`) goes into CapCut text segment properties
- **Image clips** require image files; templates that use images reference assets from `src/composition/templates/assets/` which the exporter symlinks into the CapCut project's `media/` folder

---

## 12. User Flow (Phase 1)

1. User opens an existing AutoFlowCut project (scenes already populated).
2. Clicks **[+ Add Intro]** button in the project view.
3. Modal opens:
   - Template picker (currently single option: "Default Intro")
   - Form: `title`, `episodeNumber`, `channelName`
   - Color pickers: `accentColor`, `backgroundColor`
   - Slider: `durationSec`
   - **[Preview]** button: renders to hidden BrowserWindow, shows result in a small video element (optional UX nicety)
   - **[Generate]** button
4. On Generate: AutoFlowCut extracts IR → produces composition clips → inserts at scene timeline position 0 (or wherever user specified).
5. User clicks the existing **[Export CapCut]** button — unchanged flow.
6. CapCut opens the project; intro plays as editable text/clip layers with keyframes.

---

## 13. Error Handling

| Scenario | Handling |
|---|---|
| Unsupported GSAP property | `console.warn` + skip; surface count in UI ("3 unsupported properties skipped") |
| Headless render timeout (>5s) | UI error with template name + retry button |
| Zod parameter validation failure | Inline form errors |
| JS error inside template HTML | Captured via BrowserWindow `did-fail-load` / `console-message`; surface to user |
| Template HTML file missing | "Template corrupted" message |
| CapCut export upstream failure | Existing error path in `capcutCloud.js` (unchanged) |

---

## 14. Testing Strategy

**Unit (vitest)**:
- `extractor.ts`: given a mock GSAP timeline with known tweens → expected IR
- `composition-to-capcut.ts`: given a fixed IR → expected CapCut JSON structure
- `intro.schema.ts`: zod validation passes/fails for boundary cases

**Integration (vitest + Electron environment)**:
- `renderer.ts` + `extractor.ts`: load real `intro.html` with sample params → assert IR matches snapshot
- Full pipeline: template HTML → IR → CapCut JSON → schema-validated against CapCut spec

**End-to-end (manual)**:
1. Launch AutoFlowCut
2. Open a project
3. Add intro with `{title: "Test", episodeNumber: "EP 1", channelName: "Demo"}`
4. Export to CapCut
5. Open in CapCut → verify intro plays, text is editable, keyframes visible

---

## 15. Phase 2+ (deferred)

- **Premiere Pro export**: Implement `composition-to-premiere.ts` (consumes same IR), import logic from `whisk2premiere`
- **Story Engine integration**: `storyEngine.generateIntro({episodeMeta})` calls composition pipeline automatically during W4/W5 phase
- **Additional templates**: Outro, Lower Third, Password Reveal, 5 GIFTS Reveal
- **Real-time preview**: live editing during template authoring
- **External template import**: user can drop their own HTML into a templates folder
- **Extended GSAP support**: filters, shadows, MotionPath via per-property exporters
- **Audio sync**: support templates with internal audio (currently no audio in templates)

---

## 16. Open Questions (to resolve before un-parking)

- [ ] **CapCut keyframe schema confirmation**: The internal CapCut `animation` object structure for keyframes is informally documented. Need to capture a CapCut project with manually-added keyframes and reverse-engineer the exact field names before implementation. Without this, exporter can't be written correctly.
- [ ] **Cloud Function changes**: `generateCapcutJson` is in `whisk2capcut/functions`. Does it currently support keyframe-bearing segments, or only static scenes? If not, the Cloud Function needs to be extended — that's a separate code change in a separate repo.
- [ ] **Asset packaging**: Template image assets (logo, icons) — how are they bundled with the Electron app, and how are they referenced from the exported CapCut project?
- [ ] **Sample easing density**: 10 keyframes per `samples` easing is a guess. May need 5 or 20 depending on what looks good. Empirical tuning required.
- [ ] **Headless BrowserWindow timing**: How long do we wait after `loadFile` before timeline is guaranteed populated? `did-finish-load` + a small grace period? Or a deterministic `window.__hfReady = true` signal injected by the renderer?

---

## 17. Re-evaluation Criteria

Un-park this spec when **any** of these become true:

1. Story Engine produces ≥10 episodes/month AND author reports intro-authoring fatigue
2. A specific procedural graphic (password reveal, 5 GIFTS reveal, animated counter) is requested by users
3. CapCut's `draft_content.json` format gets official documentation (lowers risk for §16 first bullet)
4. HyperFrames matures to v1.0 (lowers risk of API churn)
5. A "code-to-NLE" competitor ships, validating the market

---

## 18. References

- HyperFrames: <https://github.com/heygen-com/hyperframes>
- HyperFrames docs: <https://hyperframes.heygen.com>
- HyperFrames vs Remotion: cloned at `~/workspace/hyperframes/docs/guides/hyperframes-vs-remotion.mdx`
- Working port for reference: `/Users/tuxxon/premiere-workspace/touchizen/en/hyperframes-password-reveal/`
- AutoFlowCut CapCut exporter: `/Users/tuxxon/workspace/AutoFlowCut/src/exporters/capcutCloud.js`
- Premiere generator (separate project): `/Users/tuxxon/workspace/whisk2premiere/functions/premiere_generator.js`
- GSAP timeline API: `tl.getChildren()`, `tween.vars`, `tween._targets`, `tween._dur`, `tween._start`, `tween._ease`
