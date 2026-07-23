// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { shoppingAssets } from '../../../electron/shopping/assets/index.js'
import { createGeneratePlan } from '../../../electron/shopping/generatePlan.js'
import { createPlanMachine } from '../../../electron/shopping/planMachine.js'
import { validateShoppingPlanDraft } from '../../../electron/shopping/planSchema.js'
import { defaultShoppingPlanState } from '../../../electron/shopping/shoppingPlanStore.js'

const RAW_HTML_SENTINEL = '<html><script>RAW_HTML_MUST_NOT_REACH_LLM</script></html>'
const DISCOUNT_PERCENT_FORMULA = 'round((listPriceKrw-priceKrw)/listPriceKrw*100)'

function personaPrompt(dialogue) {
  return `Presenter speaking in Korean, say exactly "${dialogue}", no ad-lib, no extra speech, no music, no captions, no on-screen text`
}

function setClaimText(draft, claimIndex, text) {
  const claim = draft.claims[claimIndex]
  const scene = draft.scenes.find(({ claimIds }) => claimIds.includes(claim.id))
  claim.text = text
  scene.subtitleText = text
  if (scene.visualType === 'persona_i2v') {
    scene.dialogueText = text
    scene.videoPrompt = personaPrompt(text)
  }
}

function makeDiscountDraft(percent, formula = DISCOUNT_PERCENT_FORMULA) {
  const value = makeDraft()
  value.facts[1].field = 'priceKrw'
  value.facts[1].value = 29800
  value.facts[2].field = 'listPriceKrw'
  value.facts[2].value = 70000
  value.draft.claims[1].claimType = 'derived_numeric'
  value.draft.claims[1].sourceFactIds = ['fact-2', 'fact-3']
  value.draft.claims[1].formula = formula
  setClaimText(value.draft, 1, `정가 대비 ${percent}% 할인`)
  setClaimText(value.draft, 2, '정가는 70,000원')
  return value
}

function makeDraft() {
  const facts = Array.from({ length: 4 }, (_, index) => ({
    id: `fact-${index + 1}`,
    field: index === 0 ? 'name' : 'description',
    value: index === 0 ? '승인 상품명' : `승인 정보 ${index + 1}`,
    sourceKind: 'jsonld',
    sourceUrl: 'https://www.coupang.com/vp/products/1',
    jsonPathOrProperty: `$.field${index + 1}`,
    fetchedAt: '2026-07-23T09:00:00.000Z',
    verification: 'page-asserted',
    trust: 'untrusted-web-data',
  }))
  const factDecisions = facts.map(({ id }, index) => ({
    sourceFactId: id,
    decision: 'allowed',
    confirmedAt: `2026-07-23T09:0${index}:00.000Z`,
  }))
  const claims = Array.from({ length: 5 }, (_, index) => ({
    id: `claim-${index + 1}`,
    text: index === 4 ? '제품 정보를 확인하세요' : `승인 정보 ${index + 1}`,
    claimType: index === 0 ? 'product_identity' : index === 4 ? 'cta' : 'page_fact',
    sourceFactIds: index === 4 ? [] : [`fact-${index + 1}`],
  }))
  const scenes = claims.map((claim, index) => {
    const isPersona = index === 1 || index === 3
    return {
      sceneKey: `S${String(index + 1).padStart(2, '0')}`,
      visualType: isPersona ? 'persona_i2v' : 'product_still',
      visualDescription: isPersona ? '한국인 진행자가 카메라를 본다' : '승인된 실제 제품 이미지',
      productImageId: 'image-1',
      dialogueText: isPersona ? claim.text : '',
      subtitleText: claim.text,
      claimIds: [claim.id],
      timelineDurationMs: isPersona ? 4000 : 2000,
      generationDurationSec: isPersona ? 4 : 0,
      trim: isPersona ? { startMs: 0, endMs: 4000 } : null,
      videoPrompt: isPersona ? personaPrompt(claim.text) : '',
    }
  })

  return {
    facts,
    decisions: {
      factDecisions: structuredClone(factDecisions),
      prohibitedClaims: [{ id: 'ban-1', text: '과장 효능', reason: '사용자 B 확정' }],
    },
    draft: {
      schemaVersion: 'shopping-plan/3-appnative',
      product: {
        mode: 'crawl',
        snapshotId: 'snapshot-1',
        selectedImageIds: ['image-1'],
      },
      factDecisions,
      prohibitedClaims: [{ id: 'ban-1', text: '과장 효능', reason: '사용자 B 확정' }],
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
    },
  }
}

