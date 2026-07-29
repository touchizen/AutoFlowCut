// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { computePlanHash, normalizeCanonicalPlan } from '../../../electron/shopping/planCanonical.js'
import { defaultShoppingPlanState } from '../../../electron/shopping/shoppingPlanStore.js'
import {
  PLAN_STATES,
  createPlanMachine,
} from '../../../electron/shopping/planMachine.js'

const PROMPT_PHRASES = [
  'speaking in Korean',
  'say exactly',
  'no ad-lib',
  'no extra speech',
  'no music',
  'no captions',
  'no on-screen text',
]

function personaPrompt(dialogue) {
  return `Presenter ${PROMPT_PHRASES[0]}, ${PROMPT_PHRASES[1]} "${dialogue}", ${PROMPT_PHRASES.slice(2).join(', ')}`
}

function makePlan() {
  const claims = []
  const factDecisions = []
  const scenes = []

  for (let index = 0; index < 5; index += 1) {
    const ordinal = index + 1
    const isLast = index === 4
    const isPersona = index % 2 === 1 && !isLast
    const claimId = `claim-${ordinal}`
    const sourceFactId = `fact-${ordinal}`
    const text = isLast ? '지금 확인해 보세요' : `승인 정보 ${ordinal}`
    const claimType = index === 0 ? 'product_identity' : isLast ? 'cta' : 'page_fact'
    const sourceFactIds = claimType === 'cta' ? [] : [sourceFactId]

    claims.push({ id: claimId, text, claimType, sourceFactIds })
    if (sourceFactIds.length) {
      factDecisions.push({
        sourceFactId,
        decision: 'allowed',
        confirmedAt: `2026-07-23T01:0${index}:00.000Z`,
      })
    }

    scenes.push({
      sceneKey: `S${String(ordinal).padStart(2, '0')}`,
      visualType: isPersona ? 'persona_i2v' : 'product_still',
      visualDescription: isPersona ? '한국인 진행자가 카메라를 보며 말한다' : '실제 제품 이미지',
      productImageId: 'image-1',
      dialogueText: isPersona ? text : '',
      subtitleText: text,
      claimIds: [claimId],
      timelineDurationMs: isPersona ? 4000 : 2000,
      generationDurationSec: isPersona ? 4 : 0,
      trim: isPersona ? { startMs: 0, endMs: 4000 } : null,
      videoPrompt: isPersona ? personaPrompt(text) : '',
    })
  }

  return {
    schemaVersion: 'shopping-plan/3-appnative',
    product: {
      mode: 'crawl',
      snapshotId: 'snapshot-1',
      selectedImageIds: ['image-1'],
    },
    factDecisions,
    prohibitedClaims: [{ id: 'ban-1', text: '과장된 효능', reason: 'B 결정' }],
    persona: {
      id: 'persona-1',
      name: '민지',
      role: 'presenter',
      gender: 'female',
      ageBand: '30s',
      ethnicity: 'Korean',
      appearance: '단정한 검은 단발과 베이지 셔츠',
    },
    creative: {
      templateId: 'price-info-v1',
      styleId: 'shopping-ugc-presenter-v1',
    },
    generation: {
      provider: 'google',
      imageModel: 'gemini-3.1-flash-image',
      videoModel: 'veo-3.1-fast-generate-preview',
      aspectRatio: '9:16',
      videoResolution: '720p',
      videoSeedBase: 'seed-base-1',
      speechMode: 'veo-native-ko',
      productStillAudio: 'none',
      subtitleTiming: 'scene-block',
      dialoguePolicyVersion: 'shopping-veo-dialogue-v1',
    },
    claims,
    scenes,
  }
}

function makeProductSnapshot() {
  return {
    status: 'ok',
    snapshotId: 'snapshot-1',
    sourceFacts: [
      { id: 'fact-1', field: 'name', value: '테스트 상품' },
      { id: 'fact-2', field: 'price', value: 19900 },
    ],
    selectedImageIds: ['image-1'],
  }
}

function clone(value) {
  return structuredClone(value)
}

