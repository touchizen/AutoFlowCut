import { randomUUID as cryptoRandomUUID } from 'node:crypto'

import { computePlanHash, normalizeCanonicalPlan } from './planCanonical.js'
import { validateShoppingPlanDraft } from './planSchema.js'

export const PLAN_STATES = Object.freeze([
  'empty',
  'fact_review',
  'plan_review',
  'materialized',
  'generating',
  'review_required',
])

const PLAN_STATE_SET = new Set(PLAN_STATES)
const REVISION_STATES = new Set([
  'fact_review',
  'plan_review',
  'materialized',
  'generating',
  'review_required',
])
const GENERATION_STATES = new Set(['materialized', 'generating', 'review_required'])
const REQUIRED_DEPENDENCIES = ['fetchProduct', 'generatePlan', 'materialize', 'generate', 'now']
const MAX_FACT_DECISIONS = 30
const MAX_PROHIBITED_CLAIMS = 30
const MAX_FACT_REVIEW_ID_LENGTH = 160
const MAX_FACT_REVIEW_CONFIRMED_AT_LENGTH = 100
const MAX_PROHIBITED_CLAIM_TEXT_LENGTH = 2000

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return structuredClone(value)
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isBoundedNonEmptyString(value, maxLength) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
}

function inspectFactReviewInput(factDecisions, prohibitedClaims) {
  if (
    !Array.isArray(factDecisions)
    || factDecisions.length > MAX_FACT_DECISIONS
    || !Array.isArray(prohibitedClaims)
    || prohibitedClaims.length > MAX_PROHIBITED_CLAIMS
  ) return { error: 'fact-decisions-invalid' }

  const factIds = new Set()
  for (const decision of factDecisions) {
    if (
      !hasExactKeys(decision, ['sourceFactId', 'decision', 'confirmedAt'])
      || !isBoundedNonEmptyString(decision.sourceFactId, MAX_FACT_REVIEW_ID_LENGTH)
      || !['allowed', 'excluded'].includes(decision.decision)
      || !isBoundedNonEmptyString(decision.confirmedAt, MAX_FACT_REVIEW_CONFIRMED_AT_LENGTH)
      || factIds.has(decision.sourceFactId)
    ) return { error: 'fact-decisions-invalid' }
    factIds.add(decision.sourceFactId)
  }

  const prohibitedIds = new Set()
  for (const prohibited of prohibitedClaims) {
    if (
      !hasExactKeys(prohibited, ['id', 'text', 'reason'])
      || !isBoundedNonEmptyString(prohibited.id, MAX_FACT_REVIEW_ID_LENGTH)
      || !isBoundedNonEmptyString(prohibited.text, MAX_PROHIBITED_CLAIM_TEXT_LENGTH)
      || !isBoundedNonEmptyString(prohibited.reason, MAX_PROHIBITED_CLAIM_TEXT_LENGTH)
      || prohibitedIds.has(prohibited.id)
    ) return { error: 'fact-decisions-invalid' }
    prohibitedIds.add(prohibited.id)
  }

  return null
}

function groundedFactIdsForState(state) {
  const snapshot = state.snapshot
  const sourceFacts = Array.isArray(snapshot?.sourceFacts)
    ? snapshot.sourceFacts
    : Array.isArray(snapshot?.facts) ? snapshot.facts : null
  if (sourceFacts) {
    return new Set(sourceFacts.map((fact) => fact?.id).filter((id) => typeof id === 'string' && id))
  }
  if (snapshot?.product?.mode === 'manual' && Array.isArray(snapshot.product.facts)) {
    return new Set(snapshot.product.facts.map((fact) => fact?.id).filter((id) => typeof id === 'string' && id))
  }
  // A crawl draft stores only snapshot/image references. Its durable decisions were admitted
  // by createGeneratePlan against the original sourceFacts, so they are the restart-safe ID set.
  return new Set((snapshot?.factDecisions || []).map(({ sourceFactId }) => sourceFactId))
}

