// @vitest-environment node
//
// M2-LIVE N1 — main.js 배선(소스 정책, 다른 main.js 핀과 같은 방식: main.js 는 Electron 을 부팅해야 해서 실행 테스트가 없다).
//   제자리 자동화 뷰포트 동안 사용자 포인터 입력을 삼키는 **최상위 투명 방패 뷰**: flowAPIDeps.createInputShield 가 WebContentsView 를
//   투명 배경·about:blank 로 만들어 mainWindow.contentView 에 Flow 뷰 **뒤에**(위에) 붙이고 창 콘텐츠 크기로 두며, remove() 가 떼고 닫는다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MAIN = readFileSync(fileURLToPath(new URL('../../electron/main.js', import.meta.url)), 'utf8')
const fnBlock = (name) => {
  const start = MAIN.indexOf(`function ${name}(`)
  if (start < 0) return null
  return MAIN.slice(start, MAIN.indexOf('\n}\n', start))
}
/** M2-LAST P1: `view.webContents.on('<event>', …)` 핸들러 블록(2칸 들여쓰기의 `\n  })` 까지 — flow-rpc-capture-wiring 과 같은 꼴). */
const handlerBlock = (event) => {
  const start = MAIN.indexOf(`view.webContents.on('${event}'`)
  if (start < 0) return null
  return MAIN.slice(start, MAIN.indexOf('\n  })', start))
}

