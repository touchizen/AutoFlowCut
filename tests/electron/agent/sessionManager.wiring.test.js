// @vitest-environment node
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const mainSource = () => readFile(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')

describe('main AgentSessionManager ownership wiring', () => {
  it('app-scoped owner만 부팅 때 만들고 세션 범위 실행 묶음은 manager open에 맡긴다', async () => {
    const main = await mainSource()

    expect(main).toMatch(/import \{ createAgentSessionManager \} from '\.\/agent\/sessionManager\.js'/)
    expect(main).toMatch(/import \{ createAgentEventForwarder, defaultModelCatalog, registerAgentIPC \} from '\.\/ipc\/agent-api\.js'/)
    expect(main).toMatch(/const agentEvents = createAgentEventForwarder\(\{ getWindow: \(\) => mainWindow \}\)/)
    expect(main).toMatch(/const agentSessionManager = createAgentSessionManager\(\{[\s\S]*?grantLedger,[\s\S]*?approvalPrompt,[\s\S]*?toolBridge,[\s\S]*?storyCommands,[\s\S]*?modelCatalog: defaultModelCatalog,[\s\S]*?isPackaged: app\.isPackaged,[\s\S]*?resourcesPath: process\.resourcesPath,[\s\S]*?\.\.\.agentEvents,[\s\S]*?\}\)/)
    expect(main).toMatch(/registerAgentIPC\(ipcMain, \{[\s\S]*?sessionManager: agentSessionManager,[\s\S]*?modelCatalog: defaultModelCatalog,[\s\S]*?getWindow: \(\) => mainWindow,[\s\S]*?\}\)/)

    expect(main).not.toMatch(/\bcreateToolCore\s*\(/)
    expect(main).not.toMatch(/\bcreatePrivateRpc\s*\(/)
    expect(main).not.toMatch(/\bcreateElicitationResponder\s*\(/)
    expect(main).not.toMatch(/\bagentSessionId\b/)
    expect(main).not.toMatch(/\bagentRpc\b/)
  })

  it('app-scoped permission listener는 한 번뿐이고 will-quit이 manager/prompt/bridge를 모두 닫는다', async () => {
    const main = await mainSource()
    const permissionListeners = main.match(/ipcMain\.on\('agent:permission-response'/g) ?? []

    expect(permissionListeners).toHaveLength(1)
    expect(main).toMatch(/app\.on\('will-quit',[\s\S]*?agentSessionManager\.close\(\)\.catch\(\(\) => \{\}\)[\s\S]*?approvalPrompt\.close\(\)[\s\S]*?toolBridge\.close\(\)/)
  })
})
