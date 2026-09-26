# Task 6 Report: Persisted `agentPanelMode` setting

## Status

DONE

## Files Changed

- `src/hooks/useAppSettings.js`
  - Added the fresh-install default `agentPanelMode: 'floating'`.
  - Added load-time validation preserving only `floating` and `slide`, with invalid values normalized to `floating`.
- `tests/hooks/useAppSettings.test.js`
  - Added the three contract tests from the brief before the existing `videoConcurrency` describe.

The commit contains only these two files.

## Real Anchors Matched

Defaults object anchor:

```js
    seedLocked: true,
    mcpHttpEnabled: false,
    mcpHttpPort: 3210,
    agentPanelMode: 'floating',
  }
```

Load merge anchor:

```js
    const merged = { ...defaults, ...parsed }
    if (!['floating', 'slide'].includes(merged.agentPanelMode)) {
      merged.agentPanelMode = 'floating'
    }
    // 옛 Flow(none) 저장 모드 폐기
```

## RED Evidence

Command:

```bash
cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/hooks/useAppSettings.test.js
```

Result: exit code 1; 2 failed and 13 passed.

- Fresh install failed with `expected undefined to be 'floating'`.
- Invalid persisted value failed with `expected 'drawer' to be 'floating'`.
- The persisted `slide` test passed before implementation, confirming preservation already followed the merge contract.

## GREEN Summary

The same focused command completed with exit code 0:

- Test files: 1 passed
- Tests: 15 passed

The new default, persisted `slide`, and invalid-value fallback contracts all pass alongside the existing settings tests.

## Commit

`cc6150359e8d3b2c1a5b58e22548eb9fd5641428` — `feat(agent): persist panel display mode`

## Concerns

None. The requested commit succeeded and contains only `src/hooks/useAppSettings.js` and `tests/hooks/useAppSettings.test.js`.
