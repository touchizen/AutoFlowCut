/**
 * electron/flow-settings-dumper.js
 *
 * Diagnostic page-injection. Defines window.__autoflowcut_dump_settings__()
 * on the Flow page so we can capture the exact DOM of Flow's new
 * "에이전트 설정" (Agent Settings) panel — the panel that holds the image /
 * video generation DEFAULTS (count tablists, model dropdowns, aspect-ratio
 * control and the 저장 / Save button).
 *
 * Why this exists:
 *   Flow moved generation defaults out of the old compose-bar popup menu
 *   (which `configureFlowMode` in ipc/shared.js drives) into a full settings
 *   panel with a Save button. The old selectors no longer match, so count /
 *   aspect / model all silently fail. Before rewriting the automation we need
 *   ground-truth DOM — and a reusable way to re-capture it the next time Flow
 *   changes its markup.
 *
 * Usage (CDP NOT required):
 *   1. Run the app from a terminal (Flow webview console-messages are
 *      forwarded to the terminal — see main.js — but only when they contain
 *      '[autoflowcut', which all logs here do).
 *   2. Open Flow's "에이전트 설정" panel.
 *   3. (Optional) Open a model dropdown to capture its options too.
 *   4. In the Flow webview DevTools console run:  __autoflowcut_dump_settings__()
 *      The structured probe + full panel outerHTML print to the console AND
 *      the terminal. The call also returns the structured result object.
 *
 * IMPORTANT: this file exports a plain JS string executed inside the Flow page
 * via webContents.executeJavaScript() — NO Node.js APIs are available inside it.
 */

