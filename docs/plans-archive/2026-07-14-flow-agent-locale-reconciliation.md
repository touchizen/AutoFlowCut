# Flow Agent Locale Reconciliation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reconcile scene submissions with the app Agent setting and remove locale-bound toggle, settings, and generated-image selectors using only live-dump-backed structural anchors.

**Architecture:** Keep DOM discovery in pure functions that are both jsdom-testable and serializable into Flow page scripts. Reuse the settings locators across panel closing, default application, and model listing; gate scene mutation/submission on the existing shared Agent reconciliation helpers; identify generated result images by their project edit-link contract.

**Tech Stack:** Electron IPC, JavaScript ES modules, jsdom, Vitest, esbuild production minification tests.

---

### Task 1: Check in focused live-DOM fixtures

**Files:**
- Create: `tests/fixtures/flow-live-dom-20260714.js`

**Step 1: Extract exact fixtures**

Read the supplied JSON `bodyHtml` values and export verbatim focused subtrees:

- English and Korean composer roots containing the Slate editor and real `button[aria-pressed]` toggle;
- English Agent settings splitter/panel subtree;
- English and Korean generated-card links and real character/reference/preview neighbors.

Record the source dump filenames beside each export. Do not normalize translated text or styled-component classes in the fixture; selectors must prove that they ignore them.

**Step 2: Verify fixture provenance**

Run a one-off comparison that confirms every exported HTML string is contained verbatim in the corresponding dump's `bodyHtml`.

Expected: every fixture reports `true`.

### Task 2: Make the composer Agent toggle locale-invariant

**Files:**
- Modify: `tests/electron/flow-agent-toggle-diagnostic.test.js`
- Modify: `tests/electron/flow-agent-toggle-minified.test.js`
- Modify: `electron/flow-agent-toggle.js:28-109`

**Step 1: Write failing tests**

Using the real English/Korean composer fixtures:

- assert `findAgentToggle` and `AGENT_TOGGLE_SELECTOR` return the real toggle;
- replace only the real English toggle's user-facing text with `エージェント` and assert structural discovery still succeeds;
- add a second `button[aria-pressed]` inside the real composer scope and assert one existing Agent-text match disambiguates it;
- make both candidates nonmatching and assert `null`;
- assert the diagnostic probe reports both ambiguous scoped candidates;
- run the selector after a real esbuild minification.

**Step 2: Run tests to verify RED**

Run:

```bash
npm run test:run -- tests/electron/flow-agent-toggle-diagnostic.test.js tests/electron/flow-agent-toggle-minified.test.js
```

Expected: Japanese structural discovery and ambiguity assertions fail under the text-first implementation.

**Step 3: Implement the minimal locator**

Change `findAgentToggle(doc)` to:

```js
const editor = doc.querySelector("[data-slate-editor='true']")
const selector = 'button[aria-pressed], [role="switch"][aria-checked], [role="checkbox"][aria-checked]'
// walk editor ancestors; first ancestor containing candidates is the composer scope
// 1 candidate => return it
// >1 => return the sole /agent|에이전트/i text/aria match, otherwise null
```

Update `scanAgentToggleCandidates` to snapshot all candidates from the same structural scope, with the existing global agent/icon candidates only as diagnostic fallback when no scoped state control exists. Build `AGENT_TOGGLE_SELECTOR` as an IIFE that assigns `findAgentToggle.toString()` to a local const before calling it.

**Step 4: Run tests to verify GREEN**

Run the Task 2 command again.

Expected: all tests pass, including minified injection.

### Task 3: Share locale-invariant Agent settings locators

**Files:**
- Modify: `tests/electron/flow-agent-settings-close.test.js`
- Create: `tests/electron/flow-agent-defaults.test.js`
- Modify: `electron/flow-agent-toggle.js:152-179`
- Modify: `electron/flow-agent-defaults.js:1-350`

**Step 1: Write failing close-selector and defaults tests**

Against the verbatim English settings fixture:

- evaluate `AGENT_SETTINGS_CLOSE_SELECTOR` and assert its returned button contains `arrow_back`;
- evaluate `buildAgentDefaultsScript({ image: { aspectRatio: '4:3' }, save: true })` with immediate timers/visible rects and assert the English image section and structural save action are clicked/found;
- evaluate `buildListModelsScript()` with immediate timers and assert it reports current image `Nano Banana 2` and video `Omni Flash` rather than `panel_not_found`/`section_not_found`.

Keep `findAgentChatCloseButton` and its tests untouched.

**Step 2: Run tests to verify RED**

Run:

```bash
npm run test:run -- tests/electron/flow-agent-settings-close.test.js tests/electron/flow-agent-defaults.test.js
```

Expected: the English close selector returns null and both generated scripts fail to locate Korean-named sections.

