/**
 * electron/flow-agent-defaults.js
 *
 * Drives Flow's Agent Settings panel to set the IMAGE and VIDEO generation
 * defaults (aspect ratio, batch count, model) and clicks the save action.
 *
 * Flow moved these defaults out of the old compose-bar popup menu (which the
 * legacy `configureFlowMode` in ipc/shared.js drove) into a persistent settings
 * panel with a Save button, so the old selectors silently no-op. This module
 * targets the new panel.
 *
 * Selector strategy (verified against the live panel via flow-settings-dumper):
 *   - Panel: radiogroup + four tablists + two model menus + one plain action.
 *   - Settings toggle: a button whose icon is the material symbol 'tune'.
 *   - Section: aspect tablists use Material crop ligatures; crop_landscape marks IMAGE.
 *   - Aspect / count: Radix <Tabs>. The radix id PREFIX is unstable
 *     (radix-:r7a: vs radix-:r71:) but the '-trigger-X' SUFFIX is stable, so we
 *     match on the suffix, never the full id.
 *   - Model: a button[aria-haspopup="menu"] inside the section; clicking it
 *     opens a Radix menu of role="menuitem" options matched by (normalized) text.
 *   - Save: the panel's sole plain action after role/menu/icon controls are excluded.
 *
 * The model labels are matched leniently (emoji/whitespace/case-insensitive) so
 * stored 'Nano Banana 2' matches the live '🍌 Nano Banana 2'.
 */

import {
  findAgentSettingsPanel,
  findAgentSettingsSaveButton,
  findAgentSettingsSections,
} from './flow-agent-toggle.js'

/** Map a project aspect ratio to Flow's Radix Tabs trigger id suffix. */
export function aspectSuffix(ratio) {
  switch (ratio) {
    case '16:9': return '-trigger-LANDSCAPE'
    case '4:3': return '-trigger-LANDSCAPE_4_3'
    case '1:1': return '-trigger-SQUARE'
    case '3:4': return '-trigger-PORTRAIT_3_4'
    case '9:16': return '-trigger-PORTRAIT'
    default: return null
  }
}

