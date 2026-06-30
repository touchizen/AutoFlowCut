/**
 * electron/flow-submit-gate.js
 *
 * Decides whether Flow's agent is ready to accept a NEW prompt (before we inject
 * the prompt text and click submit).
 *
 * Flow's agent-chat submit button toggles by icon:
 *   - 'stop'         → the agent is generating → BUSY (do not submit)
 *   - 'arrow_forward'→ idle / ready to accept a prompt
 * An EMPTY compose shows 'arrow_forward' but DISABLED — that is still "ready to
 * type" (the button only ENABLES after text is entered). So a disabled
 * arrow_forward must classify as idle, not as a not-ready state. (Waiting for an
 * *enabled* button before injection deadlocks the very first submit.)
 *
 * classifyAgentState(doc) is a pure function tested against jsdom. The exact
 * same implementation is injected into the Flow page via SUBMIT_PROBE
 * (Function.prototype.toString), so there is a single source of truth.
 */

/**
 * @param {Document} doc
 * @returns {'busy'|'idle'|'absent'}
 */
export function classifyAgentState(doc) {
  const findIconBtn = (name) => {
    for (const b of doc.querySelectorAll('button')) {
      for (const i of b.querySelectorAll("i, span.material-icons, span.material-symbols-outlined, [class*='material-symbols'], [class*='google-symbols'], mat-icon")) {
        if ((i.textContent || '').trim() === name) return b
      }
    }
    return null
  }
  const editor = doc.querySelector("[data-slate-editor='true']")
    || doc.querySelector("div[role='textbox'][contenteditable='true']:not(#af-bot-panel *)")
    || doc.querySelector('[contenteditable="true"]:not([aria-hidden])')
    || doc.querySelector('textarea')
  if (findIconBtn('stop')) return 'busy'
  const fwd = findIconBtn('arrow_forward') || findIconBtn('send') || findIconBtn('play_arrow')
  if (fwd && editor) return 'idle'
  return 'absent'
}

/** Whether the poll may stop and proceed to inject+submit. */
export function shouldProceed(state) {
  return state === 'idle'
}

/**
 * Post-injection guard: is the submit button actually CLICKABLE now?
 * Only true when arrow_forward exists AND is enabled (= the prompt text
 * registered). Prevents clicking a disabled/absent/busy button — which would
 * be a no-op at best and a wrong/duplicate action at worst.
 * @param {Document} doc
 * @returns {boolean}
 */
export function isSubmitEnabled(doc) {
  const findIconBtn = (name) => {
    for (const b of doc.querySelectorAll('button')) {
      for (const i of b.querySelectorAll("i, span.material-icons, span.material-symbols-outlined, [class*='material-symbols'], [class*='google-symbols'], mat-icon")) {
        if ((i.textContent || '').trim() === name) return b
      }
    }
    return null
  }
  const fwd = findIconBtn('arrow_forward') || findIconBtn('send') || findIconBtn('play_arrow')
  if (!fwd) return false
  return !fwd.disabled && fwd.getAttribute('aria-disabled') !== 'true'
}

/**
 * Page-context expression returning the agent state. Same logic as
 * classifyAgentState, serialized so it runs inside the Flow webContents via
 * executeJavaScript(). Self-contained (only references its `document` arg).
 */
export const SUBMIT_PROBE = `(${classifyAgentState.toString()})(document)`

/** Page-context expression returning the post-injection submittable boolean. */
export const SUBMIT_ENABLED_PROBE = `(${isSubmitEnabled.toString()})(document)`
