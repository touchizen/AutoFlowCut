// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  canonicalStringify,
  computePlanHash,
  deriveDeterministicSceneIds,
  deriveRendererSceneId,
  deriveStoryId,
  deriveVideoSeed,
  normalizeCanonicalPlan,
  normalizeCanonicalString,
  normalizeCanonicalUrl,
} from '../../../electron/shopping/planCanonical.js'

function canonicalPlanFixture() {
  return {
    schemaVersion: 'shopping-plan/3-appnative',
    planId: 'plan-abc',
    revision: 7,
    promptAssets: {
      template: {
        id: 'price-info-v1',
        assetVersion: 'template/1',
        sectionVersion: 'price/1',
        digest: 'template-digest-a',
        resolvedText: '가격 안내 템플릿',
      },
      style: {
        id: 'shopping-ugc-presenter-v1',
        assetVersion: 'style/1',
        digest: 'style-digest-a',
        resolvedText: '세로형 UGC 스타일',
      },
      persona: {
        assetVersion: 'persona/1',
        digest: 'persona-asset-digest-a',
      },
    },
    product: {
      mode: 'crawl',
      snapshotId: 'snapshot-1',
      canonicalUrl: 'https://www.coupang.com/vp/products/123?itemId=456&vendorItemId=789',
      sku: 'SKU-1',
      fetchedAt: '2026-07-23T01:02:03.000Z',
      sourceFacts: [
        {
          id: 'fact-name',
          field: 'name',
          value: '테스트 상품',
          sourceKind: 'jsonld',
          sourceUrl: 'https://www.coupang.com/vp/products/123?itemId=456',
          jsonPathOrProperty: '$.name',
          fetchedAt: '2026-07-23T01:02:03.000Z',
          verification: 'page-asserted',
          trust: 'untrusted-web-data',
        },
        {
          id: 'fact-price',
          field: 'price',
          value: '19,900원',
          sourceKind: 'og',
          sourceUrl: 'https://www.coupang.com/vp/products/123?itemId=456',
          jsonPathOrProperty: 'product:price:amount',
          fetchedAt: '2026-07-23T01:02:03.000Z',
          verification: 'page-asserted',
          trust: 'untrusted-web-data',
        },
      ],
    },
    factDecisions: [
      { sourceFactId: 'fact-name', decision: 'allowed', confirmedAt: '2026-07-23T01:05:00.000Z' },
      { sourceFactId: 'fact-price', decision: 'allowed', confirmedAt: '2026-07-23T01:05:01.000Z' },
    ],
    prohibitedClaims: [{ id: 'ban-1', text: '직접 써봤습니다', reason: 'experience' }],
    resolvedAssets: {
      images: [
        {
          selectedImageId: 'image-1',
          sourceUrl: 'https://image.coupangcdn.com/image/1.jpg',
          sha256: 'image-digest-a',
          mimeType: 'image/jpeg',
          width: 1080,
          height: 1920,
          assetId: 'asset-image-a',
        },
      ],
      attachments: [
        {
          attachmentId: 'attachment-1',
          sha256: 'attachment-digest-a',
          mimeType: 'image/png',
          width: 1000,
          height: 1000,
          assetId: 'asset-attachment-a',
        },
      ],
    },
    persona: {
      id: 'persona-1',
      name: '민지',
      role: 'presenter',
      gender: 'female',
      ageBand: '30s',
      ethnicity: 'Korean',
      appearance: '단정한 검은 단발',
      promptBuilderVersion: 'shopping-persona-prompt/1',
      renderedPrompt: 'a Korean woman in her 30s',
      personaFingerprint: 'persona-fingerprint-a',
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
      videoSeedBase: 'base-2026',
      speechMode: 'veo-native-ko',
      productStillAudio: 'none',
      subtitleTiming: 'scene-block',
      dialoguePolicyVersion: 'shopping-veo-dialogue-v1',
    },
    sourceAudioPolicy: 'native',
    sourceAudioGain: 1,
    voiceDirection: {
      version: 'native-ko/1',
      digest: 'voice-direction-digest-a',
      text: 'Speak naturally in Korean.',
    },
    claims: [
      {
        id: 'claim-name',
        text: '테스트 상품',
        claimType: 'product_identity',
        sourceFactIds: ['fact-name'],
      },
      {
        id: 'claim-price',
        text: '가격은 19,900원',
        claimType: 'derived_numeric',
        sourceFactIds: ['fact-price'],
        formula: 'formatWon(fact-price)',
      },
    ],
    scenes: [
      {
        sceneKey: 'S01',
        storyId: '384e614d-0461-55b1-804e-4f150bb6e1ba',
        rendererSceneId: '48d7a5ec-849d-5b20-bd79-91c627a92710',
        visualType: 'persona_i2v',
        visualDescription: '진행자가 제품 가격을 소개한다.',
        productImageId: 'image-1',
        startMs: 0,
        endMs: 4000,
        timelineDurationMs: 4000,
        generationDurationSec: 4,
        trim: { startMs: 0, endMs: 4000 },
        dialogueText: '테스트 상품 가격은 19,900원',
        subtitleText: '테스트 상품 가격은 19,900원',
        claimIds: ['claim-name', 'claim-price'],
        videoPrompt: 'speaking in Korean, say exactly "테스트 상품 가격은 19,900원", no ad-lib, no extra speech, no music, no captions, no on-screen text',
        videoSeed: 2026804741,
      },
      {
        sceneKey: 'S02',
        storyId: 'story-2',
        rendererSceneId: 'renderer-2',
        visualType: 'product_still',
        visualDescription: '제품 정면 이미지',
        productImageId: 'image-1',
        startMs: 4000,
        endMs: 6000,
        timelineDurationMs: 2000,
        generationDurationSec: 0,
        trim: null,
        dialogueText: '',
        subtitleText: '테스트 상품',
        claimIds: ['claim-name'],
        videoPrompt: '',
        videoSeed: 0,
      },
    ],
    totals: {
      totalTimelineMs: 6000,
      imageCount: 1,
      totalGenerationSeconds: 4,
    },
  }
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)]),
  )
}

