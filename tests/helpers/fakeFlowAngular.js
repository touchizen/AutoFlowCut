// 가짜 Angular(설정 패널) — flow-composer-settings 드라이버 테스트 공용(jsdom 문서 `doc` 에 설치).
//   라디오 클릭은 그룹 안 aria-checked 를 옮기고, 모드 클릭은 패널을 통째로 갈아끼우며(자동 번호 offset 40),
//   모델 트리거는 메뉴를 열고 메뉴 항목은 트리거 라벨을 바꾼다. Escape 는 **document.body 에서 keyCode 27** 로만
//   닫힌다 — 실제 CDK 오버레이가 body 의 keydown 을 keyCode===27 로 판정한다(R1#3, 2026-09-24 실기: document 에
//   key:'Escape' 만 보낸 옛 드라이버는 패널을 못 닫았고 트리거 재클릭이 닫았다).
//   opts.modelReset 'sync'     : 모델 항목 클릭 핸들러가 duration/resolution 을 즉시 기본값(6초/720p)으로 되돌린다
//   opts.modelReset 'on-count' : 뒤의 count 클릭이 duration 을 기본값으로 되돌린다(지연 리셋). (M2-LIVE N6) 되돌림은 그룹 element 를 갈아끼운다 — resetReplaceDelayMs 로 늦출 수 있다
//   opts.lockGroup / lockTo    : 그 그룹은 클릭해도 ~60ms 뒤 lockTo 로 되돌아간다(계속 되돌리는 페이지)
//   opts.ignoreClicks          : 클릭에 반응하지 않는 그룹 이름 목록(합성 클릭을 무시하는 컨트롤 — needsTrusted 케이스)
//   opts.stickyPanel           : Escape 로 닫히지 않는다
//   opts.modelSubmenu          : (M2-2) 모델 메뉴 항목 클릭이 트리거 라벨을 바꾸지 않고 **하위 메뉴**만 연다(라이브 메뉴 항목엔
//                                mat-mdc-menu-trigger·aria-expanded 가 있어 하위 메뉴가 달려 있다 — 내용 미관측)
//   opts.modelMenuItems        : (M2-2) 메뉴 항목 목록 덮어쓰기(요청 모델이 없는 메뉴 — model-not-offered 케이스)
//   opts.escapeLeavesMenus     : (M2-R1 F6) Escape 가 패널 pane 만 닫고 열린 메뉴 pane 은 남긴다
//   opts.modelSelectDurations  : (M2-R3 H4) 모델 항목 클릭이 길이 그룹을 이 라벨 목록으로 갈아끼운다(모델마다 길이 옵션이 다르다 — 현재 체크값이 목록에 있으면 유지)
//   opts.modelSelectDelayMs    : (M2-R4 I7) 그 교체를 클릭 뒤 N ms 지나서 한다(라이브 페이지의 늦은 재렌더 — 고정 150ms 대기가 놓치는 경우)
//   opts.modelSelectTwoStepMs  : (M2-R5 J6) 두 단계 재렌더 — 길이 그룹을 클릭 즉시 **떼고** N ms 뒤 modelSelectDurations 로 다시 붙인다(라이브 Angular 가 새 모델의 옵션을
//                                불러오는 동안 그룹이 잠깐 사라지는 경우 — "그룹 없음" 스캔을 안정으로 세면 group-not-found:duration)
//   opts.modelSelectInterim    : (M2-R5 J6) 두 단계 재렌더 사이의 **중간** 상태 {durations, atMs} — 최종 교체(modelSelectTwoStepMs) 전 atMs 에 다른 옵션 집합이 잠깐 붙는다
//                                (연속 3회 미만의 과도 상태 — 첫 이탈 스캔이나 연속 2회에서 멈추면 중간 옵션으로 계획해 duration-not-offered)
//   opts.modelSelectInsertGroupsMs : (M2-LIVE N2, B1 프로브) 모델 항목 클릭 N ms 뒤 **없던** 해상도·길이 그룹을 패널에 끼워 넣는다(Veo 패널 → Omni 로 전환하면
//                                Angular 가 Omni 의 그룹을 늦게 그린다) — modelSelectInsertGroups {durations, checkedDuration, resolutions, checkedResolution}
//   opts.modelSelectFlapMs     : (M2-LIVE N2) 모델 항목 클릭 뒤 길이 그룹을 N ms 마다 두 옵션 집합으로 계속 갈아끼운다(영영 안정되지 않는 패널 — settings-not-settled)
//   opts.modePanel             : (M2-LIVE N2, A2 시나리오) 모드 클릭이 갈아끼우는 패널의 buildSettingsPanel 옵션(예: {model:'Veo 3.1 - Fast', omit:['duration']})
//   opts.modeInsertDurationMs  : (M2-LIVE N2, A2 시나리오) 모드 클릭 N ms 뒤 길이 그룹을 끼워 넣는다 — modeInsertDuration {labels, checked}
//   opts.modelSelectRemoveGroups : (M2-CLOSE O6, B3) {afterMs} — **Veo** 항목 클릭이 해상도·길이 행을 없앤다(실기 2026-09-25: Veo 3.1 - Fast 패널엔 두 그룹이 없다).
//                                afterMs 0 이면 동기, 아니면 N ms 뒤(Angular 의 늦은 재렌더). Omni → Veo 전환의 fixed(8)/fixed(720p) 경로를 재현한다
// 리스너는 document/body 에 붙으므로 테스트마다 disposeFakeAngular() 로 이전 것을 abort 한다.
import { buildSettingsPanel, buildModelMenu, buildDurationGroup, buildResolutionGroup } from '../fixtures/flow-live-dom-20260924.js'

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
  // M2-LIVE N2: 없던 그룹을 패널에 끼워 넣는다(모델 트리거 행 뒤) — 라이브 Angular 가 새 모델의 그룹을 늦게 그리는 경우
  const insertRowAfterModel = (html) => {
    const trigger = doc.querySelector('.flow-settings-panel button[aria-haspopup="menu"]')
    const row = trigger && trigger.closest('.setting-row')
    if (row) row.insertAdjacentHTML('afterend', `<div class="setting-row">${html}</div>`)
  }
  // M2-LIVE N6(B5): 되돌림은 aria-checked 를 옮긴 뒤 그룹 element 를 **갈아끼운다**(outerHTML — 라이브 Angular 는 상태를 바꾸고 곧 다시 그린다) 그래서 옛 참조는 떨어진
  //   노드가 된다. replaceDelayMs 가 있으면 다시 그리기를 그만큼 늦춘다 — 드라이버의 최종 재판독(+100ms) 뒤·2차 패스(+400ms) 전에 그려져야, 재스캔 없이 재판독의 클릭 목록을
  //   재사용하는 뮤턴트가 떨어진 노드를 눌러 not-checked 로 끝난다(동기 교체면 재판독이 이미 새 노드를 본다).
  const resetGroup = (group, key, replaceDelayMs = 0) => {
    const b = Array.from(doc.querySelectorAll('button[role="radio"]')).find((x) => groupOf(x) === group && (x.textContent.includes(key)))
    if (!b) return
    setChecked(b)
    const name = b.getAttribute('name')
    const replace = () => { const g = doc.querySelector(`button[role="radio"][name="${name}"]`)?.closest('mat-button-toggle-group'); if (g) g.outerHTML = g.outerHTML }
    if (replaceDelayMs > 0) setTimeout(replace, replaceDelayMs); else replace()
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
        overlay.outerHTML = buildSettingsPanel({ mode: toVideo ? 'video' : 'image', offset: 40, ...(opts.modePanel || {}) })
        // M2-LIVE N2(A2): 모드 전환 뒤 길이 그룹이 늦게 그려진다(현재 체크값은 Flow 가 기억한 값)
        if (toVideo && opts.modeInsertDurationMs > 0 && opts.modeInsertDuration) {
          setTimeout(() => insertRowAfterModel(buildDurationGroup(opts.modeInsertDuration.labels, opts.modeInsertDuration.checked, 40)), opts.modeInsertDurationMs)
        }
        return
      }
      setChecked(btn)
      if (opts.modelReset === 'on-count' && g === 'count') resetGroup('duration', '6초', opts.resetReplaceDelayMs || 0)
      // 실기: 페이지가 그룹을 계속 되돌린다(클릭 뒤 ~60ms) — 2차 패스로도 못 맞추면 fail-closed 여야 한다
      if (opts.lockGroup === g) setTimeout(() => resetGroup(g, opts.lockTo), 60)
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
      // M2-CLOSE O6(B3): Veo 항목 클릭이 길이·해상도 행을 없앤다 — afterMs 0 이면 동기, 아니면 N ms 뒤
      if (opts.modelSelectRemoveGroups && /veo/i.test(text)) {
        const remove = () => {
          for (const g of ['duration', 'resolution']) {
            const radios = Array.from(doc.querySelectorAll('button[role="radio"]')).filter((x) => groupOf(x) === g)
            const row = radios[0] && (radios[0].closest('.setting-row') || radios[0].closest('mat-button-toggle-group'))
            if (row) row.remove()
          }
        }
        const ms = Number(opts.modelSelectRemoveGroups.afterMs) || 0
        if (ms > 0) setTimeout(remove, ms); else remove()
      }
      // M2-LIVE N2(B1 프로브): 그룹이 없던 패널(Veo)에서 Omni 로 — Angular 가 Omni 의 해상도·길이 그룹을 N ms 뒤에 그린다(체크값은 Flow 가 기억한 값)
      if (opts.modelSelectInsertGroupsMs > 0 && opts.modelSelectInsertGroups) {
        const g = opts.modelSelectInsertGroups
        setTimeout(() => {
          insertRowAfterModel(buildDurationGroup(g.durations, g.checkedDuration, 40))
          insertRowAfterModel(buildResolutionGroup(g.resolutions || ['360p', '720p'], g.checkedResolution || '720p', 40))
        }, opts.modelSelectInsertGroupsMs)
      }
      // M2-LIVE N2: 영영 안정되지 않는 패널 — 길이 그룹을 N ms 마다 두 옵션 집합으로 번갈아 갈아끼운다
      if (opts.modelSelectFlapMs > 0) {
        const sets = [['4초', '6초'], ['4초', '6초', '8초']]
        let k = 0
        const flap = () => {
          if (signal.aborted) return
          const radios = Array.from(doc.querySelectorAll('button[role="radio"]')).filter((x) => groupOf(x) === 'duration')
          const group = radios[0]?.closest('mat-button-toggle-group')
          if (group) group.outerHTML = buildDurationGroup(sets[k++ % 2], '4초')
          setTimeout(flap, opts.modelSelectFlapMs)
        }
        setTimeout(flap, opts.modelSelectFlapMs)
      }
      if (Array.isArray(opts.modelSelectDurations)) {
        const swapDurations = () => {
          const radios = Array.from(doc.querySelectorAll('button[role="radio"]')).filter((x) => groupOf(x) === 'duration')
          const checkedNow = (radios.find((x) => x.getAttribute('aria-checked') === 'true')?.textContent || '').replace(/\s+/g, ' ').trim()
          const group = radios[0]?.closest('mat-button-toggle-group')
          if (group) group.outerHTML = buildDurationGroup(opts.modelSelectDurations, checkedNow)
        }
        // M2-R5 J6: 두 단계 재렌더 — 그룹을 먼저 떼고(자리에 주석 마커) N ms 뒤 새 옵션으로 같은 자리에 다시 붙인다
        if (opts.modelSelectTwoStepMs > 0) {
          const radios = Array.from(doc.querySelectorAll('button[role="radio"]')).filter((x) => groupOf(x) === 'duration')
          const checkedNow = (radios.find((x) => x.getAttribute('aria-checked') === 'true')?.textContent || '').replace(/\s+/g, ' ').trim()
          const group = radios[0]?.closest('mat-button-toggle-group')
          if (group) {
            let slot = doc.createComment('duration-group-pending')
            group.parentNode.replaceChild(slot, group)
            const put = (labels) => {
              const tpl = doc.createElement('template')
              tpl.innerHTML = buildDurationGroup(labels, checkedNow)
              const el = tpl.content.firstElementChild
              slot.parentNode.replaceChild(el, slot)
              slot = el
            }
            if (opts.modelSelectInterim) setTimeout(() => put(opts.modelSelectInterim.durations), opts.modelSelectInterim.atMs)
            setTimeout(() => put(opts.modelSelectDurations), opts.modelSelectTwoStepMs)
          }
        // M2-R4 I7: 지연 교체 — 라이브 Angular 가 그룹을 나중에 다시 그리는 경우
        } else if (opts.modelSelectDelayMs > 0) setTimeout(swapDurations, opts.modelSelectDelayMs)
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
