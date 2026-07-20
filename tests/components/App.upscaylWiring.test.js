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

  it('scene 이미지 ResultsTable과 일반 timeline/audio/detail 두 호스트만 트리거를 받는다', () => {
    const imageResults = openingTags(app, 'ResultsTable').find((tag) => tag.includes('mediaType="image"'))
    expect(imageResults).toContain('onUpscaleClick={openUpscayl}')
    expect(openingTags(app, 'LiveTimeline')[0]).toContain('onUpscaleClick={openUpscayl}')
    expect(openingTags(app, 'AudioPanel')[0]).toContain('onUpscaleClick={openUpscayl}')
    expect(openingTags(app, 'SceneList')[0]).toContain('onUpscaleClick={openUpscayl}')
    expect(openingTags(app, 'SceneDetailModal')[0]).toContain('onUpscaleClick={openUpscayl}')
  })

  it('StoryView timeline에는 Upscayl 트리거를 전달하지 않는다', () => {
    expect(story).not.toContain('onUpscaleClick')
  })
})