function createMemoryStore(initial = defaultShoppingPlanState()) {
  let state = clone(initial)
  const writes = []

  return {
    load: vi.fn(async () => clone(state)),
    update: vi.fn(async (updater) => {
      const next = await updater(clone(state))
      if (next == null) return clone(state)
      state = clone(next)
      writes.push(clone(state))
      return clone(state)
    }),
    save: vi.fn(async () => {
      throw new Error('planMachine must use queued update(), not save()')
    }),
    writtenCount: () => writes.length,
    replace(next) {
      state = clone(next)
    },
  }
}

function interposeAfterNextUpdate(store, action) {
  const baseUpdate = store.update
  let armed = true
  store.update = vi.fn(async (updater) => {
    const result = await baseUpdate(updater)
    if (armed) {
      armed = false
      await action()
    }
    return result
  })
}

function interposeBeforeNextUpdate(store, action) {
  const baseUpdate = store.update
  let armed = true
  store.update = vi.fn(async (updater) => {
    if (armed) {
      armed = false
      await action()
    }
    return baseUpdate(updater)
  })
}

function createDeps(overrides = {}) {
  let id = 0
  return {
    fetchProduct: vi.fn(async () => makeProductSnapshot()),
    generatePlan: vi.fn(async () => makePlan()),
    materialize: vi.fn(async () => ({ materializationDigest: 'materialization-digest-1' })),
    generate: vi.fn(async () => ({ assets: [{ sceneKey: 'S02', status: 'completed' }] })),
    now: vi.fn(() => '2026-07-23T09:00:00.000Z'),
    randomUUID: vi.fn(() => `operation-${++id}`),
    ...overrides,
  }
}

async function openMachine({ initial, deps: dependencyOverrides } = {}) {
  const store = createMemoryStore(initial)
  const deps = createDeps(dependencyOverrides)
  const machine = createPlanMachine({ store, deps })
  const opened = await machine.open('/projects/shopping-one')
  return { machine, store, deps, token: opened.projectToken }
}

function reviewedState(stateName, plan = makePlan()) {
  const snapshot = normalizeCanonicalPlan(plan)
  const currentPlanHash = computePlanHash(snapshot)
  return {
    snapshot,
    currentPlanHash,
    approvedHash: currentPlanHash,
    revision: 7,
    state: stateName,
    pendingMaterialization: {
      operationId: 'materialize-old',
      planHash: currentPlanHash,
      revision: 7,
      expectedMaterializationDigest: 'digest-old',
    },
    rendererAck: {
      planHash: currentPlanHash,
      revision: 7,
      materializationDigest: 'digest-old',
      expectedMaterializationDigest: 'digest-old',
      exportAdmissionDigest: 'export-old',
    },
    generationJournal: [{
      operationId: 'generation-old',
      status: 'completed',
      result: { persona: 'old', scenes: ['old'] },
      exportAdmissionDigest: 'export-old',
    }],
    visualReviews: [{ rendererSceneId: 'scene-old', status: 'ok', mediaDigest: 'old' }],
    dialogueReviews: [{ rendererSceneId: 'scene-old', status: 'ok', dialogueDigest: 'old' }],
    openAcceptanceHold: {
      status: 'acceptance_unknown',
      submissionId: 'unknown-old',
    },
  }
}

async function approveAndAck(machine, token) {
  const approval = await machine.approvePlan(token)
  const ack = await machine.recordRendererAck(token, {
    ok: true,
    operationId: approval.operationId,
    planHash: approval.planHash,
    revision: approval.revision,
    materializationDigest: approval.materializationDigest,
  })
  expect(ack).toMatchObject({ ok: true })
  return approval
}

function expectSideActionsNotCalled(deps) {
  expect(deps.fetchProduct).not.toHaveBeenCalled()
  expect(deps.generatePlan).not.toHaveBeenCalled()
  expect(deps.materialize).not.toHaveBeenCalled()
  expect(deps.generate).not.toHaveBeenCalled()
  expect(deps.now).not.toHaveBeenCalled()
}

