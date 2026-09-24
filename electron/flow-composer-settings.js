/**
 * electron/flow-composer-settings.js
 *
 * flow.google.com(Angular) 컴포저 **설정 패널 드라이버** — 모드(이미지/영상)·비율·길이·해상도·개수를 패널에서 맞추고,
 * 이미지 모델은 **검증만** 한다(패널 트리거 텍스트 ≠ 요청 → flow-image-model-mismatch {requested, panel}).
 *
 * 패널(D 덤프 2026-09-24): Material button-toggle `button.mat-button-toggle-button[role=radio][aria-checked]` 가 자동 번호
 * `name`(mat-button-toggle-group-N) 으로 묶인다 — **번호·id 로 절대 매칭하지 않는다**. 그룹은 내용으로 분류한다:
 *   mode(image|videocam) · ratio(crop_16_9|crop_9_16|crop_landscape|crop_square|crop_portrait) · inputMode(crop_free|chrome_extension)
 *   · count(x1..x4) · resolution(360p|720p) · duration(4초|6초|8초|10초). 라벨엔 <mat-icon> 이 섞인다(리거처는 따로 뽑는다).
 * 패널 = 라디오의 최소 공통 조상(카드 more_vert·프로젝트 메뉴의 button[aria-haspopup=menu] 는 밖). 모델 트리거는
 * 그 스코프 안의 button[aria-haspopup=menu] 하나. 메뉴는 열려 있을 때만 aria-controls=<div#mat-menu-panel-N[role=menu]>.
 *
 * 흐름(main applyComposerSettings): 트리거 trusted 클릭 → **단일 executeJavaScript**(SETTINGS_DRIVER_JS):
 *   스캔 → phase1 모드 → 반영 대기·재스캔 → phase2: 모델(이미지 검증 / 영상 메뉴 선택 → 안정 대기·재스캔·재계획)
 *   → 비율 → 길이 → 해상도 → 개수 → **최종 재판독**(단계 통과만으로 ok 를 내지 않는다) → Escape 로 닫기.
 *   합성 클릭을 무시한 라디오는 needsTrusted 로 돌려주고 main 이 그것만 trusted 클릭한 뒤 드라이버를 다시 돌린다.
 *   닫힘 실패는 트리거 재클릭 → 그래도 열려 있으면 panel-not-closed. 닫힌 요약의 리거처가 요청 비율과 다르면 ratio-not-reflected.
 *
 * 주입 규칙: 헬퍼는 const 로 직렬화해 호출 지점에서 조합(서로 이름으로 부르지 않는다 — settingsDriverCore 는 deps 로 받는다).
 * tests/electron/flow-composer-settings.test.js · tests/electron/flow-injections-minified.test.js
 */
import { FIND_SETTINGS_TRIGGER_JS, READ_SETTINGS_SUMMARY_JS } from './flow-composer-dom.js'

const RATIO_LIGATURE = { '16:9': 'crop_16_9', '9:16': 'crop_9_16', '4:3': 'crop_landscape', '1:1': 'crop_square', '3:4': 'crop_portrait' }

/** 요청 비율 → 패널/요약 리거처. 모르는 비율은 null. */
export function ratioLigature(ratio) {
  return RATIO_LIGATURE[String(ratio || '')] || null
}

/** 설정 패널이 열려 있나(Material 라디오 6개 이상). 자기완결. */
export function isSettingsPanelOpen(doc) {
  return doc.querySelectorAll('button.mat-button-toggle-button[role="radio"][aria-checked]').length >= 6
}

/**
 * 열린 패널 스캔 → { ok, panel, groups:{kind:{name, options:[{el,label,ligature,checked}], checked}}, model:{trigger,label,display,expanded} }.
 * 실패: panel-not-open · input-mode-not-material · group-ambiguous:<kind>. 자기완결.
 */