/** Normalize a model label for lenient matching (drop emoji/symbols, lowercase). */
export function normalizeModelLabel(s) {
  return (s || '')
    .replace(/[^\p{L}\p{N}.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Build the page-context JS that applies the defaults and saves.
 * @param {object} opts
 * @param {{aspectRatio?:string,count?:number,model?:string}} [opts.image]
 * @param {{aspectRatio?:string,count?:number,model?:string}} [opts.video]
 * @param {boolean} [opts.save=true] - click the save action after applying
 * @returns {string} JS source to run via webContents.executeJavaScript
 */
export function buildAgentDefaultsScript(opts = {}) {
  const payload = {
    image: opts.image
      ? {
          aspectSuffix: aspectSuffix(opts.image.aspectRatio),
          count: clampCount(opts.image.count),
          model: opts.image.model || null,
        }
      : null,
    video: opts.video
      ? {
          aspectSuffix: aspectSuffix(opts.video.aspectRatio),
          count: clampCount(opts.video.count),
          model: opts.video.model || null,
        }
      : null,
    // 승인 정책: 에이전트가 생성 전에 묻지 않고 자동 생성하게 하려면 AUTO_APPROVE.
    // (ALWAYS_ASK 면 프롬프트 제출해도 "생성할까요?"에서 멈춰 batchGenerateImages 가 안 감)
    approval: opts.autoApprove === true ? 'AUTO_APPROVE'
      : (opts.autoApprove === false ? 'ALWAYS_ASK' : null),
    save: opts.save !== false,
  }

  return `
    (async function() {
      const OPTS = ${JSON.stringify(payload)};
      const locatePanel = ${findAgentSettingsPanel.toString()};
      const locateSections = ${findAgentSettingsSections.toString()};
      const locateSave = ${findAgentSettingsSaveButton.toString()};
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const isVis = (el) => {
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect && el.getBoundingClientRect();
        return !!r && r.width > 2 && r.height > 2;
      };
      const norm = (s) => (s || '')
        .replace(/[^\\p{L}\\p{N}.\\s-]/gu, ' ').replace(/\\s+/g, ' ').trim().toLowerCase();
      const isActive = (el) => !!el && (el.getAttribute('aria-selected') === 'true'
        || el.getAttribute('data-state') === 'active');
      // Full Radix-compatible click sequence (pointer + mouse), as in configureFlowMode.
      const humanClick = (el) => {
        if (!el) return false;
        try {
          const rect = el.getBoundingClientRect();
          const x = rect.left + Math.max(6, Math.min(rect.width - 6, rect.width * 0.5));
          const y = rect.top + Math.max(6, Math.min(rect.height - 6, rect.height * 0.5));
          const c = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
          try {
            el.dispatchEvent(new PointerEvent('pointerover', c));
            el.dispatchEvent(new PointerEvent('pointermove', c));
            el.dispatchEvent(new PointerEvent('pointerdown', c));
          } catch {}
          el.dispatchEvent(new MouseEvent('mouseover', c));
          el.dispatchEvent(new MouseEvent('mousemove', c));
          el.dispatchEvent(new MouseEvent('mousedown', c));
          el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
          try { el.dispatchEvent(new PointerEvent('pointerup', c)); } catch {}
          el.dispatchEvent(new MouseEvent('mouseup', c));
          el.dispatchEvent(new MouseEvent('click', c));
          return true;
        } catch { try { el.click(); return true; } catch { return false; } }
      };

      // Step 1: ensure the panel is open (click the 'tune' settings button if not).
      let panel = locatePanel(document);
      if (!panel) {
        const tuneBtn = Array.from(document.querySelectorAll('button')).filter(isVis).find(b => {
          const icons = Array.from(b.querySelectorAll('i, [class*="material-symbols"], [class*="google-symbols"]'))
            .map(i => (i.textContent || '').trim());
          return icons.includes('tune');
        });
        if (tuneBtn) {
          humanClick(tuneBtn);
          for (let i = 0; i < 30; i++) { await sleep(120); panel = locatePanel(document); if (panel) break; }
        }
      }
      if (!panel) return { ok: false, error: 'panel_not_found' };
      const sections = locateSections(panel);

      const setAspect = (section, suffix) => {
        if (!suffix) return 'skipped';
        const tabs = Array.from(section.querySelectorAll('button[role="tab"]')).filter(isVis);
        const btn = tabs.find(b => b.id && b.id.endsWith(suffix));
        if (!btn) return 'tab_not_found';
        if (isActive(btn)) return 'already';
        humanClick(btn);
        return 'clicked';
      };

      const setCount = (section, n) => {
        if (!n) return 'skipped';
        const tabs = Array.from(section.querySelectorAll('button[role="tab"]')).filter(isVis)
          .filter(b => /-trigger-[1-4]$/.test(b.id || ''));
        const btn = tabs.find(b => b.id.endsWith('-trigger-' + n));
        if (!btn) return 'count_not_found';
        if (isActive(btn)) return 'already';
        humanClick(btn);
        return 'clicked';
      };

      const setModel = async (section, model) => {
        if (!model) return 'skipped';
        const trigger = Array.from(section.querySelectorAll('button[aria-haspopup="menu"]')).filter(isVis)[0];
        if (!trigger) return 'trigger_not_found';
        const want = norm(model);
        if (norm(trigger.textContent).includes(want)) return 'already';
        humanClick(trigger);
        let menu = null;
        for (let i = 0; i < 25; i++) {
          await sleep(80);
          menu = document.querySelector('[role="menu"][data-state="open"], [data-radix-menu-content][data-state="open"]');
          if (menu) break;
        }
        if (!menu) return 'menu_not_opened';
        const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter(isVis);
        const item = items.find(it => norm(it.textContent).includes(want));
        if (!item) {
          try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch {}
          return 'option_not_found:' + items.map(it => norm(it.textContent)).join('|');
        }
        humanClick(item);
        await sleep(150);
        return 'clicked';
      };

      const result = { ok: true, approval: 'skipped', image: null, video: null, saved: 'skipped' };

      // 승인 정책 라디오 (button[role=radio][value=ALWAYS_ASK|AUTO_APPROVE])
      if (OPTS.approval) {
        const radio = panel.querySelector('button[role="radio"][value="' + OPTS.approval + '"]')
          || Array.from(panel.querySelectorAll('button[role="radio"]')).find(r => r.getAttribute('value') === OPTS.approval);
        if (!radio) { result.approval = 'radio_not_found'; }
        else if (radio.getAttribute('aria-checked') === 'true' || radio.getAttribute('data-state') === 'checked') {
          result.approval = 'already';
        } else { humanClick(radio); await sleep(150); result.approval = 'clicked'; }
      }

      if (OPTS.image) {
        const sec = sections.image;
        if (!sec) { result.image = { error: 'section_not_found' }; }
        else {
          result.image = {
            aspect: setAspect(sec, OPTS.image.aspectSuffix),
            count: setCount(sec, OPTS.image.count),
            model: await setModel(sec, OPTS.image.model),
          };
        }
      }

      if (OPTS.video) {
        const sec = sections.video;
        if (!sec) { result.video = { error: 'section_not_found' }; }
        else {
          result.video = {
            aspect: setAspect(sec, OPTS.video.aspectSuffix),
            count: setCount(sec, OPTS.video.count),
            model: await setModel(sec, OPTS.video.model),
          };
        }
      }

      if (OPTS.save) {
        const saveBtn = locateSave(panel);
        if (saveBtn && isVis(saveBtn)) { humanClick(saveBtn); await sleep(200); result.saved = 'clicked'; }
        else { result.saved = 'save_not_found'; }
      }

      // 패널을 닫고, 실제로 닫힌 것을 "확인"할 때까지 대기한다.
      // (중요) 열린/닫히는 중인 패널이 컴포즈 입력창을 가리면 이후 프롬프트 주입이
      // 실패하고 제출 버튼이 disabled 로 남는다. 닫힘을 감지하기 전엔 리턴하지 않는다.
      const panelGone = () => !document.body.contains(panel) || !isVis(panel);
      let closed = false;
      for (let i = 0; i < 15; i++) {           // 최대 ~3초
        if (panelGone()) { closed = true; break; }
        try {
          document.body.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true
          }));
        } catch {}
        await sleep(200);
      }
      result.panelClosed = closed;

      return result;
    })()
  `
}

function clampCount(n) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return null
  return Math.max(1, Math.min(4, v))
}

/**
 * Flow Agent Settings 패널의 이미지/비디오 모델 드롭다운 옵션을 동적으로 긁는 page-script.
 * 하드코딩 대신 실제 서비스되는 모델만 반환(예: Imagen 제거 자동 반영).
 * 반환: { ok, image:{current,options:[{value,label}]}, video:{...}, error? }
 *   - value = 이모지/arrow 제거한 매칭용 텍스트(예: 'Nano Banana 2'), label = 원문(이모지 포함).
 * 패널은 'tune' 버튼으로 자동 오픈, 끝나면 Escape 로 닫는다(컴포즈 가림 방지).
 */
export function buildListModelsScript() {
  return `
    (async function() {
      const locatePanel = ${findAgentSettingsPanel.toString()};
      const locateSections = ${findAgentSettingsSections.toString()};
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const isVis = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect && el.getBoundingClientRect(); return !!r && r.width > 2 && r.height > 2; };
      const clean = (s) => (s || '').replace(/arrow_drop_down/gi, '')
        .replace(/[^\\p{L}\\p{N}.\\s-]/gu, ' ').replace(/\\s+/g, ' ').trim();
      const rawLabel = (s) => (s || '').replace(/arrow_drop_down/gi, '').replace(/\\s+/g, ' ').trim();
      const humanClick = (el) => { if (!el) return false; try { const r = el.getBoundingClientRect(); const x = r.left + r.width/2, y = r.top + r.height/2; const c = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; try { el.dispatchEvent(new PointerEvent('pointerdown', c)); } catch {} el.dispatchEvent(new MouseEvent('mousedown', c)); try { el.dispatchEvent(new PointerEvent('pointerup', c)); } catch {} el.dispatchEvent(new MouseEvent('mouseup', c)); el.dispatchEvent(new MouseEvent('click', c)); return true; } catch { try { el.click(); return true; } catch { return false; } } };
      let panel = locatePanel(document);
      if (!panel) {
        const tune = Array.from(document.querySelectorAll('button')).filter(isVis).find(b => Array.from(b.querySelectorAll('i,[class*="material-symbols"],[class*="google-symbols"]')).map(i => (i.textContent||'').trim()).includes('tune'));
        if (tune) { humanClick(tune); for (let i = 0; i < 30; i++) { await sleep(120); panel = locatePanel(document); if (panel) break; } }
      }
      if (!panel) return { ok: false, error: 'panel_not_found' };
      const sections = locateSections(panel);
      const readSection = async (sec) => {
        if (!sec) return { error: 'section_not_found' };
        const trigger = Array.from(sec.querySelectorAll('button[aria-haspopup="menu"]')).filter(isVis)[0];
        if (!trigger) return { error: 'trigger_not_found' };
        const current = clean(trigger.textContent);
        humanClick(trigger);
        let menu = null;
        for (let i = 0; i < 25; i++) { await sleep(80); menu = document.querySelector('[role="menu"][data-state="open"], [data-radix-menu-content][data-state="open"]'); if (menu) break; }
        let options = [];
        if (menu) {
          options = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter(isVis)
            .map(it => ({ value: clean(it.textContent), label: rawLabel(it.textContent) }))
            .filter(o => o.value);
          try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch {}
          await sleep(120);
        }
        return { current, options };
      };
      const image = await readSection(sections.image);
      const video = await readSection(sections.video);
      // 패널 닫기
      for (let i = 0; i < 10; i++) { if (!document.body.contains(panel) || !isVis(panel)) break; try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, composed: true })); } catch {} await sleep(150); }
      return { ok: true, image, video };
    })()
  `
}
