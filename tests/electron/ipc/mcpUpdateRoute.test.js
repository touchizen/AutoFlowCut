import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app' },
}))

import * as mcpIpc from '../../../electron/ipc/mcp.js'

describe('MCP /api/update renderer dispatch', () => {
  it('imagePath update의 renderer busy를 HTTP 409로 전달한다', async () => {
    const webContents = {
      send: vi.fn(),
      executeJavaScript: vi.fn(async () => JSON.stringify({ success: false, error: 'busy' })),
    }
    const data = { type: 'update-scene', index: 0, fields: { imagePath: '/new.png' } }

    const result = await mcpIpc.dispatchMcpUpdate?.(webContents, data)

    expect(webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('__mcpUpdateScene'))
    expect(webContents.send).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 409, body: { success: false, error: 'busy' } })
  })

  it('idle image update는 renderer 적용 결과를 HTTP 200으로 전달한다', async () => {
    const webContents = {
      send: vi.fn(),
      executeJavaScript: vi.fn(async () => JSON.stringify({ success: true })),
    }
    const data = { type: 'update-scene', index: 0, fields: { image: 'base64' } }

    const result = await mcpIpc.dispatchMcpUpdate?.(webContents, data)

    expect(webContents.send).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 200, body: { success: true } })
  })

  it('subtitle update는 기존 mcp-update IPC 경로를 그대로 쓴다', async () => {
    const webContents = { send: vi.fn(), executeJavaScript: vi.fn() }
    const data = { type: 'update-scene', index: 0, fields: { subtitle: 'new' } }

    const result = await mcpIpc.dispatchMcpUpdate?.(webContents, data)

    expect(webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(webContents.send).toHaveBeenCalledWith('mcp-update', data)
    expect(result).toEqual({ status: 200, body: { success: true } })
  })

  it('electron main의 /api/update가 routeMcpUpdate 결과로 응답한다', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.js'), 'utf8')
    const route = main.slice(main.indexOf("pathname === '/api/update'"), main.indexOf("pathname === '/api/generate-reference'"))

    expect(main).toContain("import { registerMcpIPC, routeMcpUpdate } from './ipc/mcp.js'")
    expect(route).toContain('const updateResponse = await routeMcpUpdate(mainWindow.webContents, body)')
    expect(route).toContain('res.writeHead(updateResponse.status)')
    expect(route).toContain('res.end(JSON.stringify(updateResponse.body))')
    // 판정·전달은 routeMcpUpdate 한 곳에서만 — 라우트가 따로 보내거나 판정하면 아래 동작 테스트가 지키는 계약을 우회한다
    expect(route).not.toMatch(/decideUpdateRequest|dispatchMcpUpdate|\.send\(/)
  })
})

// self-render 병합(리뷰 B F1): main 의 화이트리스트 판정(400)과 self-render 의 렌더러 왕복(409)을 합친 /api/update 계약.
//   전엔 main.js 소스 문자열만 검사해서 분기를 뒤집거나(유효한 쓰기가 렌더러에 안 감) 400 을 빼거나 409 를 decided 200 으로 덮어도 초록이었다.
describe('routeMcpUpdate — POST /api/update 판정 → 렌더러 전달', () => {
  const makeWebContents = (rendererResult = { success: true }) => ({
    send: vi.fn(),
    executeJavaScript: vi.fn(async () => JSON.stringify(rendererResult)),
  })

  it('JSON 이 아니면 400 이고 렌더러에 아무것도 가지 않는다', async () => {
    const webContents = makeWebContents()
    const result = await mcpIpc.routeMcpUpdate(webContents, '{not json')
    expect(result).toEqual({ status: 400, body: { error: 'body must be a JSON object' } })
    expect(webContents.send).not.toHaveBeenCalled()
    expect(webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('update-settings 에 화이트리스트 밖 키가 있으면 400 + 키 이름이고 렌더러에 아무것도 가지 않는다', async () => {
    const webContents = makeWebContents()
    const result = await mcpIpc.routeMcpUpdate(webContents, JSON.stringify({ type: 'update-settings', fields: { projectName: 'B', videoResolution: '720p' } }))
    expect(result).toEqual({ status: 400, body: { error: 'update-settings: unknown or invalid fields', keys: ['projectName'] } })
    expect(webContents.send).not.toHaveBeenCalled()
    expect(webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('유효한 update-settings 는 파싱된 forward 를 mcp-update 로 보내고 200', async () => {
    const webContents = makeWebContents()
    const result = await mcpIpc.routeMcpUpdate(webContents, JSON.stringify({ type: 'update-settings', fields: { videoResolution: '720p' } }))
    expect(result).toEqual({ status: 200, body: { success: true } })
    expect(webContents.send).toHaveBeenCalledTimes(1)
    expect(webContents.send).toHaveBeenCalledWith('mcp-update', { type: 'update-settings', fields: { videoResolution: '720p' } })
    expect(webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('이미지 교체 update-scene 이 렌더러에서 busy 면 409 이고 mcp-update 는 보내지 않는다', async () => {
    const webContents = makeWebContents({ success: false, error: 'busy' })
    const result = await mcpIpc.routeMcpUpdate(webContents, JSON.stringify({ type: 'update-scene', index: 0, fields: { imagePath: '/new.png' } }))
    expect(result).toEqual({ status: 409, body: { success: false, error: 'busy' } })
    expect(webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(webContents.send).not.toHaveBeenCalled()
  })

  it('이미지가 아닌 update-scene 은 파싱된 본문을 mcp-update 로 보내고 200', async () => {
    const webContents = makeWebContents()
    const result = await mcpIpc.routeMcpUpdate(webContents, JSON.stringify({ type: 'update-scene', index: 1, fields: { subtitle: 'new' } }))
    expect(result).toEqual({ status: 200, body: { success: true } })
    expect(webContents.send).toHaveBeenCalledWith('mcp-update', { type: 'update-scene', index: 1, fields: { subtitle: 'new' } })
    expect(webContents.executeJavaScript).not.toHaveBeenCalled()
  })
})
