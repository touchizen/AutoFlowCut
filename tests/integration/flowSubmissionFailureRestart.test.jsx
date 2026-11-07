import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
vi.mock('electron', () => ({ screen: { getAllDisplays: () => [] } }))
vi.mock('../../electron/flow-native-settings.js', () => ({ applyNativeSettings: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../src/firebase/functions', () => ({ consumeBatchDownload: vi.fn(async () => ({ charged: true })) }))
vi.mock('../../src/components/Toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('../../src/utils/formatters', async original => ({ ...await original(), getImageSizeFromBase64: async () => ({ width: 1, height: 1 }) }))
vi.mock('../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { projectExists: async () => true,
  saveProjectData: vi.fn(), loadProjectData: vi.fn(), getResourcePath: async () => ({ success: false }) } }))
import { harness } from '../fixtures/flow-passive-harness.js'
import { PROJECT, PROMPT } from '../fixtures/flow-passive-image.js'
import { _resetDomStageForTests } from '../../electron/ipc/flow-angular.js'
import { useFlowEngine } from '../../src/engine/engineFlow'
import { useScenes } from '../../src/hooks/useScenes'
import { useAutomation } from '../../src/hooks/useAutomation'
import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'
import { saveCurrentProject, loadProjectWithResources } from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import { __resetFlowSafetyForTests, getFlowSafetyStop } from '../../src/utils/flowSafetyStop'

const t = k => k
const settings = { projectName: 'paid', saveMode: 'none', aspectRatio: '16:9' }
let dir
beforeEach(() => {
  vi.useFakeTimers(); __resetFlowSafetyForTests(); _resetDomStageForTests()
  dir = mkdtempSync(join(tmpdir(), 'submission-restart-'))
  fileSystemAPI.saveProjectData.mockImplementation(async (_name, data) => {
    writeFileSync(join(dir, 'project.json'), JSON.stringify(data)); return { success: true }
  })
  fileSystemAPI.loadProjectData.mockImplementation(async () => ({ success: true, data: JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) }))
})
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); document.body.innerHTML = '' })

function mount(options = { stallDownload: true }) {
  const main = harness({ nativeClick: true, ...options })
  const listeners = new Set()
  const checks = new Set()
  const sender = { send: (channel, event) => {
    if (channel === 'flow:image-submit-check') {
      for (const cb of checks) {
        const allowed = cb(event)
        if (typeof allowed === 'boolean') main.ipcEvents.emit('flow:image-submit-check-result', { sender }, { checkId: event.checkId, allowed })
      }
      return
    }
    expect(channel).toBe('flow:image-submission')
    for (const cb of listeners) cb(event)
  } }
  const generate = vi.fn(payload => main.handlers.get('flow:generate-image')({ sender }, payload))
  window.electronAPI = {
    flowGenerateImage: generate,
    flowSessionStatus: async () => ({ ready: true }),
    flowExtractProjectId: async () => ({ projectId: PROJECT }),
    flowClearGenerations: async () => ({ success: true }),
    flowCheckGeneration: payload => main.handlers.get('flow:check-generation')({}, payload),
    flowCollectGeneration: payload => main.handlers.get('flow:collect-generation')({}, payload),
    onFlowImageSubmission: cb => { listeners.add(cb); return () => listeners.delete(cb) },
    onFlowImageSubmitCheck: cb => { checks.add(cb); return () => checks.delete(cb) },
  }
  const hook = renderHook(() => {
    const scenes = useScenes()
    const engine = { ...useFlowEngine({ boundFlowProjectId: PROJECT }), mode: 'flow' }
    const batch = useAutomation(engine, scenes, null, null, null, t, null, null, null, 'flow')
    const single = useSceneGeneration({ settings, scenes: scenes.scenes, scenesHook: scenes, genAPI: engine, t })
    return { scenes, batch, single }
  })
  return { ...hook, main, generate, listeners, checks }
}

