// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = fs.readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')
const story = fs.readFileSync(new URL('../../src/components/story/StoryView.jsx', import.meta.url), 'utf8')

function openingTags(source, name) {
  return [...source.matchAll(new RegExp(`<${name}\\b[\\s\\S]*?\\/>`, 'g'))].map((match) => match[0])
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
