/**
 * useReferenceGeneration — 카드가 생성에 쓴 스타일을 기억한다.
 *
 * 스타일 선택(selectedStyleRefId)은 앱 전역 상태 하나뿐이다. 카드가 자기 스타일을 기록하지 않으면,
 * 스타일 A 로 배치 생성 → 일부 실패 → 그 사이 전역 선택이 B 로 바뀜 → 실패 카드를 재생성하면
 * B 로 나온다. 전역 선택이 비어 있을 땐 findAutoStyle 이 스타일 카드를 자동 추정하므로,
 * 스타일 카드를 추가·삭제하는 것만으로도 재생성 결과가 달라진다.
 *
 * 규칙: 배치는 위저드에서 고른 스타일을 모든 카드에 도장 찍고(덮어씀), 단건 생성은 이미지가
 * 없는 카드면 현재 스타일을, 이미지가 있는 카드면 그 카드가 기억한 스타일을 따른다.
 * 기록 시점은 생성 '시작'이라 실패 카드에도 당시 적용한 스타일이 남는다.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))
vi.mock('../../src/utils/urls', () => ({ cleanBase64: vi.fn(s => s), toDataURL: vi.fn(s => s) }))

import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

const STYLE_A = { id: 1, type: 'style', name: '수채화', prompt: 'watercolor', status: 'done', data: 'd', mediaId: 'ms1' }
const STYLE_B = { id: 9, type: 'style', name: '유화', prompt: 'oil painting', status: 'done', data: 'd', mediaId: 'ms9' }
const HERO = { id: 2, type: 'character', name: '준호', prompt: 'hero', status: 'pending' }

function setupHook({ references, scenes = [], scenesRef = null, selectedStyleRefId = null, genOverrides = {}, generationQueue = null }) {
  let liveRefs = references
  const patches = []
  const setReferences = vi.fn((updater) => {
    liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
    patches.push(liveRefs.map(r => ({ ...r })))
  })
  const genAPI = {
    mode: 'api',
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm' }] }),
    submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'g-1' }),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm' }] }),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'm', caption: '' }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    ...genOverrides,
  }
  const props = { selectedStyleRefId, scenes }
  // App 이 소유하는 동기 ref (setSelectedStyleRefId 가 커밋 전에 즉시 갱신).
  const selectedStyleRefIdRef = { current: selectedStyleRefId }
  const { result, rerender } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1 },
    references: liveRefs, setReferences, genAPI,
    addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue,
    selectedStyleRefId: props.selectedStyleRefId,
    selectedStyleRefIdRef,
    scenes: props.scenes,
    scenesRef,
  }))
  // 전역 스타일 선택을 바꾸고 훅을 다시 렌더한다(App 의 setSelectedStyleRefId 시뮬레이션 — ref 동기 갱신 + state 커밋).
  const setGlobalStyle = (id) => { selectedStyleRefIdRef.current = id; props.selectedStyleRefId = id; rerender() }
  // 리렌더 없이 ref 만 동기 갱신 — "픽커에서 방금 골랐지만 React 커밋 전" 을 재현.
  const setGlobalStyleSync = (id) => { selectedStyleRefIdRef.current = id }
  const finalRef = (id) => (patches.length ? patches[patches.length - 1].find(r => r.id === id) : null)
  return { result, genAPI, finalRef, setGlobalStyle, setGlobalStyleSync }
}

async function runBatch(result, overrideStyleId = null) {
  vi.useFakeTimers()
  let p
  await act(async () => { p = result.current.handleGenerateAllRefs(overrideStyleId) })
  for (let i = 0; i < 20; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
  }
  await act(async () => { await p })
  vi.useRealTimers()
}

describe('카드가 쓴 스타일을 기록한다', () => {
  it('queue 대기 뒤 같은 tick에 실행돼도 authoritative scenesRef의 최신값으로 파생한다', async () => {
    let queuedJob = null
    const scenesRef = {
      current: [{ id: 11, prompt: 'old scene', style_tag: 'cinematic' }],
    }
    const generationQueue = {
      enqueue: vi.fn(async (job) => {
        queuedJob = job
        return { queued: true }
      }),
    }
    const { result, genAPI } = setupHook({
      references: [HERO],
      scenes: scenesRef.current,
      scenesRef,
      selectedStyleRefId: null,
      generationQueue,
    })

    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(queuedJob).not.toBeNull()

    // useScenes.setScenes/updateScene가 React commit 전에 동기 갱신하는 ref를 재현한다.
    // rerender 없이 같은 tick에 queued execute가 시작돼도 이 값을 읽어야 한다.
    scenesRef.current = [{ id: 12, prompt: 'latest scene', style_tag: 'korean-ani' }]
    await act(async () => { await queuedJob.execute() })

    expect(genAPI.generateImage.mock.calls[0][0]).toBe(
      'hero, Korean anime style, vibrant colors, detailed characters',
    )
  })

  it('선택과 카드 기억이 없으면 씬들의 단일 preset style_tag를 Ref 생성에 적용한다', async () => {
    const { result, genAPI, finalRef } = setupHook({
      references: [HERO],
      scenes: [
        { id: 11, prompt: 'scene one', style_tag: 'korean-ani' },
        { id: 12, prompt: 'scene two', style_tag: 'Korean Anime' },
      ],
      selectedStyleRefId: null,
    })

    await act(async () => { await result.current.handleGenerateRef(0) })

    expect(genAPI.generateImage.mock.calls[0][0]).toBe(
      'hero, Korean anime style, vibrant colors, detailed characters',
    )
    expect(finalRef(2).styleId).toBe('preset:korean-ani')
  })

  it('단건 생성: 적용된 스타일을 styleId 로 남긴다', async () => {
    const { result, finalRef } = setupHook({ references: [STYLE_A, HERO], selectedStyleRefId: 'ref:1' })
    await act(async () => { await result.current.handleGenerateRef(1) })
    expect(finalRef(2)).toMatchObject({ status: 'done', styleId: 'ref:1' })
  })

  it('생성이 실패해도 styleId 는 남는다 (재생성이 필요한 게 바로 이 카드다)', async () => {
    const { result, finalRef } = setupHook({
      references: [STYLE_A, HERO], selectedStyleRefId: 'ref:1',
      genOverrides: { generateImage: vi.fn().mockResolvedValue({ success: false, error: 'boom' }) },
    })
    await act(async () => { await result.current.handleGenerateRef(1) })
    expect(finalRef(2)).toMatchObject({ status: 'error', styleId: 'ref:1' })
  })

  it('스타일 없이 생성하면 styleId 는 null 로 기록된다', async () => {
    const { result, finalRef } = setupHook({ references: [HERO], selectedStyleRefId: null })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(finalRef(2)).toMatchObject({ status: 'done', styleId: null })
  })

  it('배치: 위저드에서 고른 스타일을 모든 카드에 도장 찍는다 (기존 기억을 덮어쓴다)', async () => {
    const { result, finalRef } = setupHook({
      references: [STYLE_A, { ...HERO, styleId: 'ref:9' }], selectedStyleRefId: 'ref:1',
    })
    await runBatch(result)
    expect(finalRef(2).styleId).toBe('ref:1')
  })

  // 스타일 준비(_prepareStyleRefs)는 Flow 스타일 업로드 등 실패할 수 있는 I/O 다. 그 단계에서
  // 죽으면 카드는 error 로 끝나는데, 정작 그 카드가 같은 스타일로 재생성돼야 한다.
  it('배치: 스타일 준비 단계에서 실패해도 styleId 는 남는다', async () => {
    const { result, finalRef } = setupHook({
      references: [{ ...STYLE_A, mediaId: null }, HERO],
      selectedStyleRefId: 'ref:1',
      genOverrides: {
        mode: 'flow', // mediaId 없는 스타일 ref → on-demand 업로드 경로
        uploadReference: vi.fn().mockRejectedValue(new Error('upload exploded')),
      },
    })
    await runBatch(result)
    expect(finalRef(2)).toMatchObject({ status: 'error', styleId: 'ref:1' })
  })

  // 스타일 카드에는 스타일을 적용하지 않는다(_prepareStyleRefs 조기 반환). 그런데 단건 경로가
  // 전역/자동 해석 결과를 그대로 찍으면, findAutoStyle 이 그 카드 자신을 골라 "ref:1 로 생성됨"
  // 이라는 거짓 기록이 남는다 — 배치는 null 을 찍는데 단건만 다른 값이 되는 모순.
  it('단건: 명시 override가 있어도 스타일 카드 자신에는 styleId를 null로 기록한다', async () => {
    const { result, finalRef } = setupHook({
      references: [{ ...STYLE_A, status: 'pending', data: null }], selectedStyleRefId: 'preset:korean-ani',
    })
    await act(async () => { await result.current.handleGenerateRef(0, false, 'preset:korean-ani') })
    expect(finalRef(1).styleId).toBeNull()
  })

  it('스타일 카드 자신은 스타일을 적용받지 않는다 (styleId null)', async () => {
    // 아직 이미지가 없는 스타일 카드 — 배치 phase 1 이 이 카드를 스타일 없이 생성한다.
    // (data/filePath 가 있으면 배치 대상에서 제외된다 — pickIndices)
    const { result, finalRef } = setupHook({
      references: [{ ...STYLE_A, status: 'pending', data: null }, HERO], selectedStyleRefId: 'ref:1',
    })
    await runBatch(result)
    expect(finalRef(1).styleId).toBeNull()
  })
})

describe('재생성은 카드가 기억한 스타일을 따른다', () => {
  it.each([
    ['data', { data: 'existing-image' }],
    ['filePath', { filePath: '/refs/hero.png' }],
    ['imagePath', { imagePath: '/refs/hero.png' }],
  ])('이미지가 있는 카드(%s)는 전역 선택이 바뀌어도 자기 styleId 로 생성한다', async (_sourceName, imageSource) => {
    const { result, genAPI, setGlobalStyle } = setupHook({
      references: [STYLE_A, STYLE_B, { ...HERO, ...imageSource, styleId: 'ref:1', status: 'error' }],
      selectedStyleRefId: 'ref:1',
    })
    setGlobalStyle('ref:9') // 사용자가 다른 카드 때문에 스타일을 유화로 바꿈
    await act(async () => { await result.current.handleGenerateRef(2) })
    expect(genAPI.generateImage.mock.calls[0][0]).toBe('hero, watercolor') // 유화가 아니라 수채화
  })

  it('이미지가 있는 카드의 styleId null 은 재생성도 무스타일로 유지한다', async () => {
    const { result, genAPI, setGlobalStyle } = setupHook({
      references: [STYLE_A, { ...HERO, data: 'existing-image', styleId: null, status: 'error' }],
      selectedStyleRefId: null,
    })
    setGlobalStyle('ref:1')
    await act(async () => { await result.current.handleGenerateRef(1) })
    expect(genAPI.generateImage.mock.calls[0][0]).toBe('hero')
  })

  it('이미지 없는 카드의 stale styleId null 대신 현재 선택 프리셋을 적용한다', async () => {
    const { result, genAPI, finalRef } = setupHook({
      references: [{ ...HERO, styleId: null, status: 'error' }],
      selectedStyleRefId: 'preset:korean-ani',
    })

    await act(async () => { await result.current.handleGenerateRef(0) })

    expect(genAPI.generateImage.mock.calls[0][0]).toBe(
      'hero, Korean anime style, vibrant colors, detailed characters',
    )
    expect(finalRef(2).styleId).toBe('preset:korean-ani')
  })

  it('상세모달 overrideRef도 이미지가 없으면 현재 선택 스타일로 생성한다', async () => {
    const { result, genAPI } = setupHook({
      references: [{ ...HERO, prompt: 'stale prompt', styleId: 'ref:old' }],
      selectedStyleRefId: 'preset:korean-ani',
    })
    const editData = { ...HERO, prompt: 'edited hero', styleId: null, status: 'error' }

    await act(async () => {
      await result.current.handleGenerateRef(0, false, null, editData)
    })

    expect(genAPI.generateImage.mock.calls[0][0]).toBe(
      'edited hero, Korean anime style, vibrant colors, detailed characters',
    )
  })

  it('styleId 가 없는 레거시 카드는 기존대로 전역 선택을 따른다', async () => {
    const { result, genAPI } = setupHook({
      references: [STYLE_A, { ...HERO, status: 'error' }], // styleId 키 자체가 없음
      selectedStyleRefId: 'ref:1',
    })
    await act(async () => { await result.current.handleGenerateRef(1) })
    expect(genAPI.generateImage.mock.calls[0][0]).toBe('hero, watercolor')
  })

  it('MCP의 명시적 overrideStyleId 는 이미지 있는 카드의 기억과 현재 선택보다 우선한다', async () => {
    const { result, genAPI } = setupHook({
      references: [STYLE_A, STYLE_B, { ...HERO, data: 'existing-image', styleId: 'ref:1', status: 'error' }],
      selectedStyleRefId: 'preset:korean-ani',
    })
    await act(async () => { await result.current.handleGenerateRef(2, false, 'ref:9') })
    expect(genAPI.generateImage.mock.calls[0][0]).toBe('hero, oil painting')
  })

  it('Flow 배치의 명시적 overrideStyleId 가 이미지 없는 카드에서 항상 우선한다', async () => {
    const { result, genAPI } = setupHook({
      references: [STYLE_A, STYLE_B, { ...HERO, styleId: 'ref:1', status: 'error' }],
      selectedStyleRefId: 'preset:korean-ani',
      genOverrides: { mode: 'flow' },
    })

    await runBatch(result, 'ref:9')

    expect(genAPI.generateImage.mock.calls[0][0]).toBe('hero, oil painting')
  })
})

// 실측 회귀(부자와_빈자, 2026-07-23): 새 프로젝트 생성 직후 픽커에서 스타일을 고르고 곧바로
// 일괄생성을 돌리면, 배치 핸들러가 '선택 전' 렌더에서 캡처된 stale 클로저라 selectedStyleRefId=null
// 을 읽어 무스타일(실사)로 나갔다. 씬 style_tag 도 null 이라 파생도 못 물어 픽커가 유일한 출처였다.
// selectedStyleRefId 를 live ref 로 읽어 최신 선택이 첫 시도에 닿게 한다.
describe('픽커 선택 stale-closure 레이스', () => {
  it('React 커밋(리렌더) 전에 픽커에서 고른 스타일이라도 첫 배치에 적용한다', async () => {
    const { result, genAPI, finalRef, setGlobalStyleSync } = setupHook({
      // 실제 재현: 씬은 prompt 만 있고 style_tag 는 null → 파생 불가, 픽커가 유일한 스타일 출처
      references: [HERO],
      scenes: [{ id: 11, prompt: 'scene', style_tag: null }],
      selectedStyleRefId: null,
    })
    // 선택 전(null) 렌더에서 배치 핸들러를 캡처한다 (앱의 stale 클로저 재현)
    const staleGenerateAll = result.current.handleGenerateAllRefs
    // 사용자가 픽커에서 스타일을 고름 → App setter 가 ref 를 동기 갱신하지만 아직 리렌더/커밋 전.
    //   (핵심: rerender 를 부르지 않는다 — 옛 render-time ref 폴백이면 stale null 로 실패해야 정상)
    setGlobalStyleSync('preset:korean-ani')

    // 옛 핸들러로 배치 실행 — override 없이 live selectedStyleRefId 에만 의존
    vi.useFakeTimers()
    let p
    await act(async () => { p = staleGenerateAll(null) })
    for (let i = 0; i < 20; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
    }
    await act(async () => { await p })
    vi.useRealTimers()

    // 배치는 submitGeneration(styledPrompt, ...) 로 제출한다. 동기 ref 로 읽어 preset 이 붙어야.
    expect(genAPI.submitGeneration.mock.calls[0][0]).toBe(
      'hero, Korean anime style, vibrant colors, detailed characters',
    )
    expect(finalRef(2).styleId).toBe('preset:korean-ani')
  })
})
