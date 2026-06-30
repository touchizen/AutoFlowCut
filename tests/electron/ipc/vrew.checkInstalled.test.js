// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const access = vi.hoisted(() => vi.fn())
vi.mock('fs/promises', () => ({
  default: { access, readFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn() },
  access,
}))
vi.mock('electron', () => ({ shell: { openPath: vi.fn() } }))

import { registerVrewIPC } from '../../../electron/ipc/vrew.js'

function makeIpc() {
  const handlers = new Map()
  return {
    handle: (name, fn) => handlers.set(name, fn),
    invoke: (name, payload) => handlers.get(name)({}, payload),
  }
}

const origPlatform = process.platform
function setPlatform(p) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true }))

describe('vrew:check-installed', () => {
  it('darwin: installed when /Applications/Vrew.app exists', async () => {
    setPlatform('darwin')
    access.mockImplementation(async (p) => { if (p === '/Applications/Vrew.app') return; throw new Error('ENOENT') })
    const ipc = makeIpc(); registerVrewIPC(ipc)
    expect(await ipc.invoke('vrew:check-installed')).toEqual({ installed: true })
  })

  it('returns { installed: false } when no Vrew app path exists', async () => {
    setPlatform('darwin')
    access.mockRejectedValue(new Error('ENOENT'))
    const ipc = makeIpc(); registerVrewIPC(ipc)
    expect(await ipc.invoke('vrew:check-installed')).toEqual({ installed: false })
  })

  it('win32: installed when a Vrew.exe candidate exists', async () => {
    setPlatform('win32')
    process.env.LOCALAPPDATA = 'C:\\Users\\me\\AppData\\Local'
    access.mockImplementation(async (p) => { if (String(p).includes('Vrew.exe')) return; throw new Error('ENOENT') })
    const ipc = makeIpc(); registerVrewIPC(ipc)
    expect(await ipc.invoke('vrew:check-installed')).toEqual({ installed: true })
  })
})