function inspectDraft(draft) {
  const validation = validateShoppingPlanDraft(draft)
  if (!validation.valid) {
    return { error: 'plan-draft-invalid', validationErrors: validation.errors }
  }

  try {
    const canonicalPlan = normalizeCanonicalPlan(draft)
    return {
      canonicalPlan,
      currentPlanHash: computePlanHash(canonicalPlan),
    }
  } catch (error) {
    return { error: 'plan-draft-invalid', validationErrors: [error.message] }
  }
}

function resetForRevision(state, canonicalPlan, currentPlanHash) {
  return {
    ...state,
    snapshot: canonicalPlan,
    currentPlanHash,
    approvedHash: null,
    revision: state.revision + 1,
    state: 'plan_review',
    pendingMaterialization: null,
    rendererAck: null,
    generationJournal: [],
    visualReviews: [],
    dialogueReviews: [],
    // acceptance_unknown is project-scoped and deliberately survives every plan revision.
    openAcceptanceHold: state.openAcceptanceHold,
  }
}

function assertMachineInputs(store, deps) {
  if (!store || typeof store.load !== 'function' || typeof store.update !== 'function') {
    throw new TypeError('store.load and queued store.update are required')
  }
  if (!deps || typeof deps !== 'object') throw new TypeError('deps are required')
  for (const dependency of REQUIRED_DEPENDENCIES) {
    if (typeof deps[dependency] !== 'function') {
      throw new TypeError(`deps.${dependency} must be a function`)
    }
  }
  if (deps.randomUUID !== undefined && typeof deps.randomUUID !== 'function') {
    throw new TypeError('deps.randomUUID must be a function when provided')
  }
}

function assertDurablePlanState(state) {
  if (!isRecord(state) || !PLAN_STATE_SET.has(state.state)) {
    throw new TypeError(`invalid durable plan state: ${String(state?.state)}`)
  }
  return state
}

