// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createUsageTracker } from '../../../electron/api/llm/usageTracker.js'
import { SHOPPING_PLAN_RESPONSE_SCHEMA } from '../../../electron/shopping/planSchema.js'
import { SHOPPING_PLAN_COPY_CONTRACT } from '../../../electron/shopping/shoppingPlanCopyContract.js'
import {
  DEFAULT_SHOPPING_LLM_MODEL,
  createGeminiShoppingLlm,
} from '../../../electron/shopping/shoppingLlmGemini.js'

function inputs() {
  return {
    facts: [{
      id: 'fact-name',
      field: 'name',
      value: '접지 상품명',
      sourceKind: 'dom',
      fetchedAt: '2026-07-30T09:00:00.000Z',
      verification: 'page-rendered',
      trust: 'untrusted-web-data',
    }],
    assets: {
      personaMapping: { sectionVersion: 'persona/1', digest: 'persona-digest', data: { categories: [] } },
      scriptTemplates: {
        sectionVersion: 'script/1',
        digest: 'script-digest',
        data: { templates: [], rules: { cta: '고정 안전 CTA' } },
      },
      qualityChecks: { sectionVersion: 'quality/1', digest: 'quality-digest', data: { planValidator: [] } },
      style: { sectionVersion: 'style/1', digest: 'style-digest', data: { id: 'shopping-ugc-presenter-v1' } },
    },
    constraints: {
      metaPrompt: 'STRICT SHOPPING META PROMPT',
      factDecisions: [{
        sourceFactId: 'fact-name',
        decision: 'allowed',
        confirmedAt: '2026-07-30T09:05:00.000Z',
      }],
      prohibitedClaims: [{ id: 'ban-1', text: '최고 성능', reason: '사용자 B 확정' }],
      planContext: {
        mode: 'crawl',
        snapshotId: 'snapshot-main-owned',
        selectedImageIds: ['image-main-owned'],
        product: { name: '접지 상품명', priceKrw: 19900, currency: 'KRW' },
      },
      targetHint: '30대 1인 가구',
      emphasis: '승인된 가격',
    },
  }
}

