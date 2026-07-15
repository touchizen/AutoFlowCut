// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'

const LIMIT = Object.freeze({ error: 'agent-limit', limit: 2, used: 2 })
const NORMALIZED_LIMIT = Object.freeze({ status: 'rejected', reason: 'agent-limit', limit: 2, used: 2 })

function storyCommands() {
  return {
    hasProject: () => true,
    projectToken: 'project-token',
    getState: vi.fn(async () => ({ sceneMode: 'audio-first' })),
    confirmSynopsis: vi.fn(async () => ({ ok: true })),
  }
}

function toolBridge() {
  return { invoke: vi.fn(async () => ({ sceneMode: 'audio-first', scenes: [] })) }
}

describe('Tool Core app ledger admission', () => {
  it('admission이 거부하면 structured value를 돌려주고 tool side effect를 시작하지 않는다', async () => {
    const commands = storyCommands()
    const bridge = toolBridge()
    const admitToolCall = vi.fn(() => LIMIT)
    const core = createToolCore({ admitToolCall, projectToken: commands.projectToken, toolBridge: bridge })
    core.use(commands)

    await expect(core.call('list_scenes', {})).resolves.toEqual(NORMALIZED_LIMIT)
    expect(admitToolCall).toHaveBeenCalledWith({
      name: 'list_scenes',
      args: {},
      context: {},
    })
    expect(bridge.invoke).not.toHaveBeenCalled()
    expect(commands.getState).not.toHaveBeenCalled()
  })

  it('병렬 tool call은 Tool Core 진입 순서대로 각각 1회 admission한다', async () => {
    const commands = storyCommands()
    const bridge = toolBridge()
    let used = 0
    const admitToolCall = vi.fn(() => {
      if (used >= 2) return LIMIT
      used += 1
      return null
    })
    const core = createToolCore({ admitToolCall, projectToken: commands.projectToken, toolBridge: bridge })
    core.use(commands)

    const results = await Promise.all([
      core.call('list_scenes'),
      core.call('list_scenes'),
      core.call('list_scenes'),
    ])

    expect(results).toEqual([
      { status: 'done', source: 'renderer', sceneMode: 'audio-first', scenes: [], errors: [] },
      { status: 'done', source: 'renderer', sceneMode: 'audio-first', scenes: [], errors: [] },
      NORMALIZED_LIMIT,
    ])
    expect(admitToolCall).toHaveBeenCalledTimes(3)
    expect(bridge.invoke).toHaveBeenCalledTimes(2)
    expect(commands.getState).toHaveBeenCalledTimes(2)
  })

  it('unknown 또는 승인 없는 호출도 agent가 실제 invoke했으므로 admission에 잡힌다', async () => {
    const admitToolCall = vi.fn(() => null)
    const commands = storyCommands()
    const core = createToolCore({ admitToolCall, projectToken: commands.projectToken })
    core.use(commands)

    await expect(core.call('not_a_tool')).rejects.toThrow('unknown tool: not_a_tool')
    await expect(core.call('story_confirm_synopsis', { synopsisMd: '#' })).resolves.toEqual({
      status: 'rejected',
      reason: 'unconfirmed',
    })

    expect(admitToolCall.mock.calls.map(([call]) => call.name)).toEqual([
      'not_a_tool',
      'story_confirm_synopsis',
    ])
  })
})
