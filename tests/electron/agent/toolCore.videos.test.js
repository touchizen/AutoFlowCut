// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'
import { createToolCore } from '../../../electron/agent/toolCore.js'

const TOKEN = 'video-project-token'

function harness({ bridgeInvoke, state, now, sleep, waitWindowMs, pollIntervalMs } = {}) {
  const ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  const toolBridge = { invoke: vi.fn(bridgeInvoke || (async () => { throw new Error('unexpected bridge call') })) }
  const commands = {
    hasProject: () => true,
    projectToken: TOKEN,
    getState: vi.fn(async () => state || ({ sceneMode: 'audio-first', steps: {} })),
  }
  const core = createToolCore({
    toolBridge,
    grantLedger: ledger,
    sessionId: 'session-1',
    projectToken: TOKEN,
    ...(now ? { now } : {}),
    ...(sleep ? { sleep } : {}),
    ...(waitWindowMs !== undefined ? { waitWindowMs } : {}),
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
  })
  core.use(commands)
  const callGenerate = async (args, nonce = 'video-grant') => {
    ledger.grant({
      nonce, tool: 'generate_videos', argsHash: hashArgs(args),
      sessionId: 'session-1', projectToken: TOKEN,
    })
    return core.call('generate_videos', args, { nonce })
  }
  return { core, toolBridge, commands, callGenerate }
}

describe('Tool Core generate_videos', () => {
  it('sceneNumbers schema는 non-empty number array만 허용하고 추가 키를 닫는다', async () => {
    const { core } = harness()
    const schema = core.list().find((tool) => tool.name === 'generate_videos')?.inputSchema
    expect(schema).toEqual({
      type: 'object',
      properties: { sceneNumbers: { type: 'array', items: { type: 'number' }, minItems: 1 } },
      required: ['sceneNumbers'],
      additionalProperties: false,
    })
  })

  it('중복 ordinal의 위치를 보존하고 resolver가 준 opaque rendererSceneId만 admission에 전달한다', async () => {
    const { callGenerate, toolBridge } = harness({
      bridgeInvoke: async (name) => {
        if (name === 'scene.snapshot') {
          return { sceneMode: 'audio-first', scenes: [{ id: 'opaque/alpha' }, { id: 'opaque:beta' }] }
        }
        if (name === 'video.admit') return { accepted: true, operationId: 'op-opaque' }
        throw new Error(`unexpected ${name}`)
      },
    })

    await expect(callGenerate({ sceneNumbers: [2, 2, 1] })).resolves.toEqual({
      status: 'done', operationId: 'op-opaque',
    })
    expect(toolBridge.invoke).toHaveBeenLastCalledWith('video.admit', {
      items: [
        { ordinal: 2, rendererSceneId: 'opaque:beta' },
        { ordinal: 2, rendererSceneId: 'opaque:beta' },
        { ordinal: 1, rendererSceneId: 'opaque/alpha' },
      ],
    })
  })

  it('fixed scene stale이면 video.admit을 호출하지 않는다', async () => {
    const { callGenerate, toolBridge } = harness({
      state: { sceneMode: 'image-first', fixedSceneError: 'fixed-scenes-stale' },
      bridgeInvoke: async (name) => {
        if (name === 'scene.snapshot') return { sceneMode: 'image-first', scenes: [] }
        throw new Error('video.admit must not run')
      },
    })

    await expect(callGenerate({ sceneNumbers: [1] })).resolves.toEqual({
      status: 'rejected', reason: 'fixed-scenes-stale',
    })
    expect(toolBridge.invoke.mock.calls.map(([name]) => name)).toEqual(['scene.snapshot'])
  })

  it('하나라도 resolve error면 첫 오류를 반환하고 video.admit은 0회다', async () => {
    const { callGenerate, toolBridge } = harness({
      bridgeInvoke: async (name) => {
        if (name === 'scene.snapshot') {
          return { sceneMode: 'audio-first', scenes: [{ id: 'only-one' }] }
        }
        throw new Error('video.admit must not run')
      },
    })

    await expect(callGenerate({ sceneNumbers: [1, 9] })).resolves.toEqual({
      status: 'rejected', reason: 'scene-not-found',
    })
    expect(toolBridge.invoke.mock.calls.map(([name]) => name)).toEqual(['scene.snapshot'])
  })

  it('renderer admission 거부 shape를 보존해 D8 rejected로 정규화한다', async () => {
    const { callGenerate } = harness({
      bridgeInvoke: async (name) => name === 'scene.snapshot'
        ? { sceneMode: 'audio-first', scenes: [{ id: 'opaque-one' }] }
        : { accepted: false, error: 'paywall' },
    })

    await expect(callGenerate({ sceneNumbers: [1] })).resolves.toEqual({
      accepted: false, status: 'rejected', reason: 'paywall',
    })
  })

  it('renderer가 error 없는 malformed 거부를 반환해도 done으로 포장하지 않는다', async () => {
    const { callGenerate } = harness({
      bridgeInvoke: async (name) => name === 'scene.snapshot'
        ? { sceneMode: 'audio-first', scenes: [{ id: 'opaque-one' }] }
        : { accepted: false },
    })

    await expect(callGenerate({ sceneNumbers: [1] })).resolves.toEqual({
      status: 'rejected', reason: 'admission-failed',
    })
  })

  it('save/download/upscale video 툴은 inventory에 없다', () => {
    const names = harness().core.list().map((tool) => tool.name)
    expect(names).not.toContain('save_videos')
    expect(names).not.toContain('download_video')
    expect(names).not.toContain('upscale')
  })
})

