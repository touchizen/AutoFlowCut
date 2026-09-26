// @vitest-environment node
//
// M3-9 · M3-10 — main.js 배선(소스 정책 — main.js 는 Electron 을 부팅해야 해서 실행 테스트가 없다; 다른 main.js 핀과 같은 방식, 줄머리 앵커).
//   레퍼런스 업로드(계획서 2026-09-25 M3 D4)는 클립보드 이미지 + Flow 뷰의 webContents.paste() 로만 간다 — flowAPIDeps 가 핸들러(flow-angular.js 의
//   드라이버 ctx)에 clipboard · nativeImage · pasteIntoFlowView 를 싣는다. 세션 캐시는 flow-angular 가 모듈(refMediaCache)을 직접 쓴다.
//   (M3-15 의 main 배선 항목이 이 파일이다 — 계획서 §4. 같은 묶음의 키 이벤트 금지는 mainInputShieldWiring.test.js, 로그 정책은 noUserContentInLogs.test.js.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MAIN = readFileSync(fileURLToPath(new URL('../../electron/main.js', import.meta.url)), 'utf8')
const DEPS = MAIN.slice(MAIN.indexOf('const flowAPIDeps = {'), MAIN.indexOf('registerFlowAPIIPC(ipcMain, flowAPIDeps)'))

describe('main.js — 레퍼런스 업로드 배선 (M3 D4)', () => {
  it("electron 에서 clipboard · nativeImage 를 import 한다", () => {
    expect(MAIN).toMatch(/^import \{[^}]*\bclipboard\b[^}]*\} from 'electron'/m)
    expect(MAIN).toMatch(/^import \{[^}]*\bnativeImage\b[^}]*\} from 'electron'/m)
  })
  it('flowAPIDeps 가 clipboard · nativeImage · pasteIntoFlowView(() => Flow 뷰의 webContents.paste()) 를 싣는다', () => {
    expect(DEPS).toMatch(/^\s*clipboard,/m)
    expect(DEPS).toMatch(/^\s*nativeImage,/m)
    expect(DEPS).toMatch(/^\s*pasteIntoFlowView:\s*\(\)\s*=>\s*modeController\.getFlowView\(\)\?\.webContents\.paste\(\),/m)
  })
})
