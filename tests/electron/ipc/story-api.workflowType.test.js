// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const stepMachineMocks = vi.hoisted(() => ({
  createStepMachine: vi.fn(),
  readAudioPackage: vi.fn(),
}))

vi.mock('../../../electron/story/stepMachine.js', () => stepMachineMocks)

import { registerStoryIPC } from '../../../electron/ipc/story-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  }
}

describe('story:open workflowType gate', () => {
  let dir
  let ipc
  let machine

  beforeEach(async () => {
    vi.resetAllMocks()
    dir = await mkdtemp(path.join(tmpdir(), 'story-workflow-'))
    ipc = fakeIpcMain()
    machine = {
      projectToken: 'story-token',
      open: vi.fn().mockResolvedValue({ projectToken: 'story-token', state: {} }),
      abort: vi.fn().mockResolvedValue(undefined),
    }
    stepMachineMocks.createStepMachine.mockReturnValue(machine)
    registerStoryIPC(ipc, {
      keyStore: { getKey: () => 'k' },
      getWindow: () => null,
      llm: {},
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
    })
  })

  async function writeProject(data) {
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(data))
  }

  it('rejects disk shopping-short before createStepMachine even when caller claims story', async () => {
    await writeProject({ workflowType: 'shopping-short' })

    const result = await ipc.invoke('story:open', { projectPath: dir, workflowType: 'story' })

    expect(result).toEqual({ error: 'shopping-workflow-requires-plan-machine' })
    expect(stepMachineMocks.createStepMachine).not.toHaveBeenCalled()
    expect(machine.open).not.toHaveBeenCalled()
  })

  it('opens disk story even when caller claims shopping-short', async () => {
    await writeProject({ workflowType: 'story' })

    const result = await ipc.invoke('story:open', { projectPath: dir, workflowType: 'shopping-short' })

    expect(result.error).toBeUndefined()
    expect(stepMachineMocks.createStepMachine).toHaveBeenCalledTimes(1)
    expect(machine.open).toHaveBeenCalledTimes(1)
  })

  it('treats a missing disk workflowType as legacy story', async () => {
    await writeProject({ schemaVersion: 2 })

    const result = await ipc.invoke('story:open', { projectPath: dir })

    expect(result.error).toBeUndefined()
    expect(stepMachineMocks.createStepMachine).toHaveBeenCalledTimes(1)
    expect(machine.open).toHaveBeenCalledTimes(1)
  })

  it('rejects an explicit unknown disk workflowType instead of opening Story', async () => {
    await writeProject({ workflowType: 'future-workflow' })

    const result = await ipc.invoke('story:open', { projectPath: dir })

    expect(result).toEqual({ error: 'shopping-workflow-requires-plan-machine' })
    expect(stepMachineMocks.createStepMachine).not.toHaveBeenCalled()
    expect(machine.open).not.toHaveBeenCalled()
  })
})
