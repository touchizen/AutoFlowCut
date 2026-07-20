import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import PreviewPanel from '../../../src/components/AudioTimeline/PreviewPanel'
import '../../../src/components/AudioTimeline/AudioTimeline.css'
import { renderWithExportSettings } from '../../utils/renderWithExportSettings'

const DEFAULT_SCENE = {
  id: 'scene-1',
  status: 'done',
  imagePath: '/images/scene-1.png',
  image_size: { width: 1920, height: 1080 },
  startTime: 0,
  endTime: 10,
}

function renderPreview({
  scene = DEFAULT_SCENE,
  scenes = [scene],
  playheadMs = 0,
  srtEntries = [],
  settings = {},
  aspectRatio = '16:9',
  hiddenRoles,
} = {}) {
  localStorage.setItem('exportSettings', JSON.stringify(settings))
  return renderWithExportSettings(
    <PreviewPanel
      playheadMs={playheadMs}
      scenes={scenes}
      srtEntries={srtEntries}
      hiddenRoles={hiddenRoles}
    />,
    { aspectRatio },
  )
}

function setNaturalSize(img, width, height) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width })
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height })
  fireEvent.load(img)
}

describe('PreviewPanel Ken Burns preview', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('이미지-only exportable 씬의 진행률로 KB layer에만 transform을 적용한다', async () => {
    const { container } = renderPreview({
      playheadMs: 5000,
      settings: {
        kenBurnsPreview: true,
        kenBurns: true,
        kenBurnsMode: 'pattern',
        kenBurnsScaleMin: 100,
        kenBurnsScaleMax: 130,
      },
    })

    const layer = container.querySelector('.atl-preview-kb')
    const img = container.querySelector('.atl-preview-img')
    await waitFor(() => expect(layer.style.transform).toContain('scale(1.15)'))
    expect(layer.style.transformOrigin).toBe('0 0')
    expect(img.style.transform).not.toContain('scale(')
  })

  it('export kenBurns가 꺼지면 프리뷰 토글이 켜져 있어도 transform을 적용하지 않는다', async () => {
    // export 가 적용하지 않는 효과를 모니터가 보여주면 WYSIWYG 위반 — 두 게이트 모두 필요.
    const { container } = renderPreview({ settings: { kenBurnsPreview: true, kenBurns: false } })
    const layer = container.querySelector('.atl-preview-kb')

    await waitFor(() => expect(layer.style.transform).toBe(''))
    expect(layer.style.transformOrigin).toBe('')
  })

  it('kenBurnsPreview(타임라인 토글)가 꺼지면 export kenBurns가 켜져 있어도 transform을 적용하지 않는다', async () => {
    const { container } = renderPreview({ settings: { kenBurnsPreview: false, kenBurns: true } })
    const layer = container.querySelector('.atl-preview-kb')

    await waitFor(() => expect(layer.style.transform).toBe(''))
    expect(layer.style.transformOrigin).toBe('')
  })

  it('객체 참조 export index를 써서 pending 씬은 정적이고 다음 done 씬은 index 0 패턴이다', async () => {
    const pending = {
      status: 'pending',
      imagePath: '/images/pending.png',
      startTime: 0,
      endTime: 1,
    }
    const done = {
      status: 'done',
      imagePath: '/images/done.png',
      startTime: 1,
      endTime: 2,
    }
    const scenes = [pending, done] // id가 둘 다 없어도 객체 참조로 구별돼야 한다.
    const view = renderPreview({
      scenes,
      playheadMs: 500,
      settings: { kenBurnsPreview: true, kenBurns: true, kenBurnsMode: 'pattern' },
    })
    const layer = view.container.querySelector('.atl-preview-kb')

    await waitFor(() => expect(layer.style.transform).toBe(''))

    view.rerender(
      <PreviewPanel playheadMs={1000} scenes={scenes} srtEntries={[]} />,
    )
    await waitFor(() => {
      expect(layer.style.transform).toBe('translate(0%, 0%) scale(1)')
    })
  })

  it('짧은 tail 비디오가 있는 씬은 비디오 시작 전에도 씬 전체에서 KB를 끈다', async () => {
    const scene = {
      ...DEFAULT_SCENE,
      videoI2VPath: '/videos/tail.mp4',
      videoI2VDuration: 2,
    }
    const { container } = renderPreview({ scene, playheadMs: 1000, settings: { kenBurnsPreview: true, kenBurns: true } })
    const layer = container.querySelector('.atl-preview-kb')

    await waitFor(() => expect(layer.style.transform).toBe(''))
  })
})