function changed(path, value) {
  return (plan) => {
    const parts = path.split('.')
    let cursor = plan
    for (const part of parts.slice(0, -1)) cursor = cursor[Number.isNaN(Number(part)) ? part : Number(part)]
    cursor[parts.at(-1)] = value
  }
}

describe('plan canonical normalization', () => {
  it('applies NFC, newline normalization, trailing-whitespace removal, and outer blank-line removal', () => {
    expect(normalizeCanonicalString('\r\nCafe\u0301  \r\n둘째 줄\t\r\n\r\n')).toBe('Café\n둘째 줄')
  })

  it('preserves meaningful internal spaces and line breaks', () => {
    expect(normalizeCanonicalString('첫  문장\n\n  들여쓰기')).toBe('첫  문장\n\n  들여쓰기')
  })

  it('canonicalizes URL scheme/host/default 443/fragment without reordering path or query', () => {
    expect(normalizeCanonicalUrl('HTTPS://EXAMPLE.COM:443/Path?b=2&a=1#section'))
      .toBe('https://example.com/Path?b=2&a=1')
  })

  it('trims ID/enum ASCII whitespace, converts negative zero, sorts keys, and preserves array order', () => {
    const normalized = normalizeCanonicalPlan({
      z: 1,
      scenes: [{ sceneKey: '  S02\t', trim: { startMs: -0, endMs: 1000 } }, { sceneKey: 'S01' }],
      provider: ' google ',
      planId: '\tplan-1 ',
      a: 2,
    })

    expect(Object.keys(normalized)).toEqual(['a', 'planId', 'provider', 'scenes', 'z'])
    expect(normalized).toMatchObject({
      planId: 'plan-1',
      provider: 'google',
      scenes: [{ sceneKey: 'S02', trim: { startMs: 0, endMs: 1000 } }, { sceneKey: 'S01' }],
    })
    expect(Object.is(normalized.scenes[0].trim.startMs, -0)).toBe(false)
  })

  it('trims ASCII whitespace from exact id and SKU fields', () => {
    expect(normalizeCanonicalPlan({ id: '  claim-1\t', sku: '\n SKU-1 ' })).toEqual({
      id: 'claim-1',
      sku: 'SKU-1',
    })
  })

  it.each([
    ['fractional millisecond', { timelineDurationMs: 1000.5 }],
    ['negative videoSeed', { videoSeed: -1 }],
    ['videoSeed above uint32', { videoSeed: 4294967296 }],
    ['non-finite number', { sourceAudioGain: Number.POSITIVE_INFINITY }],
    ['unexpected null', { optionalValue: null }],
    ['undefined array entry', { claimIds: ['claim-1', undefined] }],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeCanonicalPlan(input)).toThrow()
  })

  it('rejects an explicit undefined object child instead of omitting it from the hash', () => {
    expect(() => computePlanHash({ schemaVersion: 'shopping-plan/3-appnative', stampedField: undefined }))
      .toThrow('$.stampedField cannot be undefined')
  })
})

