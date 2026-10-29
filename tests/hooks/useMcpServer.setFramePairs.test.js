/**
 * 2026-10-30 I2V — useMcpServer 의 window.__mcpSetFramePairs(MCP set-frame-pairs, main 이 executeJavaScript 로 결과를 기다린다)와 batch-status.i2v.
 *   __mcpSetFramePairs({indexes, promptSource?}) — **동기** 결과(JSON.stringify 로 감싼다 — Promise 면 '{}' 가 된다):
 *     실행 중 → {success:false, error:'busy'} · 계획 실패 → {success:false, error:'no-image'|'bad-index', indexes} · 성공 → setFramePairs(계획) +
 *     setFtvPromptSource(promptSource ?? 'video' — 에이전트는 움직임 프롬프트(씬 videoT2VPrompt)를 쓴다) + {success:true, rows}.
 *   행은 App 의 framePairsRef(동기 갱신) 로 읽는다(getFramePairs) — 같은 tick 의 연속 호출도 앞 호출의 결과 위에 계획한다.
 *   batch-status.i2v = 선택된 행(selected !== false) 기준 {total, done(complete), generating, error, pending(나머지)}.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'

function makeProps(overrides = {}) {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [], setScenes: vi.fn(), references: [], setReferences: vi.fn(),
    handleGenerateRef: vi.fn(), handleGenerateScene: vi.fn(), handleGenerateAllRefs: vi.fn(),
    handleStart: vi.fn(), handleStop: vi.fn(), handleProjectChange: vi.fn(), handleExportConfirm: vi.fn(),
    selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(), refreshReviews: vi.fn(),
    audioReviews: [], importByPath: vi.fn(), audioPackage: null,
    automationState: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    videoAutomation: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    generatingRefs: [], isRunning: false,
    ...overrides,
  }
}
const SCENES = [{ id: 'scene_1', prompt: 'p1', mediaId: 'm1', imagePath: '/x/scene_1.jpg' }, { id: 'scene_2', prompt: 'p2' }, { id: 'scene_3', prompt: 'p3', imagePath: '/x/scene_3.jpg' }]

describe('window.__mcpSetFramePairs', () => {
  let store
  beforeEach(() => {
    window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn(() => () => {}) }
    store = { pairs: [] }
  })
  afterEach(() => { delete window.electronAPI })
  const wire = (over = {}) => {
    const setFramePairs = vi.fn((next) => { store.pairs = next })
    const setFtvPromptSource = vi.fn()
    renderHook(() => useMcpServer(makeProps({ scenes: SCENES, getFramePairs: () => store.pairs, setFramePairs, setFtvPromptSource, ...over })))
    return { setFramePairs, setFtvPromptSource }
  }

  it('성공: 행을 세우고 promptSource 기본 video · rows 를 돌려준다(동기)', () => {
    const { setFramePairs, setFtvPromptSource } = wire()
    const r = window.__mcpSetFramePairs({ type: 'set-frame-pairs', indexes: [2] })
    expect(r).toEqual({ success: true, rows: [{ index: 2, sceneId: 'scene_3', id: 'fp_1' }] })
    expect(setFramePairs).toHaveBeenCalledTimes(1)
    expect(store.pairs).toEqual([expect.objectContaining({ id: 'fp_1', ownerSceneId: 'scene_3', startSceneId: 'scene_3', endSceneId: '', selected: true })])
    expect(setFtvPromptSource).toHaveBeenCalledWith('video')
  })

  it('promptSource 를 주면 그대로 · 같은 tick 의 두 번째 호출은 앞 결과 위에(새 id fp_2, 앞 행은 선택 해제)', () => {
    const { setFtvPromptSource } = wire()
    window.__mcpSetFramePairs({ type: 'set-frame-pairs', indexes: [2] })
    const r = window.__mcpSetFramePairs({ type: 'set-frame-pairs', indexes: [0], promptSource: 'none' })
    expect(r.rows).toEqual([{ index: 0, sceneId: 'scene_1', id: 'fp_2' }])
    expect(store.pairs.map((p) => [p.id, p.selected])).toEqual([['fp_1', false], ['fp_2', true]])
    expect(setFtvPromptSource).toHaveBeenLastCalledWith('none')
  })

  it('이미지 없는 씬 → no-image + indexes, 아무것도 안 바꾼다', () => {
    const { setFramePairs, setFtvPromptSource } = wire()
    expect(window.__mcpSetFramePairs({ type: 'set-frame-pairs', indexes: [1] })).toEqual({ success: false, error: 'no-image', indexes: [1] })
    expect(setFramePairs).not.toHaveBeenCalled()
    expect(setFtvPromptSource).not.toHaveBeenCalled()
  })

  it('실행 중이면 busy(행을 바꾸면 돌고 있는 배치의 행 소유가 어긋난다)', () => {
    const { setFramePairs } = wire({ isRunning: true })
    expect(window.__mcpSetFramePairs({ type: 'set-frame-pairs', indexes: [0] })).toEqual({ success: false, error: 'busy' })
    expect(setFramePairs).not.toHaveBeenCalled()
  })

  it('시작 준비 중(isStartInFlight — 인증·폴더 확인 await)이면 busy(Codex 리뷰 H2 — 준비 중인 시작이 바뀐 행을 과금하지 않게)', () => {
    const { setFramePairs } = wire({ isStartInFlight: () => true })
    expect(window.__mcpSetFramePairs({ type: 'set-frame-pairs', indexes: [0] })).toEqual({ success: false, error: 'busy' })
    expect(setFramePairs).not.toHaveBeenCalled()
  })

  it('지금 출처(getFtvPromptSource)와 새 출처를 계획에 넘긴다 — 회수 대기 행의 프롬프트가 바뀌면 needs-recovery (Codex 2차 M3)', () => {
    store.pairs = [{ id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', status: 'error', generationId: 'g1', mediaId: 'v1', selected: false }]
    const scenes = [{ id: 'scene_1', prompt: 'image prompt', videoT2VPrompt: 'motion prompt', imagePath: '/x/scene_1.jpg' }]
    const setFramePairs = vi.fn()
    renderHook(() => useMcpServer(makeProps({ scenes, getFramePairs: () => store.pairs, setFramePairs, setFtvPromptSource: vi.fn(), getFtvPromptSource: () => 'image' })))
    expect(window.__mcpSetFramePairs({ type: 'set-frame-pairs', indexes: [0] })).toEqual({ success: false, error: 'needs-recovery', indexes: [0] })
    expect(setFramePairs).not.toHaveBeenCalled()
  })

  it('setter 가 배선되지 않았으면 handler-unavailable', () => {
    renderHook(() => useMcpServer(makeProps({ scenes: SCENES })))
    expect(window.__mcpSetFramePairs({ type: 'set-frame-pairs', indexes: [0] })).toEqual({ success: false, error: 'handler-unavailable' })
  })
})

describe('batch-status.i2v — 선택된 I2V 행 기준', () => {
  beforeEach(() => { window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn(() => () => {}) } })
  afterEach(() => { delete window.electronAPI })
  it('selected !== false 만 세고 status 로 분류(waiting 등 나머지 = pending)', () => {
    const pairs = [
      { id: 'fp_1', status: 'complete', selected: true },
      { id: 'fp_2', status: 'generating' },
      { id: 'fp_3', status: 'error', selected: true },
      { id: 'fp_4', status: 'waiting', selected: true },
      { id: 'fp_5', status: 'complete', selected: false },
    ]
    renderHook(() => useMcpServer(makeProps({ getFramePairs: () => pairs })))
    expect(window.__mcpBatchStatus().i2v).toEqual({ total: 4, done: 1, generating: 1, error: 1, pending: 1 })
  })
  it('I2V 배치가 걸려 있는 동안(isStartInFlight — 시작 준비·자동화 실행 전체)은 batch-status.isRunning 이 true (Codex 2차 H2 — app_wait_batch 가 일찍 끝나지 않게)', () => {
    renderHook(() => useMcpServer(makeProps({ isStartInFlight: () => true })))
    expect(window.__mcpBatchStatus().isRunning).toBe(true)
  })

  it('getFramePairs 를 안 넘긴 옛 호출자는 0', () => {
    renderHook(() => useMcpServer(makeProps()))
    expect(window.__mcpBatchStatus().i2v).toEqual({ total: 0, done: 0, generating: 0, error: 0, pending: 0 })
  })
})
