import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveResourceDir } from '../../../electron/ipc/mcp.js'

// 🔴 회귀: dev 에서 patch-electron-name.cjs 가 electron 바이너리를 AutoFlowCut.app 으로 리네임해
//    app.isPackaged 가 true 로 거짓말한다. getResourceDir 가 그 플래그만 믿으면 dev 에서
//    process.resourcesPath/mcp-server (번들 없음) 를 가리켜 "MCP server not found" 로 죽는다.
//    resolveCodexAdapterPath / metaPrompts 처럼 실재 후보를 고른다.
describe('resolveResourceDir — app.isPackaged 거짓말 우회', () => {
  const RES = '/node_modules/electron/dist/AutoFlowCut.app/Contents/Resources'
  const APP = '/Users/x/workspace/AutoFlowCut'

  it('dev(isPackaged 거짓 true): resources 에 없고 appPath 에 있으면 appPath 를 고른다', () => {
    const exists = (p) => p === path.join(APP, 'mcp-server') // dev 레이아웃에만 존재
    expect(resolveResourceDir({
      name: 'mcp-server', resourcesPath: RES, appPath: APP, isPackaged: true, existsSyncImpl: exists,
    })).toBe(path.join(APP, 'mcp-server'))
  })

  it('진짜 packaged: resources 에 있으면 resources 를 고른다', () => {
    const PRES = '/Applications/AutoFlowCut.app/Contents/Resources'
    const exists = (p) => p === path.join(PRES, 'mcp-server')
    expect(resolveResourceDir({
      name: 'mcp-server', resourcesPath: PRES, appPath: '/Applications/AutoFlowCut.app/Contents/Resources/app.asar',
      isPackaged: true, existsSyncImpl: exists,
    })).toBe(path.join(PRES, 'mcp-server'))
  })

  it('둘 다 있으면 packaged(resources) 후보를 우선한다', () => {
    const exists = () => true
    expect(resolveResourceDir({
      name: 'skills', resourcesPath: RES, appPath: APP, isPackaged: true, existsSyncImpl: exists,
    })).toBe(path.join(RES, 'skills'))
  })

  it('아무 데도 없으면: isPackaged=true 는 resources, false 는 appPath 후보를 돌려준다(에러메시지용)', () => {
    const exists = () => false
    expect(resolveResourceDir({
      name: 'mcp-server', resourcesPath: RES, appPath: APP, isPackaged: true, existsSyncImpl: exists,
    })).toBe(path.join(RES, 'mcp-server'))
    expect(resolveResourceDir({
      name: 'mcp-server', resourcesPath: RES, appPath: APP, isPackaged: false, existsSyncImpl: exists,
    })).toBe(path.join(APP, 'mcp-server'))
  })
})
