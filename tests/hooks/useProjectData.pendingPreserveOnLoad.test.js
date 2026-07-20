/**
 * loadProjectWithResources — 로드 시 프롬프트 변경으로 재생성 대기(pending)인 씬 보존.
 *
 * 실측 버그: done 씬 프롬프트를 바꿔 pending(재생성 대기) 상태로 두고 프로젝트를 전환·복귀하면,
 * 디스크에 옛 이미지 파일이 아직 있어 로드 정상화가 status 를 무조건 'done' 으로 강제 → pending 이
 * 사라지고 "새 프롬프트 + 옛 이미지" 가 done 으로 표시(UI 거짓말). 파일이 있어도 pending 은 보존해야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
    projectExists: vi.fn(),
    saveProjectData: vi.fn(),
    ensurePermission: vi.fn(),
  },
}))

vi.mock('../../src/services/mediaSync', () => ({
  syncVideosIntoScenes: vi.fn(),
}))

vi.mock('../../src/services/videoRecovery', () => ({
  recoverInFlightVideos: vi.fn(),
}))

import { loadProjectWithResources } from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

const loadWith = (scene) => {
  fileSystemAPI.loadProjectData.mockResolvedValue({
    success: true,
    data: {
      scenes: [scene],
      references: [],
      videoScenes: [],
      framePairs: [],
      srtTrack: [],
      schemaVersion: 2,
      settings: { aspectRatio: '16:9' },
    },
  })
  // 파일 디스크에 존재 (이미지가 살아있음)
  fileSystemAPI.getResourcePath.mockResolvedValue({ success: true, path: '/proj/scenes/s1.png' })
  fileSystemAPI.getHistory.mockResolvedValue({ success: false })
  return loadProjectWithResources('proj')
}

// mediaId 를 넣어 backfill 경로(getHistory)를 타지 않게 한다 — status 정상화만 검증.
const scene = (over = {}) => ({ id: 's1', mediaId: 'm1', status: 'done', prompt: 'P0', ...over })

describe('loadProjectWithResources — pending 씬 로드 보존', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('프롬프트 변경으로 pending 인 씬은 파일이 있어도 done 으로 올리지 않는다', async () => {
    const result = await loadWith(scene({ status: 'pending', prompt: 'P1', donePrompt: 'P0' }))
    expect(result.scenes[0].status).toBe('pending')
    expect(result.scenes[0].imagePath).toBe('/proj/scenes/s1.png') // 썸네일용 path 는 갱신
  })

  it('done 씬은 파일이 있으면 그대로 done (회귀 방지)', async () => {
    const result = await loadWith(scene({ status: 'done', prompt: 'P0' }))
    expect(result.scenes[0].status).toBe('done')
  })

  it('generation 실패 error(non-missing) 씬은 파일이 있어도 error 보존 (회귀 방지)', async () => {
    const result = await loadWith(scene({ status: 'error', errorKind: 'gen-failed', error: 'boom' }))
    expect(result.scenes[0].status).toBe('error')
    expect(result.scenes[0].errorKind).toBe('gen-failed')
  })

  it('pending 보존 시 donePrompt 도 유지돼 복귀 후 원복 복원이 가능하다', async () => {
    const result = await loadWith(scene({ status: 'pending', prompt: 'P1', donePrompt: 'P0' }))
    expect(result.scenes[0].donePrompt).toBe('P0')
  })
})
