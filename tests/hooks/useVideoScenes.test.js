/**
 * useVideoScenes — Step 3 이후의 derived view 단위 테스트.
 *
 * videoScenes 는 별도 state 가 아니라 scenes 에서 videoT2VPrompt 가 있는 항목만
 * vscene_N id 로 변환해 노출하는 *derived* 데이터. 모든 write 함수는 scenes 의
 * videoT2V* 필드를 갱신하는지 검증한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState, useCallback } from 'react'
import { useVideoScenes } from '../../src/hooks/useVideoScenes'

// scenesHook stub — 실제 useScenes 의 인터페이스 중 useVideoScenes 가 쓰는 부분만 구현
function useFakeScenesHook(initialScenes = []) {
  const [scenes, setScenesState] = useState(initialScenes)

  const setScenes = useCallback((valueOrFn) => {
    setScenesState(prev => typeof valueOrFn === 'function' ? valueOrFn(prev) : valueOrFn)
  }, [])

  const updateScene = useCallback((id, patch) => {
    setScenesState(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }, [])

  const parseFromText = useCallback((text, _defaultDuration, options = {}) => {
    const fieldName = options.fieldName || 'prompt'
    setScenesState(prev => {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      const maxLen = Math.max(prev.length, lines.length)
      return Array.from({ length: maxLen }, (_, i) => {
        const ex = prev[i]
        const line = lines[i]
        if (ex && line !== undefined) return { ...ex, [fieldName]: line }
        if (ex) return ex
        return { id: `scene_${i + 1}`, [fieldName]: line }
      })
    })
    return null
  }, [])

  return { scenes, setScenes, updateScene, parseFromText }
}

function setupHook(initialScenes = []) {
  return renderHook(() => {
    const scenesHook = useFakeScenesHook(initialScenes)
    const videoScenesHook = useVideoScenes(scenesHook.scenes, scenesHook)
    return { scenesHook, videoScenesHook }
  })
}

describe('useVideoScenes — derived view', () => {
  it('빈 scenes 면 videoScenes 빈 배열', () => {
    const { result } = setupHook([])
    expect(result.current.videoScenesHook.videoScenes).toEqual([])
  })

  it('videoT2VPrompt 가 있는 scene 만 vscene 으로 노출', () => {
    const { result } = setupHook([
      { id: 'scene_1', prompt: '이미지', videoT2VPrompt: '' },
      { id: 'scene_2', prompt: '이미지', videoT2VPrompt: '비디오 A' },
      { id: 'scene_3', prompt: '이미지', videoT2VPrompt: '' },
      { id: 'scene_4', prompt: '이미지', videoT2VPrompt: '비디오 B' },
    ])
    const vs = result.current.videoScenesHook.videoScenes
    expect(vs).toHaveLength(2)
    expect(vs[0].id).toBe('vscene_2')
    expect(vs[0].prompt).toBe('비디오 A')
    expect(vs[1].id).toBe('vscene_4')
    expect(vs[1].prompt).toBe('비디오 B')
  })

  it('vscene_N id ↔ scene_N id 매핑 (id rewrite 검증)', () => {
    const { result } = setupHook([
      { id: 'scene_1', videoT2VPrompt: 'v1' },
      { id: 'scene_5', videoT2VPrompt: 'v5' },
    ])
    const vs = result.current.videoScenesHook.videoScenes
    expect(vs[0].id).toBe('vscene_1')
    expect(vs[1].id).toBe('vscene_5')
  })

  it('videoT2VDuration 없으면 scene.duration 으로 fallback', () => {
    const { result } = setupHook([
      { id: 'scene_1', videoT2VPrompt: 'v1', duration: 4, videoT2VDuration: null },
      { id: 'scene_2', videoT2VPrompt: 'v2', duration: 3, videoT2VDuration: 7 },
    ])
    const vs = result.current.videoScenesHook.videoScenes
    expect(vs[0].duration).toBe(4)
    expect(vs[1].duration).toBe(7)
  })

  it('T2V 진행중 타이머 필드(generatingStartedAt/EndedAt)를 vscene 에 노출한다', () => {
    // 회귀: deriveVideoScene 이 이 필드를 안 꺼내면 ResultsTable 의 ElapsedTime 이
    // 항상 0:00 으로 멈춰 다운로드 완료 전까지 경과 시간을 보여주지 못한다.
    const startedAt = 1700000000000
    const { result } = setupHook([
      {
        id: 'scene_1',
        videoT2VPrompt: 'v1',
        videoT2VStatus: 'generating',
        videoT2VGeneratingStartedAt: startedAt,
        videoT2VGeneratingEndedAt: null,
      },
      {
        id: 'scene_2',
        videoT2VPrompt: 'v2',
        videoT2VStatus: 'complete',
        videoT2VGeneratingStartedAt: startedAt,
        videoT2VGeneratingEndedAt: startedAt + 30000,
      },
    ])
    const vs = result.current.videoScenesHook.videoScenes
    expect(vs[0].generatingStartedAt).toBe(startedAt)
    expect(vs[0].generatingEndedAt).toBeNull()
    expect(vs[1].generatingStartedAt).toBe(startedAt)
    expect(vs[1].generatingEndedAt).toBe(startedAt + 30000)
  })

  it('updateVideoScene { generatingStartedAt } → scene.videoT2VGeneratingStartedAt (네임스페이스 매핑)', () => {
    // 이미지 씬도 같은 이름의 필드를 쓰므로, 네임스페이스 없이 그대로 저장하면
    // T2V 시작이 이미지 씬의 generatingStartedAt 를 덮어쓴다(또는 그 반대).
    const startedAt = 1700000000000
    const { result } = setupHook([
      { id: 'scene_1', videoT2VPrompt: 'v1', generatingStartedAt: 1234 },
    ])
    act(() => {
      result.current.videoScenesHook.updateVideoScene('vscene_1', {
        status: 'generating',
        generatingStartedAt: startedAt,
        generatingEndedAt: null,
      })
    })
    const scene = result.current.scenesHook.scenes[0]
    expect(scene.videoT2VGeneratingStartedAt).toBe(startedAt)
    expect(scene.videoT2VGeneratingEndedAt).toBeNull()
    // 이미지 씬의 동명 필드는 영향받지 않아야 한다
    expect(scene.generatingStartedAt).toBe(1234)
  })

  it('source scene의 이미지 필드를 poster용으로 vscene에 보존한다', () => {
    const { result } = setupHook([
      {
        id: 'scene_1',
        videoT2VPrompt: 'v1',
        image: 'data:image/png;base64,POSTER',
        imagePath: '/abs/poster.png',
        filePath: '/abs/fallback.png',
        data: 'data:image/png;base64,FALLBACK',
      },
    ])

    const [vs] = result.current.videoScenesHook.videoScenes
    expect(vs.image).toBe('data:image/png;base64,POSTER')
    expect(vs.imagePath).toBe('/abs/poster.png')
    expect(vs.filePath).toBe('/abs/fallback.png')
    expect(vs.data).toBe('data:image/png;base64,FALLBACK')
  })
})

describe('useVideoScenes — write 라우팅', () => {
  it('parseFromText → scenes.videoT2VPrompt 만 갱신', () => {
    const { result } = setupHook([
      { id: 'scene_1', prompt: '기존 이미지', videoT2VPrompt: '', subtitle: '자막', duration: 5 },
    ])
    act(() => {
      result.current.videoScenesHook.parseFromText('NEW VIDEO', 3)
    })
    const scene = result.current.scenesHook.scenes[0]
    expect(scene.videoT2VPrompt).toBe('NEW VIDEO')
    expect(scene.prompt).toBe('기존 이미지')
  })

  it('updateVideoScene { prompt } → scene.videoT2VPrompt (FIELD_MAP 매핑)', () => {
    const { result } = setupHook([
      { id: 'scene_1', prompt: 'image', videoT2VPrompt: 'old video' },
    ])
    act(() => {
      result.current.videoScenesHook.updateVideoScene('vscene_1', { prompt: 'new video' })
    })
    expect(result.current.scenesHook.scenes[0].videoT2VPrompt).toBe('new video')
    expect(result.current.scenesHook.scenes[0].prompt).toBe('image')
  })

  it('updateVideoScene { videoPath, status } → scene.videoT2VPath / videoT2VStatus', () => {
    const { result } = setupHook([
      { id: 'scene_1', videoT2VPrompt: 'v', videoT2VPath: null, videoT2VStatus: 'pending' },
    ])
    act(() => {
      result.current.videoScenesHook.updateVideoScene('vscene_1', {
        videoPath: '/out/v.mp4',
        status: 'complete',
      })
    })
    expect(result.current.scenesHook.scenes[0].videoT2VPath).toBe('/out/v.mp4')
    expect(result.current.scenesHook.scenes[0].videoT2VStatus).toBe('complete')
  })

  it('updateVideoScene { generatedAt, error, seed, model, errorKind, videoSaveId } → videoT2V* (이미지 메타 오염 안 함)', () => {
    const { result } = setupHook([
      { id: 'scene_1', prompt: 'image', generatedAt: 100, error: null, seed: 1, videoT2VPrompt: 'v' },
    ])
    act(() => {
      result.current.videoScenesHook.updateVideoScene('vscene_1', {
        generatedAt: 999, error: 'boom', seed: 42, model: 'veo', errorKind: 'x', videoSaveId: 't2v_1',
      })
    })
    const s = result.current.scenesHook.scenes[0]
    expect(s.videoT2VGeneratedAt).toBe(999)
    expect(s.videoT2VError).toBe('boom')
    expect(s.videoT2VSeed).toBe(42)
    expect(s.videoT2VModel).toBe('veo')
    expect(s.videoT2VErrorKind).toBe('x')
    expect(s.videoT2VSaveId).toBe('t2v_1')
    // 이미지 씬 메타는 그대로 (오염 금지)
    expect(s.generatedAt).toBe(100)
    expect(s.error).toBe(null)
    expect(s.seed).toBe(1)
  })

  it('deriveVideoScene 이 videoT2V* 메타(generatedAt/error/seed)를 vscene 에 노출', () => {
    const { result } = setupHook([
      { id: 'scene_1', videoT2VPrompt: 'v', videoT2VGeneratedAt: 777, videoT2VError: 'oops', videoT2VSeed: 7 },
    ])
    const vs = result.current.videoScenesHook.videoScenes[0]
    expect(vs.generatedAt).toBe(777)
    expect(vs.error).toBe('oops')
    expect(vs.seed).toBe(7)
  })

  it('clearVideoScenes → 모든 scene 의 videoT2V* 필드 초기화 (scene 자체는 보존)', () => {
    const { result } = setupHook([
      { id: 'scene_1', prompt: 'image1', videoT2VPrompt: 'v1', videoT2VPath: '/v1.mp4', videoT2VSelected: true },
      { id: 'scene_2', prompt: 'image2', videoT2VPrompt: 'v2', videoT2VPath: '/v2.mp4' },
    ])
    act(() => {
      result.current.videoScenesHook.clearVideoScenes()
    })
    const scenes = result.current.scenesHook.scenes
    expect(scenes).toHaveLength(2)
    expect(scenes[0].prompt).toBe('image1')
    expect(scenes[0].videoT2VPrompt).toBe('')
    expect(scenes[0].videoT2VPath).toBeNull()
    expect(scenes[0].videoT2VSelected).toBe(false)
    expect(result.current.videoScenesHook.videoScenes).toEqual([])
  })

  it('clearVideoScenes → 새 메타 필드(videoT2VGeneratedAt/Error/Seed/Model/ErrorKind/SaveId)도 초기화', () => {
    const { result } = setupHook([
      { id: 'scene_1', videoT2VPrompt: 'v', videoT2VGeneratedAt: 999, videoT2VError: 'e', videoT2VSeed: 5, videoT2VModel: 'm', videoT2VErrorKind: 'k', videoT2VSaveId: 't2v_1' },
    ])
    act(() => { result.current.videoScenesHook.clearVideoScenes() })
    const s = result.current.scenesHook.scenes[0]
    expect(s.videoT2VGeneratedAt).toBeNull()
    expect(s.videoT2VError).toBeNull()
    expect(s.videoT2VSeed).toBeNull()
    expect(s.videoT2VModel).toBeNull()
    expect(s.videoT2VErrorKind).toBeNull()
    expect(s.videoT2VSaveId).toBeNull()
  })

  it('toggleSelect → 해당 scene 의 videoT2VSelected 토글', () => {
    const { result } = setupHook([
      { id: 'scene_1', videoT2VPrompt: 'v1', videoT2VSelected: false },
      { id: 'scene_2', videoT2VPrompt: 'v2', videoT2VSelected: false },
    ])
    act(() => {
      result.current.videoScenesHook.toggleSelect('vscene_1')
    })
    expect(result.current.scenesHook.scenes[0].videoT2VSelected).toBe(true)
    expect(result.current.scenesHook.scenes[1].videoT2VSelected).toBe(false)
  })

  it('toggleSelectAll → 모든 videoT2VPrompt 있는 scene 의 선택 토글', () => {
    const { result } = setupHook([
      { id: 'scene_1', videoT2VPrompt: 'v1', videoT2VSelected: false },
      { id: 'scene_2', prompt: 'img', videoT2VPrompt: '' },
      { id: 'scene_3', videoT2VPrompt: 'v3', videoT2VSelected: false },
    ])
    act(() => {
      result.current.videoScenesHook.toggleSelectAll()
    })
    expect(result.current.scenesHook.scenes[0].videoT2VSelected).toBe(true)
    expect(result.current.scenesHook.scenes[1].videoT2VSelected).toBeFalsy()
    expect(result.current.scenesHook.scenes[2].videoT2VSelected).toBe(true)
  })

  it('setVideoScenes (legacy) — vscene 배열을 받아 scene 으로 머지', () => {
    const { result } = setupHook([
      { id: 'scene_1', prompt: 'image1', videoT2VPrompt: 'old v' },
    ])
    act(() => {
      result.current.videoScenesHook.setVideoScenes([
        { id: 'vscene_1', prompt: 'new v', videoPath: '/v1.mp4', status: 'complete' },
      ])
    })
    const scene = result.current.scenesHook.scenes[0]
    expect(scene.prompt).toBe('image1')
    expect(scene.videoT2VPrompt).toBe('new v')
    expect(scene.videoT2VPath).toBe('/v1.mp4')
    expect(scene.videoT2VStatus).toBe('complete')
  })

  it('setVideoScenes (legacy) — 더 긴 배열이 들어오면 부족분 scene 자동 보강', () => {
    const { result } = setupHook([
      { id: 'scene_1', prompt: 'img1', videoT2VPrompt: 'v1' },
    ])
    act(() => {
      result.current.videoScenesHook.setVideoScenes([
        { id: 'vscene_1', prompt: 'v1', videoPath: null, status: 'pending' },
        { id: 'vscene_2', prompt: 'v2', videoPath: null, status: 'pending' },
      ])
    })
    const scenes = result.current.scenesHook.scenes
    expect(scenes).toHaveLength(2)
    expect(scenes[0].id).toBe('scene_1')
    expect(scenes[0].prompt).toBe('img1')
    expect(scenes[1].id).toBe('scene_2')
    expect(scenes[1].videoT2VPrompt).toBe('v2')
    expect(scenes[1].prompt || '').toBe('')
  })

  it('scenesHook 누락 → write 함수들은 no-op (throw 없음)', () => {
    const { result } = renderHook(() => useVideoScenes([{ id: 'scene_1', videoT2VPrompt: 'v' }], null))
    expect(() => result.current.parseFromText('x')).not.toThrow()
    expect(() => result.current.updateVideoScene('vscene_1', { prompt: 'y' })).not.toThrow()
    expect(() => result.current.clearVideoScenes()).not.toThrow()
    expect(() => result.current.setVideoScenes([])).not.toThrow()
  })
})
