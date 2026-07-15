// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import { createGrantLedger } from '../../../electron/agent/grantLedger.js'
import { hashArgs } from '../../../electron/agent/grantLedger.js'

// M3 I9 (slice 33): update_visual_review(G) / list_visual_reviews(R) / list_problem_scenes(R).
// 리뷰는 rendererSceneId 로 저장하고, 읽을 때 현재 ordinal 을 resolver 로 재부착한다.

const TOKEN = 'tok-1'

function fakeStore() {
  const reviews = {}
  return {
    reviews,
    read: vi.fn(async () => ({ version: 1, reviews })),
    update: vi.fn(async (entries) => {
      const out = []
      for (const e of entries) {
        const rec = { status: e.status, updatedAt: 'T', ...(e.reason !== undefined ? { reason: e.reason } : {}), ...(e.storyId !== undefined ? { storyId: e.storyId } : {}), ...(e.ordinalAtReview !== undefined ? { ordinalAtReview: e.ordinalAtReview } : {}) }
        reviews[e.rendererSceneId] = rec
        out.push({ rendererSceneId: e.rendererSceneId, ...rec })
      }
      return out
    }),
  }
}

let storyCommands, toolBridge, store, ledger, core
beforeEach(() => {
  storyCommands = {
    hasProject: () => true,
    projectToken: TOKEN,
    projectPath: '/proj',
    getState: vi.fn(async () => ({ sceneMode: 'audio-first', fixedScenes: null })),
  }
  toolBridge = {
    invoke: vi.fn(async (name) => {
      if (name === 'scene.snapshot') {
        return { sceneMode: 'audio-first', scenes: [
          { id: 'scene_17', storyId: 'a' },
          { id: 'scene_3', storyId: 'b' },
        ] }
      }
      throw new Error(`unexpected ${name}`)
    }),
  }
  store = fakeStore()
  ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  core = createToolCore({ toolBridge, projectToken: TOKEN, visualReviewStore: store, grantLedger: ledger, sessionId: 's1' })
  core.use(storyCommands)
})

function grant(name, args) {
  const nonce = `n-${name}`
  ledger.grant({ nonce, tool: name, argsHash: hashArgs(args), sessionId: 's1', projectToken: TOKEN })
  return { nonce }
}

describe('update_visual_review (G)', () => {
  it('승인 없이 → rejected/unconfirmed, 저장 0회', async () => {
    const r = await core.call('update_visual_review', { sceneNumbers: [1], status: 'rejected', reason: 'bad' }, {})
    expect(r).toMatchObject({ status: 'rejected', reason: 'unconfirmed' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('승인 후: ordinal→rendererSceneId 재resolve 해서 저장 (ordinalAtReview 기록)', async () => {
    const args = { sceneNumbers: [1], status: 'rejected', reason: 'face artifact' }
    const r = await core.call('update_visual_review', args, grant('update_visual_review', args))
    expect(r.status).toBe('done')
    expect(store.update).toHaveBeenCalledWith([
      { rendererSceneId: 'scene_17', storyId: 'a', status: 'rejected', reason: 'face artifact', ordinalAtReview: 1 },
    ])
    expect(r.updated[0]).toMatchObject({ rendererSceneId: 'scene_17', status: 'rejected' })
  })

  it('status 생략 → rejected 기본', async () => {
    const args = { sceneNumbers: [1] }
    await core.call('update_visual_review', args, grant('update_visual_review', args))
    expect(store.update).toHaveBeenCalledWith([expect.objectContaining({ status: 'rejected' })])
  })

  // MAJOR 2 (Fable): 빈 sceneNumbers 가 "전체 씬 reject" 로 조용히 확장되면 안 된다 (파괴적 G 툴).
  it('sceneNumbers: [] → invalid-params, 저장 0회', async () => {
    const args = { sceneNumbers: [] }
    const r = await core.call('update_visual_review', args, grant('update_visual_review', args))
    expect(r).toMatchObject({ status: 'rejected', reason: 'invalid-params' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('resolve 안 되는 ordinal 은 저장 안 하고 errors 로 보고', async () => {
    const args = { sceneNumbers: [9] }
    const r = await core.call('update_visual_review', args, grant('update_visual_review', args))
    expect(store.update).toHaveBeenCalledWith([])
    expect(r.errors).toContainEqual({ ordinal: 9, error: 'scene-not-found' })
  })
})

describe('list_visual_reviews (R)', () => {
  it('저장된 리뷰에 현재 ordinal 을 재부착한다', async () => {
    store.reviews.scene_17 = { status: 'rejected', reason: 'x', updatedAt: 'T' }
    const r = await core.call('list_visual_reviews', {}, {})
    expect(r.status).toBe('done')
    expect(r.reviews).toContainEqual({ rendererSceneId: 'scene_17', ordinal: 1, status: 'rejected', reason: 'x', updatedAt: 'T' })
  })

  it('현재 resolve 안 되는(사라진) 씬 리뷰는 ordinal null + stale, 버리지 않는다', async () => {
    store.reviews.scene_GONE = { status: 'rejected', updatedAt: 'T' }
    const r = await core.call('list_visual_reviews', {}, {})
    expect(r.reviews).toContainEqual(expect.objectContaining({ rendererSceneId: 'scene_GONE', ordinal: null, stale: true }))
  })
})

describe('list_problem_scenes (R)', () => {
  it('rejected 만 ordinal+rendererSceneId+reason 으로', async () => {
    store.reviews.scene_17 = { status: 'rejected', reason: 'blur', updatedAt: 'T' }
    store.reviews.scene_3 = { status: 'ok', updatedAt: 'T' }
    const r = await core.call('list_problem_scenes', {}, {})
    expect(r.scenes).toEqual([{ ordinal: 1, rendererSceneId: 'scene_17', reason: 'blur' }])
  })

  it('sceneNumbers 주면 그 ordinal 로 필터', async () => {
    store.reviews.scene_17 = { status: 'rejected', reason: 'a', updatedAt: 'T' }  // ordinal 1
    store.reviews.scene_3 = { status: 'rejected', reason: 'b', updatedAt: 'T' }   // ordinal 2
    const r = await core.call('list_problem_scenes', { sceneNumbers: [2] }, {})
    expect(r.scenes).toEqual([{ ordinal: 2, rendererSceneId: 'scene_3', reason: 'b' }])
  })
})