describe('planMachine 6-state workflow', () => {
  it('exports exactly the six durable state names', () => {
    expect(PLAN_STATES).toEqual([
      'empty',
      'fact_review',
      'plan_review',
      'materialized',
      'generating',
      'review_required',
    ])
    expect(PLAN_STATES).not.toContain('exportable')
  })

  it('rejects a persisted seventh state instead of treating exportable as durable state', async () => {
    const store = createMemoryStore({
      ...defaultShoppingPlanState(),
      state: 'exportable',
    })
    const deps = createDeps()
    const machine = createPlanMachine({ store, deps })

    await expect(machine.open('/projects/shopping-one'))
      .rejects.toThrow('invalid durable plan state: exportable')
    expectSideActionsNotCalled(deps)
    expect(store.writtenCount()).toBe(0)
  })

  it('runs the normal path and requires renderer ack before materialized', async () => {
    let finishGeneration
    const generationResult = new Promise((resolve) => { finishGeneration = resolve })
    const { machine, store, deps, token } = await openMachine({
      deps: { generate: vi.fn(() => generationResult) },
    })

    expect((await machine.getState()).state).toBe('empty')

    await expect(machine.submitProduct(token, 'https://www.coupang.com/vp/products/1'))
      .resolves.toMatchObject({ ok: true })
    expect((await machine.getState()).state).toBe('fact_review')

    const decisions = makePlan().factDecisions
    await expect(machine.setFactDecisions(token, decisions, makePlan().prohibitedClaims))
      .resolves.toMatchObject({ ok: true })
    expect((await machine.getState()).state).toBe('fact_review')

    await expect(machine.draftPlan(token)).resolves.toMatchObject({ ok: true })
    expect((await machine.getState()).state).toBe('plan_review')

    const approval = await machine.approvePlan(token)
    expect(approval).toMatchObject({ ok: true, revision: 1 })
    expect((await machine.getState()).state).toBe('plan_review')

    await expect(machine.recordRendererAck(token, {
      ok: true,
      operationId: approval.operationId,
      planHash: approval.planHash,
      revision: approval.revision,
      materializationDigest: approval.materializationDigest,
    })).resolves.toMatchObject({ ok: true })
    expect((await machine.getState()).state).toBe('materialized')

    const generation = machine.requestGeneration(token, ['S02', 'S04'])
    await vi.waitFor(async () => {
      expect(deps.generate).toHaveBeenCalledTimes(1)
      expect((await machine.getState()).state).toBe('generating')
    })
    finishGeneration({ assets: [{ sceneKey: 'S02' }, { sceneKey: 'S04' }] })
    await expect(generation).resolves.toMatchObject({ ok: true })

    const final = await machine.getState()
    expect(final.state).toBe('review_required')
    expect(final.generationJournal).toHaveLength(1)
    expect(final.generationJournal[0]).toMatchObject({ status: 'completed' })
    expect(store.save).not.toHaveBeenCalled()
  })

  it('rejects out-of-order transitions before their side actions', async () => {
    const { machine, store, deps, token } = await openMachine()
    store.load.mockClear()
    deps.fetchProduct.mockClear()

    await expect(machine.draftPlan(token)).resolves.toEqual({ error: 'invalid-transition' })
    await expect(machine.approvePlan(token)).resolves.toEqual({ error: 'invalid-transition' })
    await expect(machine.recordRendererAck(token, {
      ok: true,
      planHash: 'forged',
      revision: 0,
      materializationDigest: 'forged',
    })).resolves.toEqual({ error: 'materialization-not-acknowledged' })
    await expect(machine.requestGeneration(token, ['S02'])).resolves.toEqual({ error: 'plan-not-approved' })

    expect(store.writtenCount()).toBe(0)
    expectSideActionsNotCalled(deps)
  })

  it('does not refetch a product outside empty', async () => {
    const { machine, deps, token } = await openMachine()
    await machine.submitProduct(token, 'https://www.coupang.com/vp/products/1')
    deps.fetchProduct.mockClear()

    await expect(machine.submitProduct(token, 'https://www.coupang.com/vp/products/2'))
      .resolves.toEqual({ error: 'invalid-transition' })
    expect(deps.fetchProduct).not.toHaveBeenCalled()
  })

  it('unsupported 상품은 구조화 오류로 반환하고 empty를 유지해 정상 URL 재시도를 허용한다', async () => {
    const unsupported = {
      status: 'unsupported',
      trust: 'untrusted-web-data',
      reason: 'Required product image is unavailable',
    }
    const { machine, deps, token } = await openMachine({
      deps: {
        fetchProduct: vi.fn()
          .mockResolvedValueOnce(unsupported)
          .mockResolvedValueOnce(makeProductSnapshot()),
      },
    })

    await expect(machine.submitProduct(token, 'https://www.coupang.com/vp/products/unsupported'))
      .resolves.toEqual({
        error: 'product-unsupported',
        reason: 'Required product image is unavailable',
      })
    expect(await machine.getState()).toMatchObject({ state: 'empty', snapshot: null })

    await expect(machine.submitProduct(token, 'https://www.coupang.com/vp/products/valid'))
      .resolves.toMatchObject({ ok: true })
    expect(await machine.getState()).toMatchObject({
      state: 'fact_review',
      snapshot: makeProductSnapshot(),
    })
    expect(deps.fetchProduct).toHaveBeenCalledTimes(2)
  })

  it('설치 브라우저가 없으면 전용 오류를 반환하고 empty 상태를 유지한다', async () => {
    const browserError = Object.assign(new Error('no-browser-found'), {
      code: 'no-browser-found',
    })
    const { machine, token } = await openMachine({
      deps: {
        fetchProduct: vi.fn(async () => { throw browserError }),
      },
    })

    await expect(machine.submitProduct(token, 'https://www.coupang.com/vp/products/1'))
      .resolves.toEqual({ error: 'no-browser-found' })
    expect(await machine.getState()).toMatchObject({ state: 'empty', snapshot: null })
  })
})

