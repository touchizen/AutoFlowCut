### Task 6: Persisted `agentPanelMode` setting

**Files:**
- Modify: `src/hooks/useAppSettings.js:12` (`createDefaults`), `:49` (`loadSettings` validation)
- Test: Modify `tests/hooks/useAppSettings.test.js:97` (new describe before videoConcurrency)

**Interfaces:**
- Consumes: existing `useAppSettings(): {settings, setSettings, updateSetting}` and `autoflowcut_settings` localStorage record
- Produces: `settings.agentPanelMode: 'floating' | 'slide'`; `updateSetting('agentPanelMode', mode)` used by App in Task 7

- [ ] `tests/hooks/useAppSettings.test.js`에 다음 setting contract tests를 추가한다.

```js
describe('useAppSettings — agentPanelMode', () => {
  it('fresh install 기본값은 floating', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('floating')
  })

  it('저장된 slide 선호를 그대로 보존한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentPanelMode: 'slide' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('slide')
  })

  it('알 수 없는 저장값만 floating으로 정규화한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentPanelMode: 'drawer' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('floating')
  })
})
```

- [ ] hook test를 실행해 기본값 부재 RED를 확인한다.

Run: `npx vitest run tests/hooks/useAppSettings.test.js`

Expected: FAIL — fresh install의 `settings.agentPanelMode`이 `undefined`다.

- [ ] `useAppSettings.js`에 다음 기본값과 validation을 추가한다.

```diff
diff --git a/src/hooks/useAppSettings.js b/src/hooks/useAppSettings.js
@@
     mcpHttpEnabled: false,
-    mcpHttpPort: 3210
+    mcpHttpPort: 3210,
+    agentPanelMode: 'floating',
@@
     const merged = { ...defaults, ...parsed }
+    if (!['floating', 'slide'].includes(merged.agentPanelMode)) {
+      merged.agentPanelMode = 'floating'
+    }
```

- [ ] hook test를 다시 실행해 default/preserve/fallback이 GREEN인지 확인한다.

Run: `npx vitest run tests/hooks/useAppSettings.test.js`

Expected: PASS — 기존 settings 테스트와 새 `agentPanelMode` 3개 테스트가 통과한다.

- [ ] Task 6 변경만 커밋한다.

```bash
git add src/hooks/useAppSettings.js tests/hooks/useAppSettings.test.js
git commit -m "feat(agent): persist panel display mode"
```

