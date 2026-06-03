import { describe, it, expect } from 'vitest'
import { normalizeState, buildGenerationItems } from '../../src/utils/generationItems'

describe('normalizeState', () => {
  it('done·complete → complete (이미지=done, 비디오=complete)', () => {
    expect(normalizeState('done')).toBe('complete')
    expect(normalizeState('complete')).toBe('complete')
  })
  it('generating → generating', () => {
    expect(normalizeState('generating')).toBe('generating')
  })
  it('error → error', () => {
    expect(normalizeState('error')).toBe('error')
  })
  it('pending·waiting·undefined·기타 → pending', () => {
    expect(normalizeState('pending')).toBe('pending')
    expect(normalizeState('waiting')).toBe('pending')
    expect(normalizeState(undefined)).toBe('pending')
    expect(normalizeState('whatever')).toBe('pending')
  })
})

describe('buildGenerationItems', () => {
  it("mode 'image' (탭 text/list): scenes → image items", () => {
    const scenes = [
      { id: 'scene_1', status: 'done', image_path: '/i/1.png', generatedAt: 11, },
      { id: 'scene_2', status: 'generating' },
      { id: 'scene_3', status: 'error', error: 'boom' },
    ]
    const items = buildGenerationItems('image', { scenes })
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ id: 'scene_1', kind: 'image', rawStatus: 'done', state: 'complete' })
    expect(items[0].thumbSrc).toBe('file:///i/1.png?v=11')
    expect(items[0].ref).toBe(scenes[0])
    expect(items[1]).toMatchObject({ id: 'scene_2', state: 'generating' })
    expect(items[2]).toMatchObject({ id: 'scene_3', state: 'error', error: 'boom' })
  })

  it("mode 't2v' (탭 video-text): videoScenes → video items (ref = vscene)", () => {
    const videoScenes = [
      { id: 'vscene_1', status: 'complete', videoPath: '/v/t2v_1.mp4', generatedAt: 7 },
      { id: 'vscene_2', status: 'pending' },
    ]
    const items = buildGenerationItems('t2v', { videoScenes })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: 'vscene_1', kind: 'video', state: 'complete' })
    expect(items[0].thumbSrc).toBe('file:///v/t2v_1.mp4?v=7')
    expect(items[0].ref).toBe(videoScenes[0])
    expect(items[1]).toMatchObject({ id: 'vscene_2', state: 'pending' })
  })

  it("mode 'f2v' (탭 frame-to-video): framePairs → video items (waiting→pending, ref = framePair)", () => {
    const framePairs = [
      { id: 'fp_1', status: 'waiting' },
      { id: 'fp_2', status: 'complete', videoPath: '/v/i2v_2.mp4', generatedAt: 9 },
    ]
    const items = buildGenerationItems('f2v', { framePairs })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: 'fp_1', kind: 'video', state: 'pending' }) // waiting → pending
    expect(items[0].ref).toBe(framePairs[0])
    expect(items[1]).toMatchObject({ id: 'fp_2', state: 'complete' })
    expect(items[1].thumbSrc).toBe('file:///v/i2v_2.mp4?v=9')
  })

  it('알 수 없는 mode → 빈 배열', () => {
    expect(buildGenerationItems('zzz', { scenes: [{ id: 's' }] })).toEqual([])
  })

  it('소스 없음 → 빈 배열 (크래시 없음)', () => {
    expect(buildGenerationItems('image', {})).toEqual([])
    expect(buildGenerationItems('t2v', {})).toEqual([])
    expect(buildGenerationItems('f2v', {})).toEqual([])
  })
})