describe('plan revision reset', () => {
  const revisions = [
    ['plan', (machine, token, plan) => {
      plan.creative.templateId = 'problem-info-v1'
      return machine.setPlanDraft(token, plan)
    }],
    ['facts', (machine, token, plan) => {
      const decisions = clone(plan.factDecisions)
      decisions[0].confirmedAt = '2026-07-23T11:00:00.000Z'
      return machine.setFactDecisions(token, decisions, plan.prohibitedClaims)
    }],
    ['persona', (machine, token, plan) => machine.setPersona(token, {
      ...plan.persona,
      appearance: `${plan.persona.appearance}와 은색 귀걸이`,
    })],
    ['asset selection', (machine, token) => machine.setAssetSelection(token, ['image-1', 'image-2'])],
  ]

  it.each(['materialized', 'generating', 'review_required'])
  ('resets every downstream artifact from %s for each revision kind', async (stateName) => {
    for (const [revisionKind, revise] of revisions) {
      const plan = makePlan()
      const initial = reviewedState(stateName, plan)
      const { machine, store, deps, token } = await openMachine({ initial })

      await expect(revise(machine, token, clone(plan)), revisionKind)
        .resolves.toMatchObject({ ok: true })

      const revised = await machine.getState()
      expect(revised.state, revisionKind).toBe('plan_review')
      expect(revised.revision, revisionKind).toBe(8)
      expect(revised.currentPlanHash, revisionKind).not.toBe(initial.currentPlanHash)
      expect(revised.approvedHash, revisionKind).toBeNull()
      expect(revised.pendingMaterialization, revisionKind).toBeNull()
      expect(revised.rendererAck, `${revisionKind}: ack/export digest`).toBeNull()
      expect(revised.generationJournal, `${revisionKind}: persona/scene result/export digest`).toEqual([])
      expect(revised.visualReviews, revisionKind).toEqual([])
      expect(revised.dialogueReviews, revisionKind).toEqual([])
      expect(revised.openAcceptanceHold, revisionKind).toEqual(initial.openAcceptanceHold)
      expect(store.save, revisionKind).not.toHaveBeenCalled()
      expect(deps.materialize, revisionKind).not.toHaveBeenCalled()
      expect(deps.generate, revisionKind).not.toHaveBeenCalled()
    }
  })

  it('resets approval and pending materialization while aborting an in-flight approved push', async () => {
    let finishMaterialization
    let materializeSignal
    const materialization = new Promise((resolve) => { finishMaterialization = resolve })
    const plan = makePlan()
    const initial = {
      ...defaultShoppingPlanState(),
      snapshot: plan,
      currentPlanHash: computePlanHash(plan),
      revision: 1,
      state: 'plan_review',
    }
    const { machine, store, deps, token } = await openMachine({
      initial,
      deps: {
        materialize: vi.fn((_canonicalPlan, { signal }) => {
          materializeSignal = signal
          return materialization
        }),
      },
    })
    const approval = machine.approvePlan(token)
    await vi.waitFor(() => expect(deps.materialize).toHaveBeenCalledTimes(1))

    const approved = await machine.getState()
    expect(approved.state).toBe('plan_review')
    expect(approved.approvedHash).toBe(approved.currentPlanHash)
    expect(approved.pendingMaterialization).toMatchObject({ revision: 1 })
    expect(materializeSignal.aborted).toBe(false)

    const edited = makePlan()
    edited.creative.templateId = 'problem-info-v1'
    await expect(machine.setPlanDraft(token, edited)).resolves.toMatchObject({
      ok: true,
      revision: 2,
    })

    const revised = await machine.getState()
    expect(revised.state).toBe('plan_review')
    expect(revised.approvedHash).toBeNull()
    expect(revised.pendingMaterialization).toBeNull()
    expect(revised.rendererAck).toBeNull()
    expect(materializeSignal.aborted).toBe(true)
    expect(store.save).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()

    finishMaterialization({ materializationDigest: 'late-materialization-digest' })
    await expect(approval).resolves.toEqual({ error: 'aborted' })
  })

  it('does not create a new revision when canonical plan content is unchanged', async () => {
    const initial = reviewedState('materialized')
    const { machine, token } = await openMachine({ initial })

    await expect(machine.setPlanDraft(token, clone(initial.snapshot)))
      .resolves.toMatchObject({ ok: true, unchanged: true })
    expect(await machine.getState()).toMatchObject(initial)
  })
})