describe('createGeminiShoppingLlm', () => {
  it('facts/assets/A-B/planContext를 prompt에 넣고 strict draft와 usage를 반환한다', async () => {
    const { facts, assets, constraints } = inputs()
    const draft = { schemaVersion: 'shopping-plan/3-appnative' }
    const usageTracker = createUsageTracker()
    const signal = new AbortController().signal
    const jsonCall = vi.fn(async (_prompt, _opts, ctx) => {
      ctx.onUsage({ input: 321, output: 123 })
      return draft
    })
    const llm = createGeminiShoppingLlm({
      getApiKey: vi.fn(() => 'gemini-secret-key'),
      jsonCall,
      usageTracker,
      model: 'gemini-shopping-test',
    })

    await expect(llm.generateShoppingPlan(facts, assets, { ...constraints, signal }))
      .resolves.toBe(draft)

    expect(jsonCall).toHaveBeenCalledOnce()
    expect(jsonCall.mock.calls[0]).toHaveLength(3)
    const [prompt, opts, ctx] = jsonCall.mock.calls[0]
    expect(prompt).toContain('STRICT SHOPPING META PROMPT')
    expect(prompt).toContain('접지 상품명')
    expect(prompt).toContain('fact-name')
    expect(prompt).toContain('persona-digest')
    expect(prompt).toContain('script-digest')
    expect(prompt).toContain('quality-digest')
    expect(prompt).toContain('style-digest')
    expect(prompt).toContain('allowed')
    expect(prompt).toContain('최고 성능')
    expect(prompt).toContain('snapshot-main-owned')
    expect(prompt).toContain('image-main-owned')
    expect(prompt).toContain('30대 1인 가구')
    expect(prompt).toContain('승인된 가격')
    expect(prompt).toContain('exactly')
    expect(prompt).toContain('Emit exactly one product_identity claim')
    expect(prompt).toContain('Its text must equal "접지 상품명"')
    expect(prompt).toContain('sourceFactIds must equal ["fact-name"]')
    expect(prompt).toContain('Never emit another product name anywhere')
    expect(prompt).toContain('A brand mention must use an allowed brand sourceFact')
    expect(prompt).toContain('The one final CTA claim text must equal')
    expect(prompt).toContain('"고정 안전 CTA" exactly')
    expect(prompt).toContain('disclosure claim text must be exactly one of')
    expect(prompt).toContain('이 영상은 AI로 생성되었습니다.')
    expect(prompt).toContain('제휴 링크를 통해 수익을 얻을 수 있습니다.')
    expect(prompt).toContain('Never use any of these exact forbidden experience/social-proof phrases')
    expect(prompt).toContain('직접 확인해봤습니다')
    expect(prompt).toContain('첫 느낌')
    expect(prompt).toContain('문의가 많았습니다')
    expect(prompt).toContain("Every number there must already occur in that scene's claim text")
    expect(prompt).toContain(JSON.stringify(SHOPPING_PLAN_COPY_CONTRACT))
    expect(prompt).toContain(JSON.stringify(SHOPPING_PLAN_COPY_CONTRACT.personaVideoPromptTemplate))
    expect(prompt).toContain('Output JSON contract')
    expect(prompt).toContain(JSON.stringify(SHOPPING_PLAN_RESPONSE_SCHEMA))
    expect(prompt).toContain('"generationDurationSec":[0,4,6,8]')
    expect(prompt).toContain('"claimType"')
    expect(prompt).toContain('"derived_numeric"')
    expect(prompt).toContain('"sceneKey"')
    expect(prompt).toContain('"S08"')
    expect(prompt).toContain('draft.product must contain exactly mode, snapshotId, selectedImageIds')
    expect(prompt).toContain('planContext.product is grounding-only data')
    expect(prompt).toContain('derived_numeric is the only claimType that may contain formula')
    expect(prompt).toContain('scenes[index].sceneKey must equal S01 through S08 in array order')
    expect(prompt).toContain('product_still requires dialogueText="", generationDurationSec=0')
    expect(prompt).toContain('persona_i2v requires subtitleText===dialogueText')
    expect(prompt).toContain('4s<=18, 6s<=30, 8s<=42')
    expect(prompt).toContain('Every claim id must be referenced by exactly one scene')
    expect(prompt).toContain('consecutive product_still timelineDurationMs sum must be <=5000')
    expect(prompt).toContain('total timelineDurationMs sum must be <60000')
    expect(prompt).toContain('first 2000ms must contain')
    expect(prompt).toContain('CTA claim must overlap the final 3000ms')
    for (const field of [
      'reviewCount',
      'monthlyPurchaseCount',
      'listPriceKrw',
      'discountPercent',
      'deliveryType',
      'tomorrowDelivery',
      'brand',
      'category',
      'ratingValue',
    ]) {
      expect(prompt).toContain(field)
    }
    expect(prompt).toContain('first 2 seconds')
    expect(prompt).toContain('social-proof hook')
    expect(prompt).toContain('reviewCount or monthlyPurchaseCount')
    expect(prompt).toContain('price or derived-discount hook')
    expect(prompt).toContain('rocket or tomorrow-delivery convenience')
    expect(prompt).toContain('deliveryType and tomorrowDelivery are independent facts')
    expect(prompt).toContain('Use only facts whose sourceFactIds are allowed')
    expect(prompt).toContain('Copy every number exactly')
    expect(prompt).toContain('natural Korean sales dialogue')
    expect(prompt).toContain('Never use discountPercent as a direct numeric_fact')
    for (const values of Object.values(SHOPPING_PLAN_COPY_CONTRACT.visualDescriptions)) {
      for (const value of values) expect(prompt).toContain(value)
    }
    expect(prompt).not.toContain('gemini-secret-key')
    expect(opts).toEqual({ apiKey: 'gemini-secret-key', model: 'gemini-shopping-test' })
    expect(ctx.signal).toBe(signal)
    expect(ctx.onUsage).toEqual(expect.any(Function))
    expect(usageTracker.snapshot()).toEqual({ input: 321, output: 123 })
    expect(llm.getUsage()).toEqual({ input: 321, output: 123 })
  })

  it('저장된 Gemini 키가 없으면 전용 코드로 모델 호출 전에 실패한다', async () => {
    const { facts, assets, constraints } = inputs()
    const jsonCall = vi.fn()
    const llm = createGeminiShoppingLlm({
      getApiKey: vi.fn(() => null),
      jsonCall,
    })

    await expect(llm.generateShoppingPlan(facts, assets, constraints))
      .rejects.toMatchObject({ code: 'shopping-llm-key-missing' })
    expect(jsonCall).not.toHaveBeenCalled()
  })

  it('project-scoped usageTracker가 있으면 adapter fallback 대신 그 세션에 누산한다', async () => {
    const { facts, assets, constraints } = inputs()
    const fallbackTracker = createUsageTracker()
    const projectTracker = createUsageTracker()
    const jsonCall = vi.fn(async (_prompt, _opts, ctx) => {
      ctx.onUsage({ input: 20, output: 10 })
      return { schemaVersion: 'shopping-plan/3-appnative' }
    })
    const llm = createGeminiShoppingLlm({
      getApiKey: () => 'gemini-secret-key',
      jsonCall,
      usageTracker: fallbackTracker,
    })

    await llm.generateShoppingPlan(facts, assets, { ...constraints, usageTracker: projectTracker })

    expect(projectTracker.snapshot()).toEqual({ input: 20, output: 10 })
    expect(fallbackTracker.snapshot()).toEqual({ input: 0, output: 0 })
  })

  it('이미 중단된 signal이면 키 조회·모델 호출 전에 AbortError로 실패한다', async () => {
    const { facts, assets, constraints } = inputs()
    const controller = new AbortController()
    controller.abort(new DOMException('stop', 'AbortError'))
    const getApiKey = vi.fn(() => 'unused')
    const jsonCall = vi.fn()
    const llm = createGeminiShoppingLlm({ getApiKey, jsonCall })

    await expect(llm.generateShoppingPlan(facts, assets, {
      ...constraints,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(getApiKey).not.toHaveBeenCalled()
    expect(jsonCall).not.toHaveBeenCalled()
  })

  it('기본 모델은 라이브 generateContent가 가능한 Gemini 2.5 Flash로 고정한다', () => {
    expect(DEFAULT_SHOPPING_LLM_MODEL).toBe('gemini-3.6-flash')
  })
})