describe('canonical hash truth table', () => {
  it('is deterministic and emits a lowercase SHA-256 hex digest', () => {
    const plan = canonicalPlanFixture()
    const first = computePlanHash(plan)
    expect(computePlanHash(structuredClone(plan))).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is invariant to recursive object key order', () => {
    const plan = canonicalPlanFixture()
    expect(computePlanHash(reverseObjectKeys(plan))).toBe(computePlanHash(plan))
  })

  it.each(['scenes', 'claims'])('changes when the %s array order changes', (field) => {
    const plan = canonicalPlanFixture()
    const reordered = structuredClone(plan)
    reordered[field].reverse()
    expect(computePlanHash(reordered)).not.toBe(computePlanHash(plan))
  })

  const hashTargetMutations = [
    ['schema version', changed('schemaVersion', 'shopping-plan/4')],
    ['template asset version', changed('promptAssets.template.assetVersion', 'template/2')],
    ['template digest', changed('promptAssets.template.digest', 'template-digest-b')],
    ['style asset version', changed('promptAssets.style.assetVersion', 'style/2')],
    ['style digest', changed('promptAssets.style.digest', 'style-digest-b')],
    ['canonical product URL', changed('product.canonicalUrl', 'https://www.coupang.com/vp/products/124?itemId=456&vendorItemId=789')],
    ['SKU', changed('product.sku', 'SKU-2')],
    ['source fact value/price', changed('product.sourceFacts.1.value', '20,900원')],
    ['source fact provenance', changed('product.sourceFacts.1.sourceKind', 'jsonld')],
    ['source fact fetchedAt', changed('product.sourceFacts.1.fetchedAt', '2026-07-23T01:02:04.000Z')],
    ['fact decision', changed('factDecisions.1.decision', 'excluded')],
    ['prohibited claim', changed('prohibitedClaims.0.text', '첫 느낌입니다')],
    ['selected image ID', changed('resolvedAssets.images.0.selectedImageId', 'image-2')],
    ['selected image digest', changed('resolvedAssets.images.0.sha256', 'image-digest-b')],
    ['selected image dimension', changed('resolvedAssets.images.0.width', 1079)],
    ['selected image materialized asset ID', changed('resolvedAssets.images.0.assetId', 'asset-image-b')],
    ['attachment ID', changed('resolvedAssets.attachments.0.attachmentId', 'attachment-2')],
    ['attachment digest', changed('resolvedAssets.attachments.0.sha256', 'attachment-digest-b')],
    ['attachment dimension', changed('resolvedAssets.attachments.0.height', 999)],
    ['attachment materialized asset ID', changed('resolvedAssets.attachments.0.assetId', 'asset-attachment-b')],
    ['persona field', changed('persona.name', '서연')],
    ['rendered persona prompt', changed('persona.renderedPrompt', 'a Korean woman in her 40s')],
    ['persona fingerprint', changed('persona.personaFingerprint', 'persona-fingerprint-b')],
    ['scene identity', changed('scenes.0.storyId', 'story-changed')],
    ['scene visual type', changed('scenes.0.visualType', 'product_still')],
    ['scene visual description', changed('scenes.0.visualDescription', '다른 연출')],
    ['scene product image mapping', changed('scenes.0.productImageId', 'image-2')],
    ['scene time', changed('scenes.0.endMs', 3999)],
    ['scene trim', changed('scenes.0.trim.endMs', 3999)],
    ['dialogue', changed('scenes.0.dialogueText', '가격은 20,900원')],
    ['subtitle', changed('scenes.0.subtitleText', '가격은 20,900원')],
    ['claim link', changed('scenes.0.claimIds.1', 'claim-other')],
    ['claim formula', changed('claims.1.formula', 'formatWon2(fact-price)')],
    ['exact video prompt', changed('scenes.0.videoPrompt', 'changed prompt')],
    ['provider', changed('generation.provider', 'other')],
    ['image model', changed('generation.imageModel', 'image-model-2')],
    ['video model', changed('generation.videoModel', 'video-model-2')],
    ['aspect ratio', changed('generation.aspectRatio', '1:1')],
    ['resolution', changed('generation.videoResolution', '1080p')],
    ['generation duration', changed('scenes.0.generationDurationSec', 6)],
    ['video seed', changed('scenes.0.videoSeed', 2026804742)],
    ['speech mode', changed('generation.speechMode', 'speech-mode-2')],
    ['still audio policy', changed('generation.productStillAudio', 'muted-track')],
    ['source audio policy', changed('sourceAudioPolicy', 'muted')],
    ['source audio gain', changed('sourceAudioGain', 0.9)],
    ['subtitle timing', changed('generation.subtitleTiming', 'word')],
    ['voice direction', changed('voiceDirection.text', 'Speak slowly in Korean.')],
  ]

  it.each(hashTargetMutations)('changes for hash-target mutation: %s', (_label, mutate) => {
    const original = canonicalPlanFixture()
    const mutated = structuredClone(original)
    mutate(mutated)
    expect(computePlanHash(mutated)).not.toBe(computePlanHash(original))
  })

  const normalizationInvariants = [
    ['trailing whitespace', changed('scenes.0.visualDescription', '진행자가 제품 가격을 소개한다.  \t')],
    ['CRLF versus LF', changed('voiceDirection.text', 'Speak naturally\r\nin Korean.')],
    ['URL scheme/host case and default 443/fragment', changed('product.canonicalUrl', 'HTTPS://WWW.COUPANG.COM:443/vp/products/123?itemId=456&vendorItemId=789#ignored')],
    ['negative zero', changed('scenes.0.trim.startMs', -0)],
    ['negative-zero videoSeed', changed('scenes.1.videoSeed', -0)],
    ['Unicode NFC', changed('persona.appearance', '단정한 검은 단발')],
  ]

  it.each(normalizationInvariants)('does not change for normalized equivalent: %s', (_label, mutate) => {
    const original = canonicalPlanFixture()
    if (_label === 'CRLF versus LF') original.voiceDirection.text = 'Speak naturally\nin Korean.'
    if (_label === 'Unicode NFC') {
      original.persona.appearance = 'Café'
      mutate = changed('persona.appearance', 'Cafe\u0301')
    }
    const mutated = structuredClone(original)
    mutate(mutated)
    expect(computePlanHash(mutated)).toBe(computePlanHash(original))
  })

  it('canonicalStringify returns the exact compact JSON bytes source', () => {
    expect(canonicalStringify({ z: '값', a: [2, 1] })).toBe('{"a":[2,1],"z":"값"}')
  })
})

