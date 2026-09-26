# Image-first Import Transaction Design

## Scope

M1a step 3a adds only main-process filesystem IPC, preload bridges, and IPC tests. Renderer code, `electron/story/stepMachine.js`, and `electron/ipc/story-api.js` remain untouched.

## IPC surface

- `fs:stage-image-first-image`: accepts `{ workFolder, project, fixedSceneRevision, rendererSceneId, data }`. It validates the payload with the shared strict-PNG helper before creating a directory, then writes `scenes/.image-first-staging/<revision>/<rendererSceneId>.png`.
- `fs:abort-image-first-import`: accepts `{ workFolder, project, fixedSceneRevision }`. Under the project write lock it removes only that revision directory. Missing and wrong revisions are successful no-ops.
- `fs:commit-image-first-import`: accepts `{ workFolder, project, data }`, where `data` is the full `project.json` payload containing the top-level FixedSceneState fields. Under the project write lock it validates the fixed slots/staged files, writes a transaction journal, renames staged files to canonical PNGs, atomically replaces `project.json`, and cleans transaction artifacts.

Preload exposes matching `stageImageFirstImage(params)`, `abortImageFirstImport(params)`, and `commitImageFirstImport(params)` wrappers.

## Transaction and recovery

The journal records the unique fixed-scene revision, ordered staged/canonical paths, and the project temp path. Canonical collisions are rejected before journal creation, so rollback can only delete canonical files created by the recorded transaction.

Commit ordering is journal temp write/rename, ordered staged-to-canonical renames, project temp write, project temp-to-canonical rename, then journal/staging cleanup. `fs:load-project-data` runs recovery under the same per-project lock. If durable `project.json.fixedSceneRevision` equals the journal revision, recovery rolls forward any staged rename that remains and cleans up. Otherwise it rolls back recorded canonical files, staged files, and the project temp file.

After journal recovery, load sweeps all remaining revision directories below `.image-first-staging`. This relies on the desktop app's single active renderer per project: `load-project-data` is the reopen boundary and cannot coexist with an import in that same renderer. The comment and test make this assumption explicit.

## Strict PNG

One exported pure helper strips a data-URL prefix, requires the normalized base64 to start with `iVBOR`, and independently requires `detectMimeType` to return both `image/png` and `png`. Both `fs:save-resource` for `resourceType === 'scenes'` and staging call it before their first filesystem write.

## Testing

Tests use real temporary directories. They cover invalid magic, the unknown-input PNG fallback, MIME/extension mismatch, guard-before-mkdir, current/history zero writes, abort isolation/idempotence, journal-less staging sweep, scene shape and prompt-key absence, canonical collision preservation, and crashes before/after image rename and before/after project rename. Mutation checks deliberately remove each safety condition and require a targeted test to fail.

## Spec finding

The spec requires live cancellation/failure cleanup but its changed-files impact table lists only stage and commit IPC. A renderer cannot satisfy D24a-5 without an abort surface. The approved design therefore adds the third abort IPC and preload wrapper.
