// tests/utils/refEntityRegistration.test.js
import { describe, it, expect } from 'vitest'
import { needsEntityRegistration, applyEntityRegistrationPatch, selectRefsToRegister } from '../../src/utils/refEntityRegistration'

// ─── selectRefsToRegister (run 당 업로드 대상 스코핑) ─────────────────────────

describe('selectRefsToRegister', () => {
  const used = new Set(['a', 'b', 'c', 'd'])
  it('타깃 씬이 안 쓰는(usedRefIds 밖) ref 는 제외 — 멘션/태그 없으면 업로드 안 함', () => {
    const refs = [{ id: 'z', type: 'character', data: 'x' }] // 미사용
    expect(selectRefsToRegister(refs, used, 'flow')).toEqual([])
  })
  it('쓰는 + 소스 있음 + mediaId 없음 → 포함', () => {
    const refs = [{ id: 'a', type: 'character', data: 'x' }]
    expect(selectRefsToRegister(refs, used, 'flow')).toHaveLength(1)
  })
  it('쓰는 + mediaId 있고 synced → 제외(이미 등록됨)', () => {
    const refs = [{ id: 'b', type: 'character', data: 'x', mediaId: 'm', entityId: 'e', flowNameSyncStatus: 'synced' }]
    expect(selectRefsToRegister(refs, used, 'flow')).toEqual([])
  })
  it('쓰는 + mediaId 있지만 sync 안 됨(flow character) → 포함(재등록)', () => {
    const refs = [{ id: 'c', type: 'character', data: 'x', mediaId: 'm', entityId: 'e', flowNameSyncStatus: 'failed' }]
    expect(selectRefsToRegister(refs, used, 'flow')).toHaveLength(1)
  })
  it('쓰지만 소스(data/filePath/imagePath) 없음 → 제외', () => {
    const refs = [{ id: 'd', type: 'character' }]
    expect(selectRefsToRegister(refs, used, 'flow')).toEqual([])
  })
  it('usedRefIds 비면 아무것도 안 올림', () => {
    const refs = [{ id: 'a', type: 'character', data: 'x' }]
    expect(selectRefsToRegister(refs, new Set(), 'flow')).toEqual([])
  })
})


// ─── needsEntityRegistration ────────────────────────────────────────────────

describe('needsEntityRegistration', () => {
  it('returns true when flow mode + character type + no entityId', () => {
    expect(needsEntityRegistration({ type: 'character', entityId: null }, 'flow')).toBe(true)
    expect(needsEntityRegistration({ type: 'character' }, 'flow')).toBe(true)
    expect(needsEntityRegistration({ type: 'character', entityId: undefined }, 'flow')).toBe(true)
    expect(needsEntityRegistration({ type: 'character', entityId: '' }, 'flow')).toBe(true)
  })

  it('returns false when api mode (regardless of type/entityId)', () => {
    expect(needsEntityRegistration({ type: 'character', entityId: null }, 'api')).toBe(false)
    expect(needsEntityRegistration({ type: 'character' }, 'api')).toBe(false)
    expect(needsEntityRegistration({ type: 'style', entityId: null }, 'api')).toBe(false)
  })

  it('returns false when flow + non-character type', () => {
    expect(needsEntityRegistration({ type: 'style', entityId: null }, 'flow')).toBe(false)
    expect(needsEntityRegistration({ type: 'image', entityId: null }, 'flow')).toBe(false)
    expect(needsEntityRegistration({ type: undefined }, 'flow')).toBe(false)
    expect(needsEntityRegistration({ type: null }, 'flow')).toBe(false)
  })

  it('returns false when flow + character + fully registered (entityId + synced)', () => {
    expect(needsEntityRegistration({ type: 'character', entityId: 'ent-abc', flowNameSyncStatus: 'synced' }, 'flow')).toBe(false)
    expect(needsEntityRegistration({ type: 'character', entityId: 'some-id-123', flowNameSyncStatus: 'synced' }, 'flow')).toBe(false)
  })

  it('#R6-16: returns true when flow + character + entityId but sync FAILED/unsynced (must retry)', () => {
    // sync 실패한 ref 는 entityId 가 있어도 재등록 대상 — 안 그러면 mention 후보에서 영구 제외.
    expect(needsEntityRegistration({ type: 'character', entityId: 'ent-abc', flowNameSyncStatus: 'failed' }, 'flow')).toBe(true)
    expect(needsEntityRegistration({ type: 'character', entityId: 'ent-abc', flowNameSyncStatus: 'pending' }, 'flow')).toBe(true)
    // entityId 만 있고 sync 상태가 아예 없는 ref 도 재시도 대상
    expect(needsEntityRegistration({ type: 'character', entityId: 'ent-abc' }, 'flow')).toBe(true)
  })

  it('returns false when mode is neither api nor flow', () => {
    expect(needsEntityRegistration({ type: 'character', entityId: null }, 'byok')).toBe(false)
    expect(needsEntityRegistration({ type: 'character', entityId: null }, '')).toBe(false)
  })

  it('handles null/undefined ref gracefully', () => {
    expect(needsEntityRegistration(null, 'flow')).toBe(false)
    expect(needsEntityRegistration(undefined, 'flow')).toBe(false)
  })
})

