import { describe, expect, it } from 'vitest'
import {
  collectReferencedEmptyCards,
  isReferenceImageEmpty,
  referenceGuardKey,
} from '../../src/utils/refImageGuard'

describe('isReferenceImageEmpty', () => {
  it('data/filePath/imagePath/mediaId 중 하나라도 있으면 빈카드가 아니다', () => {
    expect(isReferenceImageEmpty({ data: 'x' })).toBe(false)
    expect(isReferenceImageEmpty({ filePath: '/a.png' })).toBe(false)
    expect(isReferenceImageEmpty({ imagePath: '/b.png' })).toBe(false)
    expect(isReferenceImageEmpty({ mediaId: 'm1' })).toBe(false)
  })

  it('네 필드가 모두 없으면 빈카드다', () => {
    expect(isReferenceImageEmpty({ name: 'A', type: 'character' })).toBe(true)
    expect(isReferenceImageEmpty(null)).toBe(true)
  })

  it('status done / entityId / workflowId / registered 만으로는 이미지가 있다고 보지 않는다', () => {
    expect(isReferenceImageEmpty({
      status: 'done', entityId: 'e1', workflowId: 'w1', registered: true,
    })).toBe(true)
  })
})

describe('referenceGuardKey', () => {
  it('id가 있으면 id가 authoritative key다', () => {
    expect(referenceGuardKey({ id: 7, type: 'character', name: 'A' })).toBe('id:7')
  })

  it('id가 없으면 type + normalized name으로 폴백한다', () => {
    expect(referenceGuardKey({ type: 'character', name: '  Alice  ' }))
      .toBe(referenceGuardKey({ type: 'character', name: 'alice' }))
  })

  it('id가 없고 type이 달라지면 다른 key다', () => {
    expect(referenceGuardKey({ type: 'scene', name: 'A' }))
      .not.toBe(referenceGuardKey({ type: 'character', name: 'A' }))
  })
})

describe('collectReferencedEmptyCards', () => {
  const empty = { id: 'ghost', name: 'Ghost', type: 'character', prompt: 'a ghost' }
  const emptyNoPrompt = { id: 'void', name: 'Void', type: 'character', prompt: '' }
  const filled = { id: 'alice', name: 'Alice', type: 'character', mediaId: 'm1', prompt: 'alice' }

  it('빈카드만 수집하고 채워진 카드는 제외한다', () => {
    const scenes = [{ id: 's1', prompt: '@Ghost @Alice' }]
    const result = collectReferencedEmptyCards(scenes, () => [empty, filled])

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].key).toBe('id:ghost')
  })

  it('같은 카드가 mention과 tag 양쪽에 걸려도 카드 1건으로 dedup한다', () => {
    const scenes = [{ id: 's1', prompt: '@Ghost', characters: 'Ghost' }]
    const result = collectReferencedEmptyCards(scenes, () => [empty, empty])

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].occurrences).toHaveLength(1)
  })

  it('여러 씬이 같은 카드를 참조하면 occurrences를 누적하고 원본 씬 index를 유지한다', () => {
    const scenes = [
      { id: 's1', prompt: '@Ghost' },
      { id: 's2', prompt: 'no refs' },
      { id: 's3', prompt: '@Ghost' },
    ]
    const result = collectReferencedEmptyCards(
      scenes,
      scene => (scene.prompt.includes('@Ghost') ? [empty] : []),
    )

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].occurrences).toEqual([
      { sceneId: 's1', sceneIndex: 0 },
      { sceneId: 's3', sceneIndex: 2 },
    ])
  })

  it('options.filter를 통과한 씬만 처리하되 sceneIndex는 원본 배열 index다', () => {
    const scenes = [
      { id: 's1', prompt: '@Ghost' },
      { id: 's2', prompt: '@Ghost' },
    ]
    const result = collectReferencedEmptyCards(scenes, () => [empty], {
      filter: scene => scene.id === 's2',
    })

    expect(result.cards[0].occurrences).toEqual([{ sceneId: 's2', sceneIndex: 1 }])
  })

  it('prompt 유무로 generatable / missingPrompt를 분리한다', () => {
    const scenes = [{ id: 's1', prompt: '@Ghost @Void' }]
    const result = collectReferencedEmptyCards(scenes, () => [empty, emptyNoPrompt])

    expect(result.generatableCards.map(c => c.key)).toEqual(['id:ghost'])
    expect(result.missingPromptCards.map(c => c.key)).toEqual(['id:void'])
    expect(result.cards.map(c => c.hasPrompt)).toEqual([true, false])
  })

  it('matcher를 1인자로만 호출한다 (App wrapper 계약)', () => {
    const calls = []
    const scenes = [{ id: 's1', prompt: '@Ghost' }]
    collectReferencedEmptyCards(scenes, (...args) => { calls.push(args); return [empty] })

    expect(calls.every(args => args.length === 1)).toBe(true)
  })

  it('scenes가 비면 빈 결과를 반환한다', () => {
    const result = collectReferencedEmptyCards([], () => [empty])
    expect(result).toEqual({ cards: [], generatableCards: [], missingPromptCards: [] })
  })
})
