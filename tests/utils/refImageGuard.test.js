import { describe, expect, it } from 'vitest'
import {
  sourceAvailable,
  flowImageInjectable,
  flowMentionEligible,
  flowRegistrationRepairable,
  flowSyncable,
  flowTagCharacterNeedsSync,
  collectM1FlowReferenceExclusions,
  applyM1MentionExclusions,
  buildM1FlowReferenceExclusionToast,
} from '../../src/utils/refImageGuard'

describe('refImageGuard predicates', () => {
  it('sourceAvailable checks data, filePath, and imagePath independently', () => {
    expect(sourceAvailable({ data: 'base64' })).toBe(true)
    expect(sourceAvailable({ filePath: '/tmp/ref.png' })).toBe(true)
    expect(sourceAvailable({ imagePath: 'references/ref.png' })).toBe(true)
    expect(sourceAvailable({ data: '', filePath: null, imagePath: undefined })).toBe(false)
    expect(sourceAvailable(null)).toBe(false)
  })

  it('flowImageInjectable accepts only truthy mediaId values', () => {
    expect(flowImageInjectable({ mediaId: 'media-1' })).toBe(true)
    expect(flowImageInjectable({ mediaId: null })).toBe(false)
    expect(flowImageInjectable({ mediaId: undefined })).toBe(false)
    expect(flowImageInjectable({ mediaId: '' })).toBe(false)
  })

  it('flowMentionEligible reuses the current isRefSynced contract', () => {
    expect(flowMentionEligible({
      type: 'character',
      entityId: 'entity-1',
      flowNameSyncStatus: 'synced',
    })).toBe(true)
    expect(flowMentionEligible({
      type: 'character',
      entityId: 'entity-1',
      flowNameSyncStatus: 'failed',
    })).toBe(false)
    expect(flowMentionEligible({ type: 'scene', mediaId: 'media-1' })).toBe(true)
  })

  it('flowRegistrationRepairable requires entityId and workflowId', () => {
    expect(flowRegistrationRepairable({
      entityId: 'entity-1',
      workflowId: 'workflow-1',
    })).toBe(true)
    expect(flowRegistrationRepairable({ entityId: 'entity-1' })).toBe(false)
    expect(flowRegistrationRepairable({ workflowId: 'workflow-1' })).toBe(false)
  })

  it('flowSyncable supports registration repair or local upload', () => {
    expect(flowSyncable({
      entityId: 'entity-1',
      workflowId: 'workflow-1',
    })).toBe(true)
    expect(flowSyncable({ mediaId: null, data: 'base64' })).toBe(true)
    expect(flowSyncable({ mediaId: null, imagePath: 'references/ref.png' })).toBe(true)
    expect(flowSyncable({ mediaId: 'media-1', data: 'base64' })).toBe(false)
    expect(flowSyncable({ mediaId: null })).toBe(false)
  })

  it('flowTagCharacterNeedsSync requires a source and missing mediaId', () => {
    expect(flowTagCharacterNeedsSync({ mediaId: null, filePath: '/tmp/ref.png' })).toBe(true)
    expect(flowTagCharacterNeedsSync({ mediaId: 'media-1', filePath: '/tmp/ref.png' })).toBe(false)
    expect(flowTagCharacterNeedsSync({ mediaId: null })).toBe(false)
  })
})

describe('M1 basic Flow exclusions', () => {
  const localTagCharacter = {
    id: 'local-tag',
    name: 'LocalTag',
    type: 'character',
    data: 'base64',
    mediaId: null,
  }
  const localMentionCharacter = {
    id: 'local-mention',
    name: 'LocalMention',
    type: 'character',
    data: 'base64',
    mediaId: null,
  }
  const ghost = {
    id: 'ghost',
    name: 'Ghost',
    type: 'character',
    mediaId: null,
  }
  const entityOnlyMention = {
    id: 'entity-only',
    name: 'EntityOnly',
    type: 'character',
    entityId: 'entity-1',
    flowNameSyncStatus: 'synced',
    mediaId: null,
  }
  const localScene = {
    id: 'local-scene',
    name: 'Forest',
    type: 'scene',
    imagePath: 'references/Forest',
    mediaId: null,
  }
  const emptyStyle = {
    id: 'empty-style',
    name: 'EmptyStyle',
    type: 'style',
    mediaId: null,
  }
  const uploadedCharacter = {
    id: 'uploaded',
    name: 'Uploaded',
    type: 'character',
    mediaId: 'media-1',
  }

  it('keeps syncable mentions and uploadable non-characters but excludes M1-unusable uses', () => {
    const scenes = [
      { id: 's1', prompt: 'plain', characters: 'LocalTag' },
      { id: 's2', prompt: '@LocalMention appears', characters: '' },
      { id: 's3', prompt: '@Ghost appears', characters: '' },
      { id: 's4', prompt: '@EntityOnly appears', characters: '' },
      { id: 's5', prompt: 'forest', scene_tag: 'Forest' },
      { id: 's6', prompt: 'styled', style_tag: 'EmptyStyle' },
      { id: 's7', prompt: 'uploaded', characters: 'Uploaded' },
    ]
    const matches = {
      s1: [localTagCharacter],
      s2: [localMentionCharacter],
      s3: [ghost],
      s4: [entityOnlyMention],
      s5: [localScene],
      s6: [emptyStyle],
      s7: [uploadedCharacter],
    }

    const result = collectM1FlowReferenceExclusions(
      scenes,
      scene => matches[scene.id] || []
    )

    expect(result.exclusions.map(item => item.refName)).toEqual([
      'LocalTag',
      'Ghost',
      'EmptyStyle',
    ])
    expect(result.mentionNamesBySceneId).toEqual({
      s3: ['Ghost'],
    })
  })

  it('strips only excluded mention sigils from a run-local scene copy', () => {
    const scene = { id: 's1', prompt: '@Ghost meets @Hero' }
    const effective = applyM1MentionExclusions(scene, { s1: ['Ghost'] })

    expect(effective).toEqual({
      id: 's1',
      prompt: 'Ghost meets @Hero',
    })
    expect(scene.prompt).toBe('@Ghost meets @Hero')
    expect(applyM1MentionExclusions(scene, {})).toBe(scene)
  })

  it('builds grouped primary toast params and a deterministic More count', () => {
    const exclusions = [
      { sceneIndex: 0, refName: 'A' },
      { sceneIndex: 0, refName: 'B' },
      { sceneIndex: 1, refName: 'C' },
      { sceneIndex: 2, refName: 'D' },
      { sceneIndex: 3, refName: 'E' },
    ]

    expect(buildM1FlowReferenceExclusionToast(exclusions, 3)).toEqual({
      key: 'toast.unusableRefsExcludedMore',
      params: {
        count: 5,
        details: '#1: A, B · #2: C · #3: D',
        more: 1,
      },
    })
    expect(buildM1FlowReferenceExclusionToast([])).toBeNull()
  })
})
