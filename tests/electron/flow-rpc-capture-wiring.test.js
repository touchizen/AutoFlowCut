// @vitest-environment node
//
// M1-3 — main.js 배선(소스 정책). main.js 는 Electron 을 부팅해야 해서 실행 테스트가 없다 — 배선은 소스로 핀한다.
//   (1) 캡처 주입은 did-navigate-in-page · dom-ready · did-finish-load 세 자리(진단 주입 injectNetTrace 옆)
//   (2) failBoundUnfinished(pendingGenerations) 는 did-navigate(문서 커밋)·render-process-gone 에서만 —
//       did-start-navigation 은 손대지 않는다(취소되는 내비게이션이 살아 있는 gen 을 죽이면 안 된다).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MAIN = readFileSync(fileURLToPath(new URL('../../electron/main.js', import.meta.url)), 'utf8')

/** `view.webContents.on('<event>', …)` 핸들러 블록(2칸 들여쓰기의 `\n  })` 까지). */
function handlerBlock(event) {
  const start = MAIN.indexOf(`view.webContents.on('${event}'`)
  if (start < 0) return null
  const end = MAIN.indexOf('\n  })', start)
  return MAIN.slice(start, end)
}

describe('main.js — batchexecute 캡처 주입 배선', () => {
  it('flow-rpc-capture.js 와 flow-rpc-router.js 를 import 한다', () => {
    expect(MAIN).toMatch(/import \{ FLOW_RPC_CAPTURE_INJECTION \} from '\.\/flow-rpc-capture\.js'/)
    expect(MAIN).toMatch(/import \{[^}]*failBoundUnfinished[^}]*\} from '\.\/flow-rpc-router\.js'/)
  })

  it.each(['did-navigate-in-page', 'dom-ready', 'did-finish-load'])('%s 에서 injectRpcCapture(view)', (event) => {
    const block = handlerBlock(event)
    expect(block, `${event} handler`).toBeTruthy()
    expect(block).toContain('injectRpcCapture(view)')
  })

  it('injectRpcCapture 는 FLOW_RPC_CAPTURE_INJECTION 을 executeJavaScript 한다', () => {
    expect(MAIN).toMatch(/function injectRpcCapture\(view\)[\s\S]*?executeJavaScript\(FLOW_RPC_CAPTURE_INJECTION\)/)
  })
})

describe('main.js — 문서 전환 시 바인딩 gen 실패 처리', () => {
  it('did-navigate(커밋) 핸들러가 failBoundUnfinished(pendingGenerations) 를 부른다', () => {
    expect(handlerBlock('did-navigate')).toContain('failBoundUnfinished(pendingGenerations)')
  })
  it('render-process-gone 핸들러가 failBoundUnfinished(pendingGenerations) 를 부른다', () => {
    expect(handlerBlock('render-process-gone')).toContain('failBoundUnfinished(pendingGenerations)')
  })
  it('did-start-navigation 은 손대지 않는다', () => {
    const block = handlerBlock('did-start-navigation')
    if (block) expect(block).not.toContain('failBoundUnfinished')
  })
  it('did-navigate-in-page(SPA) 는 gen 을 죽이지 않는다', () => {
    expect(handlerBlock('did-navigate-in-page')).not.toContain('failBoundUnfinished')
  })
})

describe('main.js — flow:report-response 는 buildReportCtx(state) 로 ctx 를 만든다 (M1-4)', () => {
  it('routeReportResponse(payload, buildReportCtx({…}))', () => {
    const block = MAIN.slice(MAIN.indexOf("ipcMain.handle('flow:report-response'"), MAIN.indexOf("ipcMain.handle('flow:report-xhr'"))
    expect(block).toMatch(/routeReportResponse\(payload, buildReportCtx\(/)
    expect(MAIN).toMatch(/import \{[^}]*buildReportCtx[^}]*\} from '\.\/reportResponseRouter\.js'/)
  })
})
