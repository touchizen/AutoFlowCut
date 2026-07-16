import { describe, expect, it } from 'vitest'
import {
  mergeMentionsIntoCharacters,
  planMentionTagMerges,
} from '../../src/utils/mentionTagMerge'

const references = [
  { id: 'char-alice', name: 'Alice', type: 'character' },
  { id: 'char-chulsoo', name: '철수', type: 'character' },
  { id: 'scene-alice', name: 'Alice', type: 'scene' },
]

describe('mergeMentionsIntoCharacters', () => {
  it('uses character refs only, resolves particles, preserves the old string, and appends canonical names', () => {
    const scene = {
      id: 's1',
      prompt: '@alice와 @철수가 걷는다',
      characters: '  기존 ; ALICE  ',
    }
    const before = structuredClone(scene)

    expect(mergeMentionsIntoCharacters(scene, references)).toBe(
      '  기존 ; ALICE  , 철수'
    )
    expect(scene).toEqual(before)
  })

  it('returns null when there is no change and is idempotent', () => {
    const scene = {
      id: 's1',
      prompt: '@Alice와 @철수가 걷는다',
      characters: 'Alice, 철수',
    }

    expect(mergeMentionsIntoCharacters(scene, references)).toBeNull()

    const first = mergeMentionsIntoCharacters(
      { ...scene, characters: '' },
      references
    )
    expect(first).toBe('Alice, 철수')
    expect(mergeMentionsIntoCharacters(
      { ...scene, characters: first },
      references
    )).toBeNull()
  })

  it('does not let a same-name scene ref shadow the character mention', () => {
    expect(mergeMentionsIntoCharacters(
      { id: 's1', prompt: '@Alice appears', characters: '' },
      references
    )).toBe('Alice')
  })

  it('handles empty prompts and null characters', () => {
    expect(mergeMentionsIntoCharacters(
      { id: 's1', prompt: '', characters: null },
      references
    )).toBeNull()
  })
})

describe('planMentionTagMerges', () => {
  it('returns only changed filtered scenes with original indices and state patches', () => {
    const scenes = [
      { id: 's1', prompt: '@Alice appears', characters: '', status: 'pending' },
      { id: 's2', prompt: '@철수가 appears', characters: '', status: 'done' },
      { id: 's3', prompt: '@Alice appears', characters: 'alice', status: 'pending' },
    ]

    expect(planMentionTagMerges(scenes, references, {
      filter: scene => scene.status === 'pending',
    })).toEqual({
      patches: [
        {
          sceneId: 's1',
          sceneIndex: 0,
          characters: 'Alice',
          addedNames: ['Alice'],
        },
      ],
      scenePatchesById: {
        s1: { characters: 'Alice' },
      },
    })
  })
})
