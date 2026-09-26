# Task 4 Report: Locale contract for redesigned agent chrome

## Status

DONE

## Files changed

- `tests/components/agent/agentI18n.test.jsx`
  - Imported the English and Korean locale objects.
  - Added the exact 17-key redesigned-agent locale parity contract test.
- `src/locales/en.js`
  - Added the exact 17 English strings immediately after `agent.panelLabel`.
- `src/locales/ko.js`
  - Added the exact 17 Korean strings immediately after `agent.panelLabel`.
  - Changed `closeSession` from `세션 닫기` to `세션 종료`.

This report artifact is intentionally outside the commit; the commit contains only the three
files required by the brief.

## RED evidence

Command:

```text
cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/agent/agentI18n.test.jsx
```

Result: exit code 1. The new contract test failed on the required first missing key:

```text
AssertionError: en.agent.openPanel: expected undefined to be type of 'string'
Expected: "string"
Received: "undefined"

Test Files  1 failed (1)
Tests       1 failed | 5 passed (6)
```

## GREEN verification

The same command passed after the locale additions and was run again after the commit.

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

Additional checks:

- `git diff --check` passed before commit.
- The full `en.agent` and `ko.agent` key sets matched (`onlyEn: []`, `onlyKo: []`).
- The commit contains only the three required files.
- The working tree was clean immediately after the commit.

## Commit

`7dc401685e576a4a22091225fc9caa7f3a597fc7` — `feat(agent): localize redesigned panel controls`

## panelLabel anchor check

Found in both locale files inside the actual `agent` objects before editing.

English surrounding lines:

```js
agent: {
  title: 'Agent',
  panelLabel: 'In-app agent',
  running: 'Working',
}
```

Korean surrounding lines:

```js
agent: {
  title: '에이전트',
  panelLabel: '인앱 에이전트',
  running: '작업 중',
}
```

The new 17-key blocks were inserted directly between `panelLabel` and `running` in each file.

## Concerns

None.
