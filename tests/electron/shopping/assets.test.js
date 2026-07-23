import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { canonicalStringify } from '../../../electron/shopping/planCanonical.js'
import {
  personaMapping,
  qualityChecks,
  scriptTemplates,
  shoppingAssets,
  style,
} from '../../../electron/shopping/assets/index.js'

const EXPECTED_ASSET_VERSION = 'shopping-assets/1'

function digestData(data) {
  return createHash('sha256').update(canonicalStringify(data), 'utf8').digest('hex')
}

describe('shopping app-owned prompt assets', () => {
  it.each([
    ['personaMapping', personaMapping, 'persona-mapping/1'],
    ['scriptTemplates', scriptTemplates, 'script-templates/1'],
    ['qualityChecks', qualityChecks, 'quality-checks/1'],
    ['style', style, 'style/1'],
  ])('stamps %s with versions and the canonical data digest', (_name, asset, sectionVersion) => {
    expect(asset).toEqual({
      assetVersion: EXPECTED_ASSET_VERSION,
      sectionVersion,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      data: expect.anything(),
    })
    expect(asset.digest).toBe(digestData(asset.data))

    const changed = structuredClone(asset.data)
    changed.__tampered = true
    expect(digestData(changed)).not.toBe(asset.digest)
  })

  it('exports the four fixed assets without accepting a path, URL, or skill name', () => {
    expect(shoppingAssets).toEqual({ personaMapping, scriptTemplates, qualityChecks, style })
    expect(Object.isFrozen(shoppingAssets)).toBe(true)
  })

  it('maps every category to one Korean presenter gender and one supported age band', () => {
    expect(personaMapping.data.categories.length).toBeGreaterThanOrEqual(14)
    for (const entry of personaMapping.data.categories) {
      expect(entry.category).toBeTypeOf('string')
      expect(['female', 'male']).toContain(entry.gender)
      expect(['20s', '30s', '40s', '50s', '60s']).toContain(entry.ageBand)
      expect(entry.ethnicity).toBe('Korean')
      expect(entry.requiresUserConfirmation).toBe(true)
      expect(entry.rationale).toBeTypeOf('string')
      expect(entry.rationale.length).toBeGreaterThan(0)
    }
  })

  it('contains only the two information-safe templates and no experience/social-proof wording', () => {
    expect(scriptTemplates.data.templates.map(({ id }) => id)).toEqual([
      'price-info-v1',
      'problem-info-v1',
    ])

    const executableText = scriptTemplates.data.templates
      .flatMap(({ structure, scenes }) => [structure, ...scenes.flatMap(Object.values)])
      .join('\n')
    expect(executableText).not.toMatch(/직접|써\s*봤|사용해\s*봤|첫\s*느낌|문의\s*(?:폭주|많)|전문가들이\s*다|후기/)
  })

  it('keeps quality instructions split into plan validation and M5 visual/dialogue review', () => {
    expect(qualityChecks.data.planValidator.length).toBeGreaterThan(0)
    expect(qualityChecks.data.m5Review.visual.length).toBeGreaterThan(0)
    expect(qualityChecks.data.m5Review.dialogue.length).toBeGreaterThan(0)
    const allChecks = JSON.stringify(qualityChecks.data)
    expect(allChecks).toContain('외국인 또는 무국적 외모')
    expect(allChecks).toContain('대표 상품을 태그 목록 첫 번째')
    expect(allChecks).toContain('현실적인 AI 생성 장면')
    expect(allChecks).toContain('쇼핑 콘텐츠에서 사용할 수 있는 음원')
  })

  it('uses a fixed app-native UGC prompt rather than a Higgsfield preset slug', () => {
    expect(style.data.id).toBe('shopping-ugc-presenter-v1')
    expect(style.data.prompt).toContain('9:16')
    expect(style.data.prompt).toContain('Korean')
    expect(style.data.prompt).not.toMatch(/Higgsfield|preset|slug/i)
  })
})
