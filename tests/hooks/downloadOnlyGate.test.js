/**
 * Unit tests for partitionDownloadOnly helper.
 *
 * Verifies that items with errorKind === 'download-entitlement' (never charged)
 * are placed in deniedRetry, while ordinary save-failure items (already charged)
 * are placed in plainRedownload.
 */
import { describe, it, expect } from 'vitest'
import { partitionDownloadOnly } from '../../src/hooks/downloadOnlyGate'

describe('partitionDownloadOnly', () => {
  it('puts errorKind=download-entitlement items into deniedRetry', () => {
    const items = [
      { id: '1', status: 'error', errorKind: 'download-entitlement', generationId: 'g1', mediaId: 'm1', videoPath: null },
    ]
    const { deniedRetry, plainRedownload } = partitionDownloadOnly(items)
    expect(deniedRetry).toHaveLength(1)
    expect(deniedRetry[0].id).toBe('1')
    expect(plainRedownload).toHaveLength(0)
  })

  it('puts items WITHOUT errorKind=download-entitlement into plainRedownload', () => {
    const items = [
      { id: '2', status: 'error', generationId: 'g2', mediaId: 'm2', videoPath: null },
      { id: '3', status: 'error', errorKind: 'save-failed', generationId: 'g3', mediaId: 'm3', videoPath: null },
    ]
    const { deniedRetry, plainRedownload } = partitionDownloadOnly(items)
    expect(plainRedownload).toHaveLength(2)
    expect(deniedRetry).toHaveLength(0)
  })

  it('correctly splits a mixed list', () => {
    const items = [
      { id: '1', errorKind: 'download-entitlement' },
      { id: '2', errorKind: 'save-failed' },
      { id: '3' }, // no errorKind
      { id: '4', errorKind: 'download-entitlement' },
    ]
    const { deniedRetry, plainRedownload } = partitionDownloadOnly(items)
    expect(deniedRetry.map(i => i.id)).toEqual(['1', '4'])
    expect(plainRedownload.map(i => i.id)).toEqual(['2', '3'])
  })

  it('returns empty arrays for empty input', () => {
    const { deniedRetry, plainRedownload } = partitionDownloadOnly([])
    expect(deniedRetry).toHaveLength(0)
    expect(plainRedownload).toHaveLength(0)
  })
})