describe('PreviewPanel output frame and scaleMode', () => {
  it.each([
    [300, 800, 300, 168.75],
    [1000, 200, 200 * 16 / 9, 200],
  ])('stage %sx%s 안에서 frame을 %sx%s로 aspect-preserving contain한다', async (
    stageWidth,
    stageHeight,
    expectedWidth,
    expectedHeight,
  ) => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const width = this.classList?.contains('atl-preview-stage') ? stageWidth : 0
      const height = this.classList?.contains('atl-preview-stage') ? stageHeight : 0
      return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }
    })
    try {
      const { container } = renderPreview({ settings: { kenBurns: false } })
      const frame = container.querySelector('.atl-preview-frame')

      await waitFor(() => {
        expect(parseFloat(frame.style.width)).toBeCloseTo(expectedWidth, 5)
        expect(parseFloat(frame.style.height)).toBeCloseTo(expectedHeight, 5)
        expect(parseFloat(frame.style.width) / parseFloat(frame.style.height)).toBeCloseTo(16 / 9, 5)
      })
    } finally {
      rectSpy.mockRestore()
    }
  })

  it.each([
    ['fill', 'cover'],
    ['fit', 'contain'],
  ])('%s는 프레임 전체 이미지와 object-fit:%s를 사용한다', async (scaleMode, objectFit) => {
    const { container } = renderPreview({ settings: { scaleMode, kenBurns: false } })
    const img = container.querySelector('.atl-preview-img')

    await waitFor(() => expect(getComputedStyle(img).objectFit).toBe(objectFit))
    expect(getComputedStyle(img).width).toBe('100%')
    expect(getComputedStyle(img).height).toBe('100%')
  })

  it('none은 자연-대-출력 픽셀비를 비클램프 extent로 중앙 배치한다', async () => {
    const scene = {
      ...DEFAULT_SCENE,
      image_size: { width: 3000, height: 500 },
    }
    const { container } = renderPreview({ scene, settings: { scaleMode: 'none', kenBurns: false } })
    const img = container.querySelector('.atl-preview-img')

    await waitFor(() => expect(parseFloat(getComputedStyle(img).width)).toBeCloseTo(156.25, 5))
    expect(parseFloat(getComputedStyle(img).height)).toBeCloseTo(46.296296, 5)
    expect(getComputedStyle(img).maxWidth).toBe('none')
    expect(getComputedStyle(img).left).toBe('50%')
    expect(getComputedStyle(img).top).toBe('50%')
    expect(getComputedStyle(img).transform).toBe('translate(-50%, -50%)')
  })

  it.each([
    ['16:9', 'final', 1920, 1080],
    ['16:9', 'preview', 1280, 720],
    ['9:16', 'final', 1080, 1920],
    ['9:16', 'preview', 720, 1280],
  ])('%s/%s outputSpec으로 frame aspect와 none extent를 계산한다', async (
    aspectRatio,
    renderMode,
    specWidth,
    specHeight,
  ) => {
    const scene = {
      ...DEFAULT_SCENE,
      image_size: { width: 1440, height: 960 },
    }
    const { container } = renderPreview({
      scene,
      aspectRatio,
      settings: { scaleMode: 'none', renderMode, kenBurns: false },
    })
    const frame = container.querySelector('.atl-preview-frame')
    const img = container.querySelector('.atl-preview-img')

    await waitFor(() => {
      expect(frame.style.aspectRatio).toBe(`${specWidth} / ${specHeight}`)
      expect(parseFloat(getComputedStyle(img).width)).toBeCloseTo(1440 / specWidth * 100, 5)
      expect(parseFloat(getComputedStyle(img).height)).toBeCloseTo(960 / specHeight * 100, 5)
    })
  })

  it('stale image_size를 onLoad natural dimensions로 항상 교정한다', async () => {
    const scene = {
      ...DEFAULT_SCENE,
      image_size: { width: 100, height: 100 },
    }
    const { container } = renderPreview({ scene, settings: { scaleMode: 'none', kenBurns: false } })
    const img = container.querySelector('.atl-preview-img')

    await waitFor(() => expect(parseFloat(getComputedStyle(img).width)).toBeCloseTo(100 / 1920 * 100, 5))
    setNaturalSize(img, 3000, 500)
    await waitFor(() => {
      expect(parseFloat(getComputedStyle(img).width)).toBeCloseTo(156.25, 5)
      expect(parseFloat(getComputedStyle(img).height)).toBeCloseTo(46.296296, 5)
    })
  })
})

