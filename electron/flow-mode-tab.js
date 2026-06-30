/**
 * electron/flow-mode-tab.js
 *
 * Select the compose IMAGE/VIDEO mode tab (visible when Agent is OFF).
 *
 *   <button role="tab" id="radix-:rNN:-trigger-IMAGE" data-state="inactive" class="...flow_tab_slider_trigger">
 *   <button role="tab" id="radix-:rNN:-trigger-VIDEO" data-state="active"   class="...flow_tab_slider_trigger">
 *
 * Radix prefix is unstable → match on the '-trigger-IMAGE'/'-trigger-VIDEO' suffix.
 * Pure helpers are jsdom-tested; buildSelectModeScript injects the same logic.
 */

export function modeTabSuffix(mode) {
  if (mode === 'VIDEO') return '-trigger-VIDEO'
  if (mode === 'IMAGE') return '-trigger-IMAGE'
  return null
}

export function isModeActive(el) {
  return !!el && (el.getAttribute('aria-selected') === 'true' || el.getAttribute('data-state') === 'active')
}

export function findModeTab(doc, mode) {
  const suffix = modeTabSuffix(mode)
  if (!suffix) return null
  return Array.from(doc.querySelectorAll("button[role='tab']")).find(b => (b.id || '').endsWith(suffix)) || null
}

/**
 * Page script: select the given mode tab. Returns 'already' | 'clicked' | 'not_found'.
 * Synthetic click is enough for these Radix tabs (same as the panel count/aspect tabs).
 */
export function buildSelectModeScript(mode) {
  const suffix = modeTabSuffix(mode)
  return `(function() {
    const suffix = ${JSON.stringify(suffix)};
    if (!suffix) return 'not_found';
    const el = Array.from(document.querySelectorAll("button[role='tab']")).find(b => (b.id || '').endsWith(suffix));
    if (!el) return 'not_found';
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('data-state') === 'active') return 'already';
    try {
      const r = el.getBoundingClientRect();
      const c = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      try { el.dispatchEvent(new PointerEvent('pointerdown', c)); } catch {}
      el.dispatchEvent(new MouseEvent('mousedown', c));
      try { el.dispatchEvent(new PointerEvent('pointerup', c)); } catch {}
      el.dispatchEvent(new MouseEvent('mouseup', c));
      el.dispatchEvent(new MouseEvent('click', c));
    } catch { try { el.click(); } catch {} }
    return 'clicked';
  })()`
}
