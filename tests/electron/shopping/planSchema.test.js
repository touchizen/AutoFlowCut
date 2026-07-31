// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  SHOPPING_PLAN_RESPONSE_SCHEMA,
  countNonWhitespaceGraphemes,
  normalizeClaimCoverageText,
  validateShoppingPlanDraft,
} from '../../../electron/shopping/planSchema.js'
import { computePlanHash } from '../../../electron/shopping/planCanonical.js'

const PROMPT_PHRASES = [
  'speaking in Korean',
  'say exactly',
  'no ad-lib',
  'no extra speech',
  'no music',
  'no captions',
  'no on-screen text',
]

const SECURITY_IGNORABLES = [
  ['ZWSP U+200B', '\u200B'],
  ['ZWNJ U+200C', '\u200C'],
  ['WORD JOINER U+2060', '\u2060'],
  ['BOM U+FEFF', '\uFEFF'],
  ['HANGUL FILLER U+3164', '\u3164'],
]

describe('SHOPPING_PLAN_RESPONSE_SCHEMA', () => {
  it('runtime draft 계약의 top-level과 모든 strict object key를 그대로 기술한다', () => {
    const schema = SHOPPING_PLAN_RESPONSE_SCHEMA
    const topLevelKeys = [
      'schemaVersion',
      'product',
      'factDecisions',
      'prohibitedClaims',
      'persona',
      'creative',
      'generation',
      'claims',
      'scenes',
    ]

    expect(schema.type).toBe('OBJECT')
    expect(Object.keys(schema.properties)).toEqual(topLevelKeys)
    expect(schema.required).toEqual(topLevelKeys)

    const product = schema.properties.product
    expect(product.type).toBe('OBJECT')
    expect(product).not.toHaveProperty('anyOf')
    expect(Object.keys(product.properties)).toEqual(['mode', 'snapshotId', 'selectedImageIds'])
    expect(product.required).toEqual(['mode', 'snapshotId', 'selectedImageIds'])
    expect(product.properties.mode.enum).toEqual(['crawl'])

    expect(Object.keys(schema.properties.persona.properties)).toEqual([
      'id', 'name', 'role', 'gender', 'ageBand', 'ethnicity', 'appearance',
    ])
    expect(Object.keys(schema.properties.generation.properties)).toEqual([
      'provider', 'imageModel', 'videoModel', 'aspectRatio', 'videoResolution',
      'videoSeedBase', 'speechMode', 'productStillAudio', 'subtitleTiming',
      'dialoguePolicyVersion',
    ])
    expect(Object.keys(schema.properties.claims.items.properties)).toEqual([
      'id', 'text', 'claimType', 'sourceFactIds', 'formula',
    ])
    expect(schema.properties.claims.items.required).toEqual([
      'id', 'text', 'claimType', 'sourceFactIds',
    ])
    expect(Object.keys(schema.properties.scenes.items.properties)).toEqual([
      'sceneKey', 'visualType', 'visualDescription', 'productImageId',
      'dialogueText', 'subtitleText', 'claimIds', 'timelineDurationMs',
      'generationDurationSec', 'trim', 'videoPrompt',
    ])
    expect(schema.properties.scenes.items.required)
      .toEqual(Object.keys(schema.properties.scenes.items.properties))
  })

  it('validator의 enum·scene count·nullable trim 계약을 보존된 prompt-shape에도 고정한다', () => {
    const schema = SHOPPING_PLAN_RESPONSE_SCHEMA
    const scene = schema.properties.scenes.items.properties

    expect(schema.properties.schemaVersion.enum).toEqual(['shopping-plan/3-appnative'])
    expect(schema.properties.scenes).toMatchObject({ minItems: 5, maxItems: 8 })
    expect(scene.sceneKey.enum).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08'])
    expect(scene.visualType.enum).toEqual(['product_still', 'persona_i2v'])
    expect(scene.generationDurationSec).toEqual({ type: 'INTEGER' })
    expect(scene.trim).toMatchObject({ type: 'OBJECT', nullable: true })
    expect(schema.properties.persona.properties.ethnicity.enum).toEqual(['Korean'])
    expect(schema.properties.claims.items.properties.claimType.enum).toEqual([
      'product_identity', 'page_fact', 'numeric_fact', 'derived_numeric',
      'editorial_fit', 'cta', 'disclosure',
    ])
  })

  it('후속 serving-limit 재검토용 legacy schema는 호환 가능한 문자열 enum만 보존한다', () => {
    const visit = (schema) => {
      if (!schema || typeof schema !== 'object') return
      expect(schema.type).toEqual(expect.any(String))
      if (schema.enum) expect(schema.enum.every((value) => typeof value === 'string')).toBe(true)
      for (const child of Object.values(schema.properties || {})) visit(child)
      visit(schema.items)
    }

    expect(JSON.stringify(SHOPPING_PLAN_RESPONSE_SCHEMA)).not.toContain('anyOf')
    visit(SHOPPING_PLAN_RESPONSE_SCHEMA)
  })
})