export const FLOW_SETTINGS_DUMPER = /* js */ `
(function() {
  if (window.__autoflowcut_dumper_ready__) return
  window.__autoflowcut_dumper_ready__ = true

  const P = '[autoflowcut DUMP]'
  const log = (...a) => { try { console.log(P, ...a) } catch {} }

  // Serialize an element's tag + text + every attribute (selectors live in attrs).
  const describe = (el) => {
    if (!el || !el.attributes) return null
    const o = { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 60) }
    for (const a of el.attributes) o[a.name] = a.value
    return o
  }

  const textOf = (el) => (el && el.textContent || '').trim()
  const includesText = (el, s) => textOf(el).includes(s)

  // Collect ALL elements, descending through open shadow roots AND same-origin
  // iframes (Flow's compose/prompt UI may live in an iframe, which a plain
  // document.querySelectorAll cannot see).
  let iframeCount = 0
  let iframeAccessible = 0
  const deepAll = (root, acc) => {
    acc = acc || []
    root = root || document
    try {
      root.querySelectorAll('*').forEach(el => {
        acc.push(el)
        if (el.shadowRoot) deepAll(el.shadowRoot, acc)
        if (el.tagName === 'IFRAME') {
          iframeCount++
          let doc = null
          try { doc = el.contentDocument } catch { doc = null }
          if (doc) { iframeAccessible++; deepAll(doc, acc) }
        }
      })
    } catch {}
    return acc
  }

  window.__autoflowcut_dump_settings__ = function() {
    log('==================== SETTINGS DUMP START ====================')
    log('URL:', location.href, '| title:', document.title)

    const all = deepAll()
    log('total elements:', all.length, '| iframes:', iframeCount, '(accessible:', iframeAccessible + ')')

    // (0) Stable structural signatures we already confirmed exist on Flow's
    //     settings UI (from DevTools): count buttons carry class
    //     'flow_tab_slider_trigger' and ids ending '-trigger-N'.
    const sliderBtns = all.filter(e => e.classList && Array.from(e.classList).some(c => /flow_tab_slider_trigger/.test(c)))
    const triggerIds = all.filter(e => e.id && /-trigger-/.test(e.id))
    const xButtons = all.filter(e => e.tagName === 'BUTTON' && /^x?[1-4]x?$/i.test(textOf(e)))
    log('signatures — flow_tab_slider_trigger:', sliderBtns.length,
      '| id*=-trigger-:', triggerIds.length, '| x1~x4 buttons:', xButtons.length)

    // (0a) Page structure diagnostics — when buttons go missing, find out whether
    //      the real UI moved into a (possibly cross-origin) iframe.
    let iframes = []
    try {
      iframes = Array.from(document.querySelectorAll('iframe')).map(f => {
        let accessible = false
        try { accessible = !!f.contentDocument } catch { accessible = false }
        return { src: (f.getAttribute('src') || '').slice(0, 120), id: f.id || null, accessible,
          w: Math.round(f.getBoundingClientRect().width), h: Math.round(f.getBoundingClientRect().height) }
      })
      log('iframes (' + iframes.length + '):', JSON.stringify(iframes, null, 2))
    } catch (e) { log('iframe-probe error:', e.message) }
    try {
      const hist = {}
      all.forEach(e => { const t = e.tagName.toLowerCase(); hist[t] = (hist[t] || 0) + 1 })
      const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 20)
      log('tag histogram (top 20):', JSON.stringify(top))
    } catch (e) { log('histogram error:', e.message) }
    try {
      log('BODY HTML (first 6000):\\n' + (document.body ? document.body.outerHTML.slice(0, 6000) : '(no body)'))
    } catch (e) { log('body-html error:', e.message) }

    // (0b) GENERATE/SUBMIT button probe — independent of the settings panel so it
    //      works while a generation is in progress. Verifies whether the submit
    //      button is gated by native 'disabled', by 'aria-disabled', by a class,
    //      or by an icon swap (arrow_forward -> stop / progress_activity / etc).
    //      Dump once idle and once mid-generation to compare the two states.
    let generateButtons = []
    try {
      const GEN_ICONS = ['arrow_forward', 'send', 'play_arrow', 'stop', 'pause',
        'hourglass_empty', 'hourglass_top', 'progress_activity', 'autorenew', 'sync']
      generateButtons = all
        .filter(b => b.tagName === 'BUTTON')
        .map(b => {
          const icons = Array.from(b.querySelectorAll('i, [class*="material-symbols"], [class*="google-symbols"], [class*="material-icons"]'))
            .map(i => (i.textContent || '').trim()).filter(Boolean)
          const al = (b.getAttribute('aria-label') || '')
          const iconHit = icons.find(t => GEN_ICONS.includes(t))
          const isCandidate = !!iconHit || /generate|create|submit|send|만들기|생성/i.test(al)
          if (!isCandidate) return null
          return {
            icons,
            iconHit: iconHit || null,
            disabled: b.disabled,                          // native property
            ariaDisabled: b.getAttribute('aria-disabled'), // aria fallback
            dataState: b.getAttribute('data-state'),
            ariaLabel: al || null,
            type: b.getAttribute('type'),
            visible: isVis(b),
            class: b.className,
          }
        })
        .filter(Boolean)
      log('GENERATE button candidates (' + generateButtons.length + '):', JSON.stringify(generateButtons, null, 2))
    } catch (e) { log('generate-probe error:', e.message) }

    // (0c) ALL clickable controls near the prompt — ground truth when the
    //      generate-button heuristic above misses (Flow changed the markup).
    //      Dump every <button>/[role=button] with its icons/text/disabled state.
    let allButtons = []
    try {
      allButtons = all
        .filter(b => b.tagName === 'BUTTON' || (b.getAttribute && b.getAttribute('role') === 'button'))
        // NOTE: no isVis filter — the Flow webview is often zero-size (hidden)
        // when idle, which would drop every button. Report visibility as a field.
        .map(b => ({
          tag: b.tagName.toLowerCase(),
          role: b.getAttribute('role'),
          text: textOf(b).slice(0, 30),
          visible: isVis(b),
          icons: Array.from(b.querySelectorAll('i, [class*="material-symbols"], [class*="google-symbols"], [class*="material-icons"]'))
            .map(i => (i.textContent || '').trim()).filter(Boolean),
          disabled: b.disabled,
          ariaDisabled: b.getAttribute('aria-disabled'),
          dataState: b.getAttribute('data-state'),
          ariaLabel: b.getAttribute('aria-label'),
          type: b.getAttribute('type'),
          class: (b.className || '').slice(0, 70),
        }))
        .slice(0, 80)
      log('ALL visible buttons (' + allButtons.length + '):', JSON.stringify(allButtons, null, 2))
    } catch (e) { log('all-buttons-probe error:', e.message) }

    // (0d) GENERATED IMAGE probe — 에이전트 챗에 뜬 결과 이미지의 <img src> 를 찾는다.
    //      src 가 정상 http(s) URL 이면 메뉴 없이 그 URL 로 바로 다운로드 가능.
    //      (작은 아이콘/아바타 제외: 가로/세로 120px 이상만)
    let genImages = []
    try {
      genImages = all
        .filter(e => e.tagName === 'IMG')
        .map(im => {
          const r = im.getBoundingClientRect ? im.getBoundingClientRect() : { width: 0, height: 0 }
          return {
            src: (im.currentSrc || im.src || '').slice(0, 200),
            srcset: (im.getAttribute('srcset') || '').slice(0, 200),
            w: Math.round(r.width), h: Math.round(r.height),
            natW: im.naturalWidth, natH: im.naturalHeight,
            alt: (im.getAttribute('alt') || '').slice(0, 40),
            class: (im.className || '').slice(0, 60),
          }
        })
        .filter(i => (i.w >= 120 && i.h >= 120) || i.natW >= 120)
        .slice(0, 30)
      log('GENERATED images (' + genImages.length + '):', JSON.stringify(genImages, null, 2))
    } catch (e) { log('gen-image-probe error:', e.message) }

    // (0e) GENERATED VIDEO probe — 결과 동영상 <video> 의 src/poster 를 찾는다.
    //      src 가 정상 http(s) URL(예: media.getMediaUrlRedirect?name=UUID)이면 메뉴 없이
    //      바로 다운로드 가능. blob: 이면 메뉴(다운로드)나 poster→media 경로가 필요.
    let genVideos = []
    try {
      genVideos = all
        .filter(e => e.tagName === 'VIDEO')
        .map(v => {
          const srcEl = v.querySelector ? v.querySelector('source') : null
          const r = v.getBoundingClientRect ? v.getBoundingClientRect() : { width: 0, height: 0 }
          return {
            currentSrc: (v.currentSrc || '').slice(0, 200),
            src: (v.getAttribute('src') || '').slice(0, 200),
            sourceSrc: srcEl ? (srcEl.getAttribute('src') || '').slice(0, 200) : null,
            poster: (v.getAttribute('poster') || '').slice(0, 200),
            w: Math.round(r.width), h: Math.round(r.height),
            class: (v.className || '').slice(0, 60),
          }
        })
        .slice(0, 20)
      log('GENERATED videos (' + genVideos.length + '):', JSON.stringify(genVideos, null, 2))
    } catch (e) { log('gen-video-probe error:', e.message) }

    // (1) Candidate buttons that might OPEN the settings panel.
    try {
      const openCandidates = all.filter(b => {
        if (!/^(BUTTON|A)$/.test(b.tagName) && !(b.getAttribute && b.getAttribute('role') === 'button')) return false
        const al = (b.getAttribute && b.getAttribute('aria-label')) || ''
        const t = textOf(b)
        const icons = Array.from(b.querySelectorAll('i, [class*="material-symbols"], [class*="material-icons"]')).map(i => textOf(i))
        return /설정|setting|tune|에이전트|agent|gear/i.test(al)
          || /^설정$|에이전트|기본값/.test(t)
          || icons.some(i => ['settings', 'tune', 'settings_suggest'].includes(i))
      }).slice(0, 20).map(describe)
      log('open-settings candidates (' + openCandidates.length + '):', JSON.stringify(openCandidates, null, 2))
    } catch (e) { log('open-candidates error:', e.message) }

    // (2) Locate the panel. Prefer the known signatures (anchor = a count
    //     button), else fall back to the Korean section labels.
    let panel = null
    try {
      const anchor = sliderBtns[0] || triggerIds[0] || xButtons[0]
      if (anchor) {
        // Climb to the FULL settings panel — the container holding BOTH default
        // sections (image + video) and the Save button, not just one section.
        let cur = anchor, best = anchor
        for (let i = 0; i < 16 && cur.parentElement; i++) {
          cur = cur.parentElement
          const t = textOf(cur)
          if (t.includes('이미지 생성 기본값')) best = cur
          if (t.includes('이미지 생성 기본값') && t.includes('동영상 생성 기본값') && /저장|save/i.test(t)) {
            best = cur; break
          }
        }
        panel = best
      }
      if (!panel) {
        const label = all.find(e => includesText(e, '이미지 생성 기본값') && e.querySelectorAll('*').length < 80)
        panel = label
        while (panel && panel !== document.body) {
          const t = textOf(panel)
          if (t.includes('동영상 생성 기본값') && /저장|save/i.test(t)) break
          panel = panel.parentElement
        }
        if (panel === document.body) panel = null
      }
    } catch (e) { log('panel-find error:', e.message) }

    if (!panel) {
      log('PANEL NOT FOUND — "에이전트 설정" 패널을 먼저 연 뒤 다시 호출해줘 (생성 버튼 probe 는 위에 찍힘)')
      log('==================== SETTINGS DUMP END (no panel) ====================')
      return { found: false, url: location.href, title: document.title,
        signatures: { sliderBtns: sliderBtns.length, triggerIds: triggerIds.length, xButtons: xButtons.length },
        totalElements: all.length, iframeCount, iframeAccessible, iframes,
        generateButtons, allButtons, genImages, genVideos,
        html: (function() { try { return document.body ? document.body.outerHTML.slice(0, 60000) : '' } catch { return '' } })() }
    }

    // (3) Probe the controls inside the panel.
    let tablists = [], modelish = [], saveBtns = []
    try {
      tablists = Array.from(panel.querySelectorAll('[role="tablist"]')).map(tl => ({
        tablist: describe(tl),
        tabs: Array.from(tl.querySelectorAll('[role="tab"], button')).map(describe),
      }))
      log('tablists (count / aspect rows) (' + tablists.length + '):', JSON.stringify(tablists, null, 2))
    } catch (e) { log('tablist-probe error:', e.message) }

    try {
      modelish = Array.from(panel.querySelectorAll('button, [role="combobox"], [aria-haspopup], select'))
        .filter(b => {
          const t = textOf(b)
          return /Nano|Banana|Omni|Flash|Imagen|Veo|모델|model/i.test(t)
            || (b.getAttribute && b.getAttribute('role') === 'combobox')
            || b.tagName === 'SELECT'
        })
        .map(describe)
      log('model-like controls (' + modelish.length + '):', JSON.stringify(modelish, null, 2))
    } catch (e) { log('model-probe error:', e.message) }

    try {
      saveBtns = Array.from(panel.querySelectorAll('button, [role="button"]'))
        .filter(b => /^저장$|저장|save/i.test(textOf(b)))
        .map(describe)
      log('save buttons (' + saveBtns.length + '):', JSON.stringify(saveBtns, null, 2))
    } catch (e) { log('save-probe error:', e.message) }

    // (4) Any OPEN dropdown/popover (Radix renders options in a portal OUTSIDE
    //     the panel) — captures model option items when a dropdown is open.
    try {
      const openMenus = Array.from(document.querySelectorAll(
        '[data-radix-menu-content][data-state="open"], [role="menu"][data-state="open"], [role="listbox"], [data-radix-popper-content-wrapper]'
      )).map(m => ({
        container: describe(m),
        items: Array.from(m.querySelectorAll('[role="menuitem"], [role="option"], button, li')).slice(0, 30).map(describe),
      }))
      log('open dropdown/popover content (' + openMenus.length + '):', JSON.stringify(openMenus, null, 2))
    } catch (e) { log('open-menu-probe error:', e.message) }

    // (4b) Snapshot of open dropdown/popover content (for the return value /
    //      file dump — main writes this to disk).
    let openMenusData = []
    try {
      openMenusData = Array.from(document.querySelectorAll(
        '[data-radix-menu-content][data-state="open"], [role="menu"][data-state="open"], [role="listbox"], [data-radix-popper-content-wrapper]'
      )).map(m => ({
        container: describe(m),
        items: Array.from(m.querySelectorAll('[role="menuitem"], [role="option"], button, li')).slice(0, 30).map(describe),
      }))
    } catch {}

    // (5) Full panel outerHTML. Returned to caller (main writes it to a file)
    //     and ALSO chunk-logged so it shows up via the console forwarder.
    let html = ''
    try {
      html = panel.outerHTML
      log('panel outerHTML length:', html.length)
      const CH = 4000
      for (let i = 0; i < html.length; i += CH) {
        log('panel HTML [' + i + '/' + html.length + ']:\\n' + html.slice(i, i + CH))
      }
    } catch (e) { log('html-dump error:', e.message) }

    log('==================== SETTINGS DUMP END ====================')
    return {
      found: true,
      url: location.href,
      title: document.title,
      signatures: { sliderBtns: sliderBtns.length, triggerIds: triggerIds.length, xButtons: xButtons.length },
      generateButtons,
      allButtons,
      genImages,
      genVideos,
      tablists, modelish, saveBtns,
      openMenus: openMenusData,
      html,
    }
  }

  log('dumper ready — "에이전트 설정" 패널을 연 뒤 콘솔에서 __autoflowcut_dump_settings__() 를 호출해줘')
})()
`
