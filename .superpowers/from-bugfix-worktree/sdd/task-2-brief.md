### Task 2: StoryView runAudioWithPreflight + 진입점 통합 + 게이트 렌더

**Files:**
- Modify: `src/components/story/StoryView.jsx`
- Test: `tests/components/story/storyAudioGate.test.jsx` (integration-ish; if StoryView is too heavy to render, test the `runAudioWithPreflight` logic by extracting it to a small pure/near-pure helper and unit-testing that)

**Interfaces:**
- Consumes: `useAudioPreflight` (M3b-2a), `AudioKeyGateCard` (Task 1), `pipeline.start`, `buildAudioParams`, `onVoiceSearch` (provider refetch).
- Produces: audio starts go through `runAudioWithPreflight(params, run)` — preflight check; if missing, set gate state (render `AudioKeyGateCard`) and DO NOT run; if ok, run. Key saved → refetch that provider's voices + re-check → run if now ok.

- [ ] **Step 1: Add the hook + gate state + wrapper**

In `StoryView.jsx` (near the top, after `pipeline` destructure ~:402):
```js
import { useAudioPreflight } from '../../hooks/useAudioPreflight'
import AudioKeyGateCard from './AudioKeyGateCard'
// inside component:
const preflight = useAudioPreflight(pipeline)
const [audioGate, setAudioGate] = useState(null) // { missing, retry } | null

const runAudioWithPreflight = useCallback(async (params, run) => {
  const r = await preflight.check(params)
  if (!r.ok) { setAudioGate({ missing: r.missing, retry: () => run(params) }); return { error: 'preflight-missing-key' } }
  setAudioGate(null)
  return run(params)
}, [preflight])
```

- [ ] **Step 2: Wrap the five audio trigger sites**

Replace each direct audio `start(...)` with a `runAudioWithPreflight(params, (p) => start('audio', p))` form. Exact sites:
- `:1302` handlePrimaryAction audio branch: `start(currentStep, buildStepParams(currentStep))` — only wrap when `currentStep === 'audio'`.
- `:1314` handleStepRedo: wrap when `redoStep === 'audio'`.
- `:1402` triggerAutoStep: wrap when `step === 'audio'`.
- `:1145` regenerateSegment: `start('audio', buildAudioParams([segId]))`.
- `:1151` runSpeakerAudio: `start('audio', { ...buildAudioParams(), onlySpeaker: sp.id })` — its params already include onlySpeaker so preflight scopes to that speaker.
For non-audio steps, keep the direct `start(...)` (don't route scenes/prompts through the audio gate).

- [ ] **Step 3: Render the gate card + wire key-saved refetch**

Where the audio step UI renders (near the audio progress/log area), add:
```jsx
{audioGate && (
  <AudioKeyGateCard
    missing={audioGate.missing}
    t={t}
    onKeySaved={async (provider) => {
      try { await onVoiceSearch?.(provider) } catch {}   // refetch that provider's voices (single-provider)
      const p = /* the params used for this gate — store them in audioGate */ audioGate.paramsForRecheck
      const r = await preflight.check(p)
      if (r.ok) { setAudioGate(null); audioGate.retry?.() }
      else setAudioGate({ ...audioGate, missing: r.missing })
    }}
  />
)}
```
Adjust `runAudioWithPreflight` to store `paramsForRecheck: params` in the gate state so re-check uses the same params. (If `onVoiceSearch` isn't a single-provider refetch, pass whatever StoryView has for refreshing voices; the refetch is best-effort — the key re-check is what gates.)

- [ ] **Step 4: Test**

Extract `runAudioWithPreflight` decision (ok→run, missing→gate) into a tiny testable function if StoryView won't render in jsdom, OR write a focused test that mounts StoryView with a mocked `pipeline.audioPreflight` returning a missing provider and asserts the gate card appears and `start` was NOT called; then a version returning ok asserts `start` WAS called. Mirror an existing `tests/components/story/*.test.jsx` for StoryView mount setup (it needs many props/mocks — copy them).

Run: `npx vitest run tests/components/story/storyAudioGate.test.jsx` → PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npm run test:run` → green (VideoDetailModal 2 errors unrelated).
```bash
git add src/components/story/StoryView.jsx tests/components/story/storyAudioGate.test.jsx
git commit -m "Gate audio generation on pre-flight: block + inline AudioKeyGateCard, re-run after key entry"
```

---

