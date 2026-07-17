import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScenes } from '../../src/hooks/useScenes'
import { planMentionTagMerges } from '../../src/utils/mentionTagMerge'
import {
  applyM1MentionExclusions,
  collectM1FlowReferenceExclusions,
} from '../../src/utils/refImageGuard'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

describe('M1 mention merge and reference exclusion integration', () => {
  it('persists character tags and strips only unusable mentions', () => {
    const { result } = renderHook(() => useScenes())
    const scene = {
      id: 's1',
      prompt: '@Alice meets @Ghost',
      characters: '',
      scene_tag: '',
      style_tag: 'EmptyStyle',
      status: 'pending',
    }
    const references = [
      {
        id: 'alice',
        name: 'Alice',
        type: 'character',
        entityId: 'entity-alice',
        flowNameSyncStatus: 'synced',
        mediaId: null,
      },
      {
        id: 'ghost',
        name: 'Ghost',
        type: 'character',
        mediaId: null,
      },
      {
        id: 'empty-style',
        name: 'EmptyStyle',
        type: 'style',
        mediaId: null,
      },
    ]

    act(() => {
      result.current.setScenes([scene])
      result.current.updateReferences(references)
    })

    const mergePlan = planMentionTagMerges(
      result.current.scenes,
      result.current.references,
      { filter: item => item.status === 'pending' }
    )
    act(() => {
      for (const patch of mergePlan.patches) {
        result.current.updateScene(patch.sceneId, {
          characters: patch.characters,
        })
      }
    })

    expect(result.current.scenes[0].characters).toBe('Alice, Ghost')

    const guard = collectM1FlowReferenceExclusions(
      result.current.scenes,
      result.current.getMatchingReferences
    )
    expect(guard.exclusions.map(item => item.refName)).toEqual([
      'Ghost',
      'EmptyStyle',
    ])

    const effective = applyM1MentionExclusions(
      result.current.scenes[0],
      guard.mentionNamesBySceneId
    )
    expect(effective.prompt).toBe('@Alice meets Ghost')
  })
})