function personaPrompt(dialogue) {
  return `Presenter ${PROMPT_PHRASES[0]}, ${PROMPT_PHRASES[1]} "${dialogue}", ${PROMPT_PHRASES.slice(2).join(', ')}`
}

function makeCrawlShapePlan(sceneCount = 5) {
  const claims = []
  const factDecisions = []
  const scenes = []

  for (let index = 0; index < sceneCount; index += 1) {
    const ordinal = index + 1
    const isLast = index === sceneCount - 1
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

function makeManualPlan(sceneCount = 5) {
  const plan = makeCrawlShapePlan(sceneCount)
  plan.product = {
    mode: 'manual',
    title: '수동 입력 상품',
    sku: 'MANUAL-1',
    sourceUrl: 'https://example.com/product/1',
    facts: plan.factDecisions.map(({ sourceFactId }, index) => ({
      id: sourceFactId,
      field: index === 0 ? 'name' : 'description',
      value: `수동 사실 ${index + 1}`,
      sourceKind: 'manual',
      sourceUrl: 'https://example.com/product/1',
      fetchedAt: '2026-07-23T01:00:00.000Z',
      verification: 'user-asserted',
      trust: 'untrusted-web-data',
    })),
    attachmentIds: ['image-1'],
  }
  return plan
}

// Generic schema tests use self-contained manual facts. The crawl-shaped helper above is
// limited to product-shape assertions because this validator has no snapshot to ground IDs.
function makePlan(sceneCount = 5) {
  return makeManualPlan(sceneCount)
}

function result(plan) {
  return validateShoppingPlanDraft(plan)
}

function expectValid(plan) {
  const validation = result(plan)
  expect(validation.errors).toEqual([])
  expect(validation.valid).toBe(true)
}

function expectInvalid(plan, messagePart) {
  const validation = result(plan)
  expect(validation.valid).toBe(false)
  expect(validation.errors.join('\n')).toContain(messagePart)
}

function setPersonaScene(plan, index, durationSec = 4) {
  const scene = plan.scenes[index]
  scene.visualType = 'persona_i2v'
  scene.dialogueText = scene.subtitleText
  scene.generationDurationSec = durationSec
  scene.timelineDurationMs = durationSec * 1000
  scene.trim = { startMs: 0, endMs: durationSec * 1000 }
  scene.videoPrompt = personaPrompt(scene.dialogueText)
}

function setPersonaDialogue(plan, index, text) {
  const scene = plan.scenes[index]
  const claim = plan.claims.find(({ id }) => id === scene.claimIds[0])
  scene.dialogueText = text
  scene.subtitleText = text
  scene.videoPrompt = personaPrompt(text)
  claim.text = text
}

describe('validateShoppingPlanDraft — schema', () => {
  it.each([5, 8])('accepts the scene-count boundary %i', (sceneCount) => {
    expectValid(makePlan(sceneCount))
  })

  it.each([4, 9])('rejects the scene-count value %i', (sceneCount) => {
    expectInvalid(makePlan(sceneCount), 'scenes must contain 5..8 items')
  })

  it('accepts a strict manual product with typed source facts', () => {
    expectValid(makeManualPlan())
  })

  it('accepts honest DOM/page-rendered source-fact provenance', () => {
    const plan = makeManualPlan()
    plan.product.facts[0].sourceKind = 'dom'
    plan.product.facts[0].verification = 'page-rendered'

    expectValid(plan)
  })

  const unknownKeyMutations = [
    ['root', (plan) => { plan.currentPlanHash = 'caller-hash' }, '$.currentPlanHash'],
    ['crawl product', (plan) => { plan.product.title = 'unknown here' }, '$.product.title'],
    ['fact decision', (plan) => { plan.factDecisions[0].note = 'unknown' }, '$.factDecisions[0].note'],
    ['prohibited claim', (plan) => { plan.prohibitedClaims[0].source = 'unknown' }, '$.prohibitedClaims[0].source'],
    ['persona', (plan) => { plan.persona.extra = true }, '$.persona.extra'],
    ['creative', (plan) => { plan.creative.version = 'unknown' }, '$.creative.version'],
    ['generation imageSeed', (plan) => { plan.generation.imageSeed = 123 }, '$.generation.imageSeed'],
    ['claim', (plan) => { plan.claims[0].evidence = 'unknown' }, '$.claims[0].evidence'],
    ['scene', (plan) => { plan.scenes[0].startMs = 0 }, '$.scenes[0].startMs'],
    ['trim', (plan) => { plan.scenes[1].trim.sourceEndMs = 4000 }, '$.scenes[1].trim.sourceEndMs'],
    ['manual source fact', (plan) => { plan.product.facts[0].raw = 'unknown' }, '$.product.facts[0].raw'],
  ]

  it.each(unknownKeyMutations)('rejects additionalProperties at %s', (_label, mutate, path) => {
    const plan = _label === 'crawl product' ? makeCrawlShapePlan() : makePlan()
    mutate(plan)
    expectInvalid(plan, `${path} is not allowed`)
  })

  it.each([
    ['schemaVersion', (plan) => { plan.schemaVersion = 'shopping-plan/2' }],
    ['persona role', (plan) => { plan.persona.role = 'narrator' }],
    ['persona gender', (plan) => { plan.persona.gender = 'other' }],
    ['persona ethnicity', (plan) => { plan.persona.ethnicity = 'Unknown' }],
    ['template', (plan) => { plan.creative.templateId = 'review-v1' }],
    ['provider', (plan) => { plan.generation.provider = 'other' }],
    ['video model', (plan) => { plan.generation.videoModel = 'veo-other' }],
    ['speech mode', (plan) => { plan.generation.speechMode = 'tts' }],
  ])('rejects an invalid fixed enum: %s', (_label, mutate) => {
    const plan = makePlan()
    mutate(plan)
    expectInvalid(plan, 'must be')
  })

  it('requires non-empty IDs and persona strings', () => {
    const plan = makePlan()
    plan.persona.id = ' '
    plan.persona.name = ''
    plan.persona.appearance = '\t'
    expectInvalid(plan, '$.persona.id must be a non-empty string')
    expectInvalid(plan, '$.persona.name must be a non-empty string')
    expectInvalid(plan, '$.persona.appearance must be a non-empty string')
  })

  it.each([
    ['selected image minimum', (plan) => { plan.product.selectedImageIds = [] }],
    ['selected image maximum', (plan) => { plan.product.selectedImageIds = Array.from({ length: 6 }, (_, i) => `image-${i}`) }],
    ['manual facts minimum', (plan) => { plan.product.facts = [] }],
    ['manual facts maximum', (plan) => { plan.product.facts = Array.from({ length: 31 }, (_, i) => ({ ...plan.product.facts[0], id: `f-${i}` })) }],
    ['attachment minimum', (plan) => { plan.product.attachmentIds = [] }],
    ['attachment maximum', (plan) => { plan.product.attachmentIds = Array.from({ length: 6 }, (_, i) => `a-${i}`) }],
  ])('enforces product array bounds: %s', (label, mutate) => {
    const plan = label.startsWith('selected') ? makeCrawlShapePlan() : makePlan()
    mutate(plan)
    expectInvalid(plan, 'must contain')
  })

  it('rejects duplicate scene keys and claim IDs', () => {
    const plan = makePlan()
    plan.scenes[1].sceneKey = plan.scenes[0].sceneKey
    plan.claims[1].id = plan.claims[0].id
    expectInvalid(plan, 'duplicate sceneKey')
    expectInvalid(plan, 'duplicate claim id')
  })

  it('requires ordered S01.. scene keys', () => {
    const plan = makePlan()
    plan.scenes[1].sceneKey = 'S09'
    expectInvalid(plan, '$.scenes[1].sceneKey must be S02')
  })

  it('requires every scene productImageId to refer to a selected image or attachment', () => {
    const plan = makePlan()
    plan.scenes[2].productImageId = 'image-not-selected'
    expectInvalid(plan, '$.scenes[2].productImageId must reference a selected product image')
  })

  const nonCanonicalIdOrEnumMutations = [
    ['schemaVersion', makePlan, (plan) => { plan.schemaVersion += ' ' }, '$.schemaVersion'],
    ['product mode', makePlan, (plan) => { plan.product.mode += ' ' }, '$.product.mode'],
    ['snapshotId', makeCrawlShapePlan, (plan) => { plan.product.snapshotId = ` ${plan.product.snapshotId}` }, '$.product.snapshotId'],
    ['selectedImageIds item', makeCrawlShapePlan, (plan) => { plan.product.selectedImageIds[0] += ' ' }, '$.product.selectedImageIds[0]'],
    ['manual SKU', makeManualPlan, (plan) => { plan.product.sku = `\t${plan.product.sku}` }, '$.product.sku'],
    ['manual source fact id', makeManualPlan, (plan) => { plan.product.facts[0].id += ' ' }, '$.product.facts[0].id'],
    ['manual source fact field', makeManualPlan, (plan) => { plan.product.facts[0].field = ` ${plan.product.facts[0].field}` }, '$.product.facts[0].field'],
    ['manual sourceKind', makeManualPlan, (plan) => { plan.product.facts[0].sourceKind += ' ' }, '$.product.facts[0].sourceKind'],
    ['attachmentIds item', makeManualPlan, (plan) => { plan.product.attachmentIds[0] += ' ' }, '$.product.attachmentIds[0]'],
    ['fact decision sourceFactId', makePlan, (plan) => { plan.factDecisions[0].sourceFactId += ' ' }, '$.factDecisions[0].sourceFactId'],
    ['fact decision enum', makePlan, (plan) => { plan.factDecisions[0].decision = ` ${plan.factDecisions[0].decision}` }, '$.factDecisions[0].decision'],
    ['prohibited claim id', makePlan, (plan) => { plan.prohibitedClaims[0].id += '\t' }, '$.prohibitedClaims[0].id'],
    ['persona id', makePlan, (plan) => { plan.persona.id = ` ${plan.persona.id}` }, '$.persona.id'],
    ['persona enum', makePlan, (plan) => { plan.persona.gender += ' ' }, '$.persona.gender'],
    ['creative templateId', makePlan, (plan) => { plan.creative.templateId += ' ' }, '$.creative.templateId'],
    ['generation provider', makePlan, (plan) => { plan.generation.provider = `\t${plan.generation.provider}` }, '$.generation.provider'],
    ['dialogue policy version', makePlan, (plan) => { plan.generation.dialoguePolicyVersion += ' ' }, '$.generation.dialoguePolicyVersion'],
    ['claim id', makePlan, (plan) => { plan.claims[0].id += ' ' }, '$.claims[0].id'],
    ['claimType enum', makePlan, (plan) => { plan.claims[0].claimType = ` ${plan.claims[0].claimType}` }, '$.claims[0].claimType'],
    ['sourceFactIds item', makePlan, (plan) => { plan.claims[0].sourceFactIds[0] += ' ' }, '$.claims[0].sourceFactIds[0]'],
    ['sceneKey', makePlan, (plan) => { plan.scenes[0].sceneKey += ' ' }, '$.scenes[0].sceneKey'],
    ['visualType enum', makePlan, (plan) => { plan.scenes[0].visualType = ` ${plan.scenes[0].visualType}` }, '$.scenes[0].visualType'],
    ['productImageId', makePlan, (plan) => { plan.scenes[0].productImageId += ' ' }, '$.scenes[0].productImageId'],
    ['claimIds item', makePlan, (plan) => { plan.scenes[0].claimIds[0] += ' ' }, '$.scenes[0].claimIds[0]'],
  ]

  it.each(nonCanonicalIdOrEnumMutations)('rejects non-canonical ASCII edge whitespace in %s', (_label, factory, mutate, path) => {
    const plan = factory()
    mutate(plan)
    expectInvalid(plan, `${path} must not contain leading or trailing ASCII whitespace`)
  })

  const acceptedHashCollisionVariants = [
    ['selectedImageIds/productImageId', () => {
      const first = makeCrawlShapePlan()
      first.product.selectedImageIds.push('image-1 ')
      first.scenes[0].productImageId = 'image-1 '
      const second = structuredClone(first)
      second.scenes[0].productImageId = 'image-1'
      return [first, second]
    }],
    ['claimIds', () => {
      const first = makePlan()
      const original = first.claims[0]
      first.claims.push({ ...original, id: `${original.id} ` })
      first.scenes[0].subtitleText = `${original.text}${original.text}`
      first.scenes[0].claimIds = [original.id, `${original.id} `]
      const second = structuredClone(first)
      second.scenes[0].claimIds.reverse()
      return [first, second]
    }],
    ['sourceFactIds', () => {
      const first = makePlan()
      first.factDecisions.push({ ...first.factDecisions[0], sourceFactId: 'fact-1 ' })
      first.claims[0].sourceFactIds = ['fact-1', 'fact-1 ']
      const second = structuredClone(first)
      second.claims[0].sourceFactIds.reverse()
      return [first, second]
    }],
  ]

  it.each(acceptedHashCollisionVariants)('never accepts two distinct %s variants with the same canonical hash', (_label, factory) => {
    const [first, second] = factory()
    const bothAccepted = result(first).valid && result(second).valid
    const hashesCollide = computePlanHash(first) === computePlanHash(second)
    expect(bothAccepted && hashesCollide).toBe(false)
  })

  it.each([
    ['non-array selectedImageIds', (plan) => { plan.product.selectedImageIds = 1 }],
    ['non-string claim text', (plan) => { plan.claims[0].text = 7 }],
    ['non-array scene claimIds', (plan) => { plan.scenes[0].claimIds = 'claim-1' }],
    ['null scene', (plan) => { plan.scenes[0] = null }],
  ])('returns validation errors instead of throwing for malformed %s', (_label, mutate) => {
    const plan = _label === 'non-array selectedImageIds' ? makeCrawlShapePlan() : makePlan()
    mutate(plan)
    expect(() => result(plan)).not.toThrow()
    expect(result(plan).valid).toBe(false)
  })
})

describe('validateShoppingPlanDraft — scene constraints', () => {
  const stillMutations = [
    ['dialogueText', (scene) => { scene.dialogueText = '말하면 안 됨' }, 'dialogueText must be empty'],
    ['generationDurationSec', (scene) => { scene.generationDurationSec = 4 }, 'generationDurationSec must be 0'],
    ['trim', (scene) => { scene.trim = { startMs: 0, endMs: 2000 } }, 'trim must be null'],
    ['videoPrompt', (scene) => { scene.videoPrompt = 'prompt' }, 'videoPrompt must be empty'],
    ['short duration', (scene) => { scene.timelineDurationMs = 999 }, 'timelineDurationMs must be between 1000 and 3000'],
    ['long duration', (scene) => { scene.timelineDurationMs = 3001 }, 'timelineDurationMs must be between 1000 and 3000'],
    ['empty subtitle', (scene) => { scene.subtitleText = '' }, 'subtitleText must be non-empty'],
  ]

  it.each(stillMutations)('rejects product_still invalid %s', (_label, mutate, message) => {
    const plan = makePlan()
    mutate(plan.scenes[0])
    expectInvalid(plan, message)
  })

  it('accepts a 5000ms consecutive still run and rejects 5001ms', () => {
    const plan = makePlan()
    const second = plan.scenes[1]
    second.visualType = 'product_still'
    second.dialogueText = ''
    second.generationDurationSec = 0
    second.trim = null
    second.videoPrompt = ''
    setPersonaScene(plan, 2, 4)
    plan.scenes[0].timelineDurationMs = 2500
    second.timelineDurationMs = 2500
    expectValid(plan)

    second.timelineDurationMs = 2501
    expectInvalid(plan, 'consecutive product_still run exceeds 5000ms')
  })

  const personaMutations = [
    ['subtitle mismatch', (scene) => { scene.subtitleText = `${scene.dialogueText}!` }, 'subtitleText must equal dialogueText'],
    ['generation grid', (scene) => { scene.generationDurationSec = 5 }, 'generationDurationSec must be 4, 6, or 8'],
    ['timeline grid', (scene) => { scene.timelineDurationMs = 3999 }, 'timelineDurationMs must equal generationDurationSec * 1000'],
    ['trim start', (scene) => { scene.trim.startMs = 1 }, 'trim must cover the full timeline'],
    ['trim end', (scene) => { scene.trim.endMs = 3999 }, 'trim must cover the full timeline'],
  ]

  it.each(personaMutations)('rejects persona_i2v invalid %s', (_label, mutate, message) => {
    const plan = makePlan()
    mutate(plan.scenes[1])
    expectInvalid(plan, message)
  })

  it.each(PROMPT_PHRASES)('requires the exact videoPrompt phrase "%s"', (phrase) => {
    const plan = makePlan()
    plan.scenes[1].videoPrompt = plan.scenes[1].videoPrompt.replace(phrase, 'missing phrase')
    expectInvalid(plan, `videoPrompt must include "${phrase}"`)
  })

  it('requires exact dialogue exactly once in videoPrompt', () => {
    const missing = makePlan()
    missing.scenes[1].videoPrompt = personaPrompt('다른 대사')
    expectInvalid(missing, 'videoPrompt must contain exact dialogueText exactly once')

    const duplicated = makePlan()
    duplicated.scenes[1].videoPrompt += ` / ${duplicated.scenes[1].dialogueText}`
    expectInvalid(duplicated, 'videoPrompt must contain exact dialogueText exactly once')
  })

  it.each([
    [4, 18],
    [6, 30],
    [8, 42],
  ])('enforces the %is non-whitespace grapheme boundary %i with combining text and emoji', (durationSec, limit) => {
    const plan = makePlan()
    setPersonaScene(plan, 1, durationSec)
    const atLimit = `${'e\u0301'.repeat(limit - 1)}👨‍👩‍👧‍👦`
    expect(countNonWhitespaceGraphemes(atLimit)).toBe(limit)
    setPersonaDialogue(plan, 1, atLimit)
    expectValid(plan)

    setPersonaDialogue(plan, 1, `${atLimit}가`)
    expectInvalid(plan, `dialogueText exceeds ${limit} non-whitespace graphemes`)
  })

  it('does not count Unicode whitespace as a grapheme', () => {
    expect(countNonWhitespaceGraphemes('가 나\n다\t라')).toBe(4)
  })

  it('accepts total timeline below 60s and rejects exactly 60s', () => {
    const plan = makePlan(8)
    for (let index = 0; index < 7; index += 1) setPersonaScene(plan, index, 8)
    plan.scenes[7].timelineDurationMs = 3000
    expectValid(plan)

    setPersonaScene(plan, 7, 4)
    expectInvalid(plan, 'total timeline must be less than 60000ms')
  })

  it('requires a substantive approved hook in the first two seconds', () => {
    const plan = makePlan()
    plan.claims[0].claimType = 'disclosure'
    plan.claims[0].sourceFactIds = []
    expectInvalid(plan, 'first 2000ms must contain an approved product/problem/price hook')
  })

  it('requires CTA to overlap the final three seconds', () => {
    const missing = makePlan()
    missing.claims.at(-1).claimType = 'page_fact'
    missing.claims.at(-1).sourceFactIds = ['fact-last']
    missing.factDecisions.push({ sourceFactId: 'fact-last', decision: 'allowed', confirmedAt: '2026-07-23T02:00:00.000Z' })
    expectInvalid(missing, 'CTA must occur within the final 3000ms')

    const tooEarly = makePlan()
    tooEarly.claims[1].claimType = 'cta'
    tooEarly.claims[1].sourceFactIds = []
    tooEarly.claims.at(-1).claimType = 'page_fact'
    tooEarly.claims.at(-1).sourceFactIds = ['fact-last']
    tooEarly.factDecisions.push({ sourceFactId: 'fact-last', decision: 'allowed', confirmedAt: '2026-07-23T02:00:00.000Z' })
    expectInvalid(tooEarly, 'CTA must occur within the final 3000ms')
  })

  it('rejects a performance_proof claim assigned to persona_i2v', () => {
    const plan = makePlan()
    plan.claims[1].claimType = 'performance_proof'
    expectInvalid(plan, 'performance_proof')
    expectInvalid(plan, 'persona_i2v cannot be product performance evidence')
  })
})

describe('validateShoppingPlanDraft — ordered claim coverage', () => {
  it('normalizes line endings/NFC and removes only Unicode whitespace for coverage', () => {
    expect(normalizeClaimCoverageText(' Cafe\u0301\r\n가격  정보 ')).toBe('Café가격정보')

    const plan = makePlan()
    plan.claims[0].text = '승인   정보\n1'
    plan.scenes[0].subtitleText = '승인 정보 1'
    expectValid(plan)
  })

  it('keeps format characters significant for exact claim coverage', () => {
    expect(normalizeClaimCoverageText('승인\u200B정보')).toBe('승인\u200B정보')
  })

  it('preserves punctuation, case, number, and claim order', () => {
    const plan = makePlan()
    plan.claims.push({ id: 'claim-extra', text: '!', claimType: 'disclosure', sourceFactIds: [] })
    plan.scenes[0].subtitleText += '!'
    plan.scenes[0].claimIds.push('claim-extra')
    expectValid(plan)

    plan.scenes[0].claimIds.reverse()
    expectInvalid(plan, 'claim coverage mismatch')
  })

  it('rejects missing and duplicate scene claim references', () => {
    const missing = makePlan()
    missing.scenes[0].claimIds = ['claim-does-not-exist']
    expectInvalid(missing, 'references unknown claim')

    const duplicate = makePlan()
    const firstText = duplicate.claims[0].text
    duplicate.scenes[1].claimIds.unshift(duplicate.claims[0].id)
    setPersonaDialogue(duplicate, 1, `${firstText}${duplicate.scenes[1].dialogueText}`)
    expectInvalid(duplicate, 'is referenced more than once')
  })

  it('rejects orphan claims', () => {
    const plan = makePlan()
    plan.claims.push({ id: 'orphan', text: '고아', claimType: 'disclosure', sourceFactIds: [] })
    expectInvalid(plan, 'claim orphan is not referenced by a scene')
  })

  it('rejects claims backed by missing or excluded facts', () => {
    const missing = makePlan()
    missing.claims[1].sourceFactIds = ['not-reviewed']
    expectInvalid(missing, 'references missing fact decision not-reviewed')

    const excluded = makePlan()
    excluded.factDecisions[1].decision = 'excluded'
    expectInvalid(excluded, 'references excluded fact')
  })

  it.each([
    'experience',
    'performance_proof',
    'comparison_result',
    'social_proof',
    'medical_effect',
  ])('rejects forbidden claimType %s', (claimType) => {
    const plan = makePlan()
    plan.claims[1].claimType = claimType
    expectInvalid(plan, `claimType ${claimType} is not allowed`)
  })

  it('requires facts for factual claim types and a formula only for derived_numeric', () => {
    const noFact = makePlan()
    noFact.claims[1].sourceFactIds = []
    expectInvalid(noFact, 'requires at least one sourceFactId')

    const noFormula = makePlan()
    noFormula.claims[1].claimType = 'derived_numeric'
    expectInvalid(noFormula, 'derived_numeric requires a non-empty formula')

    const strayFormula = makePlan()
    strayFormula.claims[1].formula = 'not allowed here'
    expectInvalid(strayFormula, 'formula is only allowed for derived_numeric')
  })

  it('rejects prohibited-claim overlap in approved scene text', () => {
    const plan = makePlan()
    plan.prohibitedClaims[0].text = plan.scenes[0].subtitleText
    expectInvalid(plan, 'overlaps prohibited claim ban-1')
  })

  it.each(['직접 확인해봤습니다', '첫 느낌', '문의가 많았습니다'])('rejects MVP evidence phrase "%s"', (text) => {
    const plan = makePlan()
    plan.claims[0].text = text
    plan.scenes[0].subtitleText = text
    expectInvalid(plan, 'contains forbidden experience/social-proof language')
  })

  it.each(SECURITY_IGNORABLES)('rejects a forbidden phrase split by %s', (_label, formatCharacter) => {
    const plan = makePlan()
    const obfuscated = `직접${formatCharacter}확인해봤습니다`
    plan.claims[0].text = obfuscated
    plan.scenes[0].subtitleText = obfuscated
    expectInvalid(plan, 'contains forbidden experience/social-proof language')
  })

  it.each(SECURITY_IGNORABLES)('rejects prohibited-claim overlap split by %s', (_label, formatCharacter) => {
    const plan = makePlan()
    const obfuscated = `과장된${formatCharacter}효능`
    plan.prohibitedClaims[0].text = '과장된효능'
    plan.claims[0].text = obfuscated
    plan.scenes[0].subtitleText = obfuscated
    expectInvalid(plan, 'overlaps prohibited claim ban-1')
  })
})
