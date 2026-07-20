/**
 * useScenes hook — Review fix 1 회귀 가드
 *
 * C6: 새 형식 CSV 재import 가 기존 image/status/mediaId 보존 (merge by id)
 * C9: MCP update-scenes 가 incoming.srtLineIds 누락 시 기존 보존
 * C16: parseFromSRT smart-match 가 srtLineIds=[] 되면 scene.subtitle 도 클리어
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

const NEW_CSV_V1 = `scene,prompt,subtitle,start_time,end_time
1,"PromptA","자막1",0,3
2,"PromptB","자막2",3,6`

const NEW_CSV_V2 = `scene,prompt,subtitle,start_time,end_time
1,"PromptA-Refined","자막1",0,3
2,"PromptB-Refined","자막2",3,6`

describe('C6 — 새 형식 CSV 재import 시 image/status 보존', () => {
  it('이미지 생성된 씬에 새 형식 CSV 재import → prompt 갱신, image 보존', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(NEW_CSV_V1) })
    const sceneIds = result.current.scenes.map(s => s.id)
    expect(sceneIds).toHaveLength(2)

    // 이미지 + status 부여
    act(() => {
      result.current.updateScene(sceneIds[0], {
        image: 'data:image/png;base64,XXX',
        imagePath: '/path/to/scene_1.png',
        mediaId: 'media_aaa',
        status: 'done',
      })
      result.current.updateScene(sceneIds[1], {
        image: 'data:image/png;base64,YYY',
        imagePath: '/path/to/scene_2.png',
        mediaId: 'media_bbb',
        status: 'done',
      })
    })

    // 새 CSV 재import
    act(() => { result.current.parseFromCSV(NEW_CSV_V2) })

    expect(result.current.scenes).toHaveLength(2)
    // prompt 는 새 CSV 값
    expect(result.current.scenes[0].prompt).toBe('PromptA-Refined')
    expect(result.current.scenes[1].prompt).toBe('PromptB-Refined')
    // image/status/mediaId 보존
    expect(result.current.scenes[0].image).toBe('data:image/png;base64,XXX')
    expect(result.current.scenes[0].imagePath).toBe('/path/to/scene_1.png')
    expect(result.current.scenes[0].mediaId).toBe('media_aaa')
    expect(result.current.scenes[0].status).toBe('done')
    expect(result.current.scenes[1].image).toBe('data:image/png;base64,YYY')
  })

  it('재import 가 donePrompt(생성 기준 스냅샷)도 보존 — 되돌림 시 done 복원이 CSV 왕복에도 유지', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(NEW_CSV_V1) })
    const ids = result.current.scenes.map(s => s.id)
    act(() => {
      result.current.updateScene(ids[0], {
        image: 'data:image/png;base64,XXX', status: 'done', donePrompt: 'PromptA',
      })
    })

    act(() => { result.current.parseFromCSV(NEW_CSV_V2) })
    expect(result.current.scenes[0].donePrompt).toBe('PromptA')
  })

  it('씬 수 변경 시 (3→2): 기존 첫 2개 image 보존, 사라진 씬 폐기', () => {
    const csv3 = `scene,prompt,subtitle\n1,"A","x"\n2,"B","y"\n3,"C","z"`
    const csv2 = `scene,prompt,subtitle\n1,"A","x"\n2,"B","y"`

    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(csv3) })
    const ids = result.current.scenes.map(s => s.id)
    act(() => {
      result.current.updateScene(ids[0], { image: 'img0', status: 'done' })
      result.current.updateScene(ids[1], { image: 'img1', status: 'done' })
      result.current.updateScene(ids[2], { image: 'img2', status: 'done' })
    })

    act(() => { result.current.parseFromCSV(csv2) })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].image).toBe('img0')
    expect(result.current.scenes[1].image).toBe('img1')
  })
})

describe('T2V 런타임 필드 — CSV 재파싱 시 보존', () => {
  // 회귀: ResultsTable 은 videoT2VStatus==='generating' 일 때만 타이머를 그리므로,
  // 재파싱이 videoT2VStatus 를 지워버리면 generation 진행 중 타이머가 사라진다.
  // (timestamps 만 보존해도 status 가 'pending' 으로 떨어지면 화면에서 안 보임.)
  it('CSV 재import 가 videoT2VStatus/mediaId/generationId/selected/timer 를 보존한다', () => {
    const csv1 = `scene,prompt,video_t2v_prompt,subtitle\n1,"image A","video A","s1"\n2,"image B","video B","s2"`
    const csv2 = `scene,prompt,video_t2v_prompt,subtitle\n1,"image A2","video A2","s1"\n2,"image B2","video B2","s2"`

    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(csv1) })
    const ids = result.current.scenes.map(s => s.id)

    const startedAt = 1700000000000
    act(() => {
      result.current.updateScene(ids[0], {
        videoT2VStatus: 'generating',
        videoT2VGenerationId: 'gen_aaa',
        videoT2VMediaId: 'media_aaa',
        videoT2VSelected: true,
        videoT2VGeneratingStartedAt: startedAt,
        videoT2VGeneratingEndedAt: null,
      })
    })

    // 진행 중 CSV 재import (사용자가 프롬프트 갱신 등)
    act(() => { result.current.parseFromCSV(csv2) })

    const s0 = result.current.scenes[0]
    // prompt 는 새 CSV 값으로 갱신
    expect(s0.videoT2VPrompt).toBe('video A2')
    // 런타임 필드는 전부 보존
    expect(s0.videoT2VStatus).toBe('generating')
    expect(s0.videoT2VGenerationId).toBe('gen_aaa')
    expect(s0.videoT2VMediaId).toBe('media_aaa')
    expect(s0.videoT2VSelected).toBe(true)
    expect(s0.videoT2VGeneratingStartedAt).toBe(startedAt)
    expect(s0.videoT2VGeneratingEndedAt).toBeNull()
  })

  it('D3/D4: CSV 재import 가 T2V provider와 appliedInputs를 generationId와 함께 보존한다', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(NEW_CSV_V1) })
    const sceneId = result.current.scenes[0].id
    const appliedInputs = { model: 'grok-imagine-video-1.5', resolution: '720p' }

    act(() => {
      result.current.updateScene(sceneId, {
        videoT2VGenerationId: 'gen:v1:grok-handle',
        videoT2VProvider: 'grok',
        videoT2VAppliedInputs: appliedInputs,
      })
    })
    act(() => { result.current.parseFromCSV(NEW_CSV_V2) })

    const scene = result.current.scenes[0]
    expect(scene.videoT2VGenerationId).toBe('gen:v1:grok-handle')
    expect(scene.videoT2VProvider).toBe('grok')
    expect(scene.videoT2VAppliedInputs).toBe(appliedInputs)
  })
})

describe('I2V 런타임 필드 — CSV 재파싱 시 보존', () => {
  // 회귀: 타임라인은 videoI2VStatus==='generating' 일 때만 generating 클립을 그리고,
  // 경과 타이머는 videoI2VGeneratingStartedAt/EndedAt 를 읽는다. 재파싱이 status 만 살리고
  // timestamp 를 잃으면 타이머가 0:00 으로 회귀한다(T2V 와 동일 함정).
  it('CSV 재import 가 videoI2VStatus + generating timestamp 를 보존한다', () => {
    const csv1 = `scene,prompt,video_t2v_prompt,subtitle\n1,"image A","video A","s1"\n2,"image B","video B","s2"`
    const csv2 = `scene,prompt,video_t2v_prompt,subtitle\n1,"image A2","video A2","s1"\n2,"image B2","video B2","s2"`

    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(csv1) })
    const ids = result.current.scenes.map(s => s.id)

    const startedAt = 1700000000000
    act(() => {
      result.current.updateScene(ids[0], {
        videoI2VStatus: 'generating',
        videoI2VGeneratingStartedAt: startedAt,
        videoI2VGeneratingEndedAt: null,
      })
    })

    act(() => { result.current.parseFromCSV(csv2) })

    const s0 = result.current.scenes[0]
    expect(s0.videoI2VStatus).toBe('generating')
    expect(s0.videoI2VGeneratingStartedAt).toBe(startedAt)
    expect(s0.videoI2VGeneratingEndedAt).toBeNull()
  })
})

describe('C16 — smart-match 실패 시 scene.subtitle 클리어', () => {
  it('SRT 재import 텍스트 완전 변경 → 기존 씬 srtLineIds=[] + subtitle 클리어 (UI/export 일치)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(`1
00:00:00,000 --> 00:00:01,000
원본 자막`)
    })
    const sceneId = result.current.scenes[0].id
    expect(result.current.scenes[0].subtitle).toBe('원본 자막')

    // 매칭 임계 미달인 완전 다른 SRT
    act(() => {
      result.current.parseFromSRT(`1
00:00:00,000 --> 00:00:01,000
완전히 다른 새로운 텍스트`)
    })

    // 기존 씬 보존 + srtLineIds=[] → subtitle 도 '' 로 클리어
    const oldScene = result.current.scenes.find(s => s.id === sceneId)
    expect(oldScene).toBeTruthy()
    expect(oldScene.srtLineIds).toEqual([])
    expect(oldScene.subtitle).toBe('')
  })
})
