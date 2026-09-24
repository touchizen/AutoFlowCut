// 가짜 Angular(설정 패널) — flow-composer-settings 드라이버 테스트 공용(jsdom 문서 `doc` 에 설치).
//   라디오 클릭은 그룹 안 aria-checked 를 옮기고, 모드 클릭은 패널을 통째로 갈아끼우며(자동 번호 offset 40),
//   모델 트리거는 메뉴를 열고 메뉴 항목은 트리거 라벨을 바꾼다. Escape 는 **document.body 에서 keyCode 27** 로만
//   닫힌다 — 실제 CDK 오버레이가 body 의 keydown 을 keyCode===27 로 판정한다(R1#3, 2026-09-24 실기: document 에
//   key:'Escape' 만 보낸 옛 드라이버는 패널을 못 닫았고 트리거 재클릭이 닫았다).
//   opts.modelReset 'sync'     : 모델 항목 클릭 핸들러가 duration/resolution 을 즉시 기본값(6초/720p)으로 되돌린다
//   opts.modelReset 'on-count' : 뒤의 count 클릭이 duration 을 기본값으로 되돌린다(지연 리셋)
//   opts.ignoreClicks          : 클릭에 반응하지 않는 그룹 이름 목록(합성 클릭을 무시하는 컨트롤 — needsTrusted 케이스)
//   opts.stickyPanel           : Escape 로 닫히지 않는다
//   opts.modelSubmenu          : (M2-2) 모델 메뉴 항목 클릭이 트리거 라벨을 바꾸지 않고 **하위 메뉴**만 연다(라이브 메뉴 항목엔
//                                mat-mdc-menu-trigger·aria-expanded 가 있어 하위 메뉴가 달려 있다 — 내용 미관측)
//   opts.modelMenuItems        : (M2-2) 메뉴 항목 목록 덮어쓰기(요청 모델이 없는 메뉴 — model-not-offered 케이스)
//   opts.escapeLeavesMenus     : (M2-R1 F6) Escape 가 패널 pane 만 닫고 열린 메뉴 pane 은 남긴다
//   opts.modelSelectDurations  : (M2-R3 H4) 모델 항목 클릭이 길이 그룹을 이 라벨 목록으로 갈아끼운다(모델마다 길이 옵션이 다르다 — 현재 체크값이 목록에 있으면 유지)
//   opts.modelSelectDelayMs    : (M2-R4 I7) 그 교체를 클릭 뒤 N ms 지나서 한다(라이브 페이지의 늦은 재렌더 — 고정 150ms 대기가 놓치는 경우)
// 리스너는 document/body 에 붙으므로 테스트마다 disposeFakeAngular() 로 이전 것을 abort 한다.
import { buildSettingsPanel, buildModelMenu, buildDurationGroup } from '../fixtures/flow-live-dom-20260924.js'

let fakeAngularAbort = null

export function disposeFakeAngular() {
  if (fakeAngularAbort) fakeAngularAbort.abort()
  fakeAngularAbort = null
}

