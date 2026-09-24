// @vitest-environment jsdom
//
// M1-8 — 설정 패널 드라이버. 패널 픽스처는 D 덤프(2026-09-24 image/video-panel-open) 재구성 + 카드 more_vert
// (aria-haspopup=menu) 7개와 프로젝트 메뉴 버튼을 **앞에** 둔다 — 모델 트리거는 패널 스코프 안에서만.
//   locatePanel = 라디오의 최소 공통 조상 · 그룹은 자동 번호 name 으로만 묶고 내용(리거처·텍스트)으로 분류(번호 매칭 금지)
//   phase1 모드 → 재스캔 → phase2: 모델 → (변경 시 안정 대기·재스캔·재계획) → 비율 → 길이 → 해상도 → 개수 → 최종 재판독
//   이미지 모델은 검증만(불일치 → flow-image-model-mismatch {requested, panel}, 비율·개수 클릭 없음).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  scanSettingsPanel, planSettingsClicks, ratioLigature, runSettingsDriver, SETTINGS_DRIVER_JS, SETTINGS_PANEL_OPEN_JS,
  FIND_RADIO_JS, applyComposerSettings,
} from '../../electron/flow-composer-settings.js'
import {
  CARD_MENU_BUTTONS, PROJECT_MENU_BUTTON, IMAGE_COMPOSER_KO, VIDEO_COMPOSER_KO, buildSettingsPanel,
} from '../fixtures/flow-live-dom-20260924.js'
import { installFakeAngular, disposeFakeAngular } from '../helpers/fakeFlowAngular.js'

const ONE_CARD = CARD_MENU_BUTTONS.slice(0, CARD_MENU_BUTTONS.indexOf('</div>') + '</div>'.length)
const CARDS7 = ONE_CARD.repeat(7)
const HEAD = PROJECT_MENU_BUTTON + CARDS7
const run = (expr) => window.eval(expr)
const noSleep = { sleep: async () => {} }

function mount(html) { document.body.innerHTML = html; return document }
const imagePage = (o = {}) => HEAD + IMAGE_COMPOSER_KO + buildSettingsPanel({ mode: 'image', ...o })
const videoPage = (o = {}) => HEAD + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video', ...o })

// 가짜 Angular 는 tests/helpers/fakeFlowAngular.js(공용 — minified 드라이버 테스트도 같은 것을 쓴다).

beforeEach(() => { document.body.innerHTML = ''; disposeFakeAngular() })

describe('scanSettingsPanel — 라디오 최소 공통 조상 + 내용 분류', () => {
  it('이미지 패널: mode/ratio/count 그룹, 스코프 안 모델 트리거만(카드·프로젝트 메뉴 버튼 제외)', () => {
    const doc = mount(imagePage())
    const s = scanSettingsPanel(doc)
    expect(s.ok).toBe(true)
    expect(Object.keys(s.groups).sort()).toEqual(['count', 'mode', 'ratio'])
    expect(s.groups.ratio.options.map((o) => o.ligature)).toEqual(['crop_16_9', 'crop_landscape', 'crop_square', 'crop_portrait', 'crop_9_16'])
    expect(s.groups.ratio.checked.ligature).toBe('crop_16_9')
    expect(s.groups.count.options.map((o) => o.label)).toEqual(['x1', 'x2', 'x3', 'x4'])
    expect(s.groups.mode.checked.ligature).toBe('image')
    expect(s.model).toMatchObject({ label: 'nano banana 2', display: 'Nano Banana 2' })
    expect(s.panel.contains(doc.querySelector('.more-options-button'))).toBe(false)
    expect(doc.querySelectorAll('button[aria-haspopup="menu"]').length).toBe(9)
    expect(s.panel.querySelectorAll('button[aria-haspopup="menu"]').length).toBe(1)
  })

  it('id/name 을 통째로 옮긴 셔플 사본도 같은 결과(번호로 매칭하지 않는다)', () => {
    const a = scanSettingsPanel(mount(imagePage()))
    const b = scanSettingsPanel(mount(imagePage({ offset: 500 })))
    const strip = (s) => ({ groups: Object.fromEntries(Object.entries(s.groups).map(([k, g]) => [k, { options: g.options.map((o) => [o.ligature, o.label]), checked: g.checked.label }])), model: s.model.label })
    expect(strip(b)).toEqual(strip(a))
  })

  it('영상 패널: inputMode/resolution/duration 도 분류, 모델 omni 1.1 flash', () => {
    const s = scanSettingsPanel(mount(videoPage()))
    expect(Object.keys(s.groups).sort()).toEqual(['count', 'duration', 'inputMode', 'mode', 'ratio', 'resolution'])
    expect(s.groups.resolution.options.map((o) => o.label)).toEqual(['360p', '720p'])
    expect(s.groups.duration.options.map((o) => o.label)).toEqual(['4초', '6초', '8초', '10초'])
    expect(s.groups.duration.checked.label).toBe('6초')
    expect(s.groups.inputMode.checked.ligature).toBe('chrome_extension')
    expect(s.model).toMatchObject({ label: 'omni 1.1 flash', display: 'Omni 1.1 Flash' })
  })

  it('패널이 안 열렸으면 panel-not-open, Material 이 아닌 라디오면 input-mode-not-material', () => {
    expect(scanSettingsPanel(mount(HEAD + IMAGE_COMPOSER_KO))).toEqual({ ok: false, reason: 'panel-not-open' })
    expect(run(SETTINGS_PANEL_OPEN_JS)).toBe(false)
    expect(scanSettingsPanel(mount(imagePage({ material: false })))).toEqual({ ok: false, reason: 'input-mode-not-material' })
    mount(imagePage())
    expect(run(SETTINGS_PANEL_OPEN_JS)).toBe(true)
  })
})

