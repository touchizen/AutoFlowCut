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

  it('electron main의 /api/update가 공통 dispatch 결과로 응답한다', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.js'), 'utf8')

    expect(main).toContain("import { dispatchMcpUpdate, registerMcpIPC } from './ipc/mcp.js'")
    expect(main).toContain('await dispatchMcpUpdate(mainWindow.webContents, data)')
  })
})
