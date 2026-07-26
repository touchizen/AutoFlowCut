// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BottomPanelActions from '../../src/components/BottomPanelActions.jsx'
import { isUpscaylStartBlocked } from '../../src/services/startGuard.js'

const app = fs.readFileSync(path.join(process.cwd(), 'src/App.jsx'), 'utf8')
const story = fs.readFileSync(path.join(process.cwd(), 'src/components/story/StoryView.jsx'), 'utf8')
const sceneList = fs.readFileSync(path.join(process.cwd(), 'src/components/SceneList.jsx'), 'utf8')

function openingTags(source, name) {
  return [...source.matchAll(new RegExp(`<${name}\\b[\\s\\S]*?\\/>`, 'g'))].map((match) => match[0])
}

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function loadUpscaylBusyCallback(signalsRef) {
  const match = app.match(/const isUpscaylBusy = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\)/)
  expect(match).not.toBeNull()
  return Function(
    'upscaylBusySignalsRef',
    'isUpscaylStartBlocked',
    `return () => {${match[1]}\n}`,
  )(signalsRef, isUpscaylStartBlocked)
}

function loadUpscaylBusyValue(isUpscaylBusy) {
  const match = app.match(/const upscaylBusy = ([^\n]+)/)
  expect(match).not.toBeNull()
  return Function('isUpscaylBusy', `return (${match[1]})`)(isUpscaylBusy)
}

function runHandleStop(overrides = {}) {
  const match = app.match(/const handleStop = \(\) => \{([\s\S]*?)\n  \}\n\n  \/\/ MCP HTTP 서버/)
  expect(match).not.toBeNull()

  const deps = {
    generationQueue: { clearQueue: vi.fn() },
    isRunning: false,
    stop: vi.fn(),
    videoAutomation: { isRunning: false, stop: vi.fn() },
    shouldStopRefWork: vi.fn(() => false),
    refBatchRunning: false,
    emptyRefGate: null,
    stopGenerateAllRefs: vi.fn(),
    upscayl: { running: false, cancel: vi.fn() },
    ...overrides,
  }

  Function(...Object.keys(deps), match[1])(...Object.values(deps))
  return deps
}

