/**
 * useMcpServer — load_csv(update-scenes) 병합이 CSV 가 싣지 않는 씬 런타임 필드를 보존한다(parseFromCSV 와 **같은 목록**).
 *
 * 실기(2026-09-26 M3 게이트): 병합이 이미지 포인터 몇 개만 골라 새 객체를 만들어 이미지 탭 모델명(model)·seed·생성 시각과
 * 완성된 텍스트→영상의 연결(videoT2VStatus·Path·MediaId·Model…)·선택이 CSV 재적용마다 사라졌다. 첫 수정(기존 씬 통째 깔기)은
 * 리뷰에서 회귀 둘을 냈다: prompt 키가 없는 옛 형식 행이 옛 프롬프트를 남긴 채 pending 이 돼 에피소드 전체가 재생성 대상이 됐고,
 * 옛 형식이 남긴 start_time/end_time 이 새 CSV 시간을 가렸다. 그래서 통째가 아니라 목록(src/utils/csvPreservedSceneFields)만 옮긴다.
 *
 * 행은 실제 MCP 경로(mcp-server/lib/csv.js loadCSV → bundleSceneCSVRows)로 만든다 — 손으로 만든 행은 실제 모양(status:'pending',
 * image:null, videoT2VPrompt:'' 등)과 달라 규칙을 못 문다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { useMcpServer } from '../../src/hooks/useMcpServer'
import { useVideoScenes } from '../../src/hooks/useVideoScenes'
import { filterPendingScenes } from '../../src/utils/sceneFilters'
import { loadCSV, bundleSceneCSVRows } from '../../mcp-server/lib/csv.js'

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

/** MCP load_csv 가 앱에 보내는 행 — 실제 loadCSV(+ 새 형식이면 bundleSceneCSVRows). */
let tmpDir
function mcpRows(csvText) {
  const p = path.join(tmpDir, `rows-${Math.random().toString(36).slice(2)}.csv`)
  fs.writeFileSync(p, csvText, 'utf-8')
  const { scenes } = loadCSV(p)
  return scenes.length && Object.prototype.hasOwnProperty.call(scenes[0], 'scene') ? bundleSceneCSVRows(scenes).scenes : scenes
}

/** 이미지·영상 둘 다 생성이 끝난 씬 — 실기 m3-live-gate 의 scene_5 모양. */
const DONE_SCENE = {
  id: 'scene_1', _sceneNum: 1, prompt: 'A', subtitle: 'old', characters: '', status: 'done', startTime: 0, endTime: 3, duration: 3,
  image: null, imagePath: '/p/scenes/scene_1.jpg', mediaId: 'img-media', image_size: { width: 1376, height: 768 }, donePrompt: 'A',
  model: 'Nano Banana 2', seed: 795165954, generatedAt: 1790382396526, generatingEndedAt: 1790382396600,
  videoT2VPrompt: 'V', videoT2VSelected: true, videoT2VStatus: 'complete',
  videoT2VPath: '/p/videos/t2v_1.mp4', videoT2VMediaId: 'vid-media', videoT2VGenerationId: 'vid-media',
  videoT2VSaveId: 't2v_1', videoT2VModel: 'Omni Flash', videoT2VDuration: 4, videoT2VSeed: 130204, videoT2VGeneratedAt: 1790383868674,
}

