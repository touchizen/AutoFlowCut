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
 *   → 비율 → 길이 → 해상도 → 개수 → (영상) 입력방식 검증 → **최종 재판독**(단계 통과만으로 ok 를 내지 않는다) → Escape 로 닫기.
 * M2-2 영상 단계: 해상도는 {360p, 720p} 밖이면 모델과 무관하게 클릭 전 flow-resolution-not-offered(관측된 적 없는 값은 패널이
 *   내밀어도 거부) · 개수는 항상 x1 · 모델 라벨은 토큰 부분열로 맞춘다("Omni Flash" ~ "Omni 1.1 Flash") · 입력방식은 건드리지
 *   않고 chrome_extension(소재) 이 체크됐는지만 본다(input-mode-not-material) · 메뉴 항목 클릭이 하위 메뉴만 열면
 *   (라이브 항목엔 mat-mdc-menu-trigger 가 달려 있다, 내용 미관측) model-submenu-unknown. 영상 step 라벨은 값을 단다
 *   (§4 M2 로그: mode=clicked(videocam) duration=already(6) resolution=already(720p) count=already(x1) model=already input=material).
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
  const unclassified = []   // M2 실기: 분류 못 한 토글 그룹의 UI 라벨(사용자 내용 아님) — group-not-found 진단용
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
    if (!kind) { unclassified.push({ labels: labels.slice(0, 8).map((l) => String(l).slice(0, 24)), ligatures: ligs.slice(0, 8) }); continue }
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
  return { ok: true, panel, groups, model, radioCount: material.length, unclassified }
}

/**
 * 클릭 계획. phase 1 = 모드만, phase 2 = 모델(이미지 검증 / 영상 select 계획) → 비율 → 길이 → 해상도 → 개수(영상은 항상 x1).
 * 이미 맞는 목표는 steps 에 already(비율은 already(<리거처>)), 미정의 목표는 생략. 자기완결.
 * @returns {{ok:boolean, kind?:string, params?:object, reason?:string, clicks:Array, steps?:object, model?:{select:true, requested:string}|null}}
 */
