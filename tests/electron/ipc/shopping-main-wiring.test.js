// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../../electron/main.js', import.meta.url), 'utf8')

describe('shopping IPC main wiring', () => {
  it('registers Story and Shopping with one main-owned coordinator and canonical work-folder authority', () => {
    expect(source).toMatch(/import \{ registerShoppingIPC \} from '\.\/ipc\/shopping-api\.js'/)
    expect(source).toMatch(/import \{ createBrowserProductFetch \} from '\.\/shopping\/browserProductFetch\.js'/)
    expect(source).toMatch(/const workflowSessions = createWorkflowSessionCoordinator\(\)/)
    expect(source).toMatch(/const workFolderAuthority = createWorkFolderAuthority\(\{[\s\S]*?onChange: \(\) => workflowSessions\.invalidate\(\),[\s\S]*?\}\)/)
    expect(source).toMatch(/registerFilesystemIPC\(ipcMain, \{ workFolderAuthority \}\)/)
    expect(source).toMatch(/registerStoryIPC\(ipcMain, \{[\s\S]*?getActiveWorkFolder: \(\) => workFolderAuthority\.getVerifiedContext\(\),[\s\S]*?workflowSessions,[\s\S]*?\}\)/)
    expect(source).toMatch(/registerShoppingIPC\(ipcMain, \{[\s\S]*?getWindow: \(\) => mainWindow,[\s\S]*?httpFetch: createBrowserProductFetch\([\s\S]*?createView:[\s\S]*?new WebContentsView\([\s\S]*?partition: 'persist:shopping',[\s\S]*?sandbox: true,[\s\S]*?\}\),[\s\S]*?getActiveWorkFolder: \(\) => workFolderAuthority\.getVerifiedContext\(\),[\s\S]*?workflowSessions,[\s\S]*?\}\)/)
    expect(source).toMatch(/ipcMain\.on\('shopping:crawl-view-bounds'/)
    expect(source).toMatch(/normalizeShoppingCrawlBounds\(\s*bounds,\s*mainWindow\.getContentBounds\(\),\s*mainWindow\.webContents\.zoomFactor,?\s*\)/)
    expect(source).toMatch(/shopping:crawl-status/)
    expect(source).toMatch(/getWarmupCookie: \(view\) => view\.webContents\.session\.cookies\.get\(\{\s*url: 'https:\/\/www\.coupang\.com',\s*name: '_abck',?\s*\}\)/)
    expect(source).toMatch(/onViewClosed: \(view\) => \{[\s\S]*?shoppingCrawlView === view[\s\S]*?shoppingCrawlView = null/)
    expect(source).toMatch(/registerLayoutIPC\([\s\S]*?\(\) => shoppingCrawlView,[\s\S]*?\(\) => shoppingCrawlBounds,[\s\S]*?\)/)
    expect(source).not.toMatch(/app:project-activated[\s\S]{0,180}activeWorkFolder\s*=/)
  })
})