describe('PreviewPanel image gate and persistent frame DOM', () => {
  it.each([
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
    [`iVBORw0KGgo${'A'.repeat(80)}`, `data:image/png;base64,iVBORw0KGgo${'A'.repeat(80)}`],
  ])('base64-only 씬 %s를 이미지로 렌더하고 KB를 적용한다', async (image, expectedSrc) => {
    const scene = {
      id: 'base64-only',
      status: 'done',
      image,
      startTime: 0,
      endTime: 3,
    }
    const { container } = renderPreview({ scene, playheadMs: 1000, settings: { kenBurnsPreview: true, kenBurns: true } })
    const img = container.querySelector('.atl-preview-img')
    const layer = container.querySelector('.atl-preview-kb')

    expect(img).toBeInTheDocument()
    expect(img.getAttribute('src')).toBe(expectedSrc)
    setNaturalSize(img, 1024, 1024)
    await waitFor(() => expect(layer.style.transform).not.toBe(''))
    expect(container.querySelector('.atl-preview-empty')).toBeNull()
  })

  it('video와 자막은 frame 안, KB layer 밖에 있고 video가 KB layer 뒤에 렌더된다', () => {
    const scene = {
      ...DEFAULT_SCENE,
      videoI2VPath: '/videos/tail.mp4',
      videoI2VDuration: 2,
    }
    const { container } = renderPreview({
      scene,
      playheadMs: 9000,
      srtEntries: [{ startMs: 0, endMs: 10000, text: 'Frame subtitle' }],
    })
    const frame = container.querySelector('.atl-preview-frame')
    const layer = container.querySelector('.atl-preview-kb')
    const video = container.querySelector('video.atl-preview-video')
    const subtitle = container.querySelector('.atl-preview-subtitle')

    expect(layer.parentElement).toBe(frame)
    expect(video.parentElement).toBe(frame)
    expect(subtitle.parentElement).toBe(frame)
    expect(layer.contains(video)).toBe(false)
    expect(layer.contains(subtitle)).toBe(false)
    expect([...frame.children].indexOf(video)).toBeGreaterThan([...frame.children].indexOf(layer))
  })

  it('씬이 없어도 frame과 단일 main video를 계속 마운트한다', () => {
    const { container } = renderPreview({ scene: null, scenes: [] })
    const frame = container.querySelector('.atl-preview-frame')
    const video = container.querySelector('video.atl-preview-video')

    expect(frame).toBeInTheDocument()
    expect(video).toBeInTheDocument()
    expect(video.parentElement).toBe(frame)
    expect(container.querySelectorAll('video.atl-preview-video')).toHaveLength(1)
    expect(container.querySelector('.atl-preview-empty')).toBeInTheDocument()
  })
})
