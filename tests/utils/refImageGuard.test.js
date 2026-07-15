import { describe, expect, it } from 'vitest'
import {
  sourceAvailable,
  flowImageInjectable,
  flowMentionEligible,
  flowRegistrationRepairable,
  flowSyncable,
  flowTagCharacterNeedsSync,
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
