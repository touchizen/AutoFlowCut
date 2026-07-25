// @vitest-environment node
//
// #R30-1: a Flow compose mode-switch that fails after internal retries (configureFlowMode →
// {success:false}) must ABORT the submit, not proceed — otherwise an image submit goes out as a
// video request (or vice versa), spending the wrong quota and timing out the pending capture.
import { describe, it, expect, vi } from 'vitest'
import { registerVideoIPC } from '../../../electron/ipc/video.js'

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (c, fn) => handlers.set(c, fn),
    invoke: (c, p) => handlers.get(c)({}, p),
  }
}

function makeDeps(configureResult) {
  return {
    getFlowView: () => ({ webContents: { getURL: () => 'https://labs.google/fx/project/x', executeJavaScript: vi.fn() }, getBounds: () => ({ width: 100, height: 100 }), setBounds: vi.fn() }),
    getMainWindow: () => ({ getContentBounds: () => ({ width: 800, height: 600 }) }),
    getCurrentMode: () => 'flow',
    ensureOnProjectComposer: vi.fn().mockResolvedValue({ ok: true }),
    ensureAgentOff: vi.fn().mockResolvedValue({ success: true }),
    configureFlowMode: vi.fn().mockResolvedValue(configureResult),
    setFlowPageInject: vi.fn().mockResolvedValue({ success: true }),
    clearFlowPageInject: vi.fn().mockResolvedValue(undefined),
    trustedClickOnFlowView: vi.fn(),
    getPendingVideoGeneration: () => null,
    setPendingVideoGeneration: vi.fn(),
  }
}

describe('#R30-1: configureFlowMode failure aborts video submit', () => {
  it('t2v aborts when configureFlowMode returns {success:false}', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: false, error: 'Mode VIDEO not set after 3 attempts' })
    registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid', videoBatchCount: 1 })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/mode switch failed/i)
    // must NOT have proceeded to inject/submit
    expect(deps.setFlowPageInject).not.toHaveBeenCalled()
  })

  it('i2v aborts when configureFlowMode returns {success:false}', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: false, error: 'Mode VIDEO not set after 3 attempts' })
    registerVideoIPC(ipc, deps)
    const r = await ipc.invoke('flow:generate-video-i2v', { token: 't', prompt: 'p', startImageMediaId: 'm', projectId: 'pid', videoBatchCount: 1 })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/mode switch failed/i)
    expect(deps.setFlowPageInject).not.toHaveBeenCalled()
  })

  it('t2v proceeds past mode switch when configureFlowMode succeeds (reaches inject)', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: true })
    registerVideoIPC(ipc, deps)
    // will fail later (no real DOM) but must get PAST the mode-switch gate to inject
    await ipc.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid', videoBatchCount: 1 }).catch(() => {})
    expect(deps.setFlowPageInject).toHaveBeenCalled()
  })
})

// CDP 는 사용 금지라 화면비를 보장하던 request injection 이 없다 — Flow 설정 패널의 탭 클릭이
// 유일한 수단이다. 그 클릭이 실패했는데 success:true 로 넘어가면, 9:16 로 요청한 배치가 통째로
// 16:9 로 생성된다(유료 생성이라 조용한 오출력이 시끄러운 실패보다 훨씬 나쁘다).
describe('화면비 탭 클릭 실패는 제출을 막는다', () => {
  const cases = [
    ['flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid', videoBatchCount: 1, aspectRatio: '9:16' }],
    ['flow:generate-video-i2v', { token: 't', prompt: 'p', startImageMediaId: 'm', projectId: 'pid', videoBatchCount: 1, aspectRatio: '9:16' }],
  ]

  for (const [channel, payload] of cases) {
    it(`${channel}: 탭을 못 찾으면(tab_not_found) 중단한다`, async () => {
      const ipc = makeIpcMain()
      const deps = makeDeps({ success: true, aspect: 'tab_not_found' })
      registerVideoIPC(ipc, deps)
      const r = await ipc.invoke(channel, payload)
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/aspect|화면비/i)
      expect(deps.setFlowPageInject).not.toHaveBeenCalled()
    })

    it(`${channel}: 클릭이 반영 안 되면(click_unconfirmed) 중단한다`, async () => {
      const ipc = makeIpcMain()
      const deps = makeDeps({ success: true, aspect: 'click_unconfirmed' })
      registerVideoIPC(ipc, deps)
      const r = await ipc.invoke(channel, payload)
      expect(r.success).toBe(false)
      expect(deps.setFlowPageInject).not.toHaveBeenCalled()
    })
  }

  it('이미 그 화면비면(already_set) 그대로 진행한다', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: true, aspect: 'already_set' })
    registerVideoIPC(ipc, deps)
    await ipc.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid', videoBatchCount: 1, aspectRatio: '9:16' }).catch(() => {})
    expect(deps.setFlowPageInject).toHaveBeenCalled()
  })

  it('화면비를 요청하지 않았으면(skipped) 막지 않는다', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: true, aspect: 'skipped' })
    registerVideoIPC(ipc, deps)
    await ipc.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid', videoBatchCount: 1 }).catch(() => {})
    expect(deps.setFlowPageInject).toHaveBeenCalled()
  })

  // 화면비 인자가 실제로 Flow 설정 경로까지 도달하는지 — 이 단언이 없어서 인자를 빼도 전 스위트가
  // 초록이었다(이미지 경로에는 있던 단언이 비디오 경로에만 없었다).
  it('요청한 화면비를 configureFlowMode 로 넘긴다', async () => {
    const ipc = makeIpcMain()
    const deps = makeDeps({ success: true, aspect: 'clicked' })
    registerVideoIPC(ipc, deps)
    await ipc.invoke('flow:generate-video-t2v', { token: 't', prompt: 'p', projectId: 'pid', videoBatchCount: 1, aspectRatio: '9:16' }).catch(() => {})
    expect(deps.configureFlowMode).toHaveBeenCalledWith('VIDEO', 1, '9:16')
  })
})