export function scanSettingsPanel(doc) {
  const ICON_SEL = "mat-icon, i, span[class*='symbols'], [class*='google-symbols']"
  const radiosAll = Array.from(doc.querySelectorAll('[role="radio"][aria-checked]'))
  const material = radiosAll.filter((b) => b.tagName === 'BUTTON' && b.classList.contains('mat-button-toggle-button'))
  if (material.length < 6) {
    if (radiosAll.length >= 6) return { ok: false, reason: 'input-mode-not-material' }
    return { ok: false, reason: 'panel-not-open' }
  }
  let panel = material[0].parentElement
  while (panel && panel !== doc.body && !material.every((r) => panel.contains(r))) panel = panel.parentElement
  if (!panel || panel === doc.body || panel === doc.documentElement) return { ok: false, reason: 'panel-not-open' }

  const stripped = (el) => {
    const clone = el.cloneNode(true)
    Array.from(clone.querySelectorAll(ICON_SEL)).forEach((i) => i.remove())
    return (clone.textContent || '').replace(/\s+/g, ' ').trim()
  }
  const byName = new Map()
  for (const r of material) {
    const name = r.getAttribute('name') || ''
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(r)
  }
  const groups = {}
  for (const [name, els] of byName) {
    const options = els.map((el) => {
      const icons = Array.from(el.querySelectorAll(ICON_SEL)).map((i) => (i.textContent || '').trim()).filter(Boolean)
      return { el, name, label: stripped(el), ligature: icons.find((l) => l !== 'info') || null, checked: el.getAttribute('aria-checked') === 'true' }
    })
    const ligs = options.map((o) => o.ligature).filter(Boolean)
    const labels = options.map((o) => o.label)
    let kind = null
    if (ligs.some((l) => l === 'image' || l === 'videocam')) kind = 'mode'
    else if (ligs.length === options.length && ligs.every((l) => /^crop_(16_9|9_16|landscape|square|portrait)$/.test(l))) kind = 'ratio'
    else if (ligs.some((l) => l === 'crop_free' || l === 'chrome_extension')) kind = 'inputMode'
    else if (labels.every((l) => /^x[1-4]$/i.test(l))) kind = 'count'
    else if (labels.every((l) => /^\d{3,4}p$/i.test(l))) kind = 'resolution'
    else if (labels.every((l) => /^\d{1,2}\s*\D{0,8}$/.test(l))) kind = 'duration'
    if (!kind) continue
    if (groups[kind]) return { ok: false, reason: 'group-ambiguous:' + kind }
    groups[kind] = { name, kind, options, checked: options.find((o) => o.checked) || null }
  }
  const triggers = Array.from(panel.querySelectorAll('button[aria-haspopup="menu"]'))
  let model = null
  if (triggers.length === 1) {
    const t = triggers[0]
    const raw = stripped(t)
    const display = raw.replace(/[^\p{L}\p{N}.\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
    model = { trigger: t, raw, display, label: display.toLowerCase(), expanded: t.getAttribute('aria-expanded') === 'true', controls: t.getAttribute('aria-controls') || null }
  } else if (triggers.length > 1) {
    model = { ambiguous: triggers.length }
  }
  return { ok: true, panel, groups, model, radioCount: material.length }
}

/**
 * 클릭 계획. phase 1 = 모드만, phase 2 = 모델(이미지 검증 / 영상 select 계획) → 비율 → 길이 → 해상도 → 개수(영상은 항상 x1).
 * 이미 맞는 목표는 steps 에 already(비율은 already(<리거처>)), 미정의 목표는 생략. 자기완결.
 * @returns {{ok:boolean, kind?:string, params?:object, reason?:string, clicks:Array, steps?:object, model?:{select:true, requested:string}|null}}
 */
export function planSettingsClicks(scan, targets, phase) {
  const RATIO = { '16:9': 'crop_16_9', '9:16': 'crop_9_16', '4:3': 'crop_landscape', '1:1': 'crop_square', '3:4': 'crop_portrait' }
  const norm = (s) => String(s || '').replace(/[^\p{L}\p{N}.\s-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  const t = targets || {}
  const steps = {}
  const clicks = []
  const fail = (reason) => ({ ok: false, kind: 'flow-settings-not-applied', reason, clicks: [] })
  const want = (kind, pred, notOffered) => {
    const g = scan.groups[kind]
    if (!g) return { err: fail('group-not-found:' + kind) }
    const opt = g.options.find(pred)
    if (!opt) return { err: fail(notOffered) }
    return { g, opt }
  }
  const apply = (kind, r, stepLabel) => {
    if (r.opt.checked) steps[kind] = stepLabel ? 'already(' + stepLabel + ')' : 'already'
    else {
      clicks.push({ group: kind, name: r.g.name, label: r.opt.label, ligature: r.opt.ligature, el: r.opt.el })
      steps[kind] = stepLabel ? 'clicked(' + stepLabel + ')' : 'clicked'
    }
  }
  if (phase === 1) {
    const lig = t.mode === 'video' ? 'videocam' : 'image'
    const r = want('mode', (o) => o.ligature === lig, 'mode-not-offered:' + (t.mode || 'image'))
    if (r.err) return r.err
    apply('mode', r, null)
    return { ok: true, clicks, steps }
  }
  let model = null
  if (t.model != null && t.model !== '') {
    if (!scan.model || !scan.model.trigger) return fail('model-trigger-not-found')
    const matches = scan.model.label.includes(norm(t.model))
    if (t.mode !== 'video') {
      if (!matches) return { ok: false, kind: 'flow-image-model-mismatch', params: { requested: String(t.model), panel: scan.model.display }, clicks: [] }
      steps.model = 'verified'
    } else if (matches) {
      steps.model = 'verified'
    } else {
      model = { select: true, requested: String(t.model) }
    }
  }
  if (t.ratio !== undefined) {
    const lig = RATIO[String(t.ratio)]
    if (!lig) return fail('ratio-not-offered:' + t.ratio)
    const r = want('ratio', (o) => o.ligature === lig, 'ratio-not-offered:' + t.ratio)
    if (r.err) return r.err
    apply('ratio', r, lig)
  }
  if (t.mode === 'video' && t.duration !== undefined) {
    const digits = String(t.duration).replace(/\D/g, '')
    const r = want('duration', (o) => o.label.replace(/\D/g, '') === digits, 'duration-not-offered:' + t.duration)
    if (r.err) return r.err
    apply('duration', r, null)
  }
  if (t.mode === 'video' && t.resolution !== undefined) {
    const res = String(t.resolution).toLowerCase()
    const g = scan.groups.resolution
    if (!g) return fail('group-not-found:resolution')
    const opt = g.options.find((o) => o.label.toLowerCase() === res)
    if (!opt) return { ok: false, kind: 'flow-resolution-not-offered', params: { requested: String(t.resolution) }, reason: 'resolution-not-offered:' + t.resolution, clicks: [] }
    apply('resolution', { g, opt }, null)
  }
  if (t.mode === 'video' || t.count !== undefined) {
    const label = t.mode === 'video' ? 'x1' : 'x' + Number(t.count)
    const r = want('count', (o) => o.label.toLowerCase() === label, 'count-not-offered:' + label)
    if (r.err) return r.err
    apply('count', r, null)
  }
  return { ok: true, clicks, steps, model }
}

/**
 * 페이지 안에서 한 번에 도는 드라이버 본체(async). deps = { scan, plan, sleep } — 헬퍼를 값으로 받는다(자기완결).
 * 반환 { ok, steps, closed? } | { ok:false, kind, params?, reason, steps, needsTrusted? }.
 */
export async function settingsDriverCore(doc, targets, deps) {
  const scan = deps.scan
  const plan = deps.plan
  const sleep = deps.sleep
  const t = targets || {}
  const steps = {}
  const fail = (reason, extra) => Object.assign({ ok: false, kind: 'flow-settings-not-applied', reason, steps }, extra || {})
  const failPlan = (p) => Object.assign(fail(p.reason || p.kind), { kind: p.kind || 'flow-settings-not-applied' }, p.params ? { params: p.params } : {})
  const waitFor = async (pred, ms) => {
    const n = Math.max(1, Math.ceil(ms / 50))
    for (let i = 0; i < n; i++) { if (pred()) return true; await sleep(50) }
    return pred()
  }
  const norm = (s) => String(s || '').replace(/[^\p{L}\p{N}.\s-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  const ICON_SEL = "mat-icon, i, span[class*='symbols'], [class*='google-symbols']"

  let s = scan(doc)
  if (!s.ok) return fail(s.reason)
  // phase 1 — 모드
  const p1 = plan(s, t, 1)
  if (!p1.ok) return failPlan(p1)
  Object.assign(steps, p1.steps)
  if (p1.clicks.length) {
    const c = p1.clicks[0]
    c.el.click()
    const reflected = await waitFor(() => { const n = scan(doc); return n.ok && !!n.groups.mode && !!n.groups.mode.checked && n.groups.mode.checked.ligature === c.ligature }, 3000)
    if (!reflected) return fail('needs-trusted', { needsTrusted: [{ group: 'mode', name: c.name, label: c.label, ligature: c.ligature }] })
    await sleep(100)
    s = scan(doc)
    if (!s.ok) return fail(s.reason)
  }
  // phase 2 — 모델 먼저
  let p2 = plan(s, t, 2)
  if (!p2.ok) return failPlan(p2)
  let modelClicked = false
  if (p2.model && p2.model.select) {
    const trigger = s.model.trigger
    trigger.click()
    const opened = await waitFor(() => trigger.getAttribute('aria-expanded') === 'true' && !!trigger.getAttribute('aria-controls') && !!doc.getElementById(trigger.getAttribute('aria-controls')), 3000)
    if (!opened) return fail('model-menu-not-open')
    const menu = doc.getElementById(trigger.getAttribute('aria-controls'))
    const wantLabel = norm(p2.model.requested)
    const item = Array.from(menu.querySelectorAll('[role="menuitem"]')).find((el) => {
      const clone = el.cloneNode(true)
      Array.from(clone.querySelectorAll(ICON_SEL)).forEach((i) => i.remove())
      return norm(clone.textContent).includes(wantLabel)
    })
    if (!item) { try { trigger.click() } catch (_e) { /* 메뉴 닫기 실패는 무시 */ } return fail('model-not-offered') }
    item.click()
    const applied = await waitFor(() => { const n = scan(doc); return n.ok && !!n.model && !!n.model.label && n.model.label.includes(wantLabel) && !n.model.expanded }, 3000)
    if (!applied) return fail('model-not-reflected')
    modelClicked = true
    await sleep(150)   // 안정 대기 — 모델 변경이 길이/해상도 그룹을 리셋·교체할 수 있다
    s = scan(doc)
    if (!s.ok) return fail(s.reason)
    p2 = plan(s, t, 2)
    if (!p2.ok) return failPlan(p2)
    if (p2.model && p2.model.select) return fail('model-not-reflected')
  }
  Object.assign(steps, p2.steps)
  if (modelClicked) steps.model = 'clicked'
  const needsTrusted = []
  for (const c of p2.clicks) {
    c.el.click()
    const ok = await waitFor(() => c.el.getAttribute('aria-checked') === 'true', 1500)
    if (!ok) needsTrusted.push({ group: c.group, name: c.name, label: c.label, ligature: c.ligature })
  }
  if (needsTrusted.length) return fail('needs-trusted', { needsTrusted })
  // 최종 재판독 — 뒤의 클릭이 앞 그룹을 되돌렸을 수 있다
  await sleep(100)
  s = scan(doc)
  if (!s.ok) return fail(s.reason)
  const v = plan(s, t, 2)
  if (!v.ok) return failPlan(v)
  if (v.model && v.model.select) return fail('not-checked:model')
  if (v.clicks.length) return fail('not-checked:' + v.clicks[0].group)
  // 닫기 — Escape(합성). 안 닫히면 main 이 트리거를 다시 trusted 클릭한다.
  try {
    const KE = doc.defaultView && doc.defaultView.KeyboardEvent ? doc.defaultView.KeyboardEvent : KeyboardEvent
    doc.dispatchEvent(new KE('keydown', { key: 'Escape', bubbles: true }))
  } catch (_e) { /* 이벤트 생성 실패 — closed:false 로 보고 */ }
  const closed = await waitFor(() => !scan(doc).ok, 1500)
  return { ok: true, steps, closed }
}

/** 테스트·main 공용 — 모듈 헬퍼로 조합한 드라이버(페이지 주입은 SETTINGS_DRIVER_JS). */
export function runSettingsDriver(doc, targets, deps = {}) {
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  return settingsDriverCore(doc, targets, { scan: scanSettingsPanel, plan: planSettingsClicks, sleep })
}

// ─── 페이지 주입 표현식 ────────────────────────────────────────────────────
/** 패널 열림 프로브(단일 표현식). 마커는 문자열 템플릿에(minify 에 안 잘린다). */
export const SETTINGS_PANEL_OPEN_JS = `/* __af_settings_panel_open__ */(${isSettingsPanelOpen.toString()})(document)`

/** 드라이버 스크립트 — Promise 를 돌려준다(executeJavaScript 가 기다린다). 헬퍼는 값으로 조합. */
export function SETTINGS_DRIVER_JS(targets) {
  return `/* __af_settings_driver__ */(function () {
  const scan = ${scanSettingsPanel.toString()};
  const plan = ${planSettingsClicks.toString()};
  const core = ${settingsDriverCore.toString()};
  return core(document, ${JSON.stringify(targets || {})}, { scan: scan, plan: plan, sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) } });
})()`
}

/** name + (리거처 | 라벨) 로 라디오 element — needsTrusted 의 trusted 클릭 대상. */
export function FIND_RADIO_JS(name, key) {
  return `(function (n, k) {
  const els = Array.from(document.querySelectorAll('button.mat-button-toggle-button[role="radio"][name="' + n + '"]'));
  const SEL = "mat-icon, i, span[class*='symbols'], [class*='google-symbols']";
  for (const el of els) {
    const icons = Array.from(el.querySelectorAll(SEL)).map(function (i) { return (i.textContent || '').trim() });
    if (icons.indexOf(k) >= 0) return el;
    const clone = el.cloneNode(true);
    Array.from(clone.querySelectorAll(SEL)).forEach(function (i) { i.remove() });
    if ((clone.textContent || '').replace(/\\s+/g, ' ').trim() === k) return el;
  }
  return null;
})(${JSON.stringify(String(name))}, ${JSON.stringify(String(key))})`
}

const STEP_ORDER = ['mode', 'ratio', 'duration', 'resolution', 'count', 'model']
function formatSteps(steps) {
  return STEP_ORDER.filter((k) => steps && steps[k]).map((k) => `${k}=${steps[k]}`).join(' ')
}

/**
 * main: 설정 트리거 trusted 클릭 → 드라이버 1회(needsTrusted 면 그 라디오만 trusted 클릭 후 1회 더) → 닫힘·요약 검증.
 * @param {{mode:'image'|'video', ratio?, count?, model?, duration?, resolution?}} opts
 * @param {{trustedClickOnFlowView:Function}} deps
 * @returns {{ok:boolean, steps:object, kind?:string, params?:object, reason?:string}}
 */
export async function applyComposerSettings(flowView, opts, deps) {
  const mode = opts && opts.mode === 'video' ? 'video' : 'image'
  const targets = { mode, ratio: opts?.ratio, count: opts?.count, model: opts?.model, duration: opts?.duration, resolution: opts?.resolution }
  const exec = (js) => flowView.webContents.executeJavaScript(js, true)
  let steps = {}
  const fail = (reason, extra) => {
    console.warn(`[Flow Settings] ${mode} ${formatSteps(steps)} ok=false reason=${reason}`)
    return Object.assign({ ok: false, kind: 'flow-settings-not-applied', reason, steps }, extra || {})
  }
  const summary = await exec(READ_SETTINGS_SUMMARY_JS).catch(() => null)
  if (!summary) return fail('settings-trigger-not-found')
  const click = await deps.trustedClickOnFlowView(FIND_SETTINGS_TRIGGER_JS, { required: true, step: 'settings-trigger' })
  if (!click || !click.success) return fail('settings-trigger-click-failed')
  const runDriver = () => exec(SETTINGS_DRIVER_JS(targets)).catch(() => ({ ok: false, reason: 'driver-threw', steps: {} }))
  let r = await runDriver()
  if (r && Array.isArray(r.needsTrusted) && r.needsTrusted.length) {
    for (const n of r.needsTrusted) {
      const c = await deps.trustedClickOnFlowView(FIND_RADIO_JS(n.name, n.ligature || n.label), { required: true, step: 'settings-radio' })
      if (!c || !c.success) { steps = r.steps || {}; return fail('settings-radio-click-failed:' + n.group) }
    }
    r = await runDriver()
  }
  steps = (r && r.steps) || {}
  if (!r || !r.ok) {
    const kind = r?.kind || 'flow-settings-not-applied'
    const reason = r?.reason || kind
    console.warn(`[Flow Settings] ${mode} ${formatSteps(steps)} ok=false reason=${reason}`)
    return Object.assign({ ok: false, kind, reason, steps }, r?.params ? { params: r.params } : {})
  }
  if (r.closed === false) {
    await deps.trustedClickOnFlowView(FIND_SETTINGS_TRIGGER_JS, { required: true, step: 'settings-trigger-close' })
    const stillOpen = await exec(SETTINGS_PANEL_OPEN_JS).catch(() => true)
    if (stillOpen) return fail('panel-not-closed')
  }
  if (targets.ratio !== undefined) {
    const after = await exec(READ_SETTINGS_SUMMARY_JS).catch(() => null)
    const lig = ratioLigature(targets.ratio)
    if (!after || !Array.isArray(after.ligatures) || !after.ligatures.includes(lig)) return fail('ratio-not-reflected')
  }
  console.log(`[Flow Settings] ${mode} ${formatSteps(steps)} ok=true`)
  return { ok: true, steps }
}
