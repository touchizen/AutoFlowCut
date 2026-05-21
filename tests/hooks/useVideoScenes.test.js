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
