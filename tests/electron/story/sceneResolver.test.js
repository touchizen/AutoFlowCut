// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  pairFixedSlots,
  resolveSceneOrdinals,
  currentOrdinalByRendererId,
} from '../../../electron/story/sceneResolver.js'

// M3 I2: 모든 scene-selector 툴이 공유하는 단 하나의 ordinal→rendererSceneId resolver (스펙 §2.4, D24 §987).
// 어느 소비자도 ordinal에서 `scene_${n}` 문자열을 조립하지 않는다 — resolver가 identity를 소유한다.

const audioScenes = [
  { id: 'scene_17', storyId: 'story-a', prompt: 'a' },
  { id: 'scene_3', storyId: 'story-b', prompt: 'b' },
  { id: 'scene_42', storyId: 'story-c', prompt: 'c' },
]

// image-first: fixedScenes 슬롯 순서가 ordinal이고, renderer scene은 별도 배열 순서로 뒤섞여 있다.
// ordinal 1이 rendererSceneId 'scene_17'로 resolve되는 것을 고정한다 (slice 28).
const fixedSlots = [
  { ordinal: 1, rendererSceneId: 'scene_17', storyId: 'story-a' },
  { ordinal: 2, rendererSceneId: 'scene_3', storyId: 'story-b' },
]
const fixedRendererScenes = [
  { id: 'scene_3', storyId: 'story-b', image: 'x' },
  { id: 'scene_17', storyId: 'story-a', image: 'y' },
]

describe('pairFixedSlots — dual-index unique pair', () => {
  it('rendererSceneId·storyId 두 index가 가리키는 같은 object만 pair로 인정한다', () => {
    const paired = pairFixedSlots(fixedSlots, fixedRendererScenes)
    expect(paired).toHaveLength(2)
    expect(paired[0]).toBe(fixedRendererScenes[1]) // slot 1 (scene_17) → scenes[1]
    expect(paired[1]).toBe(fixedRendererScenes[0]) // slot 2 (scene_3) → scenes[0]
  })

  it('rendererSceneId 중복이면 ambiguous → null', () => {
    const dup = [{ id: 'scene_17', storyId: 'story-a' }, { id: 'scene_17', storyId: 'story-z' }]
    expect(pairFixedSlots([fixedSlots[0]], dup)).toEqual([null])
  })

  it('한쪽 index만 맞으면(id는 맞지만 storyId 다른 object) → null', () => {
    const half = [{ id: 'scene_17', storyId: 'WRONG' }, { id: 'other', storyId: 'story-a' }]
    expect(pairFixedSlots([fixedSlots[0]], half)).toEqual([null])
  })

  it('storyId 중복이면 ambiguous → null (rendererId는 유일해도)', () => {
    const dupStory = [{ id: 'scene_17', storyId: 'story-a' }, { id: 'other', storyId: 'story-a' }]
    expect(pairFixedSlots([fixedSlots[0]], dupStory)).toEqual([null])
  })

  it('후보 없음 → null', () => {
    expect(pairFixedSlots([fixedSlots[0]], [])).toEqual([null])
  })
})

describe('resolveSceneOrdinals — audio-first (fixedScenes null)', () => {
  it('ordinal은 scenes 배열 위치(1-based), rendererSceneId=scene.id', () => {
    const { resolved, errors } = resolveSceneOrdinals({ sceneNumbers: [1, 3], scenes: audioScenes, fixedScenes: null })
    expect(errors).toEqual([])
    expect(resolved).toEqual([
      { ordinal: 1, rendererSceneId: 'scene_17', storyId: 'story-a', scene: audioScenes[0] },
      { ordinal: 3, rendererSceneId: 'scene_42', storyId: 'story-c', scene: audioScenes[2] },
    ])
  })

  it('sceneNumbers 생략 → 전체 씬', () => {
    const { resolved } = resolveSceneOrdinals({ scenes: audioScenes, fixedScenes: null })
    expect(resolved.map((r) => r.ordinal)).toEqual([1, 2, 3])
  })

  it('범위 밖 ordinal → scene-not-found (resolved에서 제외)', () => {
    const { resolved, errors } = resolveSceneOrdinals({ sceneNumbers: [2, 9], scenes: audioScenes, fixedScenes: null })
    expect(resolved.map((r) => r.ordinal)).toEqual([2])
    expect(errors).toEqual([{ ordinal: 9, error: 'scene-not-found' }])
  })

  it('storyId 없는 씬은 storyId:null', () => {
    const { resolved } = resolveSceneOrdinals({ sceneNumbers: [1], scenes: [{ id: 'scene_1' }], fixedScenes: null })
    expect(resolved[0].storyId).toBeNull()
  })

  it('정수 아닌/비양수 ordinal → invalid-ordinal', () => {
    const { errors } = resolveSceneOrdinals({ sceneNumbers: [0, 1.5, -2], scenes: audioScenes, fixedScenes: null })
    expect(errors).toEqual([
      { ordinal: 0, error: 'invalid-ordinal' },
      { ordinal: 1.5, error: 'invalid-ordinal' },
      { ordinal: -2, error: 'invalid-ordinal' },
    ])
  })
})

describe('resolveSceneOrdinals — image-first (fixedScenes slots)', () => {
  it('ordinal 1 → rendererSceneId scene_17 (배열 위치 아님), scene은 pair', () => {
    const { resolved, errors } = resolveSceneOrdinals({
      sceneNumbers: [1],
      scenes: fixedRendererScenes,
      fixedScenes: fixedSlots,
    })
    expect(errors).toEqual([])
    expect(resolved).toEqual([
      { ordinal: 1, rendererSceneId: 'scene_17', storyId: 'story-a', scene: fixedRendererScenes[1] },
    ])
  })

  it('pair 없는 슬롯 → fixed-slot-missing', () => {
    const { resolved, errors } = resolveSceneOrdinals({
      sceneNumbers: [1, 2],
      scenes: [fixedRendererScenes[1]], // scene_3 없음 → slot 2 pair 실패
      fixedScenes: fixedSlots,
    })
    expect(resolved.map((r) => r.ordinal)).toEqual([1])
    expect(errors).toEqual([{ ordinal: 2, error: 'fixed-slot-missing' }])
  })

  it('범위 밖 ordinal → fixed-slot-missing', () => {
    const { errors } = resolveSceneOrdinals({ sceneNumbers: [3], scenes: fixedRendererScenes, fixedScenes: fixedSlots })
    expect(errors).toEqual([{ ordinal: 3, error: 'fixed-slot-missing' }])
  })
})

describe('currentOrdinalByRendererId — 역방향(리뷰/문제씬용)', () => {
  it('audio-first: id→ordinal(배열 위치)', () => {
    const map = currentOrdinalByRendererId({ scenes: audioScenes, fixedScenes: null })
    expect(map.get('scene_17')).toBe(1)
    expect(map.get('scene_42')).toBe(3)
  })

  it('image-first: rendererSceneId→ordinal(슬롯 순서)', () => {
    const map = currentOrdinalByRendererId({ scenes: fixedRendererScenes, fixedScenes: fixedSlots })
    expect(map.get('scene_17')).toBe(1)
    expect(map.get('scene_3')).toBe(2)
  })

  it('image-first: pair 안 되는 슬롯 id는 map에 없다', () => {
    const map = currentOrdinalByRendererId({ scenes: [fixedRendererScenes[1]], fixedScenes: fixedSlots })
    expect(map.get('scene_17')).toBe(1)
    expect(map.has('scene_3')).toBe(false)
  })
})
