/**
 * useMcpServer — MCP HTTP `{type:'update-settings', fields}` 가 앱 설정을 병합한다 (M2 실기 준비).
 *   에이전트가 영상 모델·해상도 같은 설정을 UI 없이 맞출 수 있어야 T2V 배치를 자동으로 돌린다(useAppSettings 가
 *   localStorage 로 동기화하므로 재시작 뒤에도 남는다). fields 가 객체가 아니면 아무것도 하지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'

let mcpHandler = null
function makeProps(overrides = {}) {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [], setScenes: vi.fn(), references: [], setReferences: vi.fn(),
    handleGenerateRef: vi.fn(), handleGenerateScene: vi.fn(), handleGenerateAllRefs: vi.fn(), handleStart: vi.fn(), handleStop: vi.fn(),
    handleProjectChange: vi.fn(), handleExportConfirm: vi.fn(), selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
    refreshReviews: vi.fn(), audioReviews: [], importByPath: vi.fn(), audioPackage: null,
    automationState: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    videoAutomation: {}, generatingRefs: [], isRunning: false,
    ...overrides,
  }
}
beforeEach(() => {
  mcpHandler = null
  window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn((cb) => { mcpHandler = cb; return () => {} }) }
})
afterEach(() => { delete window.electronAPI })

describe('useMcpServer — update-settings', () => {
  it('fields 를 기존 설정에 병합하는 updater 로 setSettings 를 부른다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    expect(typeof mcpHandler).toBe('function')
    mcpHandler({ type: 'update-settings', fields: { videoModelT2V: 'Omni Flash', videoResolution: '720p' } })
    expect(setSettings).toHaveBeenCalledTimes(1)
    const updater = setSettings.mock.calls[0][0]
    expect(typeof updater).toBe('function')
    expect(updater({ aspectRatio: '9:16', videoResolution: '1080p' })).toEqual({ aspectRatio: '9:16', videoResolution: '720p', videoModelT2V: 'Omni Flash' })
  })
  // M2-LIVE N3(A3/B2): main 의 /api/update 가 먼저 400 으로 거르지만 렌더러도 화이트리스트 밖·모양 틀린 키를 버린다(이중 방어 — 공용 상수 src/utils/mcpSettingsWhitelist.js).
  it('화이트리스트 밖의 키(projectName·mcpHttpEnabled·saveMode)와 모양 틀린 값(seedNo:"abc")은 버리고 유효한 키만 병합한다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    mcpHandler({ type: 'update-settings', fields: { videoModelT2V: 'Omni Flash', projectName: 'B', mcpHttpEnabled: false, saveMode: 'none', seedNo: 'abc' } })
    expect(setSettings).toHaveBeenCalledTimes(1)
    const merged = setSettings.mock.calls[0][0]({ projectName: 'A', mcpHttpEnabled: true, saveMode: 'folder', seedNo: 7, videoModelT2V: 'Veo 3.1 - Fast' })
    expect(merged).toEqual({ projectName: 'A', mcpHttpEnabled: true, saveMode: 'folder', seedNo: 7, videoModelT2V: 'Omni Flash' })
  })
  // main 병합(리뷰 A F3): multi-provider 에서 모델 키는 "현재 provider 의 활성 모델"이다 — 다른 provider 의 카탈로그 모델을 그대로 넣으면
  //   {openai, gemini-3-pro-image} 같은 조합이 되어 이후 모든 생성이 그 adapter 에서 실패한다. 설정 화면처럼 provider 도 그 모델의 provider 로 맞춘다.
  it('다른 provider 의 카탈로그 모델(image gemini-3-pro-image)이면 provider 를 전환하고 이전 모델은 슬롯에 기억한다 — 시험 단계 provider 모델(t2v grok)은 버린다(R2-1)', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    mcpHandler({ type: 'update-settings', fields: { imageModel: 'gemini-3-pro-image', videoModelT2V: 'grok-imagine-video-1.5' } })
    const next = setSettings.mock.calls[0][0]({
      imageModel: 'gpt-image-1', videoModelT2V: 'veo-3.1-fast-generate-preview', videoModelF2V: 'veo-3.1-generate-preview',
      generation: { image: { provider: 'openai' }, video: { t2v: { provider: 'google' }, i2v: { provider: 'google' } } },
      modelsByProvider: { openai: 'gpt-image-1' }, modelsByProviderVideo: { t2v: {}, i2v: {} },
    })
    expect(next.imageModel).toBe('gemini-3-pro-image')
    expect(next.generation.image.provider).toBe('google')
    expect(next.modelsByProvider.openai).toBe('gpt-image-1')
    expect(next.videoModelT2V).toBe('veo-3.1-fast-generate-preview')
    expect(next.generation.video.t2v.provider).toBe('google')
    expect(next.generation.video.i2v.provider).toBe('google')
    expect(next.videoModelF2V).toBe('veo-3.1-generate-preview')
  })
  // 리뷰 A R2-2: Flow 모드는 provider 축이 없다 — 정렬하지 않고 그대로 병합(Flow heal 이 Flow 모델로 되돌린다)
  it('Flow 모드: 다른 provider 의 카탈로그 모델이어도 provider 를 바꾸지 않는다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings, mode: 'flow' })))
    mcpHandler({ type: 'update-settings', fields: { imageModel: 'gpt-image-1' } })
    const prev = { imageModel: 'Nano Banana 2', generation: { image: { provider: 'google' } } }
    expect(setSettings.mock.calls[0][0](prev)).toEqual({ ...prev, imageModel: 'gpt-image-1' })
  })
  // 리뷰 B R2 F1: 핸들러는 마운트 때 한 번 등록된다(effect deps []) — 모드는 ref 로 **지금** 값을 읽어야 한다. 마운트 모드만 보면 토글 뒤에 R2-2/F3 가 되살아난다.
  it('마운트 뒤 API → Flow 로 바뀌면 정렬하지 않는다', () => {
    const setSettings = vi.fn()
    const props = makeProps({ setSettings, mode: 'api' })
    const { rerender } = renderHook((p) => useMcpServer(p), { initialProps: props })
    rerender({ ...props, mode: 'flow' })
    mcpHandler({ type: 'update-settings', fields: { imageModel: 'gpt-image-1' } })
    const prev = { imageModel: 'Nano Banana 2', generation: { image: { provider: 'google' } } }
    expect(setSettings.mock.calls[0][0](prev)).toEqual({ ...prev, imageModel: 'gpt-image-1' })
  })
  it('마운트 뒤 Flow → API 로 바뀌면 provider 를 정렬한다', () => {
    const setSettings = vi.fn()
    const props = makeProps({ setSettings, mode: 'flow' })
    const { rerender } = renderHook((p) => useMcpServer(p), { initialProps: props })
    rerender({ ...props, mode: 'api' })
    mcpHandler({ type: 'update-settings', fields: { imageModel: 'gpt-image-1' } })
    const next = setSettings.mock.calls[0][0]({ imageModel: 'gemini-3.1-flash-image', generation: { image: { provider: 'google' } } })
    expect(next.imageModel).toBe('gpt-image-1')
    expect(next.generation.image.provider).toBe('openai')
  })
  it('카탈로그 밖 이름(Flow 모델 Nano Banana Pro · Omni Flash)과 같은 provider 의 모델은 provider 를 건드리지 않는다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    mcpHandler({ type: 'update-settings', fields: { imageModel: 'Nano Banana Pro', videoModelT2V: 'Omni Flash', videoModelF2V: 'veo-3.1-generate-preview' } })
    const prev = { imageModel: 'Nano Banana 2', generation: { image: { provider: 'google' }, video: { t2v: { provider: 'google' }, i2v: { provider: 'google' } } } }
    expect(setSettings.mock.calls[0][0](prev)).toEqual({ ...prev, imageModel: 'Nano Banana Pro', videoModelT2V: 'Omni Flash', videoModelF2V: 'veo-3.1-generate-preview' })
  })
  it('유효한 키가 하나도 없으면 setSettings 를 부르지 않는다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    mcpHandler({ type: 'update-settings', fields: { projectName: 'B', flowAgentOn: true } })
    expect(setSettings).not.toHaveBeenCalled()
  })
  it('fields 가 객체가 아니면 setSettings 를 부르지 않는다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    mcpHandler({ type: 'update-settings' })
    mcpHandler({ type: 'update-settings', fields: 'x' })
    expect(setSettings).not.toHaveBeenCalled()
  })
})

// multi-provider 병합(리뷰 B F5): update-scenes·update-scene 이 generation 병합 **결과**를 씬에 쓰는지 — 병합 함수는 단위로 묶였지만
//   훅이 결과 대신 옛 값(matched.generation)을 쓰는 해결은 어떤 테스트도 못 잡았다. 새 override 값이 기존 값을 대체해야 한다.
describe('useMcpServer — update-scenes / update-scene 은 generation 병합 결과를 쓴다', () => {
  const prev = [{ id: 'scene_1', _sceneNum: 1, prompt: 'old', status: 'pending', generation: { image: { provider: 'openai', model: 'gpt-image-1' } } }]
  it('update-scenes: 들어온 새 image override 가 기존 override 를 대체한다', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))
    mcpHandler({ type: 'update-scenes', scenes: [{ id: 'scene_1', _sceneNum: 1, prompt: 'old', generation: { image: { provider: 'google', model: 'gemini-3-pro-image' } } }] })
    const updater = setScenes.mock.calls.at(-1)[0]
    expect(updater(prev)[0].generation).toEqual({ image: { provider: 'google', model: 'gemini-3-pro-image' } })
  })
  it('update-scene: fields.generation 의 새 override 가 기존 override 를 대체한다', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))
    mcpHandler({ type: 'update-scene', index: 0, fields: { generation: { image: { provider: 'google', model: 'gemini-3-pro-image' } } } })
    const updater = setScenes.mock.calls.at(-1)[0]
    expect(updater(prev)[0].generation).toEqual({ image: { provider: 'google', model: 'gemini-3-pro-image' } })
  })
  // 리뷰 B R2 F2: 위 케이스는 image→image 전체 교체라 "병합 결과"와 "들어온 값 그대로"가 같다 — 일부 stage 만 보내면 나머지 override 가 남아야 한다.
  //   리뷰 B R3 N1: 같은 video 아래의 i2v 도 남아야 한다 — top-level 얕은 병합({...s.generation, ...fields.generation})은 video 를 통째로 덮는다.
  it('update-scene: t2v override 만 보내면 기존 image·i2v override 는 남는다', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))
    mcpHandler({ type: 'update-scene', index: 0, fields: { generation: { video: { t2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' } } } } })
    const updater = setScenes.mock.calls.at(-1)[0]
    const withI2v = [{ ...prev[0], generation: { ...prev[0].generation, video: { i2v: { provider: 'google', model: 'veo-3.1-generate-preview' } } } }]
    expect(updater(withI2v)[0].generation).toEqual({
      image: { provider: 'openai', model: 'gpt-image-1' },
      video: { t2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' }, i2v: { provider: 'google', model: 'veo-3.1-generate-preview' } },
    })
  })
})