describe('planSettingsClicks', () => {
  it('ratioLigature 표', () => {
    expect(['16:9', '9:16', '4:3', '1:1', '3:4'].map(ratioLigature)).toEqual(['crop_16_9', 'crop_9_16', 'crop_landscape', 'crop_square', 'crop_portrait'])
    expect(ratioLigature('21:9')).toBeNull()
  })

  it('phase1: 이미지 패널에서 mode:video → videocam 클릭 계획; 이미 그 모드면 already', () => {
    const s = scanSettingsPanel(mount(imagePage()))
    expect(planSettingsClicks(s, { mode: 'video' }, 1)).toMatchObject({ ok: true, clicks: [{ group: 'mode', ligature: 'videocam' }] })
    expect(planSettingsClicks(s, { mode: 'image' }, 1)).toEqual({ ok: true, clicks: [], steps: { mode: 'already' } })
  })

  it('phase2 이미지: 모델 검증 먼저 — 불일치면 flow-image-model-mismatch {requested, panel} 이고 비율·개수 클릭 없음', () => {
    const s = scanSettingsPanel(mount(imagePage()))
    const p = planSettingsClicks(s, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana Pro' }, 2)
    expect(p).toEqual({ ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }, clicks: [] })
  })

  it('phase2 이미지 일치: model verified, ratio crop_9_16 클릭, count x2 클릭; 미정의 목표는 생략', () => {
    const s = scanSettingsPanel(mount(imagePage()))
    const p = planSettingsClicks(s, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana 2' }, 2)
    expect(p.ok).toBe(true)
    expect(p.steps.model).toBe('verified')
    expect(p.clicks.map((c) => `${c.group}:${c.ligature || c.label}`)).toEqual(['ratio:crop_9_16', 'count:x2'])
    const q = planSettingsClicks(s, { mode: 'image', ratio: '16:9' }, 2)
    expect(q).toMatchObject({ ok: true, clicks: [], steps: { ratio: 'already(crop_16_9)' } })
    expect(q.steps.count).toBeUndefined()
    expect(q.steps.model).toBeUndefined()
  })

  it('실패 사유: ratio-not-offered:21:9 · group-not-found:ratio', () => {
    const s = scanSettingsPanel(mount(imagePage()))
    expect(planSettingsClicks(s, { mode: 'image', ratio: '21:9' }, 2)).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'ratio-not-offered:21:9' })
    const noRatio = { ...s, groups: { mode: s.groups.mode, count: s.groups.count } }
    expect(planSettingsClicks(noRatio, { mode: 'image', ratio: '16:9' }, 2)).toMatchObject({ ok: false, reason: 'group-not-found:ratio' })
  })

  it('phase2 영상: count 는 항상 x1(미정의·3 모두), 모델 같으면 already 로 나머지 계획; 모델 다르면 select 계획 **만**(길이·해상도·개수는 클릭 뒤 재계획 — M2-R3 H4)', () => {
    const s = scanSettingsPanel(mount(videoPage({ checked: { count: 'x2' } })))
    for (const count of [undefined, 3]) {
      const p = planSettingsClicks(s, { mode: 'video', count, ratio: '16:9', duration: 8, resolution: '720p', model: 'Omni 1.1 Flash' }, 2)
      expect(p.ok).toBe(true)
      expect(p.model).toBeNull()
      expect(p.clicks.map((c) => `${c.group}:${c.ligature || c.label}`)).toEqual(['duration:8초', 'count:x1'])
      // M2-2: 영상 단계는 값을 라벨로 단다(§4 M2 로그: resolution=already(720p) count=…(x1) duration=…(8))
      expect(p.steps).toMatchObject({ model: 'already', ratio: 'already(crop_16_9)', resolution: 'already(720p)', duration: 'clicked(8)', count: 'clicked(x1)' })
    }
    // M2-R3 H4(A4): 모델을 바꿔야 하면 클릭 전 계획은 모델뿐 — 현재 모델의 길이/해상도/개수로 실패시키지 않는다(목표 모델이 제공할 수 있다).
    const q = planSettingsClicks(s, { mode: 'video', count: 3, ratio: '16:9', duration: 8, resolution: '720p', model: 'Veo 3.1 - Fast' }, 2)
    expect(q).toEqual({ ok: true, clicks: [], steps: {}, model: { select: true, requested: 'Veo 3.1 - Fast' } })
    // M2-2: 영상 모델이 트리거와 맞으면 already(이미지의 verified 와 구분 — §4 M2 로그 model=already)
    expect(planSettingsClicks(s, { mode: 'video', model: 'Omni 1.1 Flash' }, 2)).toMatchObject({ ok: true, steps: { model: 'already' } })
  })
})