describe('Tool Core wait_videos', () => {
  it('running을 폴링해 done terminal을 byte-free public shape로 바꾼다', async () => {
    let polls = 0
    const { core, toolBridge } = harness({
      bridgeInvoke: async () => {
        polls++
        if (polls === 1) {
          return { operationId: 'op-1', status: 'running', progress: { done: 1, total: 2, failed: 0, phase: 'running' } }
        }
        return {
          operationId: 'op-1', status: 'done', base64: 'NOPE', video: 'NOPE', data: 'NOPE',
          progress: { done: 2, total: 2, failed: 0, phase: 'done', base64: 'NOPE' },
        }
      },
      now: () => 0,
      sleep: async () => {},
    })

    const result = await core.call('wait_videos', { operationId: 'op-1' })
    expect(result).toEqual({
      status: 'done', done: true, operationId: 'op-1',
      progress: { done: 2, total: 2, failed: 0, phase: 'done' },
    })
    expect(JSON.stringify(result)).not.toContain('NOPE')
    expect(toolBridge.invoke).toHaveBeenCalledWith('video.status', { operationId: 'op-1' })
  })

  it('대기 창 만료는 throw가 아니라 done:false 값이다', async () => {
    let time = 0
    const { core } = harness({
      bridgeInvoke: async () => ({
        operationId: 'op-timeout', status: 'running',
        progress: { done: 1, total: 4, failed: 0, phase: 'running' },
      }),
      now: () => time,
      sleep: async (ms) => { time += ms },
      waitWindowMs: 5,
      pollIntervalMs: 5,
    })

    await expect(core.call('wait_videos', { operationId: 'op-timeout' })).resolves.toEqual({
      status: 'done', done: false, operationId: 'op-timeout',
      progress: { done: 1, total: 4, failed: 0, phase: 'running' },
    })
  })

  it('bridge reject는 timeout 값으로 위조하지 않고 그대로 throw한다', async () => {
    const { core } = harness({ bridgeInvoke: async () => { throw new Error('renderer bridge died') } })
    await expect(core.call('wait_videos', { operationId: 'op-dead' })).rejects.toThrow('renderer bridge died')
  })

  it('paywall은 terminal error, stopped는 aborted로 격리 정규화한다', async () => {
    const paywall = harness({
      bridgeInvoke: async () => ({
        operationId: 'op-paywall', status: 'error', error: 'paywall',
        progress: { done: 1, total: 1, failed: 1, phase: 'error' },
      }),
    }).core
    await expect(paywall.call('wait_videos', { operationId: 'op-paywall' })).resolves.toEqual({
      status: 'error', error: 'paywall', operationId: 'op-paywall',
      progress: { done: 1, total: 1, failed: 1, phase: 'error' },
    })

    const stopped = harness({
      bridgeInvoke: async () => ({
        operationId: 'op-stop', status: 'error', error: 'stopped',
        progress: { done: 1, total: 2, failed: 1, phase: 'error' },
      }),
    }).core
    await expect(stopped.call('wait_videos', { operationId: 'op-stop' })).resolves.toEqual({
      status: 'aborted', operationId: 'op-stop',
      progress: { done: 1, total: 2, failed: 1, phase: 'error' },
    })
  })
})
