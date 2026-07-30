// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../../electron/main.js', import.meta.url), 'utf8')

describe('shopping IPC main wiring', () => {
  it('registers Story and Shopping with one main-owned coordinator and canonical work-folder authority', () => {
    expect(source).toMatch(/import \{ registerShoppingIPC \} from '\.\/ipc\/shopping-api\.js'/)
    expect(source).toMatch(/import puppeteer from 'puppeteer-core'/)
    expect(source).toMatch(/import \{ createCdpProductFetch, findBrowserExecutable \} from '\.\/shopping\/cdpProductFetch\.js'/)
    expect(source).toMatch(/const workflowSessions = createWorkflowSessionCoordinator\(\)/)
    expect(source).toMatch(/const workFolderAuthority = createWorkFolderAuthority\(\{[\s\S]*?onChange: \(\) => workflowSessions\.invalidate\(\),[\s\S]*?\}\)/)
    expect(source).toMatch(/registerFilesystemIPC\(ipcMain, \{ workFolderAuthority \}\)/)
    expect(source).toMatch(/registerStoryIPC\(ipcMain, \{[\s\S]*?getActiveWorkFolder: \(\) => workFolderAuthority\.getVerifiedContext\(\),[\s\S]*?workflowSessions,[\s\S]*?\}\)/)
    expect(source).toMatch(/registerShoppingIPC\(ipcMain, \{[\s\S]*?getWindow: \(\) => mainWindow,[\s\S]*?cdpProductFetch: createCdpProductFetch\(\{[\s\S]*?launchBrowser: \(options\) => puppeteer\.launch\(options\),[\s\S]*?findBrowserExecutable,[\s\S]*?\}\),[\s\S]*?getActiveWorkFolder: \(\) => workFolderAuthority\.getVerifiedContext\(\),[\s\S]*?workflowSessions,[\s\S]*?\}\)/)
    expect(source).not.toMatch(/createBrowserProductFetch\(|installShoppingSessionFingerprint\(/)
    expect(source).not.toMatch(/shoppingCrawlView|shoppingCrawlBounds|shopping:crawl-view-bounds/)
    expect(source).not.toMatch(/app:project-activated[\s\S]{0,180}activeWorkFolder\s*=/)
  })

  it('encrypted Gemini BYOK에서 shopping structured LLM과 generatePlan을 조립해 DI한다', () => {
    expect(source).toContain("import { createGeneratePlan } from './shopping/generatePlan.js'")
    expect(source).toContain("import { createGeminiShoppingLlm } from './shopping/shoppingLlmGemini.js'")
    expect(source).toMatch(/const shoppingLlm = createGeminiShoppingLlm\(\{\s*getApiKey: \(\) => genaiKeyStore\.getKey\(\),\s*\}\)/)
    expect(source).not.toMatch(/const shoppingLlmUsage = createUsageTracker\(\)/)
    expect(source).toMatch(/const generateShoppingPlan = createGeneratePlan\(\{ llm: shoppingLlm \}\)/)
    expect(source).toMatch(/registerShoppingIPC\(ipcMain, \{[\s\S]*?generatePlan: generateShoppingPlan,[\s\S]*?workflowSessions,[\s\S]*?\}\)/)
  })
})