describe('runSettingsDriver — 페이지 안에서 한 번에(가짜 Angular)', () => {
  it('이미지: mode already → model verified → ratio/count 클릭 → 최종 재판독 ok, Escape 로 닫힘', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc)
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana 2' }, noSleep)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { mode: 'already', model: 'verified', ratio: 'clicked(crop_9_16)', count: 'clicked' } })
    // R1#3: Escape 는 body 의 keydown 으로, keyCode/which 27 을 싣는다(CDK 오버레이의 판정 조건).
    expect(log).toEqual(['ratio:crop_9_16', 'count:x2', 'keydown:Escape:27'])
    expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
  })

  it('이미지 모델 불일치 → 클릭 0회, kind/params 전달', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc)
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana Pro' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }, closed: true })
    // R1#3: 실패 경로도 패널을 닫고 나온다(열어 둔 채 돌아오면 다음 클릭이 오버레이에 막힌다).
    expect(log).toEqual(['keydown:Escape:27'])
    expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
  })

  it('(a) 동기 리셋: 모드 전환 → 재스캔 → 모델 메뉴 선택 → duration 이 되돌아가 모델 뒤에 다시 클릭 → ok', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, { modelReset: 'sync' })
    const r = await runSettingsDriver(doc, { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', count: 1, model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r.ok).toBe(true)
    expect(r.steps).toMatchObject({ mode: 'clicked(videocam)', model: 'clicked', ratio: 'already(crop_16_9)', duration: 'clicked(8)', resolution: 'already(720p)', count: 'already(x1)', input: 'material' })
    expect(log).toEqual(['mode:videocam', 'model-trigger', 'model:veo 3.1 - fast', 'duration:8초', 'keydown:Escape:27'])
    const s = scanSettingsPanel(doc)
    expect(s.ok).toBe(false)   // 닫혔다
  })

  it('(b) 지연 리셋: count 클릭이 duration 을 되돌린다 → 최종 재판독 not-checked:duration (단계 통과만으로 ok 를 내지 않는다)', async () => {
    const doc = mount(videoPage({ checked: { count: 'x2' } }))
    installFakeAngular(doc, { modelReset: 'on-count' })
    const r = await runSettingsDriver(doc, { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', count: 1, model: 'Omni 1.1 Flash' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'not-checked:duration', closed: true })
    expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
  })

  it('needs-trusted 는 패널을 열어 둔다 — main 이 그 라디오를 trusted 클릭한 뒤 드라이버를 다시 돌린다', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, { ignoreClicks: ['ratio'] })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '9:16', model: 'Nano Banana 2' }, noSleep)
    expect(r.ok).toBe(false)
    expect(r.needsTrusted).toHaveLength(1)
    expect(r.closed).toBeUndefined()
    expect(log).not.toContain('keydown:Escape:27')
    expect(doc.querySelector('.cdk-overlay-container')).not.toBeNull()
  })

  it('합성 클릭을 무시하는 라디오 → needsTrusted 목록(name·label)으로 보고', async () => {
    const doc = mount(imagePage())
    installFakeAngular(doc, { ignoreClicks: ['ratio'] })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '9:16', model: 'Nano Banana 2' }, noSleep)
    expect(r.ok).toBe(false)
    expect(r.needsTrusted).toEqual([{ group: 'ratio', name: 'mat-button-toggle-group-27', label: '9:16', ligature: 'crop_9_16' }])
    expect(run(FIND_RADIO_JS('mat-button-toggle-group-27', 'crop_9_16'))).toBe(doc.getElementById('mat-button-toggle-95-button'))
  })

  it('Escape 로 안 닫히면 closed:false (main 이 트리거를 다시 trusted 클릭한다)', async () => {
    const doc = mount(imagePage())
    installFakeAngular(doc, { stickyPanel: true })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '16:9' }, noSleep)
    expect(r).toMatchObject({ ok: true, closed: false })
  })

  it('SETTINGS_DRIVER_JS 는 같은 로직을 페이지 표현식으로(자기완결) — 결과 동일', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc)
    const js = SETTINGS_DRIVER_JS({ mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana 2' })
    const r = await run(js)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { ratio: 'clicked(crop_9_16)', count: 'clicked', model: 'verified' } })
    expect(log).toEqual(['ratio:crop_9_16', 'count:x2', 'keydown:Escape:27'])
    // 선언(function scanSettingsPanel(...)) 말고는 이름 호출이 없다 — minify 가 이름을 뭉개도 안전
    const calls = js.replace(/function (scanSettingsPanel|planSettingsClicks|settingsDriverCore)\(/g, '')
    expect(calls).not.toMatch(/\b(scanSettingsPanel|planSettingsClicks|settingsDriverCore)\(/)
  })
})

