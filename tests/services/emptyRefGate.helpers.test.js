import { describe, expect, it } from 'vitest'
import {
  evaluateEmptyRefPostcondition,
  resolveLiveTargetScenes,
} from '../../src/services/emptyRefGate'

const ctx = (over = {}) => ({
  startMode: 'flow',
  projectName: 'P',
  force: false,
  initialTargetSceneIds: ['s1', 's2'],
  selectedStyleRefId: null,
  startOptionsWithoutSceneIds: {},
  ...over,
})

describe('resolveLiveTargetScenes', () => {
  it('최초 의도 ID 집합 밖의 씬은 (게이트 중 추가돼도) 포함하지 않는다', () => {
    const live = [
      { id: 's1', prompt: 'a', status: 'pending' },
      { id: 's2', prompt: 'b', status: 'pending' },
      { id: 's3', prompt: 'c', status: 'pending' },  // 게이트 중 MCP가 추가
    ]
    expect(resolveLiveTargetScenes(ctx(), live).map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('non-force: 게이트 중 완료된 씬은 pending 필터로 빠져 재생성하지 않는다', () => {
    const live = [
      { id: 's1', prompt: 'a', status: 'done', image: 'img' },
      { id: 's2', prompt: 'b', status: 'pending' },
    ]
    expect(resolveLiveTargetScenes(ctx(), live).map(s => s.id)).toEqual(['s2'])
  })

  it('force: 최초 의도 ID 중 실행 시점에 prompt가 있는 씬만 포함한다', () => {
    const live = [
      { id: 's1', prompt: '', status: 'done' },       // prompt 사라짐
      { id: 's2', prompt: 'b', status: 'done' },      // 완료됐어도 force면 포함
    ]
    expect(resolveLiveTargetScenes(ctx({ force: true }), live).map(s => s.id)).toEqual(['s2'])
  })

  it('삭제된 씬은 조용히 빠진다', () => {
    expect(resolveLiveTargetScenes(ctx(), [{ id: 's2', prompt: 'b', status: 'pending' }])
      .map(s => s.id)).toEqual(['s2'])
  })
})

describe('evaluateEmptyRefPostcondition', () => {
  const emptyGhost = { id: 'ghost', name: 'Ghost', type: 'character', prompt: 'p' }
  const filledGhost = { ...emptyGhost, mediaId: 'm1' }
  const scenes = [{ id: 's1', prompt: '@Ghost' }]

  it('요청한 ref가 채워졌으면 통과한다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], currentRefs: [filledGhost] },
      liveTargetScenes: scenes,
      matchRefs: () => [filledGhost],
    })
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('batch가 ok:true라도 요청한 ref가 여전히 빈카드로 참조되면 실패다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], currentRefs: [emptyGhost] },
      liveTargetScenes: scenes,
      matchRefs: () => [emptyGhost],
    })
    expect(result.ok).toBe(false)
    expect(result.failures).toEqual([
      { key: 'id:ghost', stage: 'postcondition', error: 'still-empty' },
    ])
  })

  it('batchResult.failed가 있으면 실패다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: false, outcome: 'failed', requestedKeys: ['id:ghost'], failed: [{ key: 'id:ghost', stage: 'submit', error: 'boom' }], currentRefs: [filledGhost] },
      liveTargetScenes: scenes,
      matchRefs: () => [filledGhost],
    })
    expect(result.ok).toBe(false)
  })

  it('outcome:stopped면 실패다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: false, outcome: 'stopped', requestedKeys: [], failed: [], currentRefs: [] },
      liveTargetScenes: scenes,
      matchRefs: () => [],
    })
    expect(result.ok).toBe(false)
  })

  it('요청 대상이 아니었던 빈카드(프롬프트 없음)는 postcondition 실패가 아니다 — 최종 M1이 제외한다', () => {
    const noPrompt = { id: 'void', name: 'Void', type: 'character', prompt: '' }
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], currentRefs: [filledGhost, noPrompt] },
      liveTargetScenes: [{ id: 's1', prompt: '@Ghost @Void' }],
      matchRefs: () => [filledGhost, noPrompt],
    })
    expect(result.ok).toBe(true)
  })

  it('targeted batch 후 새로 추가된 빈카드 참조는 postcondition 실패가 아니다 (§10.5)', () => {
    const newcomer = { id: 'new', name: 'New', type: 'character', prompt: 'p' }
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], currentRefs: [filledGhost, newcomer] },
      liveTargetScenes: [{ id: 's1', prompt: '@Ghost @New' }],
      matchRefs: () => [filledGhost, newcomer],
    })
    expect(result.ok).toBe(true)
  })

  it('요청한 ref가 사라졌으면 not-found로 실패다', () => {
    const result = evaluateEmptyRefPostcondition({
      batchResult: { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], failed: [], skipped: [{ key: 'id:ghost', stage: 'not-found' }], currentRefs: [] },
      liveTargetScenes: scenes,
      matchRefs: () => [],
    })
    expect(result.ok).toBe(false)
    expect(result.failures[0].error).toBe('not-found')
  })
})