describe('main.js — 입력 방패(createInputShield) 배선 (M2-LIVE N1)', () => {
  it('flowAPIDeps 가 createInputShield 를 싣는다', () => {
    const deps = MAIN.slice(MAIN.indexOf('const flowAPIDeps = {'), MAIN.indexOf('registerFlowAPIIPC(ipcMain, flowAPIDeps)'))
    expect(deps).toMatch(/createInputShield:\s*makeInputShield\b/)
  })
  it('makeInputShield: 투명 WebContentsView + about:blank, contentView 에 추가(Flow 뷰 뒤 = 위), 창 콘텐츠 크기, remove() 가 떼고 닫는다', () => {
    const b = fnBlock('makeInputShield')
    expect(b, 'makeInputShield block').toBeTruthy()
    expect(b).toMatch(/new WebContentsView\(/)
    expect(b).toMatch(/setBackgroundColor\('#00000000'\)/)
    expect(b).toMatch(/loadURL\('about:blank'\)/)
    expect(b).toMatch(/contentView\.addChildView\(shield\)/)
    expect(b).toMatch(/getContentBounds\(\)/)
    expect(b).toMatch(/shield\.setBounds\(\{ x: 0, y: 0, width, height \}\)/)
    expect(b).toMatch(/remove\(\)\s*\{[\s\S]*removeChildView\(shield\)[\s\S]*webContents\.close\(\)/)
    // 방패는 페이지 스크립트를 돌리지 않는다(sandbox, preload 없음)
    expect(b).toMatch(/sandbox:\s*true/)
    expect(b).not.toMatch(/preload/)
  })
})

// M2-CLOSE O1(A1): DOM 단계 동안 사용자의 키 입력을 Flow 뷰에 넣지 않는다 — makeFlowView 가 before-input-event 를 automationKeyLock 으로 preventDefault 하고,
//   flowAPIDeps.setAutomationKeyLock 이 그 플래그를 켜고 끈다(래퍼가 진입·finally 에서). 앱의 Angular 자동화는 executeJavaScript 와 마우스 sendInputEvent 뿐이라
//   (Escape 는 페이지 안 DOM 이벤트) 잠금이 자동화를 막지 않는다 — 그 전제도 여기서 핀.
describe('main.js — DOM 단계 키 입력 잠금 배선 (M2-CLOSE O1)', () => {
  it('makeFlowView 가 before-input-event 를 automationKeyLock 으로 preventDefault 하고, flowAPIDeps 가 setAutomationKeyLock 을 싣는다', () => {
    const b = fnBlock('makeFlowView')
    expect(b, 'makeFlowView block').toBeTruthy()
    // 줄머리 앵커(^\s*) — 주석 처리된 줄(// view.webContents.on(…))은 매치되지 않는다(뮤테이션 O1-f 가 그 구멍을 보였다)
    expect(b).toMatch(/^\s*view\.webContents\.on\('before-input-event',\s*\((\w+)\)\s*=>\s*\{\s*if \(automationKeyLock\)\s*\1\.preventDefault\(\)/m)
    const deps = MAIN.slice(MAIN.indexOf('const flowAPIDeps = {'), MAIN.indexOf('registerFlowAPIIPC(ipcMain, flowAPIDeps)'))
    expect(deps).toMatch(/^\s*setAutomationKeyLock:\s*\(on\)\s*=>\s*\{\s*automationKeyLock = !!on\s*\}/m)
    expect(MAIN).toMatch(/^let automationKeyLock = false/m)
  })
  it('Angular DOM 경로(flow-angular · flow-composer-settings · shared 의 신뢰 클릭)는 sendInputEvent 키 이벤트를 보내지 않는다 — 잠금이 자동화를 막지 않는다', () => {
    for (const f of ['../../electron/ipc/flow-angular.js', '../../electron/flow-composer-settings.js', '../../electron/ipc/shared.js']) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
      expect(src, f).not.toMatch(/sendInputEvent\(\{\s*type:\s*'(keyDown|keyUp|char|rawKeyDown)'/)
    }
  })
})

// M2-CLOSE O5(A5): 사용자가 방패를 누르면 방패 webContents 가 OS 포커스를 가져간다 — 캐럿 클릭~주입 사이에 포커스가 빠지면 execCommand 주입이 안 먹어 재판독 불일치
//   (text-injection-failed, 항목은 재시도로 유실). 방패는 포커스를 받는 즉시 Flow 뷰로 돌려준다(핸들러도 주입 직전에 focus 를 다시 건다 — 핸들러 스위트 핀).
describe('main.js — 방패의 포커스 되돌리기 배선 (M2-CLOSE O5)', () => {
  it("makeInputShield 가 shield.webContents.on('focus') 에서 getFlowView()?.webContents.focus() 를 부른다", () => {
    const b = fnBlock('makeInputShield')
    expect(b, 'makeInputShield block').toBeTruthy()
    expect(b).toMatch(/^\s*shield\.webContents\.on\('focus',\s*\(\)\s*=>\s*\{[^\n]*getFlowView\(\)\?\.webContents\.focus\(\)/m)
  })
})

// M2-LAST P1(A1 = B1): 문서가 죽으면(메인 프레임 did-navigate 커밋 · render-process-gone) 그 문서의 executeJavaScript 는 영영 settle 하지 않는다 — flow-angular 의 DOM 단계 직렬화 기록
//   (lastDomStage)을 releaseDomStage(reason) 로 비운다(failBoundUnfinished 옆). SPA 내비게이션(did-navigate-in-page)은 문서가 살아 있으므로 풀지 않는다. 줄머리 앵커(주석 처리에 눈멀지 않게).
describe('main.js — 문서가 죽으면 DOM 단계 직렬화를 푸는 배선 (M2-LAST P1)', () => {
  it("flow-angular 의 releaseDomStage 를 import 하고, did-navigate 가 releaseDomStage('did-navigate') 를, render-process-gone 이 releaseDomStage('render-process-gone') 을 부른다", () => {
    expect(MAIN).toMatch(/^import \{[^}]*\breleaseDomStage\b[^}]*\} from '\.\/ipc\/flow-angular\.js'/m)
    const nav = handlerBlock('did-navigate')
    expect(nav, 'did-navigate handler').toBeTruthy()
    expect(nav).toMatch(/^\s*releaseDomStage\('did-navigate'\)/m)
    const gone = handlerBlock('render-process-gone')
    expect(gone, 'render-process-gone handler').toBeTruthy()
    expect(gone).toMatch(/^\s*releaseDomStage\('render-process-gone'\)/m)
  })
  it('did-navigate-in-page(SPA) 와 did-start-navigation 은 풀지 않는다 — 문서가 살아 있다(취소될 수 있다)', () => {
    expect(handlerBlock('did-navigate-in-page')).not.toMatch(/releaseDomStage/)
    const start = handlerBlock('did-start-navigation')
    if (start) expect(start).not.toMatch(/releaseDomStage/)
  })
})