export function planSettingsClicks(scan, targets, phase) {
  const RATIO = { '16:9': 'crop_16_9', '9:16': 'crop_9_16', '4:3': 'crop_landscape', '1:1': 'crop_square', '3:4': 'crop_portrait' }
  const norm = (s) => String(s || '').replace(/[^\p{L}\p{N}.\s-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  // M2-2: 모델 라벨 매칭 — 정규화 부분문자열이거나, 요청 토큰이 패널 토큰의 **부분열**이면 같은 모델("omni flash" ⊂ "omni 1.1 flash";
  //   "veo 3.1 fast" ⊄ "veo 3.1 lite"). 자기완결(settingsDriverCore 에도 같은 사본).
  const labelMatches = (label, want) => {
    const l = norm(label); const w = norm(want)
    if (!w) return false
    if (l.includes(w)) return true
    const toks = (x) => x.split(/\s+/).filter((k) => /[\p{L}\p{N}]/u.test(k))
    const lt = toks(l); const wt = toks(w)
    let i = 0
    for (const k of lt) if (i < wt.length && k === wt[i]) i++
    return wt.length > 0 && i === wt.length
  }
  const t = targets || {}
  const video = t.mode === 'video'
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
    const lig = video ? 'videocam' : 'image'
    const r = want('mode', (o) => o.ligature === lig, 'mode-not-offered:' + (t.mode || 'image'))
    if (r.err) return r.err
    apply('mode', r, video ? lig : null)
    return { ok: true, clicks, steps }
  }
  // M2-2(T7): {360p, 720p} 밖 해상도는 모델과 무관하게 클릭 전 거부 — 패널이 내밀어도(미관측) 받지 않는다.
  if (video && t.resolution !== undefined) {
    const res = String(t.resolution).toLowerCase()
    if (res !== '360p' && res !== '720p') return { ok: false, kind: 'flow-resolution-not-offered', params: { requested: String(t.resolution) }, reason: 'resolution-not-offered:' + t.resolution, clicks: [] }
  }
  if (t.model != null && t.model !== '') {
    if (!scan.model || !scan.model.trigger) return fail('model-trigger-not-found')
    const matches = labelMatches(scan.model.label, t.model)
    if (!video) {
      if (!matches) return { ok: false, kind: 'flow-image-model-mismatch', params: { requested: String(t.model), panel: scan.model.display }, clicks: [] }
      steps.model = 'verified'
    } else if (matches) {
      steps.model = 'already'
    } else {
      // M2-R3 H4(A4): 모델을 바꿔야 하면 클릭 전 계획은 **모델뿐** — 길이·해상도·개수는 현재 모델의 옵션이라 여기서 실패시키면(예: 10초 없는 모델에서 Omni Flash 로)
      //   목표 모델이 제공하는 값을 클릭도 전에 거부한다. 모델 클릭 → 안정 대기 → 재스캔 → 재계획(select 없음)이 나머지 그룹을 검증한다.
      //   {360p,720p} 밖 해상도 게이트(카탈로그 고정)는 위에서 먼저 걸렸다.
      return { ok: true, clicks: [], steps, model: { select: true, requested: String(t.model) } }
    }
  }
  if (t.ratio !== undefined) {
    const lig = RATIO[String(t.ratio)]
    if (!lig) return fail('ratio-not-offered:' + t.ratio)
    const r = want('ratio', (o) => o.ligature === lig, 'ratio-not-offered:' + t.ratio)
    if (r.err) return r.err
    apply('ratio', r, lig)
  }
  if (video && t.duration !== undefined) {
    const digits = String(t.duration).replace(/\D/g, '')
    const r = want('duration', (o) => o.label.replace(/\D/g, '') === digits, 'duration-not-offered:' + t.duration)
    if (r.err) return r.err
    apply('duration', r, digits)
  }
  if (video && t.resolution !== undefined) {
    const res = String(t.resolution).toLowerCase()
    const g = scan.groups.resolution
    if (!g) return fail('group-not-found:resolution')
    const opt = g.options.find((o) => o.label.toLowerCase() === res)
    if (!opt) return { ok: false, kind: 'flow-resolution-not-offered', params: { requested: String(t.resolution) }, reason: 'resolution-not-offered:' + t.resolution, clicks: [] }
    apply('resolution', { g, opt }, res)
  }
  if (video || t.count !== undefined) {
    const label = video ? 'x1' : 'x' + Number(t.count)
    const r = want('count', (o) => o.label.toLowerCase() === label, 'count-not-offered:' + label)
    if (r.err) return r.err
    apply('count', r, video ? label : null)
  }
  // M2-2: 영상 입력방식은 건드리지 않되 소재(chrome_extension) 가 체크돼 있어야 한다 — 프레임(crop_free) 이면 i2v 로 나간다(미지원).
  if (video) {
    const g = scan.groups.inputMode
    if (!g) return fail('group-not-found:inputMode')
    if (!g.checked || g.checked.ligature !== 'chrome_extension') return fail('input-mode-not-material')
    steps.input = 'material'
  }
  return { ok: true, clicks, steps, model: null }
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
  const waitFor = async (pred, ms) => {
    const n = Math.max(1, Math.ceil(ms / 50))
    for (let i = 0; i < n; i++) { if (pred()) return true; await sleep(50) }
    return pred()
  }
  // 패널 닫기 — CDK 오버레이는 **document.body 의 keydown 을 keyCode===27** 로 판정한다(R1#3; 2026-09-24 실기: document 에
  //   key:'Escape' 만 보낸 옛 코드는 못 닫았고 트리거 재클릭이 닫았다). 초기화 사전이 keyCode/which 를 무시하는 엔진을
  //   위해 값을 직접 박는다. 안 닫히면 closed:false — main 이 트리거를 trusted 재클릭한다.
  //   M2-2/M2-R1 F6(A6/B6): 모델 메뉴·하위 메뉴가 패널 위에 겹쳐 있을 수 있다(CDK 오버레이 **스택** — Escape 하나는 맨 위 하나만 닫는다).
  //   "닫힘" = 패널 라디오 소멸 **그리고** 열린 [role=menu] 없음. 그때까지 Escape 를 더 보낸다(최대 3 = 하위 메뉴·메뉴·패널, 보낼 때마다
  //   재스캔). 패널만 닫히고 메뉴가 남으면 false — 열린 메뉴가 다음 생성의 트리거 hit-test 를 막으므로 main 이 트리거를 trusted 재클릭한다.
  const closedNow = () => !scan(doc).ok && !doc.querySelector('[role="menu"]')
  const overlayDepth = () => (scan(doc).ok ? 1 : 0) + doc.querySelectorAll('[role="menu"]').length
  const closePanel = async () => {
    for (let n = 0; n < 3; n++) {
      const before = overlayDepth()   // Escape 를 보내기 **전**의 깊이(동기 핸들러가 즉시 닫아도 변화를 본다)
      try {
        const win = doc.defaultView
        const KE = win && win.KeyboardEvent ? win.KeyboardEvent : KeyboardEvent
        const ev = new KE('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true })
        for (const k of ['keyCode', 'which']) {
          if (ev[k] !== 27) { try { Object.defineProperty(ev, k, { value: 27, configurable: true }) } catch (_e) { /* 읽기 전용 — 그대로 보낸다 */ } }
        }
        ;(doc.body || doc).dispatchEvent(ev)
      } catch (_e) { return false }
      const changed = await waitFor(() => closedNow() || overlayDepth() < before, 1500)
      if (closedNow()) return true
      if (!changed) return false   // 이 Escape 가 아무것도 안 닫았다 — 더 보내도 소용없다(main 의 트리거 재클릭이 맡는다)
    }
    return false
  }
  // 실패 결과 — needs-trusted(main 이 그 라디오를 trusted 클릭한 뒤 다시 돈다) 만 패널을 열어 두고, 나머지는 닫고 나온다.
  const fail = async (reason, extra, keepOpen) => {
    const r = Object.assign({ ok: false, kind: 'flow-settings-not-applied', reason, steps }, extra || {})
    if (!keepOpen) r.closed = await closePanel()
    return r
  }
  // M2 실기: group-not-found 는 분류 못 한 그룹의 라벨을 shape 로 싣는다(Veo 패널 모양 진단).
  const shapeOf = (p) => (String(p.reason || '').indexOf('group-not-found:') === 0 && s && s.ok ? { shape: { groups: Object.keys(s.groups || {}), unclassified: s.unclassified || [] } } : {})
  const failPlan = async (p) => Object.assign(await fail(p.reason || p.kind), { kind: p.kind || 'flow-settings-not-applied' }, shapeOf(p), p.params ? { params: p.params } : {})
  const norm = (s) => String(s || '').replace(/[^\p{L}\p{N}.\s-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  // M2-2: planSettingsClicks 의 labelMatches 와 같은 규칙(자기완결 — 이름으로 부르지 않는다).
  const labelMatches = (label, want) => {
    const l = norm(label); const w = norm(want)
    if (!w) return false
    if (l.includes(w)) return true
    const toks = (x) => x.split(/\s+/).filter((k) => /[\p{L}\p{N}]/u.test(k))
    const lt = toks(l); const wt = toks(w)
    let i = 0
    for (const k of lt) if (i < wt.length && k === wt[i]) i++
    return wt.length > 0 && i === wt.length
  }
  const ICON_SEL = "mat-icon, i, span[class*='symbols'], [class*='google-symbols']"
  // M2-R4 I7(B5): 모델 클릭 뒤 길이/해상도/개수 그룹은 라이브 Angular 가 **나중에** 다시 그릴 수 있다 — 고정 sleep(150) 은 그보다 늦은 재렌더를 놓쳐 옛 모델의 옵션으로 다시
  //   계획한다(H4 가 고치려던 그 경우). "연속 두 스캔이 같다" 만으로는 교체 **전** DOM 도 50ms 만에 같다고 통과하므로, 클릭 전 서명에서 **벗어난 뒤** 연속 두 스캔이 같을 때까지
  //   기다린다(≤1.5s — 그룹이 정말 같은 모델 전환은 상한에서 진행). 서명은 세 그룹의 옵션(리거처·라벨·체크)이다. 자기완결.
  // M2-R5 J6(A3): 과도 상태는 안정이 아니다 — 라이브 Angular 는 새 모델의 옵션을 불러오는 동안 그룹을 잠깐 뗐다가 다시 붙일 수 있는데, 실패한 스캔·그룹 없는 스캔의
  //   자리표시('scan-failed'·'-')를 서명으로 세면 그 상태가 "서명 이탈 + 연속 동일" 을 만족해 ~100ms 뒤 재계획이 group-not-found:duration 으로 실패했다. 이제 서명은 스캔이
  //   성공했고 세 그룹이 전부 있을 때만(아니면 null) 있고, 서명 이탈 뒤 **연속 3회 동일**(≈150ms)에 안정으로 본다. 상한 1.5s 는 그대로.
  const groupSig = (n) => {
    if (!n || !n.ok) return null
    const kinds = ['duration', 'resolution', 'count']
    if (!kinds.every((k) => !!n.groups[k])) return null
    return kinds.map((k) => n.groups[k].options.map((o) => (o.ligature || '') + '|' + o.label + '|' + (o.checked ? 1 : 0)).join(',')).join(';')
  }
  const waitGroupsSettled = async (preSig) => {
    let prev = null
    let same = 0   // 직전 스캔과 같은 서명이 이어진 횟수(서명 없는 스캔은 0 으로 되돌린다)
    for (let i = 0; i < 30; i++) {
      const cur = groupSig(scan(doc))
      same = cur != null && cur === prev ? same + 1 : 0
      if (cur != null && cur !== preSig && same >= 2) return   // 연속 3회 동일(현재 + 직전 2회)
      prev = cur
      await sleep(50)
    }
  }

  // M2 실기(2026-09-25, 2차 런): 트리거 클릭 직후 즉시 한 번 스캔하면 패널 애니메이션이 끝나기 전이라 panel-not-open 으로 닫혔다
  //   (이미지 런은 타이밍 운으로 통과). 패널이 스캔 가능해질 때까지 유계 대기(≤3s) 뒤 판정.
  await waitFor(() => scan(doc).ok, 3000)
  // M2 실기(3·4번째 런): 같은 페이지의 두 번째 생성부터 트리거 클릭 한 번이 헛돈다(Escape 로 닫은 뒤 Flow 의 열림 상태가 안 풀려
  //   다음 클릭이 닫기로 소비된다). 여전히 패널이 없으면 트리거를 한 번 더 누르고 다시 기다린다.
  if (!scan(doc).ok) {
    const trig = Array.from(doc.querySelectorAll('button.settings-trigger-button')).filter((b) => !!b.querySelector('.settings-summary'))
    if (trig.length === 1) {
      try { console.log('[Flow Inject] settings panel not open — clicking the trigger once more') } catch (_e) { /* 로그 실패 무시 */ }
      trig[0].click()
      await waitFor(() => scan(doc).ok, 3000)
    }
  }
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
    if (!reflected) return fail('needs-trusted', { needsTrusted: [{ group: 'mode', name: c.name, label: c.label, ligature: c.ligature }] }, true)
    await sleep(100)
    s = scan(doc)
    if (!s.ok) return fail(s.reason)
  }
  // phase 2 — 모델 먼저
  let p2 = plan(s, t, 2)
  if (!p2.ok) return failPlan(p2)
  let modelClicked = false
  if (p2.model && p2.model.select) {
    const preSig = groupSig(s)   // M2-R4 I7: 클릭 전 그룹 서명
    const trigger = s.model.trigger
    trigger.click()
    const opened = await waitFor(() => trigger.getAttribute('aria-expanded') === 'true' && !!trigger.getAttribute('aria-controls') && !!doc.getElementById(trigger.getAttribute('aria-controls')), 3000)
    if (!opened) return fail('model-menu-not-open')
    const menu = doc.getElementById(trigger.getAttribute('aria-controls'))
    const wantLabel = p2.model.requested
    const item = Array.from(menu.querySelectorAll('[role="menuitem"]')).find((el) => {
      const clone = el.cloneNode(true)
      Array.from(clone.querySelectorAll(ICON_SEL)).forEach((i) => i.remove())
      return labelMatches(clone.textContent, wantLabel)
    })
    if (!item) { try { trigger.click() } catch (_e) { /* 메뉴 닫기 실패는 무시 */ } return fail('model-not-offered') }
    item.click()
    const applied = await waitFor(() => { const n = scan(doc); return n.ok && !!n.model && !!n.model.label && labelMatches(n.model.label, wantLabel) && !n.model.expanded }, 3000)
    if (!applied) {
      // M2-2: 항목이 하위 메뉴만 열었다(항목 aria-expanded=true 또는 두 번째 role=menu) — 내용 미관측이라 더 가지 않는다.
      //   fail() 의 Escape(최대 3번) 가 하위 메뉴·메뉴·패널을 차례로 닫는다.
      const submenu = item.getAttribute('aria-expanded') === 'true' || doc.querySelectorAll('[role="menu"]').length > 1
      return fail(submenu ? 'model-submenu-unknown' : 'model-not-reflected')
    }
    modelClicked = true
    steps.model = 'clicked'   // M2-R4 I7: 클릭 뒤 거부(재계획 실패)도 모델 전환을 steps·로그에 보고한다(§12.2 무과금 프로브의 통과 조건)
    await waitGroupsSettled(preSig)   // M2-R4 I7: 안정 대기 — 모델 변경이 길이/해상도/개수 그룹을 리셋·교체할 수 있다(고정 150ms 아님)
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
  if (needsTrusted.length) return fail('needs-trusted', { needsTrusted }, true)
  // 최종 재판독 — 뒤의 클릭이 앞 그룹을 되돌렸을 수 있다
  await sleep(100)
  s = scan(doc)
  if (!s.ok) return fail(s.reason)
  const v = plan(s, t, 2)
  if (!v.ok) return failPlan(v)
  if (v.model && v.model.select) return fail('not-checked:model')
  if (v.clicks.length) return fail('not-checked:' + v.clicks[0].group)
  // 닫기 — body 의 Escape(keyCode 27). 안 닫히면 main 이 트리거를 다시 trusted 클릭한다.
  const closed = await closePanel()
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

const STEP_ORDER = ['mode', 'ratio', 'duration', 'resolution', 'count', 'model', 'input']
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
  const runDriver = () => exec(SETTINGS_DRIVER_JS(targets)).catch(() => ({ ok: false, reason: 'driver-threw', steps: {}, closed: false }))
  // 실패로 돌아왔는데 패널이 열려 있으면(Escape 무효·needs-trusted 뒤 실패) 트리거를 trusted 재클릭해 닫는다 — 열어 두면
  //   다음 생성의 클릭이 오버레이에 막힌다. 실패 kind 는 그대로(R1#3).
  const closeLeftOpen = () => deps.trustedClickOnFlowView(FIND_SETTINGS_TRIGGER_JS, { required: false, step: 'settings-trigger-close' })
  let r = await runDriver()
  if (r && Array.isArray(r.needsTrusted) && r.needsTrusted.length) {
    const firstSteps = r.steps || {}
    for (const n of r.needsTrusted) {
      const c = await deps.trustedClickOnFlowView(FIND_RADIO_JS(n.name, n.ligature || n.label), { required: true, step: 'settings-radio' })
      if (!c || !c.success) { steps = r.steps || {}; await closeLeftOpen(); return fail('settings-radio-click-failed:' + n.group) }
    }
    r = await runDriver()
    // M2-R5 J5(B4): 첫 실행이 모델을 바꿨으면(model=clicked) 재실행은 이미 바뀐 모델을 already 로 본다 — 병합 steps·[Flow Settings] 로그는 첫 실행의 전환을 지킨다
    //   (§12.2 무과금 프로브의 통과 조건 steps.model==='clicked'; I7 은 클릭 뒤 거부 경로만 지켰다).
    // M2-R6 K4(A4): already 만이 아니다 — 재실행이 clicked 를 보고하지 않는 모든 경우(already · phase 2 전 실패로 steps.model 없음 · needs-trusted 재발(R2-2#3))에
    //   첫 실행의 clicked 를 지킨다. 모델 전환은 첫 실행이 실제로 한 일이라 재실행이 어떻게 끝나든 steps·ok=false 로그에 남아야 한다.
    if (firstSteps.model === 'clicked' && r && (!r.steps || r.steps.model !== 'clicked')) r = { ...r, steps: { ...(r.steps || {}), model: 'clicked' } }
    // R2-2#3: trusted 클릭 뒤 재실행도 needs-trusted(모드 라디오 재렌더 → 다른 라디오도 합성 클릭 무시) — needs-trusted 는
    //   패널을 일부러 열어 두고(closed 없음) 나오므로 여기서 닫고 실패한다. 한 번 더 돌리지 않는다(무한 루프 방지).
    if (r && Array.isArray(r.needsTrusted) && r.needsTrusted.length) {
      steps = r.steps || {}
      await closeLeftOpen()
      return fail('needs-trusted:' + r.needsTrusted[0].group)
    }
  }
  steps = (r && r.steps) || {}
  if (!r || !r.ok) {
    // closed:true 가 아니면(false 또는 없음) 열려 있다고 보고 닫는다(R2-2#3).
    if (!r || r.closed !== true) await closeLeftOpen()
    const kind = r?.kind || 'flow-settings-not-applied'
    const reason = r?.reason || kind
    console.warn(`[Flow Settings] ${mode} ${formatSteps(steps)} ok=false reason=${reason}`)
    return Object.assign({ ok: false, kind, reason, steps }, r?.params ? { params: r.params } : {}, r?.shape ? { shape: r.shape } : {})
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