describe('applyComposerSettings — main 측(트리거 trusted 클릭 → 드라이버 → 닫힘·요약 검증)', () => {
  let log
  beforeEach(() => { log = vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { log.mockRestore() })

  function harness({ driver, summaryAfter = { text: '🍌 Nano Banana 2 x1', ligatures: ['crop_9_16'] }, panelOpenAfterReclick = false, trusted = true }) {
    const calls = []
    const executeJavaScript = vi.fn(async (script) => {
      const s = String(script)
      if (s.includes('__af_settings_driver__')) { calls.push('driver'); return typeof driver === 'function' ? driver() : driver }
      if (s.includes('settings-summary')) { calls.push('summary'); return summaryAfter }
      if (s.includes('__af_settings_panel_open__')) { calls.push('panel-open'); return panelOpenAfterReclick }
      calls.push('other'); return null
    })
    const trustedClickOnFlowView = vi.fn(async (sel, o) => { calls.push(`trusted:${o?.step}`); return { success: trusted } })
    const flowView = { webContents: { executeJavaScript } }
    return { flowView, deps: { trustedClickOnFlowView }, calls, executeJavaScript, trustedClickOnFlowView }
  }

  it('성공: 트리거 trusted 클릭 1회 → 드라이버 → 요약 리거처 확인 → {ok:true, steps} + 한 줄 로그', async () => {
    const h = harness({ driver: { ok: true, closed: true, steps: { mode: 'already', model: 'verified', ratio: 'clicked(crop_9_16)', count: 'clicked' } } })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana 2' }, h.deps)
    expect(r).toEqual({ ok: true, steps: { mode: 'already', model: 'verified', ratio: 'clicked(crop_9_16)', count: 'clicked' } })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'summary'])
    expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('[Flow Settings] image mode=already ratio=clicked(crop_9_16) count=clicked model=verified ok=true')
  })

  it('needsTrusted → 해당 라디오만 trusted 클릭 후 드라이버 재실행', async () => {
    let n = 0
    const h = harness({ driver: () => (++n === 1
      ? { ok: false, needsTrusted: [{ group: 'ratio', name: 'mat-button-toggle-group-27', label: '9:16', ligature: 'crop_9_16' }], steps: {} }
      : { ok: true, closed: true, steps: { mode: 'already', ratio: 'already(crop_9_16)' } }) })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16' }, h.deps)
    expect(r.ok).toBe(true)
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-radio', 'driver', 'summary'])
    expect(String(h.trustedClickOnFlowView.mock.calls[1][0])).toContain('mat-button-toggle-group-27')
  })

  it('kind/params 실패는 그대로 전달(모델 불일치), 요약 재검증 없음', async () => {
    const h = harness({ driver: { ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }, steps: { mode: 'already' }, closed: true } })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16', model: 'Nano Banana Pro' }, h.deps)
    expect(r).toEqual({ ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }, reason: 'flow-image-model-mismatch', steps: { mode: 'already' } })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver'])
  })

  it('실패 결과가 closed:false 면(드라이버의 Escape 가 안 먹음) 트리거를 trusted 재클릭해 닫고 실패 kind 는 그대로 (R1#3)', async () => {
    const h = harness({ driver: { ok: false, kind: 'flow-settings-not-applied', reason: 'not-checked:duration', steps: { mode: 'clicked' }, closed: false } })
    const r = await applyComposerSettings(h.flowView, { mode: 'video', duration: 8 }, h.deps)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'not-checked:duration' })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-trigger-close'])
  })

  it('needsTrusted 의 trusted 클릭이 실패하면 트리거 재클릭으로 패널을 닫고 settings-radio-click-failed', async () => {
    let n = 0
    const h = harness({ driver: () => (++n === 1
      ? { ok: false, needsTrusted: [{ group: 'ratio', name: 'mat-button-toggle-group-27', label: '9:16', ligature: 'crop_9_16' }], steps: {} }
      : { ok: true, closed: true, steps: {} }) })
    h.trustedClickOnFlowView.mockImplementation(async (sel, o) => { h.calls.push(`trusted:${o?.step}`); return { success: o?.step !== 'settings-radio' } })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16' }, h.deps)
    expect(r).toMatchObject({ ok: false, reason: 'settings-radio-click-failed:ratio' })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-radio', 'trusted:settings-trigger-close'])
  })

  it('needsTrusted 가 재실행에서도 needsTrusted 면(모드 라디오 → 재렌더 → 비율 라디오) 패널을 트리거 재클릭으로 닫고 실패 (R2-2#3)', async () => {
    const h = harness({ driver: () => ({ ok: false, needsTrusted: [{ group: 'ratio', name: 'mat-button-toggle-group-27', label: '9:16', ligature: 'crop_9_16' }], steps: { mode: 'clicked' } }) })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16' }, h.deps)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'needs-trusted:ratio' })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-radio', 'driver', 'trusted:settings-trigger-close'])
  })

  // M2-R6 K4(A4): J5 는 재실행의 model=already 만 clicked 로 되돌렸다. R2-2#3 의 "재실행도 needs-trusted"(모드 라디오 재렌더) 와 첫 스캔에서 실패한 재실행은 phase 2 전에
  //   돌아와 steps.model 이 없다 → 병합 steps·[Flow Settings] ok=false 로그가 첫 실행의 모델 전환을 떨궜다(§12.2 무과금 프로브: 모델은 실제로 바뀌었는데 통과도 정의된 실패도 아니다).
  //   첫 실행이 clicked 를 보고했고 재실행이 clicked 를 보고하지 않으면(already·없음·needs-trusted 재발) 언제나 clicked 를 지킨다.
  it('needs-trusted 재실행이 다시 needs-trusted(모드 라디오 재렌더)로 나와 model 을 보고하지 않아도 첫 실행의 model=clicked 를 지킨다 — 병합 steps 와 ok=false 로그 (M2-R6 K4)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let n = 0
      const h = harness({ driver: () => (++n === 1
        ? { ok: false, needsTrusted: [{ group: 'duration', name: 'mat-button-toggle-group-31', label: '8초' }], steps: { mode: 'already(videocam)', model: 'clicked' } }
        : { ok: false, needsTrusted: [{ group: 'mode', name: 'mat-button-toggle-group-29', label: '동영상', ligature: 'videocam' }], steps: { mode: 'already(videocam)' } }) })
      const r = await applyComposerSettings(h.flowView, { mode: 'video', duration: 8, model: 'Veo 3.1 - Fast' }, h.deps)
      expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'needs-trusted:mode', steps: { mode: 'already(videocam)', model: 'clicked' } })
      expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-radio', 'driver', 'trusted:settings-trigger-close'])
      expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('[Flow Settings] video mode=already(videocam) model=clicked ok=false reason=needs-trusted:mode')
    } finally { warn.mockRestore() }
  })

  it('needs-trusted 재실행이 첫 스캔에서 실패해(panel-not-open, steps 비어 있음) 돌아와도 첫 실행의 model=clicked 를 지킨다 (M2-R6 K4)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let n = 0
      const h = harness({ driver: () => (++n === 1
        ? { ok: false, needsTrusted: [{ group: 'duration', name: 'mat-button-toggle-group-31', label: '8초' }], steps: { mode: 'already(videocam)', model: 'clicked' } }
        : { ok: false, kind: 'flow-settings-not-applied', reason: 'panel-not-open', steps: {}, closed: false }) })
      const r = await applyComposerSettings(h.flowView, { mode: 'video', duration: 8, model: 'Veo 3.1 - Fast' }, h.deps)
      expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'panel-not-open', steps: { model: 'clicked' } })
      expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-radio', 'driver', 'trusted:settings-trigger-close'])
      expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('[Flow Settings] video model=clicked ok=false reason=panel-not-open')
    } finally { warn.mockRestore() }
  })

  it('closed:false → 트리거 재클릭 → 아직 열려 있으면 panel-not-closed', async () => {
    const h = harness({ driver: { ok: true, closed: false, steps: { mode: 'already', ratio: 'already(crop_16_9)' } }, panelOpenAfterReclick: true })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '16:9' }, h.deps)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'panel-not-closed' })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-trigger-close', 'panel-open'])
  })

  it('닫힌 요약의 리거처가 요청 비율과 다르면 ratio-not-reflected', async () => {
    const h = harness({ driver: { ok: true, closed: true, steps: { mode: 'already', ratio: 'clicked(crop_9_16)' } }, summaryAfter: { text: 'x1', ligatures: ['crop_16_9'] } })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16' }, h.deps)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'ratio-not-reflected' })
  })

  it('트리거 없음 → settings-trigger-not-found(클릭 없음); 트리거 클릭 실패 → settings-trigger-click-failed', async () => {
    const none = harness({ driver: null, summaryAfter: null })
    expect(await applyComposerSettings(none.flowView, { mode: 'image' }, none.deps)).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'settings-trigger-not-found' })
    expect(none.trustedClickOnFlowView).not.toHaveBeenCalled()
    const bad = harness({ driver: null, trusted: false })
    expect(await applyComposerSettings(bad.flowView, { mode: 'image' }, bad.deps)).toMatchObject({ ok: false, reason: 'settings-trigger-click-failed' })
  })
})

