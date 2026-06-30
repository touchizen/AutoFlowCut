// @vitest-environment node
//
// #R34-fix: flow:refresh-composer 동시 호출 coalesce.
// card/modal/panel 이 fire-and-forget 으로 refresh 를 호출하면 공유 flowView 에서 loadURL 들이
// 서로 충돌(ERR_ABORTED)한다. 진행 중이면 같은 promise 를 돌려줘 navigation 을 한 번만 한다.
import { describe, it, expect, vi } from 'vitest'
import { registerCharacterIPC } from '../../../electron/ipc/character.js'

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)({}, payload),
  }
}

describe('#R34-fix: flow:refresh-composer coalescing', () => {
  it('동시 호출 3건이 1번의 navigation(ensureOnProjectComposer) 으로 합쳐진다', async () => {
    const ipc = makeIpcMain()
    let ensureCalls = 0
    const flowView = {
      webContents: {
        getURL: () => 'https://labs.google/fx', // '/project/' 없음 → leave 단계 skip
        loadURL: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn(),
        executeJavaScript: vi.fn().mockResolvedValue(true), // 컴포저 ready 즉시
      },
    }
    const deps = {
      getFlowView: () => flowView,
      getCurrentMode: () => 'flow',
      getMainWindow: () => null,
      getCapturedProjectId: () => 'pid-1',
      ensureOnProjectComposer: async () => { ensureCalls++ },
    }
    registerCharacterIPC(ipc, deps)

    const [a, b, c] = await Promise.all([
      ipc.invoke('flow:refresh-composer', {}),
      ipc.invoke('flow:refresh-composer', {}),
      ipc.invoke('flow:refresh-composer', {}),
    ])

    expect(ensureCalls).toBe(1) // 3건이 1번으로 coalesce
    expect(a).toEqual({ success: true })
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('coalesce 해제 후 다음 호출은 다시 navigation 한다', async () => {
    const ipc = makeIpcMain()
    let ensureCalls = 0
    const flowView = {
      webContents: {
        getURL: () => 'https://labs.google/fx',
        loadURL: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn(),
        executeJavaScript: vi.fn().mockResolvedValue(true),
      },
    }
    const deps = {
      getFlowView: () => flowView,
      getCurrentMode: () => 'flow',
      getMainWindow: () => null,
      getCapturedProjectId: () => 'pid-1',
      ensureOnProjectComposer: async () => { ensureCalls++ },
    }
    registerCharacterIPC(ipc, deps)

    await ipc.invoke('flow:refresh-composer', {})
    await ipc.invoke('flow:refresh-composer', {})
    expect(ensureCalls).toBe(2) // 순차 호출은 각각 실행
  })
})
