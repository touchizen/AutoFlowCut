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
    const structuredCall = vi.fn(async (_prompt, _schema, _opts, ctx) => {
      ctx.onUsage({ input: 321, output: 123 })
      return draft
    })
    const llm = createGeminiShoppingLlm({
      getApiKey: vi.fn(() => 'gemini-secret-key'),
      structuredCall,
      usageTracker,
      model: 'gemini-shopping-test',
    })

    await expect(llm.generateShoppingPlan(facts, assets, { ...constraints, signal }))
      .resolves.toBe(draft)

    expect(structuredCall).toHaveBeenCalledOnce()
    const [prompt, schema, opts, ctx] = structuredCall.mock.calls[0]
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
    expect(prompt).toContain('Never emit another product or brand name anywhere')
    expect(prompt).toContain('The one final CTA claim text must equal')
    expect(prompt).toContain('"고정 안전 CTA" exactly')
    expect(prompt).toContain("Every number there must already occur in that scene's claim text")
    expect(prompt).toContain(JSON.stringify(SHOPPING_PLAN_COPY_CONTRACT))
    expect(prompt).toContain(JSON.stringify(SHOPPING_PLAN_COPY_CONTRACT.personaVideoPromptTemplate))
    for (const values of Object.values(SHOPPING_PLAN_COPY_CONTRACT.visualDescriptions)) {
      for (const value of values) expect(prompt).toContain(value)
    }
    expect(prompt).not.toContain('gemini-secret-key')
    expect(schema).toBe(SHOPPING_PLAN_RESPONSE_SCHEMA)
    expect(opts).toEqual({ apiKey: 'gemini-secret-key', model: 'gemini-shopping-test' })
    expect(ctx.signal).toBe(signal)
    expect(ctx.onUsage).toEqual(expect.any(Function))
    expect(usageTracker.snapshot()).toEqual({ input: 321, output: 123 })
    expect(llm.getUsage()).toEqual({ input: 321, output: 123 })
  })

  it('저장된 Gemini 키가 없으면 전용 코드로 모델 호출 전에 실패한다', async () => {
    const { facts, assets, constraints } = inputs()
    const structuredCall = vi.fn()
    const llm = createGeminiShoppingLlm({
      getApiKey: vi.fn(() => null),
      structuredCall,
    })

    await expect(llm.generateShoppingPlan(facts, assets, constraints))
      .rejects.toMatchObject({ code: 'shopping-llm-key-missing' })
    expect(structuredCall).not.toHaveBeenCalled()
  })

  it('project-scoped usageTracker가 있으면 adapter fallback 대신 그 세션에 누산한다', async () => {
    const { facts, assets, constraints } = inputs()
    const fallbackTracker = createUsageTracker()
    const projectTracker = createUsageTracker()
    const structuredCall = vi.fn(async (_prompt, _schema, _opts, ctx) => {
      ctx.onUsage({ input: 20, output: 10 })
      return { schemaVersion: 'shopping-plan/3-appnative' }
    })
    const llm = createGeminiShoppingLlm({
      getApiKey: () => 'gemini-secret-key',
      structuredCall,
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
    const structuredCall = vi.fn()
    const llm = createGeminiShoppingLlm({ getApiKey, structuredCall })

    await expect(llm.generateShoppingPlan(facts, assets, {
      ...constraints,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(getApiKey).not.toHaveBeenCalled()
    expect(structuredCall).not.toHaveBeenCalled()
  })

  it('기본 모델은 품질 우선 Gemini 2.5 Pro로 고정한다', () => {
    expect(DEFAULT_SHOPPING_LLM_MODEL).toBe('gemini-2.5-pro')
  })
})