export function createPlanMachine({ store, deps } = {}) {
  assertMachineInputs(store, deps)

  const randomUUID = deps.randomUUID || cryptoRandomUUID
  let projectPath = null
  let projectToken = null
  let activeController = null
  let operationGeneration = 0

  function tokenError(token) {
    return !projectToken || token !== projectToken ? { error: 'stale-token' } : null
  }

  function invalidateActiveOperation() {
    operationGeneration += 1
    if (activeController) activeController.abort()
    activeController = null
  }

  function beginOperation(operationId = randomUUID()) {
    invalidateActiveOperation()
    const controller = new AbortController()
    const operation = {
      controller,
      generation: operationGeneration,
      operationId,
      token: projectToken,
    }
    activeController = controller
    return operation
  }

  function isCurrentOperation(operation) {
    return operation.token === projectToken
      && operation.generation === operationGeneration
      && operation.controller === activeController
      && !operation.controller.signal.aborted
  }

  function finishOperation(operation) {
    if (operation.controller === activeController) activeController = null
  }

  async function beginAdmittedOperation(token, operationId, predicate) {
    if (tokenError(token)) return null
    const current = await store.load()
    if (tokenError(token) || !predicate(current)) return null
    return beginOperation(operationId)
  }

  async function open(nextProjectPath) {
    if (typeof nextProjectPath !== 'string' || !nextProjectPath) {
      throw new TypeError('projectPath must be a non-empty string')
    }
    invalidateActiveOperation()
    projectPath = null
    projectToken = null
    const nextProjectToken = randomUUID()
    const state = assertDurablePlanState(await store.load())
    projectPath = nextProjectPath
    projectToken = nextProjectToken
    return { projectToken, state }
  }

  async function getState() {
    if (!projectToken) return { error: 'not-open' }
    return { ...assertDurablePlanState(await store.load()), projectToken }
  }

  async function abort(token) {
    const stale = tokenError(token)
    if (stale) return stale
    invalidateActiveOperation()
    return { ok: true }
  }

  async function submitProduct(token, url) {
    const stale = tokenError(token)
    if (stale) return stale

    const before = await store.load()
    if (before.state !== 'empty') return { error: 'invalid-transition' }

    const operation = beginOperation()
    let snapshot
    try {
      snapshot = await deps.fetchProduct(url, {
        signal: operation.controller.signal,
        projectPath,
        projectToken,
        operationId: operation.operationId,
      })
    } catch (error) {
      if (!isCurrentOperation(operation) || operation.controller.signal.aborted) {
        finishOperation(operation)
        return { error: 'aborted' }
      }
      finishOperation(operation)
      if (error?.code === 'no-browser-found') return { error: 'no-browser-found' }
      return { error: 'product-fetch-failed', message: error.message }
    }

    if (!isCurrentOperation(operation)) {
      finishOperation(operation)
      return { error: 'aborted' }
    }
    if (!isRecord(snapshot)) {
      finishOperation(operation)
      return { error: 'product-snapshot-invalid' }
    }
    if (snapshot.status !== 'ok') {
      finishOperation(operation)
      if (snapshot.status === 'unsupported') {
        return {
          error: 'product-unsupported',
          reason: typeof snapshot.reason === 'string' ? snapshot.reason : 'Unsupported product page',
        }
      }
      return { error: 'product-snapshot-invalid' }
    }

    let persisted = false
    await store.update((state) => {
      if (!isCurrentOperation(operation) || state.state !== 'empty') return null
      persisted = true
      return {
        ...state,
        snapshot: clone(snapshot),
        state: 'fact_review',
      }
    })
    finishOperation(operation)
    return persisted ? { ok: true, operationId: operation.operationId } : { error: 'aborted' }
  }

  async function setFactDecisions(token, factDecisions, prohibitedClaims = []) {
    const stale = tokenError(token)
    if (stale) return stale
    const invalidInput = inspectFactReviewInput(factDecisions, prohibitedClaims)
    if (invalidInput) return invalidInput
    const operationId = randomUUID()

    let outcome = { error: 'invalid-transition' }
    await store.update((state) => {
      if (!REVISION_STATES.has(state.state) || !isRecord(state.snapshot)) return null
      const groundedFactIds = groundedFactIdsForState(state)
      if (factDecisions.some(({ sourceFactId }) => !groundedFactIds.has(sourceFactId))) {
        outcome = { error: 'fact-decisions-invalid' }
        return null
      }

      if (state.state === 'fact_review') {
        outcome = { ok: true, operationId, revision: state.revision }
        return {
          ...state,
          snapshot: {
            ...state.snapshot,
            factDecisions: clone(factDecisions),
            prohibitedClaims: clone(prohibitedClaims),
          },
        }
      }

      const draft = {
        ...state.snapshot,
        factDecisions: clone(factDecisions),
        prohibitedClaims: clone(prohibitedClaims),
      }
      const inspected = inspectDraft(draft)
      if (inspected.error) {
        outcome = inspected
        return null
      }
      if (inspected.currentPlanHash === state.currentPlanHash) {
        outcome = { ok: true, operationId, unchanged: true, revision: state.revision }
        return null
      }

      invalidateActiveOperation()
      outcome = {
        ok: true,
        operationId,
        planHash: inspected.currentPlanHash,
        revision: state.revision + 1,
      }
      return resetForRevision(state, inspected.canonicalPlan, inspected.currentPlanHash)
    })
    return outcome
  }

  async function draftPlan(token, options = {}) {
    const stale = tokenError(token)
    if (stale) return stale

    const before = await store.load()
    if (before.state !== 'fact_review' || !isRecord(before.snapshot)) {
      return { error: 'invalid-transition' }
    }

    const operation = beginOperation()
    const sourceSnapshot = clone(before.snapshot)
    const facts = sourceSnapshot.sourceFacts || sourceSnapshot.facts || sourceSnapshot
    const decisions = {
      factDecisions: sourceSnapshot.factDecisions || [],
      prohibitedClaims: sourceSnapshot.prohibitedClaims || [],
    }
    const planContext = {
      mode: 'crawl',
      snapshotId: sourceSnapshot.snapshotId,
      selectedImageIds: clone(sourceSnapshot.selectedImageIds),
      product: clone(sourceSnapshot.product),
    }
    let draft
    try {
      draft = await deps.generatePlan(facts, decisions, {
        ...options,
        planContext,
        usageTracker: deps.usageTracker,
        signal: operation.controller.signal,
        projectPath,
        projectToken,
        operationId: operation.operationId,
      })
    } catch (error) {
      if (!isCurrentOperation(operation) || operation.controller.signal.aborted) {
        finishOperation(operation)
        return { error: 'aborted' }
      }
      finishOperation(operation)
      if (error?.code === 'shopping-llm-key-missing') {
        return { error: 'shopping-llm-key-missing' }
      }
      return { error: 'plan-generation-failed', message: error.message }
    }

    if (!isCurrentOperation(operation)) {
      finishOperation(operation)
      return { error: 'aborted' }
    }

    if (draft?.error === 'plan-draft-invalid' && Array.isArray(draft.validationErrors)) {
      finishOperation(operation)
      return {
        error: 'plan-draft-invalid',
        validationErrors: clone(draft.validationErrors),
      }
    }

    const inspected = inspectDraft(draft)
    if (inspected.error) {
      finishOperation(operation)
      return inspected
    }

    let persisted = false
    await store.update((state) => {
      if (!isCurrentOperation(operation) || state.state !== 'fact_review') return null
      if (JSON.stringify(state.snapshot) !== JSON.stringify(sourceSnapshot)) return null
      persisted = true
      return resetForRevision(state, inspected.canonicalPlan, inspected.currentPlanHash)
    })
    finishOperation(operation)

    return persisted
      ? {
          ok: true,
          operationId: operation.operationId,
          planHash: inspected.currentPlanHash,
          revision: before.revision + 1,
        }
      : { error: 'aborted' }
  }

  async function setPlanDraft(token, draft) {
    const stale = tokenError(token)
    if (stale) return stale

    const inspected = inspectDraft(draft)
    if (inspected.error) return inspected

    let outcome = { error: 'invalid-transition' }
    await store.update((state) => {
      if (!REVISION_STATES.has(state.state)) return null
      if (inspected.currentPlanHash === state.currentPlanHash) {
        outcome = { ok: true, unchanged: true, revision: state.revision }
        return null
      }

      invalidateActiveOperation()
      outcome = {
        ok: true,
        planHash: inspected.currentPlanHash,
        revision: state.revision + 1,
      }
      return resetForRevision(state, inspected.canonicalPlan, inspected.currentPlanHash)
    })
    return outcome
  }

  async function reviseCurrentPlan(token, transform) {
    const stale = tokenError(token)
    if (stale) return stale

    let outcome = { error: 'invalid-transition' }
    await store.update((state) => {
      if (!REVISION_STATES.has(state.state) || !isRecord(state.snapshot)) return null
      const draft = transform(clone(state.snapshot), state.state)

      if (state.state === 'fact_review') {
        outcome = { ok: true, revision: state.revision }
        return { ...state, snapshot: draft }
      }

      const inspected = inspectDraft(draft)
      if (inspected.error) {
        outcome = inspected
        return null
      }
      if (inspected.currentPlanHash === state.currentPlanHash) {
        outcome = { ok: true, unchanged: true, revision: state.revision }
        return null
      }

      invalidateActiveOperation()
      outcome = {
        ok: true,
        planHash: inspected.currentPlanHash,
        revision: state.revision + 1,
      }
      return resetForRevision(state, inspected.canonicalPlan, inspected.currentPlanHash)
    })
    return outcome
  }

  function setPersona(token, persona) {
    return reviseCurrentPlan(token, (draft) => ({ ...draft, persona: clone(persona) }))
  }

  function setAssetSelection(token, assetIds) {
    return reviseCurrentPlan(token, (draft, stateName) => {
      if (stateName === 'fact_review') return { ...draft, selectedImageIds: clone(assetIds) }
      const field = draft.product?.mode === 'manual' ? 'attachmentIds' : 'selectedImageIds'
      return {
        ...draft,
        product: {
          ...draft.product,
          [field]: clone(assetIds),
        },
      }
    })
  }

  async function approvePlan(token) {
    const stale = tokenError(token)
    if (stale) return stale

    let admission = { error: 'invalid-transition' }
    await store.update((state) => {
      if (state.state !== 'plan_review') return null

      const inspected = inspectDraft(state.snapshot)
      if (inspected.error) {
        admission = inspected
        return null
      }

      const operationId = randomUUID()
      admission = {
        canonicalPlan: inspected.canonicalPlan,
        operationId,
        planHash: inspected.currentPlanHash,
        revision: state.revision,
      }
      return {
        ...state,
        snapshot: inspected.canonicalPlan,
        currentPlanHash: inspected.currentPlanHash,
        approvedHash: inspected.currentPlanHash,
        pendingMaterialization: {
          operationId,
          planHash: inspected.currentPlanHash,
          revision: state.revision,
          expectedMaterializationDigest: null,
          startedAt: deps.now(),
        },
        rendererAck: null,
      }
    })
    if (admission.error) return admission

    const operation = await beginAdmittedOperation(token, admission.operationId, (state) => (
      state.state === 'plan_review'
      && state.currentPlanHash === admission.planHash
      && state.approvedHash === admission.planHash
      && state.revision === admission.revision
      && state.pendingMaterialization?.operationId === admission.operationId
      && state.pendingMaterialization?.planHash === admission.planHash
      && state.pendingMaterialization?.revision === admission.revision
    ))
    if (!operation) return { error: 'aborted' }
    let materialization
    try {
      materialization = await deps.materialize(admission.canonicalPlan, {
        signal: operation.controller.signal,
        projectPath,
        projectToken,
        operationId: operation.operationId,
        planHash: admission.planHash,
        revision: admission.revision,
      })
    } catch (error) {
      if (!isCurrentOperation(operation) || operation.controller.signal.aborted) {
        finishOperation(operation)
        return { error: 'aborted' }
      }
      finishOperation(operation)
      return { error: 'materialization-failed', message: error.message }
    }

    if (!isCurrentOperation(operation)) {
      finishOperation(operation)
      return { error: 'aborted' }
    }

    const materializationDigest = materialization?.materializationDigest
    if (typeof materializationDigest !== 'string' || !materializationDigest) {
      finishOperation(operation)
      return { error: 'materialization-invalid' }
    }

    let persisted = false
    await store.update((state) => {
      const pending = state.pendingMaterialization
      if (!isCurrentOperation(operation)
        || state.state !== 'plan_review'
        || state.currentPlanHash !== admission.planHash
        || state.approvedHash !== admission.planHash
        || state.revision !== admission.revision
        || pending?.operationId !== admission.operationId) return null

      persisted = true
      return {
        ...state,
        pendingMaterialization: {
          ...pending,
          expectedMaterializationDigest: materializationDigest,
        },
      }
    })
    finishOperation(operation)

    return persisted
      ? {
          ok: true,
          operationId: admission.operationId,
          planHash: admission.planHash,
          revision: admission.revision,
          materializationDigest,
        }
      : { error: 'aborted' }
  }

  async function recordRendererAck(token, ack) {
    const stale = tokenError(token)
    if (stale) return stale

    let outcome = { error: 'materialization-not-acknowledged' }
    await store.update((state) => {
      const inspected = inspectDraft(state.snapshot)
      const pending = state.pendingMaterialization
      if (inspected.error
        || state.state !== 'plan_review'
        || state.currentPlanHash !== inspected.currentPlanHash
        || state.approvedHash !== inspected.currentPlanHash
        || ack?.ok !== true
        || !pending
        || typeof pending.expectedMaterializationDigest !== 'string'
        || ack.operationId !== pending.operationId
        || pending.planHash !== inspected.currentPlanHash
        || pending.revision !== state.revision
        || ack.planHash !== inspected.currentPlanHash
        || ack.revision !== state.revision
        || ack.materializationDigest !== pending.expectedMaterializationDigest) return null

      outcome = { ok: true, operationId: pending.operationId }
      return {
        ...state,
        state: 'materialized',
        pendingMaterialization: null,
        rendererAck: {
          planHash: ack.planHash,
          revision: ack.revision,
          materializationDigest: ack.materializationDigest,
          expectedMaterializationDigest: pending.expectedMaterializationDigest,
          operationId: pending.operationId,
          acknowledgedAt: deps.now(),
        },
      }
    })
    return outcome
  }

  async function requestGeneration(token, sceneIds) {
    const stale = tokenError(token)
    if (stale) return stale
    if (!Array.isArray(sceneIds) || sceneIds.some((id) => typeof id !== 'string' || !id)) {
      return { error: 'generation-request-invalid' }
    }

    let admission = { error: 'plan-not-approved' }
    await store.update((state) => {
      const inspected = inspectDraft(state.snapshot)
      if (inspected.error
        || state.currentPlanHash !== inspected.currentPlanHash
        || state.approvedHash !== inspected.currentPlanHash) return null

      const ack = state.rendererAck
      if (!ack
        || ack.planHash !== inspected.currentPlanHash
        || ack.revision !== state.revision
        || ack.materializationDigest !== ack.expectedMaterializationDigest) {
        admission = { error: 'materialization-not-acknowledged' }
        return null
      }
      if (!GENERATION_STATES.has(state.state)) {
        admission = { error: 'invalid-transition' }
        return null
      }
      if (state.openAcceptanceHold) {
        admission = { error: 'acceptance-unknown-hold' }
        return null
      }

      const operationId = randomUUID()
      const timestamp = deps.now()
      admission = {
        operationId,
        planHash: inspected.currentPlanHash,
        revision: state.revision,
      }
      return {
        ...state,
        state: 'generating',
        generationJournal: [
          ...state.generationJournal,
          {
            operationId,
            planHash: inspected.currentPlanHash,
            revision: state.revision,
            sceneIds: clone(sceneIds),
            status: 'reserved',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      }
    })
    if (admission.error) return admission

    const operation = await beginAdmittedOperation(token, admission.operationId, (state) => (
      state.state === 'generating'
      && state.currentPlanHash === admission.planHash
      && state.approvedHash === admission.planHash
      && state.revision === admission.revision
      && !state.openAcceptanceHold
      && state.generationJournal.some((row) => (
        row.operationId === admission.operationId
        && row.planHash === admission.planHash
        && row.revision === admission.revision
        && row.status === 'reserved'
      ))
    ))
    if (!operation) {
      // Admission may already be durable as `generating` + `reserved`. No paid action ran;
      // rolling that orphaned row/state back is follow-up recovery work, not this gate fix.
      return { error: 'aborted' }
    }
    let result
    try {
      result = await deps.generate(clone(sceneIds), {
        signal: operation.controller.signal,
        projectPath,
        projectToken,
        operationId: operation.operationId,
        planHash: admission.planHash,
        revision: admission.revision,
      })
    } catch (error) {
      if (!isCurrentOperation(operation) || operation.controller.signal.aborted) {
        finishOperation(operation)
        return { error: 'aborted' }
      }
      let persisted = false
      await store.update((state) => {
        const reserved = state.generationJournal.some((row) => (
          row.operationId === admission.operationId && row.status === 'reserved'
        ))
        if (!isCurrentOperation(operation)
          || state.state !== 'generating'
          || state.currentPlanHash !== admission.planHash
          || state.approvedHash !== admission.planHash
          || state.revision !== admission.revision
          || !reserved) return null

        persisted = true
        return {
          ...state,
          state: 'materialized',
          generationJournal: state.generationJournal.map((row) => row.operationId === admission.operationId
            ? { ...row, status: 'failed', message: error.message, updatedAt: deps.now() }
            : row),
        }
      })
      finishOperation(operation)
      return persisted
        ? { error: 'generation-failed', operationId: admission.operationId, message: error.message }
        : { error: 'aborted' }
    }

    if (!isCurrentOperation(operation)) {
      finishOperation(operation)
      return { error: 'aborted' }
    }

    let persisted = false
    await store.update((state) => {
      if (!isCurrentOperation(operation)
        || state.currentPlanHash !== admission.planHash
        || state.approvedHash !== admission.planHash
        || state.revision !== admission.revision) return null

      persisted = true
      return {
        ...state,
        state: 'review_required',
        generationJournal: state.generationJournal.map((row) => row.operationId === admission.operationId
          ? { ...row, status: 'completed', result: clone(result), updatedAt: deps.now() }
          : row),
      }
    })
    finishOperation(operation)

    return persisted
      ? { ok: true, operationId: admission.operationId, result }
      : { error: 'aborted' }
  }

  return {
    open,
    getState,
    abort,
    submitProduct,
    setFactDecisions,
    draftPlan,
    setPlanDraft,
    setPersona,
    setAssetSelection,
    approvePlan,
    recordRendererAck,
    requestGeneration,
  }
}
