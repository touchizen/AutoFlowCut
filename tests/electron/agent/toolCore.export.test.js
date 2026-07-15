// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'

// M3 I10 (D13, slices 34-36): export_capcut/export_premiere(G). renderer 가 실제 export + 요약을
// 소유하고, tool 은 force 전달 + D8 reshape 만 한다. 성공 {success:true} 는 normalize 가 throw 하므로
// 반드시 명시 {status:'done'} 로 바꾼다.

const TOKEN = 'tok-1'
const SUMMARY = { sceneSummary: { total: 5, exported: 3, skippedNoImage: 2, skippedVideoOnly: 0 }, audioSummary: { source: 'none', tracks: 0 } }

let storyCommands, toolBridge, ledger, core
beforeEach(() => {
  storyCommands = { hasProject: () => true, projectToken: TOKEN, projectPath: '/proj', getState: vi.fn(async () => ({})) }
  toolBridge = { invoke: vi.fn(async () => ({ success: true, targetPath: '/out/proj', ...SUMMARY })) }
  ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  core = createToolCore({ toolBridge, projectToken: TOKEN, grantLedger: ledger, sessionId: 's1' })
  core.use(storyCommands)
})
function grant(name, args) {
  const nonce = `n-${name}`
  ledger.grant({ nonce, tool: name, argsHash: hashArgs(args), sessionId: 's1', projectToken: TOKEN })
  return { nonce }
}

describe('export_capcut / export_premiere (G)', () => {
  it('승인 없이 → rejected/unconfirmed, bridge 미호출', async () => {
    const r = await core.call('export_capcut', {}, {})
    expect(r).toMatchObject({ status: 'rejected', reason: 'unconfirmed' })
    expect(toolBridge.invoke).not.toHaveBeenCalled()
  })

  it('성공: {success:true}를 {status:done, targetPath, 요약}으로 reshape (raw success는 throw됨)', async () => {
    const r = await core.call('export_capcut', {}, grant('export_capcut', {}))
    expect(r).toEqual({ status: 'done', targetPath: '/out/proj', ...SUMMARY })
    expect(toolBridge.invoke).toHaveBeenCalledWith('export.capcut', { force: false })
  })

  it('force:true 를 bridge 로 전달', async () => {
    const args = { force: true }
    await core.call('export_capcut', args, grant('export_capcut', args))
    expect(toolBridge.invoke).toHaveBeenCalledWith('export.capcut', { force: true })
  })

  it('batch-running 거부는 rejected/batch-running 으로 정규화', async () => {
    toolBridge.invoke = vi.fn(async () => ({ success: false, error: 'batch-running' }))
    const r = await core.call('export_capcut', {}, grant('export_capcut', {}))
    expect(r).toEqual({ status: 'rejected', reason: 'batch-running' })
  })

  it('fixed-slot-missing 거부는 ordinals 를 보존한다', async () => {
    toolBridge.invoke = vi.fn(async () => ({ success: false, error: 'fixed-slot-missing', ordinals: [2] }))
    const r = await core.call('export_capcut', {}, grant('export_capcut', {}))
    expect(r).toEqual({ status: 'rejected', reason: 'fixed-slot-missing', ordinals: [2] })
  })

  it('export_premiere 는 export.premiere bridge 를 부른다', async () => {
    await core.call('export_premiere', {}, grant('export_premiere', {}))
    expect(toolBridge.invoke).toHaveBeenCalledWith('export.premiere', { force: false })
  })
})
