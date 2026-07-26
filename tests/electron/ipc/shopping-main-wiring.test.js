// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../../electron/main.js', import.meta.url), 'utf8')

describe('shopping IPC main wiring', () => {
  it('registers Story and Shopping with one main-owned coordinator and canonical work-folder authority', () => {
    expect(source).toMatch(/import \{ registerShoppingIPC \} from '\.\/ipc\/shopping-api\.js'/)
    expect(source).toMatch(/const workFolderAuthority = createWorkFolderAuthority\(\)/)
    expect(source).toMatch(/const workflowSessions = createWorkflowSessionCoordinator\(\)/)
    expect(source).toMatch(/registerFilesystemIPC\(ipcMain, \{ workFolderAuthority \}\)/)
    expect(source).toMatch(/registerStoryIPC\(ipcMain, \{[\s\S]*?getActiveWorkFolder: \(\) => workFolderAuthority\.getCanonicalPath\(\),[\s\S]*?workflowSessions,[\s\S]*?\}\)/)
    expect(source).toMatch(/registerShoppingIPC\(ipcMain, \{[\s\S]*?getWindow: \(\) => mainWindow,[\s\S]*?getActiveWorkFolder: \(\) => workFolderAuthority\.getCanonicalPath\(\),[\s\S]*?workflowSessions,[\s\S]*?\}\)/)
    expect(source).not.toMatch(/app:project-activated[\s\S]{0,180}activeWorkFolder\s*=/)
  })
})
