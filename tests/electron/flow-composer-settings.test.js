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

  it('phase2 영상: count 는 항상 x1(미정의·3 모두), 모델 다르면 select 계획, 같으면 verified', () => {
    const s = scanSettingsPanel(mount(videoPage({ checked: { count: 'x2' } })))
    for (const count of [undefined, 3]) {
      const p = planSettingsClicks(s, { mode: 'video', count, ratio: '16:9', duration: 8, resolution: '720p', model: 'Veo 3.1 - Fast' }, 2)
      expect(p.ok).toBe(true)
      expect(p.model).toEqual({ select: true, requested: 'Veo 3.1 - Fast' })
      expect(p.clicks.map((c) => `${c.group}:${c.ligature || c.label}`)).toEqual(['duration:8초', 'count:x1'])
      expect(p.steps).toMatchObject({ ratio: 'already(crop_16_9)', resolution: 'already' })
    }
    expect(planSettingsClicks(s, { mode: 'video', model: 'Omni 1.1 Flash' }, 2)).toMatchObject({ ok: true, steps: { model: 'verified' } })
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
    expect(r.steps).toMatchObject({ mode: 'clicked', model: 'clicked', ratio: 'already(crop_16_9)', duration: 'clicked', resolution: 'already', count: 'already' })
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
