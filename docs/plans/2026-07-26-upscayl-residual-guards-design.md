# Upscayl Residual Guards Design

## Goal

Close the remaining mutual-exclusion and render temp-name findings without changing unrelated behavior.

## Design

### Batch generation reverse guard

`useUpscayl` will expose a stable reader backed by its internal `runningRef`. `App` will inject that reader into `useAutomation`. The batch loop will call it immediately before marking a scene `generating` or submitting it. A busy hit sets the existing stop ref and exits the loop, so pending work is restored by the current stop cleanup and already completed scenes remain untouched.

### Manual and MCP image writers

Writer-side refusal is safer than making Upscayl completion conditionally lose. History restore already overwrites the on-disk scene image; solving the race at completion would require disk and React-state versioning. `SceneDetailModal` will therefore refuse restore, save, and regenerate while Upscayl is active and show the existing Upscayl-busy toast.

For MCP, only `update-scene` requests containing `image` or `imagePath` are guarded. The Electron HTTP route will synchronously invoke a renderer-owned handler. That handler reads a live Upscayl ref and either applies the scene update or returns `{ success: false, error: 'busy' }`. The main process maps refusal to HTTP 409, and the MCP tool maps the failed response to `isError`. Non-image fields keep the existing forward path.

### Deterministic temp names

Names at or below 160 characters remain unchanged. Longer pre-cap names become a truncated head plus a SHA-256 suffix derived from the full name. This preserves deterministic output and keeps source/scene distinctions even when their readable suffix is beyond the cap.

### App wiring test

The existing App render harness will cover the five `isMcpRunning` operands with a runtime matrix. The corresponding regex assertion will be removed. The nine-operand Upscayl callback extraction remains because replacing it would require substantial orchestration of private same-tick latches and would add more test risk than this cleanup warrants.

## Verification

Each behavior gets a failing regression test before production changes. Only touched test files will be run; the full suite is intentionally left to the user.
