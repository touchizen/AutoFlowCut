import { describe, it, expect } from 'vitest'
import * as timing from '../../../electron/story/timing.js'
import { validateFixedScenes } from '../../../electron/story/fixedScenes.js'

const { buildSegmentTimeline, buildSrt, srtLineId } = timing

const segs = [
  { id: 's1', type: 'narration', text: '첫 문장', durationMs: 2000 },
  { id: 's2', type: 'sfx', text: '', durationMs: 800 },
  { id: 's3', type: 'narration', text: '둘째 문장', durationMs: 1500 },
]

describe('buildSegmentTimeline', () => {
  it('기본은 gap 없이 누적 startMs (0, 2000, 2800)', () => {
    const out = buildSegmentTimeline(segs)
    expect(out.map((s) => s.startMs)).toEqual([0, 2000, 2800])
    expect(segs[0].startMs).toBeUndefined() // 원본 불변
  })

  it('gapMs를 주면 gap 포함 누적 startMs (0, 2150, 3100)', () => {
    const out = buildSegmentTimeline(segs, { gapMs: 150 })
    expect(out.map((s) => s.startMs)).toEqual([0, 2150, 3100])
    expect(segs[0].startMs).toBeUndefined() // 원본 불변
  })
})

describe('buildFixedSlotTimeline (D24a-9)', () => {
  const fixedScenes = [
    { ordinal: 1, storyId: 'story-a', rendererSceneId: 'scene_A' },
    { ordinal: 2, storyId: 'story-b', rendererSceneId: 'scene_B' },
  ]
  const sourceRows = [
    { sourceRowId: 'row-1', sceneOrdinal: 1, subtitle: 'first', speaker: 'narrator' },
    { sourceRowId: 'row-2', sceneOrdinal: 2, subtitle: 'second', speaker: 'narrator' },
  ]
  const scenes = [
    {
      ...fixedScenes[0], sceneNo: 1, imagePrompt: 'prompt A', sourceRowIds: ['row-1'], plannedMs: 20000,
      segments: [{ id: 'seg-a', type: 'narration', text: 'first', speaker: 'narrator', sourceRowId: 'row-1', durationMs: 3000 }],
    },
    {
      ...fixedScenes[1], sceneNo: 2, imagePrompt: 'prompt B', sourceRowIds: ['row-2'], plannedMs: 3000,
      segments: [{ id: 'seg-b', type: 'narration', text: 'second', speaker: 'narrator', sourceRowId: 'row-2', durationMs: 5000 }],
    },
  ]

  it('slot start에 재앵커해 300ms tail을 다음 narration 앞에 누적하지 않는다', () => {
    expect(typeof timing.buildFixedSlotTimeline).toBe('function')
    const out = timing.buildFixedSlotTimeline(scenes, { variant: 'storyboard' })

    expect(out.scenes.map((scene) => scene.startSec * 1000)).toEqual([0, 20000])
    expect(out.scenes.map((scene) => Math.round((scene.endSec - scene.startSec) * 1000))).toEqual([20000, 5300])
    expect(out.segments.map((segment) => segment.startMs)).toEqual([0, 20000])
    expect(out.scenes.map((scene) => scene.storyId)).toEqual(['story-a', 'story-b'])
    expect(out.scenes.map((scene) => scene.segments.map((segment) => segment.id))).toEqual([['seg-a'], ['seg-b']])
    expect(scenes[0].startSec).toBeUndefined()

    expect(validateFixedScenes({
      scenes: out.scenes,
      fixedScenes,
      variant: 'storyboard',
      speakers: [],
      sourceRows,
      requireTiming: true,
    })).toEqual({ success: true })
  })

  it('D24b는 plannedMs와 무관하게 audioSpanMs + 300을 쓴다', () => {
    expect(typeof timing.buildFixedSlotTimeline).toBe('function')
    const out = timing.buildFixedSlotTimeline([
      { ...scenes[0], plannedMs: 20000 },
      { ...scenes[1], plannedMs: 3000 },
    ], { variant: 'image-only' })

    expect(out.scenes.map((scene) => Math.round((scene.endSec - scene.startSec) * 1000))).toEqual([3300, 5300])
    expect(out.segments.map((segment) => segment.startMs)).toEqual([0, 3300])
  })

  it('visual-only slot은 300ms를 더하지 않고 plannedMs 그대로 유지한다', () => {
    expect(typeof timing.buildFixedSlotTimeline).toBe('function')
    const out = timing.buildFixedSlotTimeline([
      { ...scenes[0], segments: [{ id: 'sfx-a', type: 'sfx', durationMs: 5000 }], plannedMs: 3000 },
      scenes[1],
    ], { variant: 'storyboard' })

    expect(out.scenes.map((scene) => Math.round((scene.endSec - scene.startSec) * 1000))).toEqual([3000, 5300])
    expect(out.segments.map((segment) => segment.startMs)).toEqual([0, 3000])
  })
})

describe('srtLineId', () => {
  it('sub_<id>', () => { expect(srtLineId('s3')).toBe('sub_s3') })
})

describe('buildSrt', () => {
  it('narration만 자막화, sfx 제외, 인덱스 1..N 순차', () => {
    const timed = buildSegmentTimeline(segs, { gapMs: 150 })
    const srt = buildSrt(timed)
    // s1: 0~2000, s3: 3100~4600 (s2 sfx 제외)
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,000\n첫 문장')
    expect(srt).toContain('2\n00:00:03,100 --> 00:00:04,600\n둘째 문장')
    expect(srt).not.toContain('800')
  })
})
