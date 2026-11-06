import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useScenes } from '../../src/hooks/useScenes'
import { useAutomation } from '../../src/hooks/useAutomation'
import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'
import { useMcpServer } from '../../src/hooks/useMcpServer'
import { saveCurrentProject, loadProjectWithResources } from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import { __resetFlowSafetyForTests, getFlowSafetyStop } from '../../src/utils/flowSafetyStop'
import { bundleSceneCSVRows, loadCSV } from '../../mcp-server/lib/csv.js'

vi.mock('../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { projectExists: async () => true,
  saveProjectData: vi.fn(), loadProjectData: vi.fn(), getResourcePath: async () => ({ success: false }) } }))
vi.mock('../../src/firebase/functions', () => ({ consumeBatchDownload: vi.fn() }))
vi.mock('../../src/utils/guards', () => ({ checkFolderPermission: async () => ({ ok: true }), checkAuthToken: async () => true, checkFlowProjectReady: () => ({ ok: true }) }))
vi.mock('../../src/services/imageFinalize', () => ({ finalizeGeneratedImage: async () => ({ success: false, sceneUpdate: { status: 'error' } }), processAsyncSceneResult: vi.fn() }))
vi.mock('../../src/components/Toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
const t = k => k
const settings = { projectName: 'paid', saveMode: 'folder', aspectRatio: '16:9' }
const stopped = { id: 'scene_1', _sceneNum: 1, prompt: 'p', status: 'error', generationId: 'paid-1', retryBlocked: true,
  errorKind: 'flow-unusual-activity', error: 'flow-unusual-activity', errorParams: { reason: 'detected' } }
const csv = 'scene,prompt,subtitle,start_time,end_time\n1,p,subtitle,0,3\n'
let dir, onMcpUpdate
beforeEach(() => {
  __resetFlowSafetyForTests()
  dir = mkdtempSync(join(tmpdir(), 'flow-restart-'))
  fileSystemAPI.saveProjectData.mockImplementation(async (_name, data) => {
    writeFileSync(join(dir, 'project.json'), JSON.stringify(data)); return { success: true }
  })
  fileSystemAPI.loadProjectData.mockImplementation(async () => ({ success: true, data: JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) }))
  window.electronAPI = { onMcpUpdate: fn => { onMcpUpdate = fn; return () => {} } }
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete window.electronAPI })

function mount() {
  const refused = { success: false, errorKind: 'unexpected-resubmit', safetyStop: true, retryBlocked: true }
  const genAPI = { mode: 'flow', getAccessToken: async () => 'session', generateImage: vi.fn(async () => refused),
    submitGeneration: vi.fn(async () => refused), clearGenerations: vi.fn(), cancelGeneration: vi.fn() }
  const hook = renderHook(() => {
    const scenes = useScenes()
    const batch = useAutomation(genAPI, scenes, null, null, null, t, null, null, null, 'flow')
    const single = useSceneGeneration({ settings, scenes: scenes.scenes, scenesHook: scenes, genAPI, t })
    useMcpServer({ settings, mode: 'flow', scenes: scenes.scenes, setScenes: scenes.setScenes, references: [],
      setSrtTrack: scenes.setSrtTrack, handleGenerateScene: single.handleGenerateScene,
      handleStart: (_style, options) => batch.start({ projectName: 'paid', saveMode: 'none', ...options }),
      automationState: batch, videoAutomation: {}, generatingRefs: [], audioReviews: [] })
    return { scenes, batch, single }
  })
  return { ...hook, genAPI }
}

it.each(['app', 'mcp'].flatMap(source => ['batch', 'individual', 'mcp', 'mcp-batch'].map(retry => [source, retry])))('preserves submission through %s CSV reapply, disk save, restart and %s retry', async (source, retry) => {
  const first = mount()
  act(() => first.result.current.scenes.setScenes([structuredClone(stopped)]))
  act(() => {
    if (source === 'app') first.result.current.scenes.parseFromCSV(csv)
    else {
      writeFileSync(join(dir, 'scenes.csv'), csv)
      onMcpUpdate({ type: 'update-scenes', ...bundleSceneCSVRows(loadCSV(join(dir, 'scenes.csv')).scenes) })
    }
  })
  await saveCurrentProject(settings, first.result.current.scenes.scenes, [], [], [], null, first.result.current.scenes.srtTrack)
  first.unmount()
  __resetFlowSafetyForTests()
  const loaded = await loadProjectWithResources('paid')
  const restarted = mount()
  act(() => restarted.result.current.scenes.setScenes(loaded.scenes))
  expect(getFlowSafetyStop()).toBeNull()
  await act(async () => {
    if (retry === 'batch') await restarted.result.current.batch.start({ projectName: 'paid', saveMode: 'none', force: true })
    else if (retry === 'individual') await restarted.result.current.single.handleGenerateScene('scene_1')
    else if (retry === 'mcp') await window.__mcpGenerateScene('scene_1', 'none')
    else await window.__mcpStartBatch('none', { force: true, mode: 'image' })
  })
  expect(restarted.genAPI.generateImage).not.toHaveBeenCalled()
  expect(restarted.genAPI.submitGeneration).not.toHaveBeenCalled()
  expect(loaded.scenes[0]).toMatchObject(stopped)
  expect(restarted.result.current.scenes.scenes[0]).toMatchObject(stopped)
})