describe('approval and paid generation gates', () => {
  it('rejects approve outside plan_review with zero writes and zero materialization', async () => {
    const { machine, store, deps, token } = await openMachine()
    store.load.mockClear()

    await expect(machine.approvePlan(token)).resolves.toEqual({ error: 'invalid-transition' })

    expect(store.writtenCount()).toBe(0)
    expect(deps.materialize).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
  })

  it('rejects an invalid draft without persisting approval or materializing', async () => {
    const initial = {
      ...defaultShoppingPlanState(),
      snapshot: { schemaVersion: 'shopping-plan/3-appnative' },
      currentPlanHash: 'renderer-controlled',
      revision: 1,
      state: 'plan_review',
    }
    const { machine, store, deps, token } = await openMachine({ initial })

    const result = await machine.approvePlan(token)

    expect(result.error).toBe('plan-draft-invalid')
    expect(result.validationErrors.length).toBeGreaterThan(0)
    expect(store.writtenCount()).toBe(0)
    expect((await machine.getState()).approvedHash).toBeNull()
    expect(deps.materialize).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
  })

  it('has no caller-hash parameter and overwrites forged stored hash with a main recomputation', async () => {
    const plan = makePlan()
    const initial = {
      ...defaultShoppingPlanState(),
      snapshot: clone(plan),
      currentPlanHash: 'renderer-controlled-current-hash',
      revision: 3,
      state: 'plan_review',
    }
    const { machine, deps, token } = await openMachine({ initial })
    const callerHash = 'f'.repeat(64)
    const expectedCanonical = normalizeCanonicalPlan(plan)
    const expectedHash = computePlanHash(expectedCanonical)

    expect(machine.approvePlan).toHaveLength(1)
    const result = await machine.approvePlan(token, callerHash)

    expect(result.planHash).toBe(expectedHash)
    expect(result.planHash).not.toBe(callerHash)
    expect(await machine.getState()).toMatchObject({
      currentPlanHash: expectedHash,
      approvedHash: expectedHash,
    })
    expect(deps.materialize).toHaveBeenCalledWith(expectedCanonical, expect.objectContaining({
      planHash: expectedHash,
      signal: expect.any(AbortSignal),
    }))
  })

  it('blocks generation after a one-character draft edit and performs no new side action', async () => {
    const initial = {
      ...defaultShoppingPlanState(),
      snapshot: makePlan(),
      currentPlanHash: computePlanHash(makePlan()),
      revision: 1,
      state: 'plan_review',
    }
    const { machine, deps, token } = await openMachine({ initial })
    await machine.approvePlan(token)
    deps.materialize.mockClear()
    deps.generate.mockClear()
    deps.now.mockClear()

    const edited = makePlan()
    edited.persona.appearance = `${edited.persona.appearance}!`
    await machine.setPlanDraft(token, edited)
    const before = await machine.getState()
    expect(before.approvedHash).not.toBe(before.currentPlanHash)

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'plan-not-approved' })
    expect(deps.materialize).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
    expect((await machine.getState()).generationJournal).toEqual([])
  })

  it('blocks paid generation without renderer ack and reserves no journal row', async () => {
    const initial = {
      ...defaultShoppingPlanState(),
      snapshot: makePlan(),
      currentPlanHash: computePlanHash(makePlan()),
      revision: 1,
      state: 'plan_review',
    }
    const { machine, deps, token } = await openMachine({ initial })
    await machine.approvePlan(token)
    deps.generate.mockClear()
    deps.now.mockClear()

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'materialization-not-acknowledged' })
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
    expect((await machine.getState()).generationJournal).toEqual([])
  })

  it.each([
    ['hash', (approval) => ({ planHash: 'wrong-hash', revision: approval.revision, materializationDigest: approval.materializationDigest })],
    ['revision', (approval) => ({ planHash: approval.planHash, revision: approval.revision + 1, materializationDigest: approval.materializationDigest })],
    ['digest', (approval) => ({ planHash: approval.planHash, revision: approval.revision, materializationDigest: 'wrong-digest' })],
  ])('rejects a wrong renderer ack %s and keeps paid generation closed', async (_name, makeAck) => {
    const initial = {
      ...defaultShoppingPlanState(),
      snapshot: makePlan(),
      currentPlanHash: computePlanHash(makePlan()),
      revision: 1,
      state: 'plan_review',
    }
    const { machine, deps, token } = await openMachine({ initial })
    const approval = await machine.approvePlan(token)

    await expect(machine.recordRendererAck(token, {
      ok: true,
      operationId: approval.operationId,
      ...makeAck(approval),
    }))
      .resolves.toEqual({ error: 'materialization-not-acknowledged' })
    deps.generate.mockClear()
    deps.now.mockClear()

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'materialization-not-acknowledged' })
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
    expect((await machine.getState()).generationJournal).toEqual([])
  })

  it.each([
    ['operationId', ({ approval, ack }) => ({
      ack: { ...ack, operationId: `${approval.operationId}-forged` },
    })],
    ['pending planHash', ({ state }) => ({
      state: {
        ...state,
        pendingMaterialization: { ...state.pendingMaterialization, planHash: 'forged-plan-hash' },
      },
    })],
    ['pending revision', ({ state }) => ({
      state: {
        ...state,
        pendingMaterialization: { ...state.pendingMaterialization, revision: state.revision + 1 },
      },
    })],
  ])('binds renderer ack to the exact pending transaction %s', async (_name, mutate) => {
    const initial = {
      ...defaultShoppingPlanState(),
      snapshot: makePlan(),
      currentPlanHash: computePlanHash(makePlan()),
      revision: 1,
      state: 'plan_review',
    }
    const { machine, store, token } = await openMachine({ initial })
    const approval = await machine.approvePlan(token)
    const state = await store.load()
    const ack = {
      ok: true,
      operationId: approval.operationId,
      planHash: approval.planHash,
      revision: approval.revision,
      materializationDigest: approval.materializationDigest,
    }
    const changed = mutate({ approval, ack, state })
    if (changed.state) store.replace(changed.state)

    await expect(machine.recordRendererAck(token, changed.ack || ack))
      .resolves.toEqual({ error: 'materialization-not-acknowledged' })
    expect((await machine.getState()).state).toBe('plan_review')
  })

  it('rejects a live renderer ack whose planHash no longer matches the current plan', async () => {
    const initial = {
      ...reviewedState('materialized'),
      pendingMaterialization: null,
      rendererAck: {
        ...reviewedState('materialized').rendererAck,
        planHash: 'stale-plan-hash',
      },
      generationJournal: [],
      visualReviews: [],
      dialogueReviews: [],
      openAcceptanceHold: null,
    }
    const { machine, store, deps, token } = await openMachine({ initial })

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'materialization-not-acknowledged' })
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
    expect(store.writtenCount()).toBe(0)
    expect((await machine.getState()).generationJournal).toEqual([])
  })

  it('rejects a live renderer ack whose revision no longer matches the current revision', async () => {
    const ready = reviewedState('materialized')
    const initial = {
      ...ready,
      pendingMaterialization: null,
      rendererAck: {
        ...ready.rendererAck,
        revision: ready.revision + 1,
      },
      generationJournal: [],
      visualReviews: [],
      dialogueReviews: [],
      openAcceptanceHold: null,
    }
    const { machine, store, deps, token } = await openMachine({ initial })

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'materialization-not-acknowledged' })
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
    expect(store.writtenCount()).toBe(0)
    expect((await machine.getState()).generationJournal).toEqual([])
  })

  it('recomputes the snapshot hash at generation admission instead of trusting forged store hashes', async () => {
    const forgedHash = 'a'.repeat(64)
    const initial = {
      ...reviewedState('materialized'),
      currentPlanHash: forgedHash,
      approvedHash: forgedHash,
      rendererAck: {
        planHash: forgedHash,
        revision: 7,
        materializationDigest: 'forged-digest',
        expectedMaterializationDigest: 'forged-digest',
      },
      pendingMaterialization: null,
      generationJournal: [],
      visualReviews: [],
      dialogueReviews: [],
      openAcceptanceHold: null,
    }
    const { machine, store, deps, token } = await openMachine({ initial })
    deps.now.mockClear()

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'plan-not-approved' })
    expect(store.writtenCount()).toBe(0)
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
  })

  it('rejects a renderer ack whose materialization digest no longer matches the main-owned expected digest', async () => {
    const initial = {
      ...reviewedState('materialized'),
      pendingMaterialization: null,
      rendererAck: {
        ...reviewedState('materialized').rendererAck,
        materializationDigest: 'tampered-digest',
      },
      generationJournal: [],
      visualReviews: [],
      dialogueReviews: [],
      openAcceptanceHold: null,
    }
    const { machine, deps, token } = await openMachine({ initial })
    deps.now.mockClear()

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'materialization-not-acknowledged' })
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
  })

  it('keeps an acceptance_unknown hold closed even when approval and ack are valid', async () => {
    const initial = {
      ...reviewedState('materialized'),
      pendingMaterialization: null,
      generationJournal: [],
      visualReviews: [],
      dialogueReviews: [],
    }
    const { machine, deps, token } = await openMachine({ initial })
    deps.now.mockClear()

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'acceptance-unknown-hold' })
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.now).not.toHaveBeenCalled()
  })
})

