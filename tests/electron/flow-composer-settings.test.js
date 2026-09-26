// @vitest-environment jsdom
//
// M1-8 — 설정 패널 드라이버. 패널 픽스처는 D 덤프(2026-09-24 image/video-panel-open) 재구성 + 카드 more_vert
// (aria-haspopup=menu) 7개와 프로젝트 메뉴 버튼을 **앞에** 둔다 — 모델 트리거는 패널 스코프 안에서만.
//   locatePanel = 라디오의 최소 공통 조상 · 그룹은 자동 번호 name 으로만 묶고 내용(리거처·텍스트)으로 분류(번호 매칭 금지)
//   phase1 모드 → 재스캔 → phase2: 모델 → (변경 시 안정 대기·재스캔·재계획) → 비율 → 길이 → 해상도 → 개수 → 최종 재판독
//   이미지 모델도 영상처럼 메뉴에서 고른다(2026-09-26) — 단 **정확 일치**("Nano Banana 2" ≠ "Nano Banana 2 Lite"). 메뉴에 없으면
//   flow-image-model-mismatch {requested, panel}(비율·개수 클릭 없음).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  scanSettingsPanel, planSettingsClicks, ratioLigature, runSettingsDriver, SETTINGS_DRIVER_JS, SETTINGS_PANEL_OPEN_JS,
  FIND_RADIO_JS, applyComposerSettings,
} from '../../electron/flow-composer-settings.js'
import {
  CARD_MENU_BUTTONS, PROJECT_MENU_BUTTON, IMAGE_COMPOSER_KO, VIDEO_COMPOSER_KO, buildSettingsPanel, buildDurationGroup, IMAGE_MODEL_MENU_ITEMS,
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
// 가짜 Angular 의 모델 메뉴를 2026-09-26 이미지 메뉴 덤프로(항목 순서 그대로, 아이콘 없음)
const IMAGE_MENU = { modelMenuItems: IMAGE_MODEL_MENU_ITEMS, modelMenuIcon: null }

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

  it('phase2 이미지: 모델이 다르면 영상처럼 select 계획 **만** — 비율·개수는 모델 클릭 뒤 재계획(2026-09-26, 옛: flow-image-model-mismatch)', () => {
    const s = scanSettingsPanel(mount(imagePage()))
    const p = planSettingsClicks(s, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana Pro' }, 2)
    expect(p).toEqual({ ok: true, clicks: [], steps: {}, model: { select: true, requested: 'Nano Banana Pro' } })
  })

  // 2026-09-26: 부분열 규칙은 패널 "🍌 Nano Banana 2 Lite" 를 요청 "Nano Banana 2" 로 보고 verified — Lite 로 조용히 생성했다(덤프에서 Lite 첫 관측).
  it('phase2 이미지: 모델은 정확 일치 — 패널 "🍌 Nano Banana 2 Lite" 는 요청 "Nano Banana 2" 가 아니다(select), 같은 이름이면 verified', () => {
    const lite = scanSettingsPanel(mount(imagePage({ model: '🍌 Nano Banana 2 Lite' })))
    expect(planSettingsClicks(lite, { mode: 'image', ratio: '9:16', model: 'Nano Banana 2' }, 2)).toEqual({ ok: true, clicks: [], steps: {}, model: { select: true, requested: 'Nano Banana 2' } })
    expect(planSettingsClicks(lite, { mode: 'image', ratio: '16:9', model: 'Nano Banana 2 Lite' }, 2)).toMatchObject({ ok: true, steps: { model: 'verified' }, model: null })
    // 이모지·대소문자는 무시한다(정규화 뒤 토큰 열 비교)
    const two = scanSettingsPanel(mount(imagePage()))
    expect(planSettingsClicks(two, { mode: 'image', ratio: '16:9', model: 'nano banana 2' }, 2)).toMatchObject({ ok: true, steps: { model: 'verified' }, model: null })
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

  // 2026-09-26: 이미지 모델도 영상과 같은 메뉴 경로로 고른다(옛 flow.google.com 이전 뒤 검증만 남아 "요청 Pro, 패널 2" 토스트로 멈췄다).
  it('이미지 모델이 다르면(패널 2 · 요청 Pro) 메뉴에서 🍌 Nano Banana Pro 클릭 → 재계획 → 비율·개수 클릭 → ok, model clicked', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, IMAGE_MENU)
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana Pro' }, noSleep)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { mode: 'already', model: 'clicked', ratio: 'clicked(crop_9_16)', count: 'clicked' } })
    expect(log).toEqual(['model-trigger', 'model:🍌 nano banana pro', 'ratio:crop_9_16', 'count:x2', 'keydown:Escape:27'])
    expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
  })

  it('패널 🍌 Nano Banana 2 Lite · 요청 Nano Banana 2 → Lite 로 조용히 생성하지 않는다: 메뉴에서 🍌 Nano Banana 2 를 클릭 → ok', async () => {
    const doc = mount(imagePage({ model: '🍌 Nano Banana 2 Lite' }))
    const log = installFakeAngular(doc, IMAGE_MENU)
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '16:9', model: 'Nano Banana 2' }, noSleep)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { mode: 'already', model: 'clicked', ratio: 'already(crop_16_9)' } })
    expect(log).toEqual(['model-trigger', 'model:🍌 nano banana 2', 'keydown:Escape:27'])
  })

  // 드라이버 사본(settingsDriverCore)의 항목 찾기도 정확 일치여야 한다 — 덤프 순서(Pro, 2, Lite)에선 부분열 규칙도 2 를 먼저 찾으므로 Lite 를 앞에 둔다.
  it('메뉴에서 Lite 가 2 보다 앞에 있어도 요청 Nano Banana 2 는 🍌 Nano Banana 2 를 누른다', async () => {
    const doc = mount(imagePage({ model: '🍌 Nano Banana Pro' }))
    const log = installFakeAngular(doc, { ...IMAGE_MENU, modelMenuItems: ['🍌 Nano Banana Pro', '🍌 Nano Banana 2 Lite', '🍌 Nano Banana 2'] })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '16:9', model: 'Nano Banana 2' }, noSleep)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { model: 'clicked' } })
    expect(log).toEqual(['model-trigger', 'model:🍌 nano banana 2', 'keydown:Escape:27'])
  })

  it('요청 이미지 모델이 메뉴에 없으면 flow-image-model-mismatch {requested, panel}(기존 문구·params) — 메뉴·패널을 닫고 비율·개수 클릭 없음', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, { ...IMAGE_MENU, modelMenuItems: ['🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'] })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana Pro' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }, closed: true })
    // 트리거 재클릭이 메뉴를 닫고, Escape 가 패널을 닫는다(R1#3: 실패 경로도 닫고 나온다)
    expect(log).toEqual(['model-trigger', 'model-trigger', 'keydown:Escape:27'])
    expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
  })

  it('이미지 항목을 눌러도 트리거 글자가 안 바뀌면 model-not-reflected — 비율·개수 클릭 없이 멈춘다(생성 전)', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, { ...IMAGE_MENU, modelSelectIgnored: true })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana Pro' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'model-not-reflected', closed: true })
    expect(log).toEqual(['model-trigger', 'model:🍌 nano banana pro', 'keydown:Escape:27'])
    expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
  })

  // 리뷰 B(2026-09-26): 반영 확인도 정확 일치여야 한다 — 부분열이면 Lite 트리거가 요청 2 의 "반영"으로 통과해 model=clicked 로 거짓 보고하고
  //   settings-not-settled 로 끝났다(생성 전 멈춤은 같지만 진단이 틀린다). 패널 2 · 요청 Pro 케이스는 두 규칙이 같은 답이라 이걸 못 가린다.
  it('패널 Lite · 요청 2 · 항목 클릭이 반영 안 됨 → model-not-reflected, steps 에 model 없음(전환했다고 보고하지 않는다)', async () => {
    const doc = mount(imagePage({ model: '🍌 Nano Banana 2 Lite' }))
    const log = installFakeAngular(doc, { ...IMAGE_MENU, modelSelectIgnored: true })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '16:9', model: 'Nano Banana 2' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'model-not-reflected', closed: true })
    expect(r.steps.model).toBeUndefined()
    expect(log).toEqual(['model-trigger', 'model:🍌 nano banana 2', 'keydown:Escape:27'])
  })

  // §4 덤프: 이미지 항목에도 mat-mdc-menu-trigger 가 달려 있다(영상은 장식이었다) — 하위 메뉴가 뜨면 내용 미관측이라 멈춘다.
  it('이미지 항목이 하위 메뉴만 열면 model-submenu-unknown — Escape ×3 로 닫고 비율·개수 클릭 없음', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, { ...IMAGE_MENU, modelSubmenu: true })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana Pro' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'model-submenu-unknown', closed: true })
    expect(log).toEqual(['model-trigger', 'model:🍌 nano banana pro', 'keydown:Escape:27', 'keydown:Escape:27', 'keydown:Escape:27'])
  })

  // 리뷰 A(2026-09-26): 이미지 패널엔 길이·해상도 그룹이 없어 안정 대기는 패널 서명으로 끝난다(≈1.5s) — 대기를 빼도 초록이었다.
  //   모델 클릭 300ms 뒤 Flow 가 개수를 x1 로 리셋하면, 대기 없이 재스캔한 계획은 x2 를 already 로 보고 1장만 만든다.
  it('이미지 모델 클릭 300ms 뒤 개수 리셋(x2 → x1) → 안정 대기 뒤 재계획이 x2 를 다시 클릭한다', async () => {
    vi.useFakeTimers()
    try {
      const doc = mount(imagePage({ checked: { count: 'x2' } }))
      const log = installFakeAngular(doc, { ...IMAGE_MENU, modelSelectLater: { afterMs: 300, count: 'x1' } })
      const r = await runSettingsDriver(doc, { mode: 'image', ratio: '16:9', count: 2, model: 'Nano Banana Pro' }, { sleep: (ms) => vi.advanceTimersByTimeAsync(ms) })
      expect(r).toMatchObject({ ok: true, closed: true, steps: { model: 'clicked', count: 'clicked' } })
      expect(log).toEqual(['model-trigger', 'model:🍌 nano banana pro', 'count:x2', 'keydown:Escape:27'])
    } finally { vi.useRealTimers() }
  })

  // 리뷰 A(2026-09-26): 이미지는 제출 뒤 모델 검사가 없다(영상은 modelKeyMatches) — 전환 뒤 되돌림을 잡는 재계획·최종 재판독이 유일한 방어선인데 묶이지 않았다.
  it('반영 뒤 100ms 에 Flow 가 모델을 🍌 Nano Banana 2 로 되돌리면(개수도 바뀜) 재계획이 model-not-reflected 로 멈춘다 — 비율·개수 클릭 없음', async () => {
    vi.useFakeTimers()
    try {
      const doc = mount(imagePage())
      const log = installFakeAngular(doc, { ...IMAGE_MENU, modelSelectLater: { afterMs: 100, label: '🍌 Nano Banana 2', count: 'x2' } })
      const r = await runSettingsDriver(doc, { mode: 'image', ratio: '16:9', model: 'Nano Banana Pro' }, { sleep: (ms) => vi.advanceTimersByTimeAsync(ms) })
      expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'model-not-reflected', closed: true, steps: { model: 'clicked' } })
      expect(log).toEqual(['model-trigger', 'model:🍌 nano banana pro', 'keydown:Escape:27'])
    } finally { vi.useRealTimers() }
  })

  it('재계획 뒤 개수 클릭이 모델을 되돌리면 최종 재판독이 not-checked:model 로 멈춘다(ok 로 닫지 않는다)', async () => {
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, { ...IMAGE_MENU, modelRevertOnCount: '🍌 Nano Banana 2' })
    const r = await runSettingsDriver(doc, { mode: 'image', ratio: '16:9', count: 2, model: 'Nano Banana Pro' }, noSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'not-checked:model', closed: true })
    expect(log).toEqual(['model-trigger', 'model:🍌 nano banana pro', 'count:x2', 'keydown:Escape:27'])
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

  // M2-LIVE N6(B5): 가짜의 되돌림이 같은 노드의 aria-checked 만 뒤집어 "2차 패스는 재스캔한다" 가 묶이지 않았다 — 최종 재판독(+100ms)의 클릭 목록을 재스캔 없이 재사용하는
  //   뮤턴트가 통과했다. 이제 되돌림은 상태를 뒤집고 200ms 뒤 그룹 element 를 갈아끼운다(라이브 Angular 의 재렌더): 재판독이 잡은 노드는 2차 패스(+400ms) 전에 떨어지므로
  //   2차 패스의 8초 클릭은 재스캔한 새 노드여야 reclicked(8) 이 된다. 결정적 시계(가짜 타이머 + sleep 전진).
  it('(b) 지연 리셋: count 클릭이 duration 을 되돌리고 200ms 뒤 그룹을 다시 그린다 → 최종 재판독이 잡고 2차 패스가 **재스캔한 노드**로 다시 맞춘 뒤 재판독 ok (M2 실기 · M2-LIVE N6)', async () => {
    vi.useFakeTimers()
    try {
      const doc = mount(videoPage({ checked: { count: 'x2' } }))
      const log = installFakeAngular(doc, { modelReset: 'on-count', resetReplaceDelayMs: 200 })
      const firstDurationEl = scanSettingsPanel(doc).groups.duration.options.find((o) => o.label === '8초').el
      const r = await runSettingsDriver(doc, { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', count: 1, model: 'Omni 1.1 Flash' }, { sleep: (ms) => vi.advanceTimersByTimeAsync(ms) })
      expect(r).toMatchObject({ ok: true, closed: true, steps: { duration: 'reclicked(8)', count: 'clicked(x1)' } })
      expect(log.filter((l) => l === 'duration:8초')).toHaveLength(2)   // 1차 + 2차 패스
      expect(firstDurationEl.isConnected).toBe(false)   // 1차 패스가 누른 노드는 되돌림이 갈아끼워 떨어져 있다
      expect(scanSettingsPanel(doc).ok).toBe(false)   // 닫혔다
    } finally { vi.useRealTimers() }
  })

  it('(b2) 계속 되돌리는 그룹은 2차 패스 뒤에도 어긋나 → not-checked:<group> (fail-closed, 단계 통과만으로 ok 를 내지 않는다)', async () => {
    const doc = mount(videoPage({ checked: { ratio: 'crop_16_9' } }))
    const log = installFakeAngular(doc, { lockGroup: 'ratio', lockTo: 'crop_16_9' })
    const r = await runSettingsDriver(doc, { mode: 'video', ratio: '9:16', duration: 6, resolution: '720p', count: 1, model: 'Omni 1.1 Flash' })
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'not-checked:ratio', closed: true })
    expect(log.filter((l) => l === 'ratio:crop_9_16')).toHaveLength(2)
  }, 10000)

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

  // M2-CLOSE O2(A2): deps.isAborted(워치독이 닫은 뒤의 좀비)는 신뢰 클릭·드라이버 exec 마다 먼저 본다 — 더 이상 페이지를 만지지 않고 dom-stage-aborted 로 돌아온다.
  it('isAborted 가 처음부터 true 면 요약 exec·트리거 클릭·드라이버 없이 dom-stage-aborted (M2-CLOSE O2)', async () => {
    const h = harness({ driver: { ok: true, closed: true, steps: {} } })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16' }, { ...h.deps, isAborted: () => true })
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'dom-stage-aborted' })
    expect(h.calls).toEqual([])
  })
  it('첫 드라이버 실행이 needs-trusted 로 돌아온 사이 isAborted 가 true 가 되면 라디오 신뢰 클릭·재실행·닫기 클릭 없이 dom-stage-aborted (M2-CLOSE O2)', async () => {
    let aborted = false
    const h = harness({ driver: () => { aborted = true; return { ok: false, needsTrusted: [{ group: 'ratio', name: 'g', label: '9:16', ligature: 'crop_9_16' }], steps: {} } } })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16' }, { ...h.deps, isAborted: () => aborted })
    expect(r).toMatchObject({ ok: false, reason: 'dom-stage-aborted' })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver'])
  })

  it('kind/params 실패는 그대로 전달(모델 불일치), 요약 재검증 없음', async () => {
    const h = harness({ driver: { ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }, steps: { mode: 'already' }, closed: true } })
    const r = await applyComposerSettings(h.flowView, { mode: 'image', ratio: '9:16', model: 'Nano Banana Pro' }, h.deps)
    expect(r).toEqual({ ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }, reason: 'flow-image-model-mismatch', steps: { mode: 'already' } })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver'])
  })

  // 2026-09-26 통합: main + **실제** 드라이버(페이지 표현식) + 가짜 Angular 이미지 메뉴 — 모델 전환이 한 줄 로그까지, 메뉴에 없음이 kind·params 까지 온다.
  async function runMain(doc, opts) {
    const calls = []
    const flowView = { webContents: { executeJavaScript: vi.fn(async (js) => window.eval(js)) } }
    const trustedClickOnFlowView = vi.fn(async (_sel, o) => { calls.push(`trusted:${o?.step}`); return { success: true } })
    const p = applyComposerSettings(flowView, opts, { trustedClickOnFlowView })
    let r
    p.then((v) => { r = v })
    for (let t = 0; t < 30000 && r === undefined; t += 100) await vi.advanceTimersByTimeAsync(100)
    return { r, calls }
  }

  it('실제 드라이버: 이미지 패널 2 · 요청 Pro → 메뉴 선택 → ok, [Flow Settings] 로그 model=clicked, 닫기 재클릭 없음', async () => {
    vi.useFakeTimers()
    try {
      const doc = mount(imagePage())
      const fakeLog = installFakeAngular(doc, IMAGE_MENU)
      const { r, calls } = await runMain(doc, { mode: 'image', ratio: '16:9', model: 'Nano Banana Pro' })
      expect(r).toEqual({ ok: true, steps: { mode: 'already', model: 'clicked', ratio: 'already(crop_16_9)' } })
      expect(calls).toEqual(['trusted:settings-trigger'])
      expect(fakeLog).toEqual(['model-trigger', 'model:🍌 nano banana pro', 'keydown:Escape:27'])
      expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('[Flow Settings] image mode=already ratio=already(crop_16_9) model=clicked ok=true')
    } finally { vi.useRealTimers() }
  })

  it('실제 드라이버: 요청 이미지 모델이 메뉴에 없음 → main 도 flow-image-model-mismatch {requested, panel} 을 그대로 돌려준다', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const doc = mount(imagePage())
      const fakeLog = installFakeAngular(doc, { ...IMAGE_MENU, modelMenuItems: ['🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'] })
      const { r, calls } = await runMain(doc, { mode: 'image', ratio: '16:9', model: 'Nano Banana Pro' })
      expect(r).toMatchObject({ ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' } })
      expect(fakeLog).toEqual(['model-trigger', 'model-trigger', 'keydown:Escape:27'])   // 메뉴를 열어 찾아봤다(옛 검증은 열지 않았다)
      expect(calls).toEqual(['trusted:settings-trigger'])   // 드라이버가 닫고 나왔다(closed:true) — 재클릭 없음
    } finally { warn.mockRestore(); vi.useRealTimers() }
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

  // M2-R7 L2(B1): K4 의 병합 조건엔 `firstSteps.model === 'clicked'` 항의 핀이 없었다 — 그 항만 지워도 전 스위트 초록. 없으면 재실행이 clicked 를 보고하지 않는 모든 경우에
  //   model:'clicked' 를 찍어 (i) §12.2 무과금 프로브(phase 1 needs-trusted:mode → 재실행 panel-not-open, steps 비어 있음)가 모델을 건드린 적 없어도 steps.model==='clicked' 로
  //   공허하게 통과하고 (ii) Omni 가 이미 선택된 10크레딧 런(length 라디오만 trusted, 재실행 model:'already')이 §12.2 의 model=already 대신 model=clicked 를 찍는다.
  it('첫 실행이 모델을 건드리지 않았으면(needs-trusted:mode, steps.model 없음) 재실행이 panel-not-open(steps 비어 있음)으로 실패해도 model 을 찍지 않는다 — steps·로그 둘 다 (M2-R7 L2)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let n = 0
      const h = harness({ driver: () => (++n === 1
        ? { ok: false, needsTrusted: [{ group: 'mode', name: 'mat-button-toggle-group-29', label: '동영상', ligature: 'videocam' }], steps: { mode: 'clicked(videocam)' } }
        : { ok: false, kind: 'flow-settings-not-applied', reason: 'panel-not-open', steps: {}, closed: false }) })
      const r = await applyComposerSettings(h.flowView, { mode: 'video', duration: 8, model: 'Veo 3.1 - Fast' }, h.deps)
      expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'panel-not-open' })
      expect(r.steps).not.toHaveProperty('model')
      expect(r.steps).toEqual({})
      expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-radio', 'driver', 'trusted:settings-trigger-close'])
      const logs = warn.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(logs).toMatch(/\[Flow Settings\] video\s+ok=false reason=panel-not-open/)
      expect(logs).not.toContain('model=')
    } finally { warn.mockRestore() }
  })

  it('첫 실행이 model=already 였으면(needs-trusted:duration) 재실행의 model=already 를 그대로 둔다 — steps.model==="already", 로그 model=already (M2-R7 L2)', async () => {
    let n = 0
    const h = harness({ driver: () => (++n === 1
      ? { ok: false, needsTrusted: [{ group: 'duration', name: 'mat-button-toggle-group-31', label: '6초' }], steps: { mode: 'already(videocam)', model: 'already' } }
      : { ok: true, closed: true, steps: { mode: 'already(videocam)', ratio: 'already(crop_16_9)', duration: 'clicked(6)', resolution: 'already(720p)', count: 'already(x1)', model: 'already', input: 'material' } }) })
    const r = await applyComposerSettings(h.flowView, { mode: 'video', duration: 6, resolution: '720p', model: 'Omni Flash' }, h.deps)
    expect(r.ok).toBe(true)
    expect(r.steps.model).toBe('already')
    expect(r.steps).not.toMatchObject({ model: 'clicked' })
    expect(h.calls).toEqual(['summary', 'trusted:settings-trigger', 'driver', 'trusted:settings-radio', 'driver'])
    const logs = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logs).toContain('[Flow Settings] video mode=already(videocam) ratio=already(crop_16_9) duration=clicked(6) resolution=already(720p) count=already(x1) model=already input=material ok=true')
    expect(logs).not.toContain('model=clicked')
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

// 2026-09-25 M2 실기(2차 런, 957×1022): 설정 트리거 trusted 클릭 직후 드라이버가 **즉시 한 번** 스캔해 패널 애니메이션이 끝나기 전에
//   panel-not-open 으로 닫았다(같은 세션의 이미지 런 두 번은 타이밍 운으로 통과). 패널은 유계 대기(≤3s, 50ms 폴링)로 기다린다.
describe('settingsDriverCore — 패널이 늦게 열려도 기다린다 (M2 실기)', () => {
  // M2-LIVE N4(B3): 옛 핀은 "첫 스캔 전 대기" 를 묶지 못했다 — 대기를 지워도 재시도의 3s 대기가 400ms 패널을 구제해 초록이었다. 라이브에선 대기 없는
  //   즉시 재시도 클릭이 **애니메이션 중인 패널을 토글로 닫아** 모든 생성이 panel-not-open 이 된다. 트리거에 토글 의미(클릭 = 열린 패널 닫기)를 달고
  //   재시도 클릭이 0회임을 본다.
  it('트리거 클릭 400ms 뒤에 패널이 나타나면 ok — 첫 스캔 전에 기다리므로 재시도 클릭(토글: 열린 패널을 닫는다)은 0회 (M2-LIVE N4)', async () => {
    const doc = mount(HEAD + IMAGE_COMPOSER_KO)   // 패널 없음(닫힌 상태)
    const trigger = doc.querySelector('button.settings-trigger-button')
    let clicks = 0
    trigger.addEventListener('click', () => { clicks++; doc.querySelector('.cdk-overlay-container')?.remove() })
    const p = runSettingsDriver(doc, { mode: 'image' })   // 모드만 — 픽스처엔 가짜 Angular 가 없어 라디오 클릭 반영은 여기서 다루지 않는다
    await new Promise((r) => setTimeout(r, 400))
    doc.body.insertAdjacentHTML('beforeend', buildSettingsPanel({ mode: 'image' }))
    const r = await p
    expect(r).toMatchObject({ ok: true, steps: { mode: 'already' } })
    expect(clicks).toBe(0)
  })
  it('3초가 지나도 패널이 없으면 panel-not-open', async () => {
    const doc = mount(HEAD + IMAGE_COMPOSER_KO)
    const r = await runSettingsDriver(doc, { mode: 'image' })
    expect(r).toMatchObject({ ok: false, reason: 'panel-not-open' })
  }, 10000)
})

// 2026-09-25 M2 실기(3·4번째 런): (1) 같은 페이지에서 두 번째 생성부터 트리거 클릭 한 번이 헛돌았다 — Escape 로 닫은 뒤 Flow 의
//   "열림" 상태가 풀리지 않아 다음 클릭이 닫기로 소비된다(그다음 클릭은 연다). 첫 대기에도 패널이 없으면 드라이버가 트리거를 한 번
//   더 누르고 다시 기다린다. (2) Veo 3.1 - Fast 로 바꾸자 group-not-found:duration — Veo 패널의 길이 그룹 모양은 관측된 적이 없다.
//   group-not-found 실패는 분류 못 한 토글 그룹의 라벨(UI 문자열)을 shape 로 싣는다(진단 — 다음 한 번에 모양을 본다).
describe('settingsDriverCore — 트리거 헛클릭 재시도 · group-not-found 모양 진단 (M2 실기)', () => {
  it('패널이 안 열리면 트리거를 한 번 더 누르고, 그 클릭이 패널을 열면 ok — 재시도 클릭은 첫 대기(≈3000ms)가 지난 **뒤**에만 (M2-LIVE N4)', async () => {
    vi.useFakeTimers()
    try {
      const doc = mount(HEAD + IMAGE_COMPOSER_KO)
      const trigger = doc.querySelector('button.settings-trigger-button')
      const t0 = Date.now()
      const clickedAt = []
      trigger.addEventListener('click', () => { clickedAt.push(Date.now() - t0); doc.body.insertAdjacentHTML('beforeend', buildSettingsPanel({ mode: 'image' })) })
      const r = await runSettingsDriver(doc, { mode: 'image' }, { sleep: (ms) => vi.advanceTimersByTimeAsync(ms) })
      expect(r).toMatchObject({ ok: true, steps: { mode: 'already' } })
      expect(clickedAt).toHaveLength(1)
      expect(clickedAt[0]).toBeGreaterThanOrEqual(3000)
      expect(clickedAt[0]).toBeLessThan(3200)
    } finally { vi.useRealTimers() }
  })

  it('길이 그룹을 분류 못 하면 group-not-found:duration 에 분류 못 한 그룹의 라벨을 shape 로 싣는다', async () => {
    const odd = ['4초 · 오디오 포함', '8초 · 오디오 포함']
    const doc = mount(HEAD + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video', durations: odd, checked: { duration: odd[1] } }))
    const r = await runSettingsDriver(doc, { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', count: 1, model: 'Omni Flash' })
    expect(r).toMatchObject({ ok: false, reason: 'group-not-found:duration' })
    expect(r.shape.groups).toEqual(expect.arrayContaining(['mode', 'ratio', 'resolution', 'count']))
    expect(r.shape.unclassified).toEqual([{ labels: odd, ligatures: [] }])
    // 토글이 아닌 패널 컨트롤도 싣는다(Veo 패널엔 길이·해상도 토글이 없었다 — 드롭다운인지 없는지 본다). 모델 트리거가 그중 하나.
    expect(r.shape.controls.some((c) => /omni 1\.1 flash/i.test(c.label) && c.haspopup === 'menu')).toBe(true)
    expect(r.shape.controls.every((c) => c.role !== 'radio')).toBe(true)
  })
})

// M2-LIVE N5(A4/B4): 트리거 재시도 클릭은 scan 이 실패하기만 하면 나갔다 — 열려 있지만 Material 이 아닌 패널(input-mode-not-material, 배치 전체 이유)·점진 렌더 중인
//   패널을 토글로 닫고 3s 뒤 panel-not-open(항목 이유)으로 둔갑시켜 원인을 가리고 항목마다 +3s·클릭 2회를 태웠다. 재시도는 "panel-not-open **이고** 문서에 [role=radio] 가
//   하나도 없을 때"(정말 아무것도 안 그려진 경우)만; 아니면 스캔의 사유 그대로.
describe('settingsDriverCore — 트리거 재시도는 panel-not-open + 라디오 0개일 때만 (M2-LIVE N5)', () => {
  const fakeSleep = { sleep: (ms) => vi.advanceTimersByTimeAsync(ms) }
  const countTriggerClicks = (doc) => { let n = 0; doc.querySelector('button.settings-trigger-button').addEventListener('click', () => { n++ }); return () => n }
  afterEach(() => { vi.useRealTimers() })
  it('Material 이 아닌 라디오 패널(input-mode-not-material) → 재시도 클릭 없이 그 사유 그대로', async () => {
    vi.useFakeTimers()
    const doc = mount(imagePage({ material: false }))
    const clicks = countTriggerClicks(doc)
    const r = await runSettingsDriver(doc, { mode: 'image' }, fakeSleep)
    expect(r).toMatchObject({ ok: false, reason: 'input-mode-not-material' })
    expect(clicks()).toBe(0)
  })
  it('라디오가 있지만 6개 미만(점진 렌더 — panel-not-open) → 재시도 클릭 없이 panel-not-open', async () => {
    vi.useFakeTimers()
    const three = '<div class="cdk-overlay-container"><div class="cdk-overlay-pane"><div class="flow-settings-panel">' + [1, 2, 3].map((i) => `<button type="button" class="mat-button-toggle-button" role="radio" aria-checked="${i === 1}" name="mat-button-toggle-group-9">x${i}</button>`).join('') + '</div></div></div>'
    const doc = mount(HEAD + IMAGE_COMPOSER_KO + three)
    const clicks = countTriggerClicks(doc)
    const r = await runSettingsDriver(doc, { mode: 'image' }, fakeSleep)
    expect(r).toMatchObject({ ok: false, reason: 'panel-not-open' })
    expect(clicks()).toBe(0)
  })
})

// M2-LIVE N8(A7/B8): shape 진단은 라디오의 최소 공통 조상 아래 button/[role]/input/mat-select 의 textContent 를 읽는다 — 패널이 CDK 오버레이 pane 이면 UI 라벨뿐이지만
//   Flow 가 패널을 인라인으로 그리면 LCA 가 컴포저·앱 루트로 넓어져 카드 프롬프트·프로젝트 이름 입력이 잡혀 reportDomFailure → Sentry 로 간다. shape(controls 포함)는 LCA 가
//   .cdk-overlay-pane 안일 때만 모은다. 라벨 텍스트(unclassified[].labels · controls[].label)는 로컬 진단 파일에만 — Sentry 스크럽은 flow-diag 의 CONTENT_KEYS(labels 추가).
describe('scanSettingsPanel / group-not-found shape — 오버레이 pane 안의 패널만 shape 를 싣는다 (M2-LIVE N8)', () => {
  const odd = ['4초 · 오디오 포함', '8초 · 오디오 포함']
  const inlinePanel = () => {
    // 같은 패널을 오버레이 없이 컴포저 옆에 인라인으로 — LCA 가 body 바로 아래 래퍼(앱 루트 모양)가 된다
    const panelHtml = buildSettingsPanel({ mode: 'video', durations: odd, checked: { duration: odd[1] } }).replace('<div class="cdk-overlay-container"><div class="cdk-overlay-pane">', '').replace(/<\/div><\/div>$/, '')
    return mount('<div class="af-app-root"><input class="project-name" value="내 프로젝트 이름"><button class="af-card-prompt">왕이 궁전을 걷는 프롬프트</button>' + IMAGE_COMPOSER_KO + panelHtml + '</div>')
  }
  it('scan: 오버레이 pane 안이면 overlay:true + controls, 인라인이면 overlay:false + controls 비움(앱 루트의 텍스트를 읽지 않는다)', () => {
    const inOverlay = scanSettingsPanel(mount(videoPage()))
    expect(inOverlay.ok).toBe(true)
    expect(inOverlay.overlay).toBe(true)
    expect(inOverlay.controls.length).toBeGreaterThan(0)
    const inline = scanSettingsPanel(inlinePanel())
    expect(inline.ok).toBe(true)
    expect(inline.overlay).toBe(false)
    expect(inline.controls).toEqual([])
    expect(JSON.stringify(inline)).not.toContain('프롬프트')
    expect(JSON.stringify(inline)).not.toContain('프로젝트 이름')
  })
  it('driver: 인라인 패널의 group-not-found:duration 은 shape 없이 — 결과 어디에도 카드 프롬프트·프로젝트 이름이 없다', async () => {
    const doc = inlinePanel()
    const r = await runSettingsDriver(doc, { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', count: 1, model: 'Omni Flash' }, noSleep)
    expect(r).toMatchObject({ ok: false, reason: 'group-not-found:duration' })
    expect(r).not.toHaveProperty('shape')
    expect(JSON.stringify(r)).not.toContain('프롬프트')
    expect(JSON.stringify(r)).not.toContain('프로젝트 이름')
  })
  it('driver: 오버레이 pane 안의 패널은 그대로 shape(groups·unclassified·controls) 를 싣는다', async () => {
    const doc = mount(HEAD + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video', durations: odd, checked: { duration: odd[1] } }))
    const r = await runSettingsDriver(doc, { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', count: 1, model: 'Omni Flash' }, noSleep)
    expect(r).toMatchObject({ ok: false, reason: 'group-not-found:duration' })
    expect(r.shape.unclassified).toEqual([{ labels: odd, ligatures: [] }])
    expect(r.shape.controls.some((c) => c.haspopup === 'menu')).toBe(true)
  })
})

// 2026-09-25 M2 실기: Veo 3.1 - Fast 패널엔 길이·해상도 컨트롤이 없다(진단 shape: mode·inputMode·ratio·모델·count 뿐). 없는 그룹은 모델 기본값
//   — 카탈로그 키 문법상 길이 토큰 없음 = 8초, _360p 없음 = 720p — 만 받고, 그 외 요청은 클릭 전에 거부한다(과금 뒤 모델키 불일치를 막는다).
describe('planSettingsClicks — 패널에 없는 길이·해상도 그룹은 모델 기본값만 (Veo 실측)', () => {
  const veoPanel = () => mount(HEAD + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video', model: 'Veo 3.1 - Fast', omit: ['resolution', 'duration'], checked: { ratio: 'crop_9_16' } }))
  const plan2 = (targets) => { const s = scanSettingsPanel(veoPanel()); expect(s.ok).toBe(true); return planSettingsClicks(s, { mode: 'video', ratio: '9:16', count: 1, model: 'Veo 3.1 - Fast', ...targets }, 2) }
  it('8초·720p → fixed 로 통과(클릭 없음)', () => {
    const r = plan2({ duration: 8, resolution: '720p' })
    expect(r).toMatchObject({ ok: true, clicks: [], steps: { model: 'already', duration: 'fixed(8)', resolution: 'fixed(720p)' } })
  })
  it('6초 → duration-not-offered:6 (클릭 전 거부)', () => {
    expect(plan2({ duration: 6, resolution: '720p' })).toMatchObject({ ok: false, reason: 'duration-not-offered:6' })
  })
  it('360p → flow-resolution-not-offered {requested:360p}', () => {
    expect(plan2({ duration: 8, resolution: '360p' })).toMatchObject({ ok: false, kind: 'flow-resolution-not-offered', params: { requested: '360p' } })
  })
  it('분류 못 한 토글 그룹이 있으면 없음으로 보지 않는다 — 8초 요청이어도 group-not-found:duration', () => {
    const s = scanSettingsPanel(mount(HEAD + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video', model: 'Veo 3.1 - Fast', durations: ['4초 · 오디오 포함', '8초 · 오디오 포함'] })))
    expect(planSettingsClicks(s, { mode: 'video', ratio: '16:9', count: 1, model: 'Veo 3.1 - Fast', duration: 8, resolution: '720p' }, 2)).toMatchObject({ ok: false, reason: 'group-not-found:duration' })
  })
  it('그룹이 있는 Omni 패널은 그대로(없는 값은 여전히 not-offered)', () => {
    const s = scanSettingsPanel(mount(HEAD + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video' })))
    expect(planSettingsClicks(s, { mode: 'video', ratio: '16:9', count: 1, model: 'Omni Flash', duration: 5, resolution: '720p' }, 2)).toMatchObject({ ok: false, reason: 'duration-not-offered:5' })
  })
})

// M2-LIVE N2(A2/B1): "없는 그룹 = 모델 기본값(fixed 8초·720p)" 은 스냅샷 술어였다 — 안정 요구도 모델 검사도 없어서 (1) Omni 패널이 그룹을 늦게 그리면
//   (모드 전환 뒤 · Veo → Omni 전환 뒤 Angular 가 옵션을 늦게 붙인다) 그 순간의 "없음" 을 기본값으로 받아 Flow 가 기억한 4·6초로 과금될 수 있었고
//   (2) 모델 클릭 뒤 waitGroupsSettled 는 그룹이 없으면 영영 안정되지 않아 1.5s 상한에서 그냥 떨어져 "아직 없음" 을 "기본값" 으로 삼았다.
//   이제: (a) fixed 는 패널 모델 라벨이 /veo/i 일 때만 — Omni 의 없는 그룹은 group-not-found + shape (b) 없음은 유계 대기(≤1.5s)로 증명한다 —
//   그 안에 그룹이 나타나면 그걸로 계획하고, 끝까지 없으면 마지막 3스캔의 패널 서명(모든 라디오 name|label|checked + 트리거 라벨)이 같아야(모델 클릭 뒤엔
//   클릭 전 서명에서 벗어나야) 받는다; 계속 바뀌면 settings-not-settled(클릭 전) (c) main 은 닫힌 요약의 길이·해상도 토큰이 fixed 값과 다르면 거부한다.
describe('M2-LIVE N2 — 없는 길이·해상도 그룹은 Veo 에서만, 없음은 안정으로 증명, 닫힌 요약 재검증', () => {
  const fakeSleep = { sleep: (ms) => vi.advanceTimersByTimeAsync(ms) }
  const veoPanel = (o = {}) => HEAD + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video', model: 'Veo 3.1 - Fast', omit: ['resolution', 'duration'], checked: { ratio: 'crop_9_16' }, ...o })
  const VEO8 = { mode: 'video', ratio: '9:16', count: 1, model: 'Veo 3.1 - Fast', duration: 8, resolution: '720p' }
  afterEach(() => { vi.useRealTimers() })

  it('(a) 계획: Omni 패널에 길이·해상도 그룹이 없으면 fixed 가 아니라 group-not-found:<kind> — Veo 라벨만 fixed', () => {
    const omni = (omit) => scanSettingsPanel(mount(HEAD + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video', omit })))
    const target = { mode: 'video', ratio: '16:9', count: 1, model: 'Omni Flash', duration: 8, resolution: '720p' }
    expect(planSettingsClicks(omni(['duration']), target, 2)).toMatchObject({ ok: false, reason: 'group-not-found:duration' })
    expect(planSettingsClicks(omni(['resolution']), target, 2)).toMatchObject({ ok: false, reason: 'group-not-found:resolution' })
    const veo = scanSettingsPanel(mount(veoPanel()))
    expect(planSettingsClicks(veo, VEO8, 2)).toMatchObject({ ok: true, steps: { duration: 'fixed(8)', resolution: 'fixed(720p)' } })
  })

  it('(b) B1 프로브: Veo 패널 → 목표 Omni Flash 8초/720p, Omni 그룹이 항목 클릭 2000ms 뒤 삽입(6초 체크) → 절대 fixed(8) 아님 — 8초 클릭 또는 클릭 전 실패', async () => {
    vi.useFakeTimers()
    const doc = mount(veoPanel())
    const log = installFakeAngular(doc, { modelSelectInsertGroupsMs: 2000, modelSelectInsertGroups: { durations: ['4초', '6초', '8초', '10초'], checkedDuration: '6초', resolutions: ['360p', '720p'], checkedResolution: '720p' } })
    const r = await runSettingsDriver(doc, { ...VEO8, model: 'Omni Flash' }, fakeSleep)
    expect(JSON.stringify(r.steps)).not.toContain('fixed(')
    expect(r.steps.model).toBe('clicked')
    if (r.ok) expect(log).toContain('duration:8초')
    else expect(r.reason).toMatch(/^(group-not-found:duration|settings-not-settled)$/)
    expect(r.closed).toBe(true)
    expect(log.slice(0, 2)).toEqual(['model-trigger', 'model:omni 1.1 flash'])
  })

  it('(b) A2 시나리오(Veo 라벨): 이미지 → 영상 모드, 길이 그룹이 300ms 늦게(4초 체크) 그려진다 → 대기가 그룹을 보고 8초 클릭(fixed 아님)', async () => {
    vi.useFakeTimers()
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, { modePanel: { model: 'Veo 3.1 - Fast', omit: ['duration'] }, modeInsertDurationMs: 300, modeInsertDuration: { labels: ['4초', '6초', '8초'], checked: '4초' } })
    const r = await runSettingsDriver(doc, { ...VEO8, ratio: '16:9' }, fakeSleep)
    expect(r).toMatchObject({ ok: true, closed: true })
    expect(r.steps).toMatchObject({ mode: 'clicked(videocam)', model: 'already', duration: 'clicked(8)', resolution: 'already(720p)', count: 'already(x1)' })
    expect(log).toEqual(['mode:videocam', 'duration:8초', 'keydown:Escape:27'])
  })

  it('(b) A2 시나리오(Omni 라벨): 늦게 그려진 그룹으로 8초 클릭; 끝까지 안 그려지면 유계 대기 뒤 group-not-found:duration + shape (클릭 전)', async () => {
    vi.useFakeTimers()
    const doc = mount(imagePage())
    const log = installFakeAngular(doc, { modePanel: { omit: ['duration'] }, modeInsertDurationMs: 300, modeInsertDuration: { labels: ['4초', '6초', '8초', '10초'], checked: '4초' } })
    const r = await runSettingsDriver(doc, { mode: 'video', ratio: '16:9', count: 1, model: 'Omni Flash', duration: 8, resolution: '720p' }, fakeSleep)
    expect(r).toMatchObject({ ok: true, steps: { duration: 'clicked(8)' } })
    expect(log).toEqual(['mode:videocam', 'duration:8초', 'keydown:Escape:27'])
    const doc2 = mount(imagePage())
    installFakeAngular(doc2, { modePanel: { omit: ['duration'] } })
    const t0 = Date.now()
    const r2 = await runSettingsDriver(doc2, { mode: 'video', ratio: '16:9', count: 1, model: 'Omni Flash', duration: 8, resolution: '720p' }, fakeSleep)
    expect(r2).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'group-not-found:duration', closed: true })
    expect(r2.shape.groups).toEqual(expect.arrayContaining(['mode', 'ratio', 'resolution', 'count']))
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500)
  })

  it('(b) 모델 클릭 뒤 패널이 계속 바뀌면(100ms 마다 길이 그룹 교체) 1.5s 상한에서 떨어지지 않고 settings-not-settled (클릭 전, 닫고 나온다)', async () => {
    vi.useFakeTimers()
    const doc = mount(videoPage({ durations: ['4초', '6초'] }))
    const log = installFakeAngular(doc, { modelSelectFlapMs: 100 })
    const r = await runSettingsDriver(doc, { ...VEO8, ratio: '16:9' }, fakeSleep)
    expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason: 'settings-not-settled', closed: true, steps: { model: 'clicked' } })
    expect(log.filter((l) => l.startsWith('duration:'))).toEqual([])
  })

  it('(b) Veo 가 이미 선택된 패널(그룹 없음, 변화 없음): 없음을 ≥1.5s 지켜본 뒤 fixed(8)·fixed(720p) 로 ok — 클릭 없음', async () => {
    vi.useFakeTimers()
    const doc = mount(veoPanel())
    const log = installFakeAngular(doc)
    const t0 = Date.now()
    const r = await runSettingsDriver(doc, VEO8, fakeSleep)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { model: 'already', duration: 'fixed(8)', resolution: 'fixed(720p)', ratio: 'already(crop_9_16)', input: 'material' } })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500)
    expect(log).toEqual(['keydown:Escape:27'])
  })

  it('(b) Veo → Omni 전환에서 Omni 그룹이 400ms 뒤에 그려지면(6초 체크) 안정 대기가 그룹을 보고 8초 클릭 — fixed 아님', async () => {
    vi.useFakeTimers()
    const doc = mount(veoPanel())
    const log = installFakeAngular(doc, { modelSelectInsertGroupsMs: 400, modelSelectInsertGroups: { durations: ['4초', '6초', '8초', '10초'], checkedDuration: '6초' } })
    const r = await runSettingsDriver(doc, { ...VEO8, model: 'Omni Flash' }, fakeSleep)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { model: 'clicked', duration: 'clicked(8)', resolution: 'already(720p)' } })
    expect(log).toEqual(['model-trigger', 'model:omni 1.1 flash', 'duration:8초', 'keydown:Escape:27'])
  })

  // (c) main: fixed 단계는 닫힌 요약으로 재검증 — 요약에 다른 길이·해상도 토큰이 있으면 클릭 전 거부(토큰 없음은 ok).
  describe('(c) applyComposerSettings — fixed 단계의 닫힌 요약 재검증', () => {
    const VEO_STEPS = { mode: 'already(videocam)', ratio: 'already(crop_9_16)', duration: 'fixed(8)', resolution: 'fixed(720p)', count: 'already(x1)', model: 'already', input: 'material' }
    let warn
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}) })
    afterEach(() => { vi.restoreAllMocks() })
    const mainRun = (steps, summaryText) => {
      const executeJavaScript = vi.fn(async (script) => {
        const s = String(script)
        if (s.includes('__af_settings_driver__')) return { ok: true, closed: true, steps }
        if (s.includes('settings-summary')) return { text: summaryText, ligatures: ['crop_9_16'] }
        return null
      })
      return applyComposerSettings({ webContents: { executeJavaScript } }, VEO8, { trustedClickOnFlowView: vi.fn(async () => ({ success: true })) })
    }
    it.each([
      ['동영상 · 720p · 6초 x1', 'duration-not-reflected', /summary duration=6 fixed=8/],
      ['Video · 720p · 6s x1', 'duration-not-reflected', /summary duration=6 fixed=8/],
      ['동영상 · 360p · 8초 x1', 'resolution-not-reflected', /summary resolution=360 fixed=720/],
    ])('요약 %s → %s (숫자만 로그)', async (text, reason, logRe) => {
      const r = await mainRun(VEO_STEPS, text)
      expect(r).toMatchObject({ ok: false, kind: 'flow-settings-not-applied', reason })
      const logs = warn.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(logs).toMatch(logRe)
      expect(logs).not.toContain(text)
    })
    it.each(['동영상 · 720p · 8초 x1', 'Video · 720p · 8s x1', 'Veo 3.1 - Fast x1', '동영상 x1'])('요약 %s (토큰 일치 또는 없음) → ok', async (text) => {
      expect(await mainRun(VEO_STEPS, text)).toEqual({ ok: true, steps: VEO_STEPS })
    })
    it('fixed 가 아닌 단계(already(6)·already(720p))는 요약 토큰과 무관하게 ok (기존 경로 불변)', async () => {
      const steps = { ...VEO_STEPS, duration: 'already(6)', resolution: 'already(720p)' }
      expect(await mainRun(steps, '동영상 · 720p · 6초 x1')).toEqual({ ok: true, steps })
    })
  })
})

// M2-CLOSE O6(B3): Omni → Veo 모델 전환은 실기(결과 3·4)로만 통과했다 — 가짜 Angular 에 Veo 선택이 길이·해상도 그룹을 **없애는** 옵션이 없어 어떤 N2 핀도 그 경로를 안 밟았다.
//   상한 안정 판정(마지막 3스캔의 패널 서명이 같고 클릭 전 서명에서 벗어남)에 "클릭 전엔 그룹이 있었는데 지금 없으면 미안정" 을 덧붙인 뮤턴트가 전체 스위트를 통과하면서
//   모든 Omni→Veo 전환을 settings-not-settled 로 만들었다. 이제 동기(0ms)·늦은(300ms) 제거 둘 다 fixed(8)·fixed(720p) 로 ok, 길이·해상도 클릭 없음.
describe('M2-CLOSE O6 — Omni → Veo 전환: 모델 항목 클릭이 길이·해상도 그룹을 없앤다 → fixed(8)·fixed(720p), 클릭 없음', () => {
  const fakeSleep = { sleep: (ms) => vi.advanceTimersByTimeAsync(ms) }
  afterEach(() => { vi.useRealTimers() })
  it.each([0, 300])('Omni 패널 → 목표 Veo 3.1 - Fast 8초/720p, 그룹 제거 %ims 뒤 → {ok, model:clicked, duration:fixed(8), resolution:fixed(720p)}', async (afterMs) => {
    vi.useFakeTimers()
    const doc = mount(videoPage())
    const log = installFakeAngular(doc, { modelSelectRemoveGroups: { afterMs } })
    const r = await runSettingsDriver(doc, { mode: 'video', ratio: '16:9', count: 1, model: 'Veo 3.1 - Fast', duration: 8, resolution: '720p' }, fakeSleep)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { model: 'clicked', duration: 'fixed(8)', resolution: 'fixed(720p)', ratio: 'already(crop_16_9)', count: 'already(x1)', input: 'material' } })
    expect(log).toEqual(['model-trigger', 'model:veo 3.1 - fast', 'keydown:Escape:27'])
    expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
  })
})