**Step 3: Implement shared structural locators**

Export pure helpers from `flow-agent-toggle.js`:

```js
findAgentSettingsPanel(doc)       // radiogroup -> smallest ancestor with 4 tablists + 2 menu triggers
findAgentSettingsSections(panel) // crop_16_9 lists; crop_landscape identifies image
findAgentSettingsSaveButton(panel) // only plain non-role/non-menu/non-icon action
```

Build `AGENT_SETTINGS_CLOSE_SELECTOR` by serializing panel and close helpers into local consts. Import the shared helpers in `flow-agent-defaults.js`; serialize them into both generated scripts and replace label-based `findPanel`, `sectionByLabel`, and save text matching with structural results.

**Step 4: Run tests to verify GREEN**

Run the Task 3 command again.

Expected: all tests pass against the real English subtree.

### Task 4: Restrict generated-image collection to real result cards

**Files:**
- Modify: `tests/electron/flow-media-collect.test.js`
- Modify: `electron/flow-media-collect.js:20-48`

**Step 1: Write failing tests**

Build jsdom documents from the verbatim English and Korean generated-card fixtures plus their real reference/preview neighbors. Assert `scanGeneratedImages` and `GENERATED_IMG_PROBE` return only the generated card media IDs in both locales, even when reference/preview elements receive large rectangles.

**Step 2: Run tests to verify RED**

Run:

```bash
npm run test:run -- tests/electron/flow-media-collect.test.js
```

Expected: English results are missed without size and large reference/preview images are included with size.

**Step 3: Implement the structural result contract**

For each redirect image with a UUID, require a closest anchor whose href matches a Flow project edit route:

```js
const link = im.closest('a[href]')
const isResult = link && /\/tools\/flow\/project\/[^/]+\/edit\//.test(link.getAttribute('href') || '')
```

Remove alt and size checks.

**Step 4: Run tests to verify GREEN**

Run the Task 4 command again.

Expected: only real English/Korean result cards remain.

### Task 5: Fail scene generation closed when Agent reconciliation fails

**Files:**
- Modify: `tests/electron/ipc/generateSceneAspect.test.js`
- Modify: `electron/ipc/character.js:85-105,664-820`

**Step 1: Write failing IPC tests**

Extend the existing scene dependency harness with `ensureAgentOff` and `ensureAgentOn` doubles. Assert:

- setting OFF + `ensureAgentOff() -> { success: false }` returns a clear OFF error and never calls mode configuration, compose injection, or trusted submit click;
- setting ON + `ensureAgentOn() -> { success: false }` returns a clear ON error and never injects/submits;
- successful OFF reconciliation occurs before `configureFlowMode` and submit;
- successful ON reconciliation selects the ON collection path.

**Step 2: Run tests to verify RED**

Run:

```bash
npm run test:run -- tests/electron/ipc/generateSceneAspect.test.js
```

Expected: ensure helpers are not called and failure cases continue toward submission.

**Step 3: Implement the scene gate**

Destructure both ensure helpers. Capture `getFlowAgentOn()` once, reconcile immediately after `ensureOnProjectComposer`, and return before any composer mutation on failure. Use the captured mode for the later idle, defaults, collection, and async branches so the reconciled page state and collection mechanism stay aligned.

**Step 4: Run tests to verify GREEN**

Run the Task 5 command again.

Expected: all scene tests pass and failed reconciliation produces zero submissions.

### Task 6: Regression verification and implementation commit

**Files:**
- Verify all modified production/test files
- Do not modify: round-3 mention fixtures in `tests/electron/flow-mention-dom.test.js` and `tests/electron/flow-compose-mention.test.js`

**Step 1: Run focused regression tests**

Run all toggle/settings/media/scene and mention suites.

Expected: all focused tests pass.

**Step 2: Run the complete suite**

Run:

```bash
npm run test:run
```

Expected: all test files/tests pass; baseline 558 files / 5675 tests increases only by the new regression cases.

**Step 3: Check the patch**

Run `git diff --check`, inspect `git diff --stat`, and confirm `findAgentChatCloseButton` and the round-3 mention fixtures have no diff.

**Step 4: Commit all A/B/C implementation together**

```bash
git add electron/flow-agent-toggle.js electron/flow-agent-defaults.js electron/flow-media-collect.js electron/ipc/character.js tests/fixtures/flow-live-dom-20260714.js tests/electron/flow-agent-toggle-diagnostic.test.js tests/electron/flow-agent-toggle-minified.test.js tests/electron/flow-agent-settings-close.test.js tests/electron/flow-agent-defaults.test.js tests/electron/flow-media-collect.test.js tests/electron/ipc/generateSceneAspect.test.js
git commit -m "fix(flow): reconcile agent state without locale assumptions"
```