it.each(['batch', 'individual'].flatMap(first => ['batch', 'individual'].map(retry => [first, retry])))(
  'persists actual %s click and download failure through disk restart before %s retry', async (first, retry) => {
    const h = mount()
    act(() => h.result.current.scenes.setScenes([{ id: 's1', prompt: PROMPT, status: 'pending' }]))
    let running
    await act(async () => {
      running = first === 'batch' ? h.result.current.batch.start(settings) : h.result.current.single.handleGenerateScene('s1')
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(h.main.submit).toHaveBeenCalledOnce()
    const clicked = h.result.current.scenes.scenes[0]
    expect(clicked).toMatchObject({ postClick: true, retryBlocked: true, flowSubmission: {
      id: expect.stringMatching(/^flow-submit-/), submittedAt: expect.any(Number),
      promptHash: createHash('sha256').update(PROMPT).digest('hex'),
      postClick: true, retryBlocked: true, reason: 'awaiting-result',
    } })
    expect(clicked.generationId).toBeUndefined()
    await act(async () => { await vi.runAllTimersAsync(); await running })
    const failed = h.result.current.scenes.scenes[0]
    expect(failed).toMatchObject({ status: 'error', postClick: true, retryBlocked: true, safetyStop: true,
      flowSubmission: { ...clicked.flowSubmission, reason: 'download-timeout' } })
    expect(failed.generationId).toBeUndefined()
    // CSV reapply is not recovery; it must keep the locally recorded click too.
    act(() => h.result.current.scenes.parseFromCSV(`scene,prompt,subtitle,start_time,end_time\n1,${PROMPT},,0,3\n`))
    await saveCurrentProject({ ...settings, saveMode: 'folder' }, h.result.current.scenes.scenes, [], [], [], null, h.result.current.scenes.srtTrack)
    expect(h.listeners.size).toBe(0)
    expect(h.checks.size).toBe(0)
    expect(h.main.ipcEvents.eventNames()).toEqual([])
    h.unmount(); __resetFlowSafetyForTests(); _resetDomStageForTests()
    const loaded = await loadProjectWithResources('paid')
    const restarted = mount()
    act(() => restarted.result.current.scenes.setScenes(loaded.scenes))
    expect(getFlowSafetyStop()).toBeNull()
    expect(loaded.scenes[0].flowSubmission).toEqual(failed.flowSubmission)
    await act(async () => {
      if (retry === 'batch') await restarted.result.current.batch.start({ ...settings, force: true })
      else await restarted.result.current.single.handleGenerateScene(loaded.scenes[0].id)
    })
    expect(restarted.generate).not.toHaveBeenCalled()
    expect(restarted.main.submit).not.toHaveBeenCalled()
  })

it.each(['blocked', 'deleted'])('rechecks a %s batch scene at native dispatch after main-process preparation', async change => {
  const h = mount()
  act(() => h.result.current.scenes.setScenes([{ id: 's1', prompt: PROMPT, status: 'pending' }]))
  let running
  await act(async () => {
    running = h.result.current.batch.start(settings)
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(h.generate).toHaveBeenCalledOnce()
  expect(h.main.submit).not.toHaveBeenCalled()
  act(() => {
    if (change === 'deleted') h.result.current.scenes.setScenes([])
    else h.result.current.scenes.updateScene('s1', { status: 'error', generationId: 'paid-elsewhere', retryBlocked: true })
  })
  await act(async () => { await vi.runAllTimersAsync(); await running })
  expect(h.main.submit).not.toHaveBeenCalled()
})

it('rechecks persisted state after the final asynchronous composer read before mouseDown', async () => {
  const h = mount()
  const original = h.main.wc.executeJavaScriptInIsolatedWorld.getMockImplementation()
  let reads = 0, release
  h.main.wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (...args) => {
    const value = await original(...args)
    if (args[1][0].code.includes('editorText') && ++reads === 3) await new Promise(resolve => { release = resolve })
    return value
  })
  act(() => h.result.current.scenes.setScenes([{ id: 's1', prompt: PROMPT, status: 'pending' }]))
  let running
  await act(async () => { running = h.result.current.batch.start(settings); await vi.advanceTimersByTimeAsync(1000) })
  expect(release).toEqual(expect.any(Function))
  act(() => h.result.current.scenes.updateScene('s1', { generationId: 'paid-during-dom-read', retryBlocked: true }))
  await act(async () => { release(); await vi.runAllTimersAsync(); await running })
  expect(h.main.submit).not.toHaveBeenCalled()
})

it.each(['batch', 'individual'].flatMap(entry => ['missing-response', 'httpError', 'navigate', 'foreign'].map(failure => [entry, failure])))(
  'retains the clicked %s submission after %s failure', async (entry, failure) => {
    const h = mount(failure === 'missing-response' ? { responseError: 'response-proof-empty' } : { [failure]: true })
    act(() => h.result.current.scenes.setScenes([{ id: 's1', prompt: PROMPT, status: 'pending' }]))
    await act(async () => {
      const run = entry === 'batch' ? h.result.current.batch.start(settings) : h.result.current.single.handleGenerateScene('s1')
      await vi.runAllTimersAsync(); await run
    })
    expect(h.main.submit).toHaveBeenCalledOnce()
    const scene = h.result.current.scenes.scenes[0]
    expect(scene).toMatchObject({ status: 'error', postClick: true, retryBlocked: true,
      flowSubmission: { id: expect.stringMatching(/^flow-submit-/), postClick: true, retryBlocked: true } })
    expect(scene.flowSubmission.reason).not.toBe('awaiting-result')
    expect(h.listeners.size + h.checks.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

it.each(['batch', 'individual'])('closes the local submission only after successful %s finalization', async entry => {
  const h = mount({})
  act(() => h.result.current.scenes.setScenes([{ id: 's1', prompt: PROMPT, status: 'pending' }]))
  await act(async () => {
    const run = entry === 'batch' ? h.result.current.batch.start(settings) : h.result.current.single.handleGenerateScene('s1')
    await vi.runAllTimersAsync(); await run
  })
  expect(h.result.current.scenes.scenes[0]).toMatchObject({ status: 'done', retryBlocked: false,
    flowSubmission: { postClick: true, retryBlocked: false, reason: 'collected' } })
})
