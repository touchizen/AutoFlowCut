/**
 * SSE 스트리밍 중 뷰가 새 텍스트를 따라 내려간다(시놉시스 / 대본 둘 다).
 * 안 그러면 scrollTop이 0에 머물러 텍스트는 가만히 있고 스크롤바만 줄어든다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

afterEach(() => { localStorage.removeItem('autoflowcut_lang') })

// jsdom은 레이아웃이 없어 scrollHeight/clientHeight가 0이다 — 실제 값처럼 보이게 심는다.
function fakeLayout(el, { scrollHeight, clientHeight = 200 }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
}

const stream = (container) => container.querySelector('.story-script-stream')
const streamingTable = (container, step) => container.querySelector(`.story-stream-table-${step}`)

const basePipeline = (over = {}) => ({
  state: { steps: { script: { status: 'pending' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } } },
  scenes: [], streamingText: '', scriptText: '', start: vi.fn(), abort: vi.fn(), openError: null,
  progressLog: [], reviewProgress: null,
  ...over,
})

// 대본: script 스텝이 running이면 스트림 뷰가 뜬다.
const scriptPipeline = (streamingText) => basePipeline({
  state: { steps: { script: { status: 'running', updatedAt: '2026-07-10T00:00:00Z' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } } },
  streamingText,
})

const synopsisPipeline = (synopsisStreamingText) => basePipeline({
  synopsisGenerating: true,
  synopsisStreamingText,
  generateSynopsis: vi.fn().mockResolvedValue({}),
})

const scenePreview = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [
  `0:${i}`,
  { chunkIndex: 0, localSceneNo: i, scene: { segments: [{ speaker: 'narrator', text: `scene-${i}` }] } },
]))

const scenesPipeline = (count) => basePipeline({
  state: { steps: { script: { status: 'done' }, scenes: { status: 'running', updatedAt: '2026-07-20T00:00:00Z' }, audio: { status: 'pending' }, prompts: { status: 'pending' } } },
  scriptText: 'streaming script',
  previewScenes: scenePreview(count),
})

const promptScenes = [1, 2, 3].map((sceneNo) => ({ sceneNo, storyId: `s${sceneNo}` }))
const promptPreview = (count) => Object.fromEntries(promptScenes.slice(0, count).map((scene) => [
  scene.sceneNo,
  { imagePrompt: `image-${scene.sceneNo}`, videoPrompt: `video-${scene.sceneNo}` },
]))
const promptsPipeline = (count) => basePipeline({
  state: { steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'running', updatedAt: '2026-07-20T00:00:00Z' } } },
  scenes: promptScenes,
  previewPrompts: promptPreview(count),
})

describe('대본 스트리밍 자동 스크롤', () => {
  it('델타가 들어오면 바닥으로 따라간다', () => {
    const { container, rerender } = render(<StoryView pipeline={scriptPipeline('한 줄')} />)
    const el = stream(container)
    expect(el).toBeTruthy()

    fakeLayout(el, { scrollHeight: 1000 })
    rerender(<StoryView pipeline={scriptPipeline('한 줄\n두 줄')} />)
    expect(el.scrollTop).toBe(800) // scrollHeight - clientHeight
  })

  it('사용자가 위로 올려 읽는 중이면 끌어내리지 않는다', () => {
    const { container, rerender } = render(<StoryView pipeline={scriptPipeline('한 줄')} />)
    const el = stream(container)
    fakeLayout(el, { scrollHeight: 1000 })

    el.scrollTop = 0
    fireEvent.scroll(el)
    rerender(<StoryView pipeline={scriptPipeline('한 줄\n두 줄')} />)
    expect(el.scrollTop).toBe(0)
  })

  it('다시 바닥으로 내리면 따라가기를 재개한다', () => {
    const { container, rerender } = render(<StoryView pipeline={scriptPipeline('한 줄')} />)
    const el = stream(container)
    fakeLayout(el, { scrollHeight: 1000 })

    el.scrollTop = 0
    fireEvent.scroll(el)
    rerender(<StoryView pipeline={scriptPipeline('한 줄\n두 줄')} />)
    expect(el.scrollTop).toBe(0)

    el.scrollTop = 800
    fireEvent.scroll(el)
    rerender(<StoryView pipeline={scriptPipeline('한 줄\n두 줄\n세 줄')} />)
    expect(el.scrollTop).toBe(800)
  })
})

describe('시놉시스 스트리밍 자동 스크롤', () => {
  const enterSynopsis = (pipeline) => {
    const r = render(<StoryView pipeline={pipeline} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    return r
  }

  it('델타가 들어오면 바닥으로 따라간다', () => {
    const { container, rerender } = enterSynopsis(synopsisPipeline('로그라인'))
    const el = stream(container)
    expect(el).toBeTruthy()

    fakeLayout(el, { scrollHeight: 1000 })
    rerender(<StoryView pipeline={synopsisPipeline('로그라인 이야기')} />)
    expect(el.scrollTop).toBe(800)
  })

  it('사용자가 위로 올려 읽는 중이면 끌어내리지 않는다', () => {
    const { container, rerender } = enterSynopsis(synopsisPipeline('로그라인'))
    const el = stream(container)
    fakeLayout(el, { scrollHeight: 1000 })

    el.scrollTop = 0
    fireEvent.scroll(el)
    rerender(<StoryView pipeline={synopsisPipeline('로그라인 이야기')} />)
    expect(el.scrollTop).toBe(0)
  })
})

describe('씬 ghost table 자동 스크롤', () => {
  it('preview scene이 늘고 바닥에 붙어 있으면 최신 행으로 내린다', () => {
    const { container, rerender } = render(<StoryView pipeline={scenesPipeline(1)} />)
    const el = streamingTable(container, 'scenes')
    const progress = container.querySelector('.story-stream-progress-sticky')
    expect(el).toBeTruthy()
    expect(progress).toBeTruthy()
    expect(el.contains(progress)).toBe(false)
    expect(progress.parentElement).toBe(el.parentElement)
    expect(progress.parentElement.firstElementChild).toBe(progress)
    fakeLayout(el, { scrollHeight: 1000 })

    rerender(<StoryView pipeline={scenesPipeline(2)} />)
    expect(el.scrollTop).toBe(1000)
  })

  it('사용자가 위로 올렸으면 preview scene이 늘어도 끌어내리지 않는다', () => {
    const { container, rerender } = render(<StoryView pipeline={scenesPipeline(1)} />)
    const el = streamingTable(container, 'scenes')
    fakeLayout(el, { scrollHeight: 1000 })
    el.scrollTop = 0
    fireEvent.scroll(el)

    rerender(<StoryView pipeline={scenesPipeline(2)} />)
    expect(el.scrollTop).toBe(0)
  })
})

describe('프롬프트 ghost table 자동 스크롤', () => {
  it('preview prompt가 늘고 바닥에 붙어 있으면 최신 행으로 내린다', () => {
    const { container, rerender } = render(<StoryView pipeline={promptsPipeline(1)} />)
    const el = streamingTable(container, 'prompts')
    const progress = container.querySelector('.story-stream-progress-sticky')
    expect(el).toBeTruthy()
    expect(progress).toBeTruthy()
    expect(el.contains(progress)).toBe(false)
    expect(progress.parentElement).toBe(el.parentElement)
    expect(progress.parentElement.firstElementChild).toBe(progress)
    fakeLayout(el, { scrollHeight: 1000 })

    rerender(<StoryView pipeline={promptsPipeline(2)} />)
    expect(el.scrollTop).toBe(1000)
  })

  it('사용자가 위로 올렸으면 preview prompt가 늘어도 끌어내리지 않는다', () => {
    const { container, rerender } = render(<StoryView pipeline={promptsPipeline(1)} />)
    const el = streamingTable(container, 'prompts')
    fakeLayout(el, { scrollHeight: 1000 })
    el.scrollTop = 0
    fireEvent.scroll(el)

    rerender(<StoryView pipeline={promptsPipeline(2)} />)
    expect(el.scrollTop).toBe(0)
  })
})
