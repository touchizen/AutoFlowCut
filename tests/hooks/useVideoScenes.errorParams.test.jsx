/**
 * useVideoScenes — 영상 kind 의 params·거부 미디어 id 는 videoT2V* 네임스페이스로 (M2-R1 F2, A2)
 *
 * updateVideoScene 의 errorParams·rejectedMediaId·rejectedMediaIds 는 FIELD_MAP 에 없어서 이미지 씬의 **동명 최상위 필드**에
 * 쓰였고(이미지 kind 의 params 가 덮인다), deriveVideoScene 이 읽지도 않아 영상 ResultsTable/VideoDetailModal 은 params 를
 * 못 받았다({requested} 대신 raw kind 토큰). 실제 useVideoScenes + ResultsTable 로 끝까지 확인한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, render } from '@testing-library/react'
import { useState, useCallback } from 'react'
import { useVideoScenes } from '../../src/hooks/useVideoScenes'
import ResultsTable from '../../src/components/ResultsTable'
import { I18nProvider } from '../../src/hooks/useI18n'

// scenesHook stub — useScenes 의 updateScene 과 같은 얕은 머지
function useFakeScenesHook(initialScenes = []) {
  const [scenes, setScenesState] = useState(initialScenes)
  const setScenes = useCallback((valueOrFn) => { setScenesState(prev => typeof valueOrFn === 'function' ? valueOrFn(prev) : valueOrFn) }, [])
  const updateScene = useCallback((id, patch) => { setScenesState(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s)) }, [])
  return { scenes, setScenes, updateScene }
}
function setupHook(initialScenes) {
  return renderHook(() => {
    const scenesHook = useFakeScenesHook(initialScenes)
    const videoScenesHook = useVideoScenes(scenesHook.scenes, scenesHook)
    return { scenesHook, videoScenesHook }
  })
}
const IMAGE_PARAMS = { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' }
const SCENE = () => ({ id: 'scene_1', prompt: 'img', videoT2VPrompt: 'vid', status: 'error', error: 'flow-image-model-mismatch', errorKind: 'flow-image-model-mismatch', errorParams: IMAGE_PARAMS })
const errorTexts = (items) => {
  const { container } = render(<I18nProvider><ResultsTable items={items} mediaType="video" onVideoRetry={vi.fn()} /></I18nProvider>)
  return Array.from(container.querySelectorAll('.prompt-error')).map((el) => el.textContent)
}

describe('useVideoScenes — errorParams / rejectedMediaId(s) 는 videoT2V* 로 매핑되고 derived 로 돌아온다', () => {
  it('flow-resolution-not-offered {requested}: 영상 표 텍스트에 1080p, {requested} 없음; 이미지 씬의 자기 errorParams 는 불변', async () => {
    const { result } = setupHook([SCENE()])
    await act(async () => { result.current.videoScenesHook.updateVideoScene('vscene_1', { status: 'error', error: 'flow-resolution-not-offered', errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } }) })
    const scene = result.current.scenesHook.scenes[0]
    expect(scene.errorParams).toEqual(IMAGE_PARAMS)               // 이미지 kind 의 params 가 덮이지 않는다
    expect(scene.errorKind).toBe('flow-image-model-mismatch')
    expect(scene.videoT2VErrorParams).toEqual({ requested: '1080p' })
    const vs = result.current.videoScenesHook.videoScenes[0]
    expect(vs).toMatchObject({ status: 'error', errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    const [text] = errorTexts(result.current.videoScenesHook.videoScenes)
    expect(text).toContain('1080p')
    expect(text).not.toMatch(/\{\w+\}/)
  })

  it('flow-batch-halted {cause}: 영상 표 텍스트에 원인 kind, {cause} 없음', async () => {
    const { result } = setupHook([SCENE()])
    await act(async () => { result.current.videoScenesHook.updateVideoScene('vscene_1', { status: 'error', error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-video-settings-mismatch' } }) })
    expect(result.current.scenesHook.scenes[0].errorParams).toEqual(IMAGE_PARAMS)
    const [text] = errorTexts(result.current.videoScenesHook.videoScenes)
    expect(text).toContain('flow-video-settings-mismatch')
    expect(text).not.toMatch(/\{\w+\}/)
  })

  it('rejectedMediaId(s) 는 videoT2VRejectedMediaId(s) 로 — mediaId 로 둔갑하지 않고, 이미지 씬 최상위에 남지 않는다', async () => {
    const { result } = setupHook([SCENE()])
    await act(async () => { result.current.videoScenesHook.updateVideoScene('vscene_1', { rejectedMediaId: '<uuid#11>', rejectedMediaIds: ['<uuid#11>', '<uuid#12>'] }) })
    const scene = result.current.scenesHook.scenes[0]
    expect(scene).not.toHaveProperty('rejectedMediaId')
    expect(scene).not.toHaveProperty('rejectedMediaIds')
    expect(scene.videoT2VRejectedMediaId).toBe('<uuid#11>')
    expect(scene.videoT2VRejectedMediaIds).toEqual(['<uuid#11>', '<uuid#12>'])
    const vs = result.current.videoScenesHook.videoScenes[0]
    expect(vs.mediaId).toBeNull()
    expect(vs.rejectedMediaId).toBe('<uuid#11>')
    expect(vs.rejectedMediaIds).toEqual(['<uuid#11>', '<uuid#12>'])
  })

  it('clearVideoScenes 는 세 필드도 비운다', async () => {
    const { result } = setupHook([{ ...SCENE(), videoT2VErrorParams: { requested: '1080p' }, videoT2VRejectedMediaId: '<uuid#11>', videoT2VRejectedMediaIds: ['<uuid#11>'] }])
    expect(result.current.videoScenesHook.videoScenes[0].errorParams).toEqual({ requested: '1080p' })
    await act(async () => { result.current.videoScenesHook.clearVideoScenes() })
    const scene = result.current.scenesHook.scenes[0]
    expect(scene.videoT2VErrorParams).toBeNull()
    expect(scene.videoT2VRejectedMediaId).toBeNull()
    expect(scene.videoT2VRejectedMediaIds).toBeNull()
    expect(scene.errorParams).toEqual(IMAGE_PARAMS)               // 이미지 쪽은 clearVideoScenes 의 대상이 아니다
  })
})
