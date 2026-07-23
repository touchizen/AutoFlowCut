// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../../electron/main.js', import.meta.url), 'utf8')

describe('shopping IPC main wiring', () => {
  it('registers Shopping next to Story with the active work folder and window providers', () => {
    expect(source).toMatch(/import \{ registerShoppingIPC \} from '\.\/ipc\/shopping-api\.js'/)
    expect(source).toMatch(/registerShoppingIPC\(ipcMain, \{[\s\S]*?getWindow: \(\) => mainWindow,[\s\S]*?getActiveWorkFolder: \(\) => activeWorkFolder,[\s\S]*?\}\)/)
  })
})
