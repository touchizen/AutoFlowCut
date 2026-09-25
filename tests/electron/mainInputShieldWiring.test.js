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
