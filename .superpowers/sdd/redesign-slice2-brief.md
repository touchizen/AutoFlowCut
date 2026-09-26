# Composer Redesign — Slice 2: reference-style bottom-toolbar composer

Goal: make the agent panel's composer look like the reference (clean input + bottom toolbar). Move the model picker into the composer, merge Send/Stop into one state-flipping primary button, move Close-session to the header, and restyle cleanly. Keep all agent behavior (model snapshot at submit, steer, abort, running lifecycle, dismiss/FAB, mode toggle, effective mode/drag) intact.

## Files
- Modify: src/components/agent/ChatPanel.jsx (header actions + composer JSX)
- Modify: src/components/agent/ChatPanel.css (composer/toolbar/primary-button styling)
- Modify: tests/components/agent/ChatPanel.test.jsx (queries change: Send/Stop merge, model picker location, close in header)
- (Do NOT touch AgentModelSelector.jsx — Slice 1 already portal-ized it. Do NOT touch AgentIconButton.jsx.)

## Target layout
HEADER (`.agent-chat-header`), right-side actions in this order:
  [mode-toggle ▮▮]  [close-session]  [dismiss ×]
  (running/flow-notice indicators stay near the title on the left. The AgentModelSelector is REMOVED from the header.)

COMPOSER (`form.agent-chat-compose`), two rows:
  Row 1: the message `<textarea>` (full width, the input).
  Row 2 = bottom toolbar (`.agent-chat-toolbar`):
    LEFT:  the AgentModelSelector (moved here from the header)
    RIGHT: [Steer]  [PRIMARY]
  where PRIMARY is a SINGLE button that flips by `running`:
    - idle:    label = t('agent.send'),  icon = AgentControlIcon name="send",  className "is-primary", type="submit", disabled={!input.trim()}. (No longer disabled-by-running because when running it's the Stop button instead.)
    - running: label = t('agent.stop'),  icon = AgentControlIcon name="stop",  className "is-primary is-stop", type="button", onClick={abort}, disabled=false.
  Steer stays a separate AgentIconButton: label t('agent.steer'), onClick steer, disabled={!running || !input.trim()}.

## Behavior contract (MUST preserve)
- Submitting (idle primary is type=submit; form onSubmit=send) still snapshots {text, model} and runs the existing send() unchanged.
- While running, the primary shows Stop and clicking it calls abort() (same as the old Stop button).
- Steer unchanged (running + input only, carries no model).
- Close session unchanged (onClick=close, disabled={!sessionOpenRef.current}) — just relocated to the header actions.
- Model selector: same props as before (models/value/loading/onChange/labels), just rendered inside the toolbar. selectedModel state + snapshot logic unchanged.
- Accessible names preserved so tests keep working: `Steer`, `Close session`, `Slide panel mode`, `Dismiss agent`, `Open agent`, combobox `Agent model`. The primary button's accessible name is `Send` when idle and `Stop` when running (this REPLACES the old separate Send and Stop buttons).

## CSS (clean, reference-like — dark, rounded, subtle)
- `.agent-chat-compose`: a rounded container (border, radius ~12px, subtle bg) wrapping the textarea + toolbar; padding; the textarea borderless/transparent inside it, auto-ish height (rows=2), no separate border.
- `.agent-chat-toolbar`: flex row, `justify-content: space-between`, align-items center, gap, small top padding.
- `.agent-chat-toolbar .agent-model-selector`: constrained width (e.g. min-width 120px, max-width ~180px) so it sits neatly bottom-left.
- `.agent-chat-toolbar-actions`: flex row gap for Steer + primary on the right.
- Primary button `.agent-icon-button.is-primary`: keep the accent (blue) fill for Send; `.is-primary.is-stop` → red fill (reference's red stop button). Reuse existing `.agent-icon-button` sizing.
- Remove/replace the old `.agent-chat-actions` grid rules that assumed 4 buttons if they conflict; keep it clean.
- Keep it theme-var based (var(--accent), var(--border), var(--panel-bg), etc.) consistent with existing styles.

## Tests to update (ChatPanel.test.jsx)
- Existing tests querying `getByRole('button', { name: 'Send' })` for submitting while IDLE still work (primary is 'Send' when idle).
- Tests that assumed a SEPARATE 'Stop' button OR asserted 'Send' is disabled while running must be updated: while running, the primary button's name is `Stop` (enabled) and there is NO button named `Send`. Update those assertions accordingly (e.g. the "running 중 Send는 disabled" test → assert that while running the primary is `Stop` and enabled, and querying `Send` returns null; Steer still enabled with input).
- The model-selector tests (open combobox 'Agent model', pick 'GPT A'/'GPT B') now find it in the composer toolbar — same role/name queries work; verify.
- Close-session tests still query `Close session` (now in header) — verify.
- Add a test: while running, the primary button is `Stop` and clicking it calls agentAbort; when idle it's `Send` and submitting sends. (Guards the merge.)
- Keep the model-snapshot, dismiss-preserve, focus-handoff, effective-mode, drag tests green (adjust queries only where the button identity changed).

## TDD + verification
- Update tests RED (new layout not present) → implement → GREEN.
- Run (all prefixed `cd /Users/tuxxon/workspace/AutoFlowCut &&`): ChatPanel.test.jsx, agentI18n.test.jsx, ChatPanel.appMount.test.js, AgentModelSelector.test.jsx.
- Commit: `git commit -m "feat(agent): reference-style bottom-toolbar composer with merged send/stop"`

## Notes
- This may incidentally fix the "mode-toggle won't click" report (the model selector leaving the header removes header width/overlap pressure) — but the real confirmation is the user's live eye-check.
- Do NOT change locale keys (Task 4 already has send/steer/stop/closeSession + tooltips). Reuse them.