// ─── applyEntityRegistrationPatch ──────────────────────────────────────────

describe('applyEntityRegistrationPatch', () => {
  const ref = { type: 'character', name: 'Alice', entityId: null }

  it('success=true: ref gets entityId, workflowId, mediaId, flowNameSyncStatus=synced, registered=true', () => {
    const result = { entityId: 'ent-001', workflowId: 'wf-002', mediaId: 'med-003' }
    const patch = applyEntityRegistrationPatch(ref, result, true)
    expect(patch.entityId).toBe('ent-001')
    expect(patch.workflowId).toBe('wf-002')
    expect(patch.mediaId).toBe('med-003')
    expect(patch.flowNameSyncStatus).toBe('synced')
    expect(patch.registered).toBe(true)
  })

  it('success=true: handles missing fields in result gracefully (null fallback)', () => {
    const result = {}
    const patch = applyEntityRegistrationPatch(ref, result, true)
    expect(patch.entityId).toBeNull()
    expect(patch.workflowId).toBeNull()
    expect(patch.mediaId).toBeNull()
    // No entityId → not fully synced
    expect(patch.flowNameSyncStatus).toBe('failed')
    expect(patch.registered).toBe(false)
  })

  it('success=true + result.registered=false: preserve ids, mark failed (not a mention candidate)', () => {
    const result = { entityId: 'ent-001', workflowId: 'wf-002', mediaId: 'med-003', registered: false }
    const patch = applyEntityRegistrationPatch(ref, result, true)
    // IDs are preserved so they can be retried later
    expect(patch.entityId).toBe('ent-001')
    expect(patch.workflowId).toBe('wf-002')
    expect(patch.mediaId).toBe('med-003')
    // But NOT synced — display-name PATCH failed
    expect(patch.flowNameSyncStatus).toBe('failed')
    expect(patch.registered).toBe(false)
  })

  it('success=true + registered=true + entityId present: mark synced (happy path)', () => {
    const result = { entityId: 'ent-001', workflowId: 'wf-002', mediaId: 'med-003', registered: true }
    const patch = applyEntityRegistrationPatch(ref, result, true)
    expect(patch.entityId).toBe('ent-001')
    expect(patch.workflowId).toBe('wf-002')
    expect(patch.mediaId).toBe('med-003')
    expect(patch.flowNameSyncStatus).toBe('synced')
    expect(patch.registered).toBe(true)
  })

  it('#R12-9: partial registration preserves existing ref ids instead of nulling them', () => {
    const existing = { type: 'character', name: 'Eve', entityId: 'ent-keep', workflowId: 'wf-keep', mediaId: 'med-keep' }
    // result omits entityId/workflowId (partial) but registered!==false
    const patch = applyEntityRegistrationPatch(existing, { mediaId: 'med-new', registered: true }, true)
    expect(patch.entityId).toBe('ent-keep')    // preserved, not nulled
    expect(patch.workflowId).toBe('wf-keep')   // preserved
    expect(patch.mediaId).toBe('med-new')      // overridden by result
    expect(patch.flowNameSyncStatus).toBe('synced')
    expect(patch.registered).toBe(true)
  })

  it('success=false: ref gets flowNameSyncStatus=failed (and nothing else)', () => {
    const result = { entityId: 'ent-001', workflowId: 'wf-002' }
    const patch = applyEntityRegistrationPatch(ref, result, false)
    expect(patch.flowNameSyncStatus).toBe('failed')
    expect(patch.entityId).toBeUndefined()
    expect(patch.registered).toBeUndefined()
  })

  it('success=false: flowNameSyncStatus=failed even with empty result', () => {
    const patch = applyEntityRegistrationPatch(ref, {}, false)
    expect(patch.flowNameSyncStatus).toBe('failed')
  })

  it('patch is a plain object (no side effects on original ref)', () => {
    const original = { type: 'character', entityId: null, name: 'Bob' }
    const result = { entityId: 'ent-x', workflowId: 'wf-y', mediaId: 'med-z' }
    const patch = applyEntityRegistrationPatch(original, result, true)
    // original is unmodified
    expect(original.entityId).toBeNull()
    // patch is a separate object
    expect(patch).not.toBe(original)
    const merged = { ...original, ...patch }
    expect(merged.entityId).toBe('ent-x')
    expect(merged.flowNameSyncStatus).toBe('synced')
  })
})
