// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { shoppingAssets } from '../../../electron/shopping/assets/index.js'
import { createGeneratePlan } from '../../../electron/shopping/generatePlan.js'
import { createPlanMachine } from '../../../electron/shopping/planMachine.js'
import { validateShoppingPlanDraft } from '../../../electron/shopping/planSchema.js'
import { createGeminiShoppingLlm } from '../../../electron/shopping/shoppingLlmGemini.js'
import { defaultShoppingPlanState } from '../../../electron/shopping/shoppingPlanStore.js'

const RAW_HTML_SENTINEL = '<html><script>RAW_HTML_MUST_NOT_REACH_LLM</script></html>'
const DISCOUNT_PERCENT_FORMULA = 'round((listPriceKrw-priceKrw)/listPriceKrw*100)'
const SAFE_CTA_TEXT = shoppingAssets.scriptTemplates.data.rules.cta

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

function setGroundedPrice(value, priceKrw = 29800) {
  value.facts[1].field = 'priceKrw'
  value.facts[1].value = priceKrw
  value.draft.claims[1].claimType = 'numeric_fact'
  setClaimText(value.draft, 1, `판매가는 ${priceKrw.toLocaleString('en-US')}원`)
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
    text: index === 0
      ? '승인 상품명'
      : index === 4 ? SAFE_CTA_TEXT : `승인 정보 ${index + 1}`,
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

function planContextFor(facts, overrides = {}) {
  const product = {}
  for (const field of ['name', 'priceKrw', 'listPriceKrw', 'discountPercent', 'currency']) {
    const fact = facts.find((candidate) => candidate.field === field)
    if (fact) product[field] = fact.value
  }
  return {
    mode: 'crawl',
    snapshotId: 'snapshot-1',
    selectedImageIds: ['image-1'],
    product,
    ...overrides,
  }
}

function createGroundedGeneratePlan({ llm }) {
  const generatePlan = createGeneratePlan({ llm })
  return (facts, decisions, options = {}) => generatePlan(facts, decisions, {
    planContext: planContextFor(facts),
    ...options,
  })
}

describe('createGeneratePlan', () => {
  it('Gemini JSON mode adapter의 정상 object가 strict 접지 게이트를 통과한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    const jsonCall = vi.fn(async () => structuredClone(draft))
    const llm = createGeminiShoppingLlm({ getApiKey: () => 'test-key', jsonCall })
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toEqual(draft)
    expect(jsonCall).toHaveBeenCalledOnce()
  })

  it('Gemini JSON mode adapter가 반환한 날조 이미지 ID도 strict 접지 게이트가 거부한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.scenes[0].productImageId = 'image-invented-in-json-mode'
    const llm = createGeminiShoppingLlm({
      getApiKey: () => 'test-key',
      jsonCall: vi.fn(async () => structuredClone(draft)),
    })
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: ['scene references unknown product image image-invented-in-json-mode'],
    })
  })

  it('Gemini JSON mode adapter의 부분 JSON object는 strict gates가 안전 거부한다', async () => {
    const { facts, decisions } = makeDraft()
    const llm = createGeminiShoppingLlm({
      getApiKey: () => 'test-key',
      jsonCall: vi.fn(async () => ({ schemaVersion: 'shopping-plan/3-appnative' })),
    })
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: expect.arrayContaining([expect.stringContaining('product')]),
    })
  })

  it('main-owned planContext가 없으면 모델 호출 전에 fail closed한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('planContext')],
    })
    expect(llm.generateShoppingPlan).not.toHaveBeenCalled()
  })

  it('planContext를 sanitize해 모델에 전달하고 main product/sourceFacts 정합을 확인한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    const result = await generatePlan(facts, decisions, {
      planContext: {
        ...planContextFor(facts),
        product: {
          name: '승인 상품명',
          ignoredRendererField: 'must-not-reach-model',
        },
        rendererOnly: 'must-not-reach-model',
      },
    })

    expect(validateShoppingPlanDraft(result)).toEqual({ valid: true, errors: [] })
    const constraints = llm.generateShoppingPlan.mock.calls[0][2]
    expect(constraints.planContext).toEqual({
      mode: 'crawl',
      snapshotId: 'snapshot-1',
      selectedImageIds: ['image-1'],
      product: { name: '승인 상품명' },
    })
    expect(JSON.stringify(constraints)).not.toContain('must-not-reach-model')
  })

  it('main-owned project usageTracker만 모델 constraints에 전달한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    const usageTracker = { addDelta: vi.fn(), snapshot: vi.fn(() => ({ input: 0, output: 0 })) }
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await generatePlan(facts, decisions, {
      planContext: planContextFor(facts),
      usageTracker,
    })

    expect(llm.generateShoppingPlan.mock.calls[0][2].usageTracker).toBe(usageTracker)
  })

  it('planContext와 sourceFacts의 main-owned 상품 기본정보가 다르면 모델 전에 거부한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions, {
      planContext: planContextFor(facts, { product: { name: '날조 상품명' } }),
    })).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('planContext.product.name')],
    })
    expect(llm.generateShoppingPlan).not.toHaveBeenCalled()
  })

  it('모델이 planContext 밖 productImageId를 쓰면 전용 접지 오류로 거부한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.scenes[0].productImageId = 'image-invented-by-model'
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: ['scene references unknown product image image-invented-by-model'],
    })
  })

  it('모델이 draft.product selectedImageIds에 가짜 ID를 섞어도 context equality가 막는다', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.product.selectedImageIds = ['image-1', 'image-invented-by-model']
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('product must preserve planContext')],
    })
  })

  it('product_identity claim이 planContext의 admitted name을 바꾸면 거부한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    setClaimText(draft, 0, '모델이 만든 다른 상품명')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('product identity')],
    })
  })

  it('planContext 가격과 다른 numeric claim을 draft에 만들면 거부한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    facts[1].field = 'priceKrw'
    facts[1].value = 29800
    draft.claims[1].claimType = 'numeric_fact'
    setClaimText(draft, 1, '판매가는 39,800원')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('numeric tokens')],
    })
  })

  it('sourceFactIds가 빈 CTA로 planContext 밖 가격을 우회해도 고정 안전 문구 게이트가 거부한다', async () => {
    const { facts, decisions, draft } = setGroundedPrice(makeDraft())
    setClaimText(draft, 4, '39,800원에 지금 구매하세요')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('fixed safe CTA')],
    })
  })

  it('editorial_fit으로 relabel한 날조 가격도 numeric grounding이 거부한다', async () => {
    const { facts, decisions, draft } = setGroundedPrice(makeDraft())
    draft.claims[1].claimType = 'editorial_fit'
    setClaimText(draft, 1, '39,800원이라 잘 맞습니다')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('numeric tokens')],
    })
  })

  it('날조 상품명을 page_fact로 relabel해 product_identity 게이트를 우회해도 거부한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.claims[0].claimType = 'page_fact'
    setClaimText(draft, 0, '모델이 만든 다른 상품명')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('product identity')],
    })
  })

  it('정상 product_identity를 남겨도 다른 claim에 비숫자 가짜 브랜드를 넣으면 거부한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    setClaimText(draft, 1, '날조브랜드가 편리해요')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('copy is not grounded')],
    })
  })

  it('supplied script template의 placeholder를 정확한 fact 값으로 채운 카피는 허용한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    setClaimText(draft, 2, '상품 정보에는 승인 정보 3이 제시되어 있습니다.')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toEqual(draft)
  })

  it('정확한 identity를 남겨도 source-free CTA에 다른 상품명을 넣으면 거부한다', async () => {
    const { facts, decisions, draft } = makeDraft()
    setClaimText(draft, 4, '날조 브랜드 지금 구매하세요')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('fixed safe CTA')],
    })
  })

  it('scene visualDescription에 planContext 밖 숫자를 숨겨도 거부한다', async () => {
    const { facts, decisions, draft } = setGroundedPrice(makeDraft())
    draft.scenes[0].visualDescription = '39,800원 상품을 크게 보여준다'
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('visualDescription numeric tokens')],
    })
  })

  it('scene videoPrompt에 planContext 밖 숫자를 숨겨도 거부한다', async () => {
    const { facts, decisions, draft } = setGroundedPrice(makeDraft())
    draft.scenes[1].videoPrompt += ', show an invented 39800 price tag'
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('videoPrompt numeric tokens')],
    })
  })

  it.each([
    ['visualDescription', 0, '날조브랜드 제품 클로즈업'],
    ['videoPrompt', 1, `${personaPrompt('승인 정보 2')}, featuring FakeBrand`],
  ])('scene %s에 비숫자 가짜 브랜드를 숨겨도 거부한다', async (field, sceneIndex, text) => {
    const { facts, decisions, draft } = makeDraft()
    draft.scenes[sceneIndex][field] = text
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining(`${field} must use controlled copy`)],
    })
  })

  it.each([
    ['visualDescription', 0, '30원 상품을 보여준다'],
    ['videoPrompt', 1, 'Presenter speaking in Korean, say exactly "판매가는 29,800원", no ad-lib, no extra speech, no music, no captions, no on-screen text, show a 4원 price tag'],
  ])('production 숫자와 충돌하는 %s의 날조 가격도 거부한다', async (field, sceneIndex, text) => {
    const { facts, decisions, draft } = setGroundedPrice(makeDraft())
    draft.scenes[sceneIndex][field] = text
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining(`${field} numeric tokens`)],
    })
  })

  it('round-trips a CDP DOM/page-rendered snapshot through A/B decisions and draft validation', async () => {
    const { facts, decisions, draft } = makeDraft()
    for (const fact of facts) {
      fact.sourceKind = 'dom'
      fact.verification = 'page-rendered'
      fact.jsonPathOrProperty = `document:${fact.field}`
    }
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })
    let state = defaultShoppingPlanState()
    const store = {
      load: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (updater) => {
        const next = await updater(structuredClone(state))
        if (next) state = structuredClone(next)
        return structuredClone(state)
      }),
    }
    const snapshot = {
      status: 'ok',
      snapshotId: 'snapshot-1',
      product: { name: '승인 상품명' },
      sourceFacts: facts,
      images: [{ id: 'image-1' }],
      selectedImageIds: ['image-1'],
    }
    const machine = createPlanMachine({
      store,
      deps: {
        fetchProduct: vi.fn(async () => snapshot),
        generatePlan,
        materialize: vi.fn(),
        generate: vi.fn(),
        now: vi.fn(() => '2026-07-23T09:00:00.000Z'),
        randomUUID: vi.fn(() => 'operation-1'),
      },
    })
    const { projectToken } = await machine.open('/tmp/shopping-dom-provenance')

    await expect(machine.submitProduct(projectToken, 'https://www.coupang.com/vp/products/1'))
      .resolves.toMatchObject({ ok: true })
    await expect(machine.setFactDecisions(
      projectToken,
      decisions.factDecisions,
      decisions.prohibitedClaims,
    )).resolves.toMatchObject({ ok: true })
    await expect(machine.draftPlan(projectToken)).resolves.toMatchObject({ ok: true })

    expect(llm.generateShoppingPlan).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'dom', verification: 'page-rendered' }),
      ]),
      shoppingAssets,
      expect.objectContaining({ factDecisions: decisions.factDecisions }),
    )
    await expect(machine.getState()).resolves.toMatchObject({
      state: 'plan_review',
      snapshot: {
        schemaVersion: 'shopping-plan/3-appnative',
        factDecisions: decisions.factDecisions,
        prohibitedClaims: decisions.prohibitedClaims,
      },
    })
  })

  it('keeps fact_review when a fake LLM returns a claim grounded to no admitted source fact', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.claims[1].sourceFactIds = ['fact-invented-by-model']
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })
    let state = defaultShoppingPlanState()
    const store = {
      load: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (updater) => {
        const next = await updater(structuredClone(state))
        if (next) state = structuredClone(next)
        return structuredClone(state)
      }),
    }
    const machine = createPlanMachine({
      store,
      deps: {
        fetchProduct: vi.fn(async () => ({
          status: 'ok',
          snapshotId: 'snapshot-1',
          product: { name: '승인 상품명' },
          sourceFacts: facts,
          images: [{ id: 'image-1' }],
          selectedImageIds: ['image-1'],
        })),
        generatePlan,
        materialize: vi.fn(),
        generate: vi.fn(),
        now: vi.fn(() => '2026-07-23T09:00:00.000Z'),
        randomUUID: vi.fn(() => 'operation-1'),
      },
    })
    const { projectToken } = await machine.open('/tmp/shopping-unknown-claim-grounding')
    await machine.submitProduct(projectToken, 'https://www.coupang.com/vp/products/1')
    await machine.setFactDecisions(projectToken, decisions.factDecisions, decisions.prohibitedClaims)

    await expect(machine.draftPlan(projectToken)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: expect.arrayContaining([expect.stringContaining('missing fact decision')]),
    })
    expect(llm.generateShoppingPlan).toHaveBeenCalledOnce()
    await expect(machine.getState()).resolves.toMatchObject({ state: 'fact_review' })
  })

  it('does not auto-allow a page-rendered fact when the user excludes it', async () => {
    const { facts, decisions, draft } = makeDraft()
    facts[0].sourceKind = 'dom'
    facts[0].verification = 'page-rendered'
    decisions.factDecisions[0].decision = 'excluded'
    draft.factDecisions[0].decision = 'excluded'
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: expect.arrayContaining([expect.stringContaining('references excluded fact')]),
    })
  })

  it('passes only bounded source facts, fixed assets, and confirmed A/B constraints to the LLM', async () => {
    const { facts, decisions, draft } = makeDraft()
    facts[0].rawHtml = RAW_HTML_SENTINEL
    facts[0].body = Buffer.from('forbidden bytes')
    facts[2].value = `3${'가'.repeat(9_999)}`
    setClaimText(draft, 2, facts[2].value.slice(0, 2000))
    facts[2].jsonPathOrProperty = RAW_HTML_SENTINEL
    const llm = {
      generateShoppingPlan: vi.fn(async () => JSON.stringify(draft)),
    }
    const generatePlan = createGroundedGeneratePlan({ llm })
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
    expect(sanitizedFacts[2].value.length).toBeLessThanOrEqual(2000)
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
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('JSON')],
    })
  })

  it('returns plan-draft-invalid for a strict schema failure', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.extra = 'not allowed'
    const llm = { generateShoppingPlan: vi.fn(async () => JSON.stringify(draft)) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: expect.arrayContaining([expect.stringContaining('$.extra is not allowed')]),
    })
  })

  it('rejects an LLM claim without an allowed D4 source-fact connection', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.claims[1].sourceFactIds = []
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

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
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('numeric tokens')],
    })
  })

  it('rejects a derived discount whose claimed percentage disagrees with main recomputation', async () => {
    const { facts, decisions, draft } = makeDiscountDraft(87)
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('derived_numeric')],
    })
  })

  it('rejects a non-deterministic derived formula even when the claimed percentage is correct', async () => {
    const { facts, decisions, draft } = makeDiscountDraft(57, 'x')
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('formula')],
    })
  })

  it('returns the main-recomputed discount and deterministic formula in the hashable draft', async () => {
    const { facts, decisions, draft } = makeDiscountDraft(57)
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

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
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('confirmed A/B')],
    })
  })

  it('rejects an LLM-dropped prohibitedClaims list without a durable store write', async () => {
    const { facts, decisions, draft } = makeDraft()
    draft.prohibitedClaims = []
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })
    let state = {
      ...defaultShoppingPlanState(),
      state: 'fact_review',
      snapshot: {
        status: 'ok',
        snapshotId: 'snapshot-1',
        product: { name: '승인 상품명' },
        sourceFacts: facts,
        images: [{ id: 'image-1' }],
        selectedImageIds: ['image-1'],
        ...decisions,
      },
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

    expect(result).toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('confirmed A/B')],
    })
    expect(llm.generateShoppingPlan).toHaveBeenCalledOnce()
    expect(store.update).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('rejects a claim linked to a fact ID that was never present in sanitized input', async () => {
    const { facts, decisions, draft } = makeDraft()
    facts.splice(2, 1)
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: expect.arrayContaining([expect.stringContaining('unknown source fact')]),
    })
  })

  it('fails closed before the LLM when confirmed A/B has an invalid decision', async () => {
    const { facts, decisions, draft } = makeDraft()
    decisions.factDecisions[0].decision = 'page-asserted'
    const llm = { generateShoppingPlan: vi.fn(async () => draft) }
    const generatePlan = createGroundedGeneratePlan({ llm })

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
    const generatePlan = createGroundedGeneratePlan({ llm })

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
    const generatePlan = createGroundedGeneratePlan({ llm })

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
    const generatePlan = createGroundedGeneratePlan({ llm })

    await expect(generatePlan(facts, decisions)).resolves.toMatchObject({
      error: 'plan-draft-invalid',
      validationErrors: [expect.stringContaining('JSON')],
    })
  })
})
