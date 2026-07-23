// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { shoppingAssets } from '../../../electron/shopping/assets/index.js'
import { createGeneratePlan } from '../../../electron/shopping/generatePlan.js'
import { validateShoppingPlanDraft } from '../../../electron/shopping/planSchema.js'

const RAW_HTML_SENTINEL = '<html><script>RAW_HTML_MUST_NOT_REACH_LLM</script></html>'

function personaPrompt(dialogue) {
  return `Presenter speaking in Korean, say exactly "${dialogue}", no ad-lib, no extra speech, no music, no captions, no on-screen text`
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
    facts[1].value = '가'.repeat(10_000)
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
