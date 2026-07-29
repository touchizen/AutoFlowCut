import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const main = readFileSync(resolve(process.cwd(), 'electron/main.js'), 'utf8')

describe('main.js spike wiring', () => {
  it('calls registerSpikeShortcuts inside whenReady after createWindow', () => {
    const readyIndex = main.indexOf('app.whenReady')
    const createWindowIndex = main.indexOf('createWindow()', readyIndex)
    const registerCallIndex = main.indexOf('registerSpikeShortcuts(', readyIndex)
    expect(readyIndex).toBeGreaterThanOrEqual(0)
    expect(createWindowIndex).toBeGreaterThan(readyIndex)
    expect(registerCallIndex).toBeGreaterThan(createWindowIndex)
    expect(main).toContain("persist:chatgpt")   // makeView가 스파이크 파티션 사용
  })
  it('handles ChatGPT loadURL rejections', () => {
    expect(main).toContain('view.webContents.loadURL(CHATGPT_URL).catch(() => {})')
  })
  it('wires stale-view disposal to detach and close the WebContentsView', () => {
    expect(main).toMatch(/disposeView:\s*\(v\)\s*=>/)
    expect(main).toContain('mainWindow.contentView.removeChildView(v)')
    expect(main).toContain('v.webContents.close()')
  })
})