describe('createGeneratePlan', () => {
  it('passes only bounded source facts, fixed assets, and confirmed A/B constraints to the LLM', async () => {
    const { facts, decisions, draft } = makeDraft()
    facts[0].rawHtml = RAW_HTML_SENTINEL
    facts[0].body = Buffer.from('forbidden bytes')
    facts[1].value = `2${'가'.repeat(9_999)}`
    facts[2].jsonPathOrProperty = RAW_HTML_SENTINEL
    const llm = {
      generateShoppingPlan: vi.fn(async () => JSON.stringify(draft)),
    }
    const generatePlan = createGeneratePlan({ llm })
    const controller = new AbortController()

    const result = await generatePlan(facts, decisions, {
      signal: controller.signal,
      targetHint: '30대 1인 가구',
      emphasis: '승인된 가격',
      rawHtml: RAW_HTML_SENTINEL,
      projectPath: '/private/project/path-must-not-reach-model',
    })

    expect(validateShoppingPlanDraft(result)).toEqual({ valid: true, errors: [] })
    expect(llm.generateShoppingPlan).toHaveBeenCalledTimes(1)
    const [sanitizedFacts, assets, constraints] = llm.generateShoppingPlan.mock.calls[0]
    expect(sanitizedFacts).toHaveLength(4)
    expect(Object.keys(sanitizedFacts[0])).toEqual([
      'id',
      'field',
      'value',
      'sourceKind',
      'sourceUrl',
      'jsonPathOrProperty',
      'fetchedAt',
      'verification',
      'trust',
    ])
    expect(sanitizedFacts[1].value.length).toBeLessThanOrEqual(2000)
    expect(assets).toBe(shoppingAssets)
    expect(constraints).toMatchObject({
      metaPrompt: expect.stringContaining('ShoppingPlanDraftInput'),
      factDecisions: decisions.factDecisions,
      prohibitedClaims: decisions.prohibitedClaims,
      targetHint: '30대 1인 가구',
      emphasis: '승인된 가격',
      signal: controller.signal,
    })
    const serializedModelInput = JSON.stringify([sanitizedFacts, assets, constraints])
    expect(serializedModelInput).not.toContain(RAW_HTML_SENTINEL)
    expect(serializedModelInput).not.toContain('path-must-not-reach-model')
    expect(serializedModelInput).not.toContain('forbidden bytes')
  })

  it('returns plan-draft-invalid for malformed JSON', async () => {
    const { facts, decisions } = makeDraft()
    const llm = { generateShoppingPlan: vi.fn(async () => '```json\n{}\n```') }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('JSON')],
    })
  })

  it('returns plan-draft-invalid for a strict schema failure', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.extra = 'not allowed'
    const llm = { generateShoppingPlan: vi.fn(async () => JSON.stringify(draft)) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: expect.arrayContaining([expect.stringContaining('$.extra is not allowed')]),
    })
  })

  it('rejects an LLM claim without an allowed D4 source-fact connection', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.claims[1].sourceFactIds = []
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: expect.arrayContaining([expect.stringContaining('requires at least one sourceFactId')]),
    })
  })

  it('rejects page_fact numeric tokens that are absent from every referenced fact value', async () => {
    const { facts, decisions, draft } = makeDraft()
    facts[1].value = '비듬샴푸'
    setClaimText(draft, 1, '출시 3일 만에 5만 개 완판')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('numeric tokens')],
    })
  })

  it('rejects a derived discount whose claimed percentage disagrees with main recomputation', async () => {
    const { facts, decisions, draft } = makeDiscountDraft(87)
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('derived_numeric')],
    })
  })

  it('rejects a non-deterministic derived formula even when the claimed percentage is correct', async () => {
    const { facts, decisions, draft } = makeDiscountDraft(57, 'x')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('formula')],
    })
  })

  it('returns the main-recomputed discount and deterministic formula in the hashable draft', async () => {
    const { facts, decisions, draft } = makeDiscountDraft(57)
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    const result = await generatePlan(facts, decisions)

    expect(validateShoppingPlanDraft(result)).toEqual({ valid: true, errors: [] })
    expect(result.claims[1]).toMatchObject({
      text: '정가 대비 57% 할인',
      formula: DISCOUNT_PERCENT_FORMULA,
    })
  })

  it('rejects LLM attempts to forge the user-confirmed A/B decisions', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.factDecisions[0].decision = 'excluded'
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('confirmed A/B')],
    })
  })

  it('rejects an LLM-dropped prohibitedClaims list without a durable store write', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.prohibitedClaims = []
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })
    let state = {
      ...defaultShoppingPlanState(),
      state: 'fact_review',
      snapshot: { sourceFacts: facts, ...decisions },
    }
    const store = {
      load: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (updater) => {
        const next = await updater(structuredClone(state))
        if (next) state = structuredClone(next)
        return structuredClone(state)
      }),
      save: vi.fn(),
    }
    const machine = createPlanMachine({
      store,
      deps: {
        fetchProduct: vi.fn(),
        generatePlan,
        materialize: vi.fn(),
        generate: vi.fn(),
        now: vi.fn(() => '2026-07-23T09:00:00.000Z'),
        randomUUID: vi.fn(() => 'operation-1'),
      },
    })
    const { projectToken } = await machine.open('/tmp/shopping-prohibited-coverage')
    store.update.mockClear()

    const result = await machine.draftPlan(projectToken)

    expect(result).toMatchObject({ error: 'plan-draft-invalid' })
    expect(store.update).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('rejects a claim linked to a fact ID that was never present in sanitized input', async () => {
    const { facts, decisions, draft } = makeDraft()
    facts.splice(2, 1)
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: expect.arrayContaining([expect.stringContaining('unknown source fact')]),
    })
  })

  it('fails closed before the LLM when confirmed A/B has an invalid decision', async () => {
    const { facts, decisions, draft } = makeDraft()
    decisions.factDecisions[0].decision = 'page-asserted'
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('confirmed A/B input')],
    })
    expect(llm.generateShoppingPlan).not.toHaveBeenCalled()
  })

  it('rejects over-limit A/B instead of silently truncating a user-confirmed prohibition', async () => {
    const { facts, decisions, draft } = makeDraft()
    decisions.prohibitedClaims[0].text = '금'.repeat(2001)
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('confirmed A/B input')],
    })
    expect(llm.generateShoppingPlan).not.toHaveBeenCalled()
  })

  it('fails closed before the LLM when a source-fact value contains a raw HTML document', async () => {
    const { facts, decisions, draft } = makeDraft()
    facts[0].value = RAW_HTML_SENTINEL
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('unknown source fact')],
    })
    expect(llm.generateShoppingPlan).not.toHaveBeenCalled()
  })

  it('returns plan-draft-invalid when an object result cannot represent strict JSON', async () => {
    const { facts, decisions } = makeDraft()
    const cyclic = {}
    cyclic.self = cyclic
    const llm = { generateShoppingPlan: vi.fn(async () => cyclic) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('JSON')],
    })
  })
})