// ─── M2-2 영상 단계 ──────────────────────────────────────────────────────────────────────────────────────────
//   이미지 픽스처에서 {mode:'video', ratio, duration, resolution, model:'Omni Flash'}(count 미지정) → phase1 videocam → 재스캔 →
//   ratio already · duration click(8) · resolution already · count 는 항상 x1(설정+검증) · model already(패널 'Omni 1.1 Flash' ~
//   요청 'Omni Flash') · 입력방식 chrome_extension 검증(input=material). {360p,720p} 밖 해상도는 모델과 무관하게 클릭 전 거부.
//   모델 메뉴는 트리거 클릭 → aria-expanded 대기 → 그때의 aria-controls 로 document.getElementById(픽스처는 닫힌 채 시작).
//   하위 메뉴만 뜨면 Escape 후 model-submenu-unknown, 항목이 없으면 model-not-offered.
describe('M2-2 설정 드라이버 영상 단계', () => {
  const VIDEO_TARGET = { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', model: 'Omni Flash' }
  // 영어 로케일 변형(라벨만 다르다 — 리거처·앞자리 정수 규칙은 같다)
  const englishize = (html) => html.replace(/초</g, 's<').replace(/>이미지</g, '>Image<').replace(/>동영상</g, '>Video<').replace(/>프레임</g, '>Frames<').replace(/>소재</g, '>Ingredients<')

  it('planSettingsClicks 영상: 요청 "Omni Flash" 는 패널 "Omni 1.1 Flash" 와 맞는다 → model already, select 계획 없음', () => {
    const s = scanSettingsPanel(mount(videoPage()))
    const p = planSettingsClicks(s, { mode: 'video', model: 'Omni Flash' }, 2)
    expect(p.ok).toBe(true)
    expect(p.model).toBeNull()
    expect(p.steps.model).toBe('already')
    // 다른 패밀리는 여전히 select 계획(느슨한 매칭이 Veo 를 Omni 로 오인하지 않는다)
    expect(planSettingsClicks(s, { mode: 'video', model: 'Veo 3.1 - Fast' }, 2).model).toEqual({ select: true, requested: 'Veo 3.1 - Fast' })
  })

  it.each([[undefined], [3]])('runSettingsDriver 이미지 픽스처 → 영상 목표(count=%s): mode clicked(videocam) → 재스캔 → duration 만 클릭, count 는 x1, model already, input material', async (count) => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc)
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, count }, noSleep)
    expect(r).toMatchObject({ ok: true, closed: true })
    expect(r.steps).toEqual({ mode: 'clicked(videocam)', ratio: 'already(crop_16_9)', duration: 'clicked(8)', resolution: 'already(720p)', count: 'already(x1)', model: 'already', input: 'material' })
    expect(log).toEqual(['mode:videocam', 'duration:8초', 'keydown:Escape:27'])
  })

  it('ratio 9:16 → crop_9_16 클릭; 잔여 x2 패널 → x1 클릭 후 검증(clicked(x1))', async () => {
    const doc = mount(videoPage({ checked: { count: 'x2' } }))
    const log = installFakeAngular(doc)
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, ratio: '9:16', duration: 6 }, noSleep)
    expect(r).toMatchObject({ ok: true, steps: { mode: 'already(videocam)', ratio: 'clicked(crop_9_16)', duration: 'already(6)', count: 'clicked(x1)', model: 'already', input: 'material' } })
    expect(log).toEqual(['ratio:crop_9_16', 'count:x1', 'keydown:Escape:27'])
  })

  it('영어 변형(Video/Frames/Ingredients/8s) 도 같은 계획·같은 결과', async () => {
    const doc = mount(englishize(HEAD + IMAGE_COMPOSER_KO + buildSettingsPanel({ mode: 'video' })))
    const log = installFakeAngular(doc)
    const r = await runSettingsDriver(doc, VIDEO_TARGET, noSleep)
    expect(r).toMatchObject({ ok: true, steps: { mode: 'already(videocam)', duration: 'clicked(8)', resolution: 'already(720p)', count: 'already(x1)', model: 'already', input: 'material' } })
    expect(log).toEqual(['duration:8s', 'keydown:Escape:27'])
  })

  it('resolution 1080p 는 패널이 1080p 를 내밀어도, 모델이 Veo Fast 여도 클릭 전 flow-resolution-not-offered {requested}', () => {
    const s = scanSettingsPanel(mount(videoPage()))
    // 패널 사본에 1080p 옵션을 끼워 넣는다 — {360p, 720p} 밖은 관측된 적이 없어 패널이 내밀어도 거부한다(T7)
    s.groups.resolution.options.push({ el: s.groups.resolution.options[1].el, name: s.groups.resolution.name, label: '1080p', ligature: null, checked: false })
    const p = planSettingsClicks(s, { ...VIDEO_TARGET, resolution: '1080p', model: 'Veo 3.1 - Fast' }, 2)
    expect(p).toEqual({ ok: false, kind: 'flow-resolution-not-offered', params: { requested: '1080p' }, reason: 'resolution-not-offered:1080p', clicks: [] })
    expect(p.model).toBeUndefined()
  })

  it('runSettingsDriver: resolution 1080p + Veo Fast → 모델 메뉴 클릭 없이 flow-resolution-not-offered 로 닫는다', async () => {
    const doc = mount(videoPage())
    const log = installFakeAngular(doc)
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, resolution: '1080p', model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-resolution-not-offered', params: { requested: '1080p' }, closed: true })
    expect(log).toEqual(['keydown:Escape:27'])
  })

  it('실패 사유: ratio 4:3 → ratio-not-offered:4:3 · duration 5 → duration-not-offered:5 (영상 패널엔 없다)', () => {
    const s = scanSettingsPanel(mount(videoPage()))
    expect(planSettingsClicks(s, { ...VIDEO_TARGET, ratio: '4:3' }, 2)).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'ratio-not-offered:4:3' })
    expect(planSettingsClicks(s, { ...VIDEO_TARGET, duration: 5 }, 2)).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'duration-not-offered:5' })
  })

  it('입력방식이 crop_free(프레임) 로 체크된 사본 → input-mode-not-material(클릭 없음); 그룹이 없으면 group-not-found:inputMode', async () => {
    const doc = mount(videoPage({ checked: { inputMode: 'crop_free' } }))
    const log = installFakeAngular(doc)
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 6 }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'input-mode-not-material', closed: true })
    expect(log).toEqual(['keydown:Escape:27'])
    const s = scanSettingsPanel(mount(videoPage()))
    delete s.groups.inputMode
    expect(planSettingsClicks(s, { ...VIDEO_TARGET, duration: 6 }, 2)).toMatchObject({ ok: false, reason: 'group-not-found:inputMode' })
  })

  // M2-R3 H4(A4): 현재 모델(Omni)의 패널엔 8초가 없고 요청 모델(Veo Fast)은 8초를 제공한다 — 옛 드라이버는 모델 클릭 **전**에 현재 패널로 전체를 계획해 duration-not-offered:8 로
  //   거부했다. 모델을 바꿔야 하면 클릭 전 계획은 모델뿐이고, 클릭 → 안정 대기 → 재스캔 → 재계획이 길이/해상도/개수를 검증한다. {360p,720p} 게이트는 여전히 클릭 전.
  it('현재 모델엔 8초 없음 · 목표 모델(Veo Fast)엔 있음 → 모델 클릭 뒤 재계획으로 duration clicked(8), ok:true; 같은 픽스처 1080p 는 모델 클릭 없이 flow-resolution-not-offered', async () => {
    const doc = mount(videoPage({ durations: ['4초', '6초'] }))
    expect(scanSettingsPanel(doc).groups.duration.options.map((o) => o.label)).toEqual(['4초', '6초'])
    const log = installFakeAngular(doc, { modelSelectDurations: ['4초', '6초', '8초', '10초'] })
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 8, model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r).toMatchObject({ ok: true, closed: true })
    expect(r.steps).toEqual({ mode: 'already(videocam)', model: 'clicked', ratio: 'already(crop_16_9)', duration: 'clicked(8)', resolution: 'already(720p)', count: 'already(x1)', input: 'material' })
    expect(log).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'duration:8초', 'keydown:Escape:27'])
    // 1080p: 카탈로그 고정 게이트가 모델 클릭보다 먼저
    const doc2 = mount(videoPage({ durations: ['4초', '6초'] }))
    const log2 = installFakeAngular(doc2, { modelSelectDurations: ['4초', '6초', '8초', '10초'] })
    const r2 = await runSettingsDriver(doc2, { ...VIDEO_TARGET, duration: 8, resolution: '1080p', model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r2).toMatchObject({ ok: false, kind: 'flow-resolution-not-offered', params: { requested: '1080p' }, closed: true })
    expect(log2).toEqual(['keydown:Escape:27'])
    // 목표 모델도 8초를 안 주면(모델 클릭 뒤 재계획) duration-not-offered:8 — 모델은 이미 바뀐 채
    const doc3 = mount(videoPage({ durations: ['4초', '6초'] }))
    const log3 = installFakeAngular(doc3, { modelSelectDurations: ['4초', '6초'] })
    const r3 = await runSettingsDriver(doc3, { ...VIDEO_TARGET, duration: 8, model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r3).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'duration-not-offered:8', closed: true })
    expect(log3).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'keydown:Escape:27'])
  })

  // M2-R4 I7(B5): (1) 가짜 Angular 는 길이 그룹을 클릭 핸들러 안에서 동기로 갈아끼웠고 프로덕션은 고정 sleep(150) 뒤 재스캔했다 — 라이브 그룹이 그보다 늦게 다시 그려지면 옛 모델의
  //   옵션으로 다시 계획한다(H4 가 고치려던 바로 그 경우인데 어떤 테스트도 못 보였다). 고정 대기 대신 유계 안정 대기(클릭 전 서명에서 벗어난 뒤 연속 두 스캔 동일, ≤1.5s).
  //   (2) steps.model='clicked' 는 클릭 뒤 재계획이 성공해야 붙었다 — 클릭 뒤 거부는 모델 전환을 steps·로그에서 빠뜨려 §12.2 무과금 프로브(통과 조건 steps.model==='clicked')가 통과도 실패도 아니었다.
  it('지연 교체(300ms): 모델 클릭 뒤 길이 그룹이 늦게 갈아끼워져도 안정 대기가 새 그룹을 보고 duration clicked(8), ok:true (duration-not-offered:8 아님)', async () => {
    const doc = mount(videoPage({ durations: ['4초', '6초'] }))
    const log = installFakeAngular(doc, { modelSelectDurations: ['4초', '6초', '8초', '10초'], modelSelectDelayMs: 300 })
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 8, model: 'Veo 3.1 - Fast' })   // 실제 sleep — 지연이 실제 시간이다
    expect(r).toMatchObject({ ok: true, closed: true })
    expect(r.steps).toMatchObject({ model: 'clicked', duration: 'clicked(8)', resolution: 'already(720p)', count: 'already(x1)' })
    expect(log).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'duration:8초', 'keydown:Escape:27'])
  })

  // M2-R5 J6(A3): I7 의 "클릭 전 서명에서 벗어난 뒤 연속 두 스캔 동일" 은 과도 상태도 안정으로 셌다 — 라이브 Angular 가 새 모델의 옵션을 불러오는 동안 길이 그룹을 잠깐 **떼면**
  //   그 "그룹 없음" 스캔(groupSig 의 '-' 자리표시)이 서명 이탈로 잡혀 ~100ms 뒤 재계획이 group-not-found:duration 으로 실패했다(클릭 전이라 과금은 없지만 §12.2 프로브·실기 모델 전환이 깨진다).
  //   이제 스캔은 성공했고 세 그룹(duration/resolution/count)이 전부 있어야만 서명이 있고, 서명 이탈 뒤 연속 3회 동일(≈150ms)에 안정으로 본다(≤1.5s).
  it('두 단계 재렌더(길이 그룹 제거 → 300ms 뒤 새 옵션으로 재추가): 그룹 없는 스캔은 안정으로 세지 않아 group-not-found 없이 duration clicked(8), ok:true (M2-R5 J6)', async () => {
    const doc = mount(videoPage({ durations: ['4초', '6초'] }))
    const log = installFakeAngular(doc, { modelSelectDurations: ['4초', '6초', '8초', '10초'], modelSelectTwoStepMs: 300 })
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 8, model: 'Veo 3.1 - Fast' })   // 실제 sleep — 제거·재추가가 실제 시간이다
    expect(String(r.reason || '')).not.toMatch(/group-not-found/)   // 성공이면 reason 이 없다
    expect(r).toMatchObject({ ok: true, closed: true })
    expect(r.steps).toMatchObject({ model: 'clicked', duration: 'clicked(8)', resolution: 'already(720p)', count: 'already(x1)' })
    expect(log).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'duration:8초', 'keydown:Escape:27'])
  })

  // 연속 3회 규칙의 핀 — 결정적 시계(deps.sleep 이 가짜 타이머를 전진; waitFor·안정 대기 전부 그 sleep 을 쓴다): 제거(0ms) → 중간 옵션 ['4초'](300ms) → 최종(400ms).
  //   스캔은 50ms 간격이라 중간 상태는 2회(300·350)만 보인다 — 첫 이탈 스캔(300)이나 연속 2회(350)에서 멈추면 ['4초'] 로 계획해 duration-not-offered:8; 3회(500)면 최종 옵션.
  it('세 단계(제거 → 300ms 중간 옵션 → 400ms 최종 옵션): 연속 3회 미만의 중간 상태는 안정이 아니다 → 최종 옵션으로 duration clicked(8), ok:true (M2-R5 J6)', async () => {
    vi.useFakeTimers()
    try {
      const doc = mount(videoPage({ durations: ['4초', '6초'] }))
      const log = installFakeAngular(doc, { modelSelectDurations: ['4초', '6초', '8초', '10초'], modelSelectTwoStepMs: 400, modelSelectInterim: { durations: ['4초'], atMs: 300 } })
      const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 8, model: 'Veo 3.1 - Fast' }, { sleep: (ms) => vi.advanceTimersByTimeAsync(ms) })
      expect(String(r.reason || '')).not.toMatch(/duration-not-offered|group-not-found/)
      expect(r).toMatchObject({ ok: true, closed: true })
      expect(r.steps).toMatchObject({ model: 'clicked', duration: 'clicked(8)' })
      expect(log).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'duration:8초', 'keydown:Escape:27'])
    } finally { vi.useRealTimers() }
  })

  it('클릭 뒤 거부(목표 모델에도 8초 없음 → duration-not-offered:8)도 steps.model:clicked 를 보고한다 — 모델은 이미 바뀌었다', async () => {
    const doc = mount(videoPage({ durations: ['4초', '6초'] }))
    const log = installFakeAngular(doc, { modelSelectDurations: ['4초', '6초'] })
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 8, model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'duration-not-offered:8', closed: true })
    expect(r.steps).toMatchObject({ mode: 'already(videocam)', model: 'clicked' })
    expect(log).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'keydown:Escape:27'])
  })

  it('모델 메뉴: 닫힌 트리거(aria-controls 없음) 클릭 → aria-expanded 대기 → aria-controls 로 메뉴 → 항목 클릭 → clicked; 메뉴에 없으면 model-not-offered', async () => {
    const doc = mount(videoPage())
    expect(doc.querySelector('.flow-settings-panel button[aria-haspopup="menu"]').hasAttribute('aria-controls')).toBe(false)
    const log = installFakeAngular(doc)
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 6, model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r).toMatchObject({ ok: true, steps: { model: 'clicked', mode: 'already(videocam)', input: 'material' } })
    expect(log).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'keydown:Escape:27'])
    // 항목 없음
    const doc2 = mount(videoPage())
    installFakeAngular(doc2, { modelMenuItems: ['Omni 1.1 Flash', 'Veo 3.1 - Lite'] })
    const r2 = await runSettingsDriver(doc2, { ...VIDEO_TARGET, duration: 6, model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r2).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'model-not-offered' })
  })

  // M2-R1 F6(A6/B6): 오버레이는 스택(패널·메뉴·하위 메뉴) — Escape 하나는 맨 위만 닫는다. "닫힘" = 라디오 소멸 **그리고** [role=menu] 없음이라
  //   하위 메뉴 케이스는 Escape 3번(재스캔마다)이고, 패널만 닫히고 메뉴가 남으면 closed:false 로 돌아가 main 이 트리거를 trusted 재클릭한다.
  it('항목 클릭이 하위 메뉴만 열면(트리거 라벨 불변·두 번째 role=menu) Escape ×3(하위 메뉴→메뉴→패널) 후 model-submenu-unknown, closed:true', async () => {
    const doc = mount(videoPage())
    const log = installFakeAngular(doc, { modelSubmenu: true })
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 6, model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'model-submenu-unknown', closed: true })
    expect(log).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'keydown:Escape:27', 'keydown:Escape:27', 'keydown:Escape:27'])
    expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
  })

  it('패널은 닫혔는데 메뉴가 남으면(Escape 가 메뉴를 못 닫음) closed:false — 열린 메뉴는 "닫힘"이 아니다; 효과 없는 Escape 뒤엔 더 보내지 않는다', async () => {
    const doc = mount(videoPage())
    const log = installFakeAngular(doc, { modelSubmenu: true, escapeLeavesMenus: true })
    const r = await runSettingsDriver(doc, { ...VIDEO_TARGET, duration: 6, model: 'Veo 3.1 - Fast' }, noSleep)
    expect(r).toMatchObject({ ok: false, reason: 'model-submenu-unknown', closed: false })
    expect(log.filter((x) => x.startsWith('keydown:')).length).toBe(2)   // 1: 패널 닫힘(메뉴 남음) · 2: 변화 없음 → 중단
    expect(scanSettingsPanel(doc).ok).toBe(false)                 // 패널(라디오)은 사라졌지만
    expect(doc.querySelectorAll('[role="menu"]').length).toBe(2)   // 메뉴·하위 메뉴가 남아 있다
  })

  it('applyComposerSettings(main) + 실제 드라이버: 패널만 닫히고 메뉴가 남으면 closed:false → 트리거 trusted 재클릭(settings-trigger-close)', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const doc = mount(videoPage())
      installFakeAngular(doc, { modelSubmenu: true, escapeLeavesMenus: true })
      const calls = []
      const flowView = { webContents: { executeJavaScript: vi.fn(async (js) => window.eval(js)) } }
      const trustedClickOnFlowView = vi.fn(async (_sel, o) => { calls.push(`trusted:${o?.step}`); return { success: true } })
      const p = applyComposerSettings(flowView, { ...VIDEO_TARGET, duration: 6, model: 'Veo 3.1 - Fast' }, { trustedClickOnFlowView })
      let r
      p.then((v) => { r = v })
      for (let t = 0; t < 30000 && r === undefined; t += 100) await vi.advanceTimersByTimeAsync(100)
      expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'model-submenu-unknown' })
      expect(calls).toEqual(['trusted:settings-trigger', 'trusted:settings-trigger-close'])
    } finally { warn.mockRestore(); vi.useRealTimers() }
  })

  it('applyComposerSettings(main) 영상: §4 M2 한 줄 로그 + 닫힌 요약 crop_9_16 검증(Omni 9:16 은 패널이 보장)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const calls = []
      const executeJavaScript = vi.fn(async (script) => {
        const s = String(script)
        if (s.includes('__af_settings_driver__')) { calls.push('driver'); return { ok: true, closed: true, steps: { mode: 'clicked(videocam)', ratio: 'clicked(crop_9_16)', duration: 'already(6)', resolution: 'already(720p)', count: 'already(x1)', model: 'already', input: 'material' } } }
        if (s.includes('settings-summary')) { calls.push('summary'); return { text: '동영상 · 720p · 6초 x1', ligatures: ['crop_9_16'] } }
        return null
      })
      const trustedClickOnFlowView = vi.fn(async (_sel, o) => { calls.push(`trusted:${o?.step}`); return { success: true } })
      const r = await applyComposerSettings({ webContents: { executeJavaScript } }, { mode: 'video', ratio: '9:16', count: 3, model: 'Omni Flash', duration: 6, resolution: '720p' }, { trustedClickOnFlowView })
      expect(r.ok).toBe(true)
      expect(calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'summary'])
      expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('[Flow Settings] video mode=clicked(videocam) ratio=clicked(crop_9_16) duration=already(6) resolution=already(720p) count=already(x1) model=already input=material ok=true')
    } finally { log.mockRestore() }
  })

  // M2-R5 J5(B4): I7 은 클릭 뒤 거부 경로에서만 모델 전환을 지켰다. needs-trusted 경로 — 첫 실행이 모델을 바꾸고(model=clicked) 길이 라디오가 합성 클릭을 무시해 needs-trusted 로
  //   나오면 main 이 그 라디오를 trusted 클릭하고 드라이버를 다시 돌리는데, 재실행은 이미 바뀐 모델을 already 로 보고한다 → 병합 steps·[Flow Settings] 로그가 model=already 로 남아
  //   §12.2 무과금 프로브(통과 조건 steps.model==='clicked')가 ok:true 인데도 통과도 실패도 아니었다. 첫 실행의 clicked 를 지킨다.
  it('needs-trusted 재실행이 model=already 를 보고해도 첫 실행의 model=clicked 를 지킨다 — 병합 steps 와 [Flow Settings] 로그 (M2-R5 J5)', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const doc = mount(videoPage({ durations: ['4초', '6초'] }))
      const fakeLog = installFakeAngular(doc, { modelSelectDurations: ['4초', '6초', '8초', '10초'], ignoreClicks: ['duration'] })
      const calls = []
      const flowView = { webContents: { executeJavaScript: vi.fn(async (js) => window.eval(js)) } }
      const trustedClickOnFlowView = vi.fn(async (sel, o) => {
        calls.push(`trusted:${o?.step}`)
        if (o?.step === 'settings-radio') {
          // trusted 클릭 흉내: 가짜 Angular 는 duration 의 합성 클릭을 무시하므로 aria-checked 를 직접 옮긴다(FIND_RADIO_JS 가 고른 그 라디오)
          const el = window.eval(sel)
          expect(el?.textContent.replace(/\s+/g, ' ').trim()).toBe('8초')
          doc.querySelectorAll(`button[role="radio"][name="${el.getAttribute('name')}"]`).forEach((b) => b.setAttribute('aria-checked', String(b === el)))
        }
        return { success: true }
      })
      const p = applyComposerSettings(flowView, { mode: 'video', duration: 8, resolution: '720p', model: 'Veo 3.1 - Fast' }, { trustedClickOnFlowView })
      let r
      p.then((v) => { r = v })
      for (let t = 0; t < 30000 && r === undefined; t += 100) await vi.advanceTimersByTimeAsync(100)
      expect(calls).toEqual(['trusted:settings-trigger', 'trusted:settings-radio'])
      expect(fakeLog.slice(0, 3)).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'duration:8초'])   // 첫 실행: 모델 전환 + 무시된 길이 클릭
      expect(r).toMatchObject({ ok: true, steps: { model: 'clicked', duration: 'already(8)', resolution: 'already(720p)', count: 'already(x1)', input: 'material' } })
      expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/\[Flow Settings\] video .*model=clicked.* ok=true/)
    } finally { log.mockRestore(); vi.useRealTimers() }
  })
})
