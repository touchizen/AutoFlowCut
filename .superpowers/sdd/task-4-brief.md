### Task 4: Locale contract for the redesigned agent chrome

**Files:**
- Modify: `src/locales/en.js:1601` (`agent` object)
- Modify: `src/locales/ko.js:1600` (`agent` object)
- Test: Modify `tests/components/agent/agentI18n.test.jsx:13` (locale imports), append after `:150`

**Interfaces:**
- Consumes: `useSafeT(key)` / `useI18n().t(key)` existing translation contract
- Produces: `agent.openPanel`, `dismissPanel`, `modelLabel`, `modelDefault`, `codexProvider`, `claudeProvider`, `comingSoon`, `slideMode`, `floatingMode`, `modeToggle`, `switchToSlide`, `switchToFloating`, `flowFloatingOnly`, `sendTooltip`, `steerTooltip`, `stopTooltip`, `closeSessionTooltip`

- [ ] `tests/components/agent/agentI18n.test.jsx`에 locale imports와 다음 parity test를 추가한다.

```diff
diff --git a/tests/components/agent/agentI18n.test.jsx b/tests/components/agent/agentI18n.test.jsx
@@
 import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'
+import en from '../../../src/locales/en.js'
+import ko from '../../../src/locales/ko.js'
@@
+const REDESIGN_KEYS = [
+  'openPanel', 'dismissPanel', 'modelLabel', 'modelDefault', 'codexProvider',
+  'claudeProvider', 'comingSoon', 'slideMode', 'floatingMode', 'modeToggle',
+  'switchToSlide', 'switchToFloating', 'flowFloatingOnly', 'sendTooltip',
+  'steerTooltip', 'stopTooltip', 'closeSessionTooltip',
+]
+
+describe('에이전트 UI 재설계 locale 계약', () => {
+  it('ko/en에 같은 새 키가 있고 빈 문자열이나 raw key가 없다', () => {
+    for (const key of REDESIGN_KEYS) {
+      expect(en.agent[key], `en.agent.${key}`).toBeTypeOf('string')
+      expect(ko.agent[key], `ko.agent.${key}`).toBeTypeOf('string')
+      expect(en.agent[key].trim()).not.toBe('')
+      expect(ko.agent[key].trim()).not.toBe('')
+      expect(en.agent[key]).not.toBe(`agent.${key}`)
+      expect(ko.agent[key]).not.toBe(`agent.${key}`)
+    }
+  })
+})
```

- [ ] locale test를 실행해 새 키 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/agentI18n.test.jsx`

Expected: FAIL — 첫 누락 키 `en.agent.openPanel`이 string이 아니다.

- [ ] `src/locales/en.js`의 `agent` object에 다음 문자열을 `panelLabel` 바로 뒤에 추가한다.

```js
openPanel: 'Open agent',
dismissPanel: 'Dismiss agent',
modelLabel: 'Agent model',
modelDefault: 'Default',
codexProvider: 'Codex',
claudeProvider: 'Claude',
comingSoon: 'Coming soon',
slideMode: 'Slide',
floatingMode: 'Floating',
modeToggle: 'Slide panel mode',
switchToSlide: 'Switch to slide panel',
switchToFloating: 'Switch to floating panel',
flowFloatingOnly: 'The agent stays floating while Flow is active.',
sendTooltip: 'Send a new turn',
steerTooltip: 'Add guidance to the active turn',
stopTooltip: 'Stop the active turn',
closeSessionTooltip: 'Close the agent session',
```

- [ ] `src/locales/ko.js`의 `agent` object에 다음 문자열을 `panelLabel` 바로 뒤에 추가한다.

```js
openPanel: '에이전트 열기',
dismissPanel: '에이전트 숨기기',
modelLabel: '에이전트 모델',
modelDefault: '기본',
codexProvider: 'Codex',
claudeProvider: 'Claude',
comingSoon: '구현 예정',
slideMode: '슬라이드',
floatingMode: '플로팅',
modeToggle: '슬라이드 패널 모드',
switchToSlide: '슬라이드 패널로 전환',
switchToFloating: '플로팅 패널로 전환',
flowFloatingOnly: 'Flow 사용 중에는 에이전트가 플로팅으로 표시됩니다.',
sendTooltip: '새 턴 보내기',
steerTooltip: '진행 중인 턴에 지시 추가',
stopTooltip: '진행 중인 턴 중지',
closeSessionTooltip: '에이전트 세션 종료',
```

- [ ] 같은 `ko.agent` object의 기존 close label을 종료 의미로 정확히 맞춘다.

```diff
diff --git a/src/locales/ko.js b/src/locales/ko.js
@@
-    closeSession: '세션 닫기',
+    closeSession: '세션 종료',
```

- [ ] locale test를 다시 실행해 ko/en parity가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/agentI18n.test.jsx`

Expected: PASS — 기존 영어/한국어 UI 테스트와 새 17-key parity 테스트가 통과한다.

- [ ] Task 4 변경만 커밋한다.

```bash
git add src/locales/en.js src/locales/ko.js tests/components/agent/agentI18n.test.jsx
git commit -m "feat(agent): localize redesigned panel controls"
```