export function installFakeAngular(doc, opts = {}) {
  disposeFakeAngular()
  // JSDOM 은 다른 realm 의 AbortSignal 을 거부한다 — 문서가 속한 window 의 AbortController 를 쓴다.
  const AC = (doc.defaultView && doc.defaultView.AbortController) || AbortController
  fakeAngularAbort = new AC()
  const signal = fakeAngularAbort.signal
  const log = []
  const setChecked = (btn) => {
    const name = btn.getAttribute('name')
    doc.querySelectorAll(`button[role="radio"][name="${name}"]`).forEach((b) => b.setAttribute('aria-checked', String(b === btn)))
  }
  const groupOf = (btn) => {
    const t = (btn.textContent || '').replace(/\s+/g, ' ').trim()
    const ligs = Array.from(btn.querySelectorAll('mat-icon')).map((i) => i.textContent.trim())
    if (ligs.some((l) => l === 'image' || l === 'videocam')) return 'mode'
    if (ligs.some((l) => /^crop_(16_9|9_16|landscape|square|portrait)$/.test(l))) return 'ratio'
    if (/^x\d$/.test(t)) return 'count'
    if (/\d+p/.test(t)) return 'resolution'
    // M2-2: 길이 라벨은 로케일마다 다르다('4초'·'4s') — 드라이버와 같은 "앞자리 정수" 규칙으로 분류한다.
    if (/^\d{1,2}\s*\D{0,8}$/.test(t)) return 'duration'
    return 'other'
  }
  const resetGroup = (group, key) => {
    const b = Array.from(doc.querySelectorAll('button[role="radio"]')).find((x) => groupOf(x) === group && (x.textContent.includes(key)))
    if (b) setChecked(b)
  }
  doc.addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn) return
    if (btn.getAttribute('role') === 'radio') {
      const g = groupOf(btn)
      const label = Array.from(btn.querySelectorAll('mat-icon')).map((i) => i.textContent.trim())[0] || btn.textContent.replace(/\s+/g, ' ').trim()
      log.push(`${g}:${label}`)
      if ((opts.ignoreClicks || []).includes(g)) return
      if (g === 'mode') {
        const toVideo = label === 'videocam'
        const overlay = doc.querySelector('.cdk-overlay-container')
        overlay.outerHTML = buildSettingsPanel({ mode: toVideo ? 'video' : 'image', offset: 40 })
        return
      }
      setChecked(btn)
      if (opts.modelReset === 'on-count' && g === 'count') resetGroup('duration', '6초')
      return
    }
    if (btn.getAttribute('aria-haspopup') === 'menu' && btn.closest('.flow-settings-panel')) {
      log.push('model-trigger')
      const open = btn.getAttribute('aria-expanded') === 'true'
      if (open) { doc.getElementById(btn.getAttribute('aria-controls'))?.closest('.cdk-overlay-pane')?.remove(); btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-controls'); return }
      doc.querySelector('.cdk-overlay-container').insertAdjacentHTML('beforeend', buildModelMenu('mat-menu-panel-20', opts.modelMenuItems))
      btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', 'mat-menu-panel-20')
      return
    }
    if (btn.getAttribute('role') === 'menuitem') {
      const text = btn.querySelector('.mat-mdc-menu-item-text').textContent.trim()
      log.push(`model:${text.toLowerCase()}`)
      if (opts.modelSubmenu) {
        // 하위 메뉴만 뜬다 — 트리거 라벨은 그대로, 항목은 aria-expanded=true, 두 번째 [role=menu] 가 오버레이에 추가된다.
        btn.setAttribute('aria-expanded', 'true')
        doc.querySelector('.cdk-overlay-container').insertAdjacentHTML('beforeend', buildModelMenu('mat-menu-panel-21', ['Fast 720p', 'Fast 1080p']))
        return
      }
      const trigger = doc.querySelector('.flow-settings-panel button[aria-haspopup="menu"]')
      trigger.querySelector('.mdc-button__label').textContent = text
      trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls')
      btn.closest('.cdk-overlay-pane').remove()
      if (opts.modelReset === 'sync') { resetGroup('duration', '6초'); resetGroup('resolution', '720p') }
      if (Array.isArray(opts.modelSelectDurations)) {
        const swapDurations = () => {
          const radios = Array.from(doc.querySelectorAll('button[role="radio"]')).filter((x) => groupOf(x) === 'duration')
          const checkedNow = (radios.find((x) => x.getAttribute('aria-checked') === 'true')?.textContent || '').replace(/\s+/g, ' ').trim()
          const group = radios[0]?.closest('mat-button-toggle-group')
          if (group) group.outerHTML = buildDurationGroup(opts.modelSelectDurations, checkedNow)
        }
        // M2-R4 I7: 지연 교체 — 라이브 Angular 가 그룹을 나중에 다시 그리는 경우
        if (opts.modelSelectDelayMs > 0) setTimeout(swapDurations, opts.modelSelectDelayMs)
        else swapDurations()
      }
    }
  }, { signal })
  // CDK 오버레이 흉내: body 의 keydown 에서 keyCode===27 일 때만 닫는다(key:'Escape' 만으로는 안 닫힌다).
  //   M2-R1 F6: 실제 오버레이는 **스택**(패널 → 모델 메뉴 → 하위 메뉴) — Escape 하나는 맨 위 pane 하나만 닫는다. 마지막 pane 이 닫히면
  //   컨테이너도 사라진다. opts.escapeLeavesMenus 면 메뉴 pane 은 Escape 에 안 닫힌다("패널은 닫혔는데 메뉴가 남는" 케이스).
  doc.body.addEventListener('keydown', (e) => {
    log.push(`keydown:${e.key}:${e.keyCode}`)
    if (e.keyCode !== 27 || opts.stickyPanel) return
    const container = doc.querySelector('.cdk-overlay-container')
    if (!container) return
    const panes = Array.from(container.querySelectorAll('.cdk-overlay-pane'))
    const closable = opts.escapeLeavesMenus ? panes.filter((p) => !p.querySelector('[role="menu"]')) : panes
    const top = closable[closable.length - 1]
    if (top) top.remove()
    if (!container.querySelector('.cdk-overlay-pane')) container.remove()
  }, { signal })
  return log
}