describe('deterministic scene derivation', () => {
  it('derives the videoSeed golden vector from the first four SHA-256 bytes as uint32', () => {
    expect(deriveVideoSeed('base-2026', 'S01')).toBe(2026804741)
    expect(deriveVideoSeed('base-2026', 'S01')).toBeGreaterThanOrEqual(0)
    expect(deriveVideoSeed('base-2026', 'S01')).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isSafeInteger(deriveVideoSeed('base-2026', 'S01'))).toBe(true)
  })

  it('derives stable UUID-shaped storyId and rendererSceneId golden vectors', () => {
    expect(deriveStoryId('plan-abc', 7, 'S01')).toBe('384e614d-0461-55b1-804e-4f150bb6e1ba')
    expect(deriveRendererSceneId('plan-abc', 7, 'S01')).toBe('48d7a5ec-849d-5b20-bd79-91c627a92710')
    expect(deriveDeterministicSceneIds('plan-abc', 7, 'S01')).toEqual({
      storyId: '384e614d-0461-55b1-804e-4f150bb6e1ba',
      rendererSceneId: '48d7a5ec-849d-5b20-bd79-91c627a92710',
    })
  })

  it('changes deterministic IDs when planId, revision, or sceneKey changes', () => {
    const base = deriveDeterministicSceneIds('plan-abc', 7, 'S01')
    expect(deriveDeterministicSceneIds('plan-other', 7, 'S01')).not.toEqual(base)
    expect(deriveDeterministicSceneIds('plan-abc', 8, 'S01')).not.toEqual(base)
    expect(deriveDeterministicSceneIds('plan-abc', 7, 'S02')).not.toEqual(base)
  })
})
