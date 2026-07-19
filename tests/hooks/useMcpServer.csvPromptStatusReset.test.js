/**
 * useMcpServer — load_csv(update-scenes) 재적용 시 Done 씬 프롬프트 변경 → pending (Issue #2 parity)
 *
 * 데스크톱 .txt import / 모달·인라인 편집은 이미 Done 씬 프롬프트 변경 시 status 를 pending 으로
 * 되돌린다. MCP load_csv 병합은 matched.status(done)를 그대로 유지해, 에이전트가 프롬프트를 바꿔도
 * 재생성 대상에서 빠지는 불일치가 있었다 — 동일 규칙(prompt 변경 + 이미지 보유)을 여기에도 적용.
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
    videoAutomation: {}, generatingRefs: [], isRunning: false,
    ...overrides,
  }
}

describe('MCP load_csv — Done 씬 프롬프트 변경 시 pending 리셋', () => {
  let cb = null
  beforeEach(() => {
    window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn((fn) => { cb = fn; return () => {} }) }
  })
  afterEach(() => { delete window.electronAPI; cb = null })

  function applyUpdate(prev, incomingScenes) {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))
    cb({ type: 'update-scenes', scenes: incomingScenes })
    return setScenes.mock.calls[0][0](prev)
  }

  it('프롬프트가 바뀐 Done 씬(이미지 보유)은 pending 으로', () => {
    const prev = [{ id: 'scene_1', _sceneNum: 1, prompt: 'A', image: 'img-A', status: 'done' }]
    const result = applyUpdate(prev, [{ id: 'scene_1', _sceneNum: 1, prompt: 'A-refined' }])
    expect(result[0].prompt).toBe('A-refined')
    expect(result[0].image).toBe('img-A') // 이미지 보존
    expect(result[0].status).toBe('pending')
  })

  it('프롬프트가 같으면 Done 유지(불필요한 리셋 없음 — ep4 sat-fire 가드 보존)', () => {
    const prev = [{ id: 'scene_1', _sceneNum: 1, prompt: 'A', image: 'img-A', status: 'done' }]
    const result = applyUpdate(prev, [{ id: 'scene_1', _sceneNum: 1, prompt: 'A' }])
    expect(result[0].status).toBe('done')
  })

  it('이미지 없는 씬은 프롬프트 바뀌어도 status 그대로', () => {
    const prev = [{ id: 'scene_1', _sceneNum: 1, prompt: 'A', status: 'pending' }]
    const result = applyUpdate(prev, [{ id: 'scene_1', _sceneNum: 1, prompt: 'A-refined' }])
    expect(result[0].status).toBe('pending')
  })
})