describe('App Upscayl wiring', () => {
  it('useUpscayl 단일 인스턴스에 live project ref와 saveImage wrapper/API를 연결한다', () => {
    expect(app).toContain("import { useUpscayl } from './hooks/useUpscayl'")
    expect(app).toContain("import { fileSystemAPI } from './hooks/useFileSystem'")
    expect(app.match(/= useUpscayl\(/g)).toHaveLength(1)
    expect(app).toContain('projectNameRef,')
    expect(app).toContain('saveImage: saveUpscaylImage,')
    expect(app).toContain('upscaylAPI: window.upscaylAPI,')
  })

  it('useUpscayl isBusy가 App의 최신 9개 신호를 실제 predicate로 판정한다', () => {
    expect(app).toContain("isUpscaylStartBlocked,")
    expect(app).toContain('isBusy: isUpscaylBusy,')

    const reader = sourceBlock(app, 'const isUpscaylBusy', 'const upscayl = useUpscayl')
    ;[
      'isRunning: signals.isRunning',
      'isSceneBatchQueued: signals.isSceneBatchQueued',
      'hasPendingBatch: signals.hasPendingBatch',
      'startInFlight: signals.startInFlightRef?.current',
      'generatingSceneId: signals.generatingSceneId',
      'videoRunning: signals.videoRunning',
      'videoRetryInFlight: signals.videoRetryInFlightRef?.current',
      'refBatchRunning: signals.refBatchRunning',
      'gatePhase: signals.gatePhase',
    ].forEach((operand) => expect(reader).toContain(operand))

    const assignment = sourceBlock(app, 'upscaylBusySignalsRef.current = {', 'const upscaylBusy =')
    ;[
      'isRunning,',
      'isSceneBatchQueued,',
      'hasPendingBatch,',
      'startInFlightRef,',
      'generatingSceneId,',
      'videoRunning: videoAutomation.isRunning',
      'videoRetryInFlightRef,',
      'refBatchRunning,',
      'gatePhase: emptyRefGate?.phase',
    ].forEach((operand) => expect(assignment).toContain(operand))

    const signalsRef = { current: {
      isRunning: false,
      isSceneBatchQueued: false,
      hasPendingBatch: false,
      startInFlightRef: { current: false },
      generatingSceneId: null,
      videoRunning: false,
      videoRetryInFlightRef: { current: false },
      refBatchRunning: false,
      gatePhase: null,
    } }
    const callback = loadUpscaylBusyCallback(signalsRef)

    expect(callback()).toBe(false)
    signalsRef.current.startInFlightRef.current = true
    expect(callback()).toBe(true)
  })

  it('App에서 계산한 scene busy가 BottomPanel Upscale 항목의 disabled까지 흐른다', () => {
    const signalsRef = { current: {
      isRunning: false,
      isSceneBatchQueued: false,
      hasPendingBatch: false,
      startInFlightRef: { current: false },
      generatingSceneId: 'scene_1',
      videoRunning: false,
      videoRetryInFlightRef: { current: false },
      refBatchRunning: false,
      gatePhase: null,
    } }
    const upscaylBusy = loadUpscaylBusyValue(loadUpscaylBusyCallback(signalsRef))

    render(createElement(BottomPanelActions, {
      onUpscale: vi.fn(),
      upscaylBusy,
      upscaylBusyTooltip: 'busy',
      t: (key) => ({
        'bottomPanel.actionsMenu': 'Bottom panel actions',
        'bottomPanel.imageUpscale': 'Image Upscale',
      })[key] || key,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Bottom panel actions' }))

    expect(screen.getByRole('menuitem', { name: '⬆️ Image Upscale' })).toBeDisabled()
  })

  it.each([
    ['실행 중', true, 1],
    ['idle', false, 0],
  ])('handleStop은 Upscayl이 %s일 때 cancel 호출 횟수가 %d다', (_label, running, count) => {
    const cancel = vi.fn()

    runHandleStop({ upscayl: { running, cancel } })

    expect(cancel).toHaveBeenCalledTimes(count)
  })

  it('App anyRunning/fullProjectBusy를 M-A predicate로 1:1 파생한다', () => {
    const aggregates = sourceBlock(app, 'const anyRunning =', '// 네이티브 File 메뉴')
    expect(aggregates).toContain('const anyRunning = isAnyRunning({')
    expect(aggregates).toContain('videoRunning: videoAutomation.isRunning')
    expect(aggregates).toContain('hasPendingBatch,')
    expect(aggregates).toContain('upscaylRunning: upscayl.running')
    expect(aggregates).toContain('const fullProjectBusy = isProjectBusy({')
    expect(aggregates).toContain('refBatchRunning,')
    expect(aggregates).toContain('videoRetryRunning,')
    expect(aggregates).toContain('generatingSceneId,')
    expect(aggregates).toContain('thumbnailGenerating,')
    expect(aggregates).toContain('galleryUploading,')
    expect(aggregates).not.toContain('const anyRunning = isRunning ||')
    expect(aggregates).not.toContain('const fullProjectBusy = anyRunning ||')
  })

  it('App이 단일 다이얼로그/targetSceneIds/detect-on-open을 소유한다', () => {
    expect(app).toContain("import UpscaylDialog from './components/UpscaylDialog'")
    expect(app).toContain('const [upscaylTargetSceneIds, setUpscaylTargetSceneIds]')
    expect(app).toContain('if (!upscaylDialogOpen) return')
    expect(openingTags(app, 'UpscaylDialog')).toHaveLength(1)
  })

  it('BottomPanelActions만 whole-batch 트리거를 받고 SceneDetail 두 호스트는 per-scene 트리거를 유지한다', () => {
    expect(app).toContain("import BottomPanelActions from './components/BottomPanelActions'")
    expect(openingTags(app, 'BottomPanelActions')).toHaveLength(1)
    expect(openingTags(app, 'BottomPanelActions')[0]).toContain('onUpscale={() => openUpscayl()}')
    expect(openingTags(app, 'ResultsTable').every((tag) => !tag.includes('onUpscaleClick'))).toBe(true)
    expect(openingTags(app, 'LiveTimeline')[0]).not.toContain('onUpscaleClick')
    expect(openingTags(app, 'AudioPanel')[0]).not.toContain('onUpscaleClick')
    expect(openingTags(app, 'SceneList')[0]).toContain('onUpscaleClick={openUpscayl}')
    expect(openingTags(app, 'SceneDetailModal')[0]).toContain('onUpscaleClick={openUpscayl}')
  })

  it('같은 App busy와 tooltip을 Bottom/Dialog/두 SceneDetail 경로에 전달한다', () => {
    const bottomActions = openingTags(app, 'BottomPanelActions')[0]
    const dialog = openingTags(app, 'UpscaylDialog')[0]
    const directSceneDetail = openingTags(app, 'SceneDetailModal')[0]
    const sceneListHost = openingTags(app, 'SceneList')[0]
    const nestedSceneDetail = openingTags(sceneList, 'SceneDetailModal')[0]

    for (const tag of [bottomActions, dialog, directSceneDetail, sceneListHost, nestedSceneDetail]) {
      expect(tag).toContain('upscaylBusy={upscaylBusy}')
      expect(tag).toContain('upscaylBusyTooltip={upscaylBusyTooltip}')
    }
  })

  it('Upscayl busy tooltip locale이 ko/en에 실제 문구로 존재한다', async () => {
    const { default: ko } = await import('../../src/locales/ko.js')
    const { default: en } = await import('../../src/locales/en.js')
    expect(ko.upscayl.busyTooltip).toBe('생성 작업이 끝난 뒤 업스케일할 수 있어요')
    expect(en.upscayl.busyTooltip).toBe('You can upscale after generation finishes')
  })

  it('StoryView timeline에는 Upscayl 트리거를 전달하지 않는다', () => {
    expect(story).not.toContain('onUpscaleClick')
  })

  it('배치·단일 씬·MCP 생성 진입점이 Upscayl 실행 상태를 busy로 공유한다', () => {
    expect(app).toContain('upscaylRunning: upscayl.running,')
    expect(app).toContain('retryInFlight: videoRetryInFlightRef.current,\n      upscaylRunning: upscayl.running,')
    expect(app).toContain('isRunning: isRunning || isSceneBatchQueued || videoAutomation.isRunning || refBatchRunning || upscayl.running')
  })

  it('두 이미지 Results clear 경로가 Upscayl 메타데이터까지 초기화한다', () => {
    expect(app).toContain("import { baseImageReplacementPatch } from './utils/imagePatch'")
    expect(app.match(/onClearMedia=\{\(id\) => scenesHook\.updateScene\(id, baseImageReplacementPatch\(\{/g)).toHaveLength(2)
  })
})