describe('session, abort, and dependency isolation', () => {
  it('issues a new token on every open, aborts the old operation, and drops its late result', async () => {
    let finishFetch
    let fetchSignal
    const fetchResult = new Promise((resolve) => { finishFetch = resolve })
    const store = createMemoryStore()
    const deps = createDeps({
      fetchProduct: vi.fn((_url, { signal }) => {
        fetchSignal = signal
        return fetchResult
      }),
    })
    const machine = createPlanMachine({ store, deps })
    const first = await machine.open('/projects/one')
    const oldCommand = machine.submitProduct(first.projectToken, 'https://www.coupang.com/vp/products/1')
    await vi.waitFor(() => expect(deps.fetchProduct).toHaveBeenCalledTimes(1))
    expect(fetchSignal.aborted).toBe(false)

    const second = await machine.open('/projects/two')
    expect(second.projectToken).not.toBe(first.projectToken)
    expect(fetchSignal.aborted).toBe(true)

    finishFetch(makeProductSnapshot())
    await expect(oldCommand).resolves.toEqual({ error: 'aborted' })
    expect((await machine.getState()).state).toBe('empty')
    expect(store.writtenCount()).toBe(0)
  })

  it('does not start materialization if project open changes after approval admission is persisted', async () => {
    const initial = {
      ...defaultShoppingPlanState(),
      snapshot: makePlan(),
      currentPlanHash: computePlanHash(makePlan()),
      revision: 1,
      state: 'plan_review',
    }
    const { machine, store, deps, token } = await openMachine({ initial })
    interposeAfterNextUpdate(store, () => machine.open('/projects/shopping-two'))

    await expect(machine.approvePlan(token)).resolves.toEqual({ error: 'aborted' })
    expect(deps.materialize).not.toHaveBeenCalled()
  })

  it('does not start paid generation if a plan revision lands after admission is persisted', async () => {
    const initial = {
      ...reviewedState('materialized'),
      pendingMaterialization: null,
      generationJournal: [],
      visualReviews: [],
      dialogueReviews: [],
      openAcceptanceHold: null,
    }
    const { machine, store, deps, token } = await openMachine({ initial })
    const edited = makePlan()
    edited.creative.templateId = 'problem-info-v1'
    interposeAfterNextUpdate(store, () => machine.setPlanDraft(token, edited))

    await expect(machine.requestGeneration(token, ['S02']))
      .resolves.toEqual({ error: 'aborted' })
    expect(deps.generate).not.toHaveBeenCalled()
    expect((await machine.getState()).generationJournal).toEqual([])
  })

  it('does not let a late generation failure resurrect materialized after revision reset', async () => {
    let failGeneration
    const generationResult = new Promise((_resolve, reject) => { failGeneration = reject })
    const initial = {
      ...reviewedState('materialized'),
      pendingMaterialization: null,
      generationJournal: [],
      visualReviews: [],
      dialogueReviews: [],
      openAcceptanceHold: null,
    }
    const { machine, store, deps, token } = await openMachine({
      initial,
      deps: { generate: vi.fn(() => generationResult) },
    })
    const request = machine.requestGeneration(token, ['S02'])
    await vi.waitFor(() => expect(deps.generate).toHaveBeenCalledTimes(1))

    const edited = makePlan()
    edited.creative.templateId = 'problem-info-v1'
    interposeBeforeNextUpdate(store, () => machine.setPlanDraft(token, edited))
    failGeneration(new Error('provider failed'))

    await expect(request).resolves.toEqual({ error: 'aborted' })
    expect(await machine.getState()).toMatchObject({
      state: 'plan_review',
      approvedHash: null,
      rendererAck: null,
      generationJournal: [],
    })
  })

  it('checks stale tokens before every mutating command, store access, or injected side action', async () => {
    const { machine, store, deps } = await openMachine()
    store.load.mockClear()
    store.update.mockClear()
    Object.values(deps).forEach((dependency) => dependency?.mockClear?.())
    const stale = 'stale-project-token'

    const commands = [
      () => machine.abort(stale),
      () => machine.submitProduct(stale, 'https://www.coupang.com/vp/products/1'),
      () => machine.setFactDecisions(stale, [], []),
      () => machine.draftPlan(stale),
      () => machine.setPlanDraft(stale, makePlan()),
      () => machine.setPersona(stale, makePlan().persona),
      () => machine.setAssetSelection(stale, ['image-1']),
      () => machine.approvePlan(stale),
      () => machine.recordRendererAck(stale, {
        ok: true,
        planHash: 'forged',
        revision: 1,
        materializationDigest: 'forged',
      }),
      () => machine.requestGeneration(stale, ['S02']),
    ]

    for (const command of commands) {
      await expect(command()).resolves.toEqual({ error: 'stale-token' })
    }

    expect(store.load).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
    expectSideActionsNotCalled(deps)
  })

  it('passes AbortSignal only through DI side actions and never performs network, LLM, or file work itself', async () => {
    const { machine, deps, token } = await openMachine()

    await machine.submitProduct(token, 'https://www.coupang.com/vp/products/1')
    expect(deps.fetchProduct).toHaveBeenCalledWith(
      'https://www.coupang.com/vp/products/1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    await machine.setFactDecisions(token, makePlan().factDecisions, makePlan().prohibitedClaims)
    await machine.draftPlan(token)
    expect(deps.generatePlan).toHaveBeenCalledWith(
      makeProductSnapshot().sourceFacts,
      expect.objectContaining({ factDecisions: makePlan().factDecisions }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    const approval = await machine.approvePlan(token)
    expect(deps.materialize).toHaveBeenCalledWith(
      normalizeCanonicalPlan(makePlan()),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    await machine.recordRendererAck(token, {
      ok: true,
      operationId: approval.operationId,
      planHash: approval.planHash,
      revision: approval.revision,
      materializationDigest: approval.materializationDigest,
    })
    await machine.requestGeneration(token, ['S02'])
    expect(deps.generate).toHaveBeenCalledWith(
      ['S02'],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('uses store.update for every durable mutation and never calls blind save', async () => {
    const { machine, store, token } = await openMachine()

    await machine.submitProduct(token, 'https://www.coupang.com/vp/products/1')
    await machine.setFactDecisions(token, makePlan().factDecisions, makePlan().prohibitedClaims)
    await machine.draftPlan(token)
    await approveAndAck(machine, token)
    await machine.requestGeneration(token, ['S02'])

    expect(store.update.mock.calls.length).toBeGreaterThan(0)
    expect(store.save).not.toHaveBeenCalled()
  })
})