describe('MCP load_csv — CSV 가 싣지 않는 씬 런타임 필드 보존(실제 행)', () => {
  let cb = null
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-csvmerge-'))
    window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn((fn) => { cb = fn; return () => {} }) }
  })
  afterEach(() => { delete window.electronAPI; cb = null; fs.rmSync(tmpDir, { recursive: true, force: true }) })

  function applyUpdate(prev, incomingScenes) {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))
    cb({ type: 'update-scenes', scenes: incomingScenes })
    return setScenes.mock.calls[0][0](prev)
  }

  it('새 형식 CSV, 프롬프트 같음 → 생성 메타·영상 결과·선택 보존, CSV 필드(자막·캐릭터)는 반영', () => {
    const rows = mcpRows('scene,prompt,video_prompt,subtitle,characters,start_time,end_time\n1,"A","V","new","king",0,3\n')
    const [s] = applyUpdate([DONE_SCENE], rows)
    expect(s.subtitle).toBe('new')
    expect(s.characters).toBe('king')
    expect(s.status).toBe('done')
    expect(s).toMatchObject({ imagePath: '/p/scenes/scene_1.jpg', mediaId: 'img-media' })
    expect(s).toMatchObject({ model: 'Nano Banana 2', seed: 795165954, generatedAt: 1790382396526, generatingEndedAt: 1790382396600 })
    expect(s).toMatchObject({
      videoT2VSelected: true, videoT2VStatus: 'complete', videoT2VPath: '/p/videos/t2v_1.mp4',
      videoT2VMediaId: 'vid-media', videoT2VGenerationId: 'vid-media', videoT2VSaveId: 't2v_1',
      videoT2VModel: 'Omni Flash', videoT2VDuration: 4, videoT2VSeed: 130204, videoT2VGeneratedAt: 1790383868674,
    })
  })

  it('새 형식 CSV, 프롬프트 바뀜 → 기존 규칙대로 pending, 남아 있는 옛 이미지의 메타는 보존', () => {
    const [s] = applyUpdate([DONE_SCENE], mcpRows('scene,prompt,start_time,end_time\n1,"A-refined",0,3\n'))
    expect(s.prompt).toBe('A-refined')
    expect(s.status).toBe('pending')
    expect(s.imagePath).toBe('/p/scenes/scene_1.jpg')
    expect(s.model).toBe('Nano Banana 2')
  })

  it('리뷰 R1 MAJOR: prompt 키가 없는 옛 형식 행(헤더 Prompt)이 완료 씬을 재생성 대상으로 만들지 않는다', () => {
    const rows = mcpRows('Prompt,subtitle\n"A","s"\n')
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'prompt')).toBe(false)   // 실제 옛 형식 행 모양
    const merged = applyUpdate([DONE_SCENE], rows)
    expect(filterPendingScenes(merged)).toEqual([])
  })

  it('리뷰 R1 MAJOR: 옛 형식이 남긴 start_time/end_time 이 새 CSV 시간을 가리지 않는다', () => {
    const prev = [{ ...DONE_SCENE, start_time: 1, end_time: 4 }]
    const [s] = applyUpdate(prev, mcpRows('scene,prompt,start_time,end_time\n1,"A",10,13\n'))
    expect(s.startTime).toBe(10)
    expect(s.endTime).toBe(13)
    expect(s.start_time).toBeUndefined()
    expect(s.end_time).toBeUndefined()
  })

  it('실제 행이 싣는 image:null 이 기존 이미지를 지우지 않는다', () => {
    const rows = mcpRows('scene,prompt,start_time,end_time\n1,"A",0,3\n')
    expect(rows[0].image).toBeNull()
    const [s] = applyUpdate([{ ...DONE_SCENE, image: 'data:img' }], rows)
    expect(s.image).toBe('data:img')
  })

  it('통합: 병합 뒤에도 영상 탭(useVideoScenes)에 완료된 영상이 선택된 채로 보인다', () => {
    const merged = applyUpdate([DONE_SCENE], mcpRows('scene,prompt,video_prompt,subtitle,start_time,end_time\n1,"A","V","new",0,3\n'))
    const { result } = renderHook(() => useVideoScenes(merged, null))
    expect(result.current.videoScenes).toHaveLength(1)
    expect(result.current.videoScenes[0]).toMatchObject({
      id: 'vscene_1', status: 'complete', videoPath: '/p/videos/t2v_1.mp4', mediaId: 'vid-media', model: 'Omni Flash', selected: true,
    })
  })
})
