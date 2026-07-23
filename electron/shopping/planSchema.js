import { normalizeCanonicalString } from './planCanonical.js'

const PLAN_KEYS = [
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

const PERSONA_KEYS = ['id', 'name', 'role', 'gender', 'ageBand', 'ethnicity', 'appearance']
const CREATIVE_KEYS = ['templateId', 'styleId']
const GENERATION_KEYS = [
  'provider',
  'imageModel',
  'videoModel',
  'aspectRatio',
  'videoResolution',
  'videoSeedBase',
  'speechMode',
  'productStillAudio',
  'subtitleTiming',
  'dialoguePolicyVersion',
]
const CLAIM_KEYS = ['id', 'text', 'claimType', 'sourceFactIds', 'formula']
const SCENE_KEYS = [
  'sceneKey',
  'visualType',
  'visualDescription',
  'productImageId',
  'dialogueText',
  'subtitleText',
  'claimIds',
  'timelineDurationMs',
  'generationDurationSec',
  'trim',
  'videoPrompt',
]
const SOURCE_FACT_KEYS = [
  'id',
  'field',
  'value',
  'sourceKind',
  'sourceUrl',
  'jsonPathOrProperty',
  'fetchedAt',
  'verification',
  'trust',
]

const REQUIRED_CLAIM_KEYS = CLAIM_KEYS.filter((key) => key !== 'formula')
const REQUIRED_SOURCE_FACT_KEYS = SOURCE_FACT_KEYS.filter((key) => !['sourceUrl', 'jsonPathOrProperty'].includes(key))
const ALLOWED_CLAIM_TYPES = new Set([
  'product_identity',
  'page_fact',
  'numeric_fact',
  'derived_numeric',
  'editorial_fit',
  'cta',
  'disclosure',
])
const FACT_REQUIRED_CLAIM_TYPES = new Set([
  'product_identity',
  'page_fact',
  'numeric_fact',
  'derived_numeric',
  'editorial_fit',
])
const PROMPT_PHRASES = [
  'speaking in Korean',
  'say exactly',
  'no ad-lib',
  'no extra speech',
  'no music',
  'no captions',
  'no on-screen text',
]
const GRAPHEME_LIMITS = new Map([[4, 18], [6, 30], [8, 42]])
const FORBIDDEN_EVIDENCE_PHRASES = ['직접 확인해봤습니다', '첫 느낌', '문의가 많았습니다']
const SEGMENTER = new Intl.Segmenter('ko', { granularity: 'grapheme' })

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function addError(errors, message) {
  if (!errors.includes(message)) errors.push(message)
}

function checkObject(value, path, allowedKeys, requiredKeys, errors) {
  if (!isRecord(value)) {
    addError(errors, `${path} must be an object`)
    return false
  }

  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${path}.${key} is not allowed`)
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) {
      addError(errors, `${path}.${key} is required`)
    }
  }
  return true
}

function checkString(value, path, errors, { nonEmpty = false } = {}) {
  if (typeof value !== 'string') {
    addError(errors, `${path} must be a string`)
    return false
  }
  if (nonEmpty && !value.trim()) {
    addError(errors, `${path} must be a non-empty string`)
    return false
  }
  return true
}

function checkEnum(value, path, allowed, errors) {
  if (!allowed.includes(value)) {
    addError(errors, `${path} must be ${allowed.map((item) => JSON.stringify(item)).join(' or ')}`)
    return false
  }
  return true
}

function checkInteger(value, path, errors) {
  if (!Number.isInteger(value)) {
    addError(errors, `${path} must be an integer`)
    return false
  }
  return true
}

function checkArray(value, path, errors, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  if (!Array.isArray(value)) {
    addError(errors, `${path} must be an array`)
    return false
  }
  if (value.length < min || value.length > max) {
    addError(errors, `${path} must contain ${min}..${max} items`)
    return false
  }
  return true
}

function checkUniqueStrings(values, path, errors) {
  if (!Array.isArray(values)) return
  const seen = new Set()
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!checkString(value, `${path}[${index}]`, errors, { nonEmpty: true })) continue
    if (seen.has(value)) addError(errors, `${path} contains duplicate value ${value}`)
    seen.add(value)
  }
}

function countExactOccurrences(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let cursor = 0
  while (cursor <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, cursor)
    if (found === -1) break
    count += 1
    cursor = found + needle.length
  }
  return count
}

function checkUrl(value, path, errors) {
  if (!checkString(value, path, errors, { nonEmpty: true })) return
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
  } catch {
    addError(errors, `${path} must be an absolute HTTP(S) URL`)
  }
}

export function countNonWhitespaceGraphemes(value) {
  if (typeof value !== 'string') throw new TypeError('grapheme input must be a string')
  let count = 0
  for (const { segment } of SEGMENTER.segment(value)) {
    if (/\P{White_Space}/u.test(segment)) count += 1
  }
  return count
}

export function normalizeClaimCoverageText(value) {
  if (typeof value !== 'string') throw new TypeError('claim coverage input must be a string')
  return normalizeCanonicalString(value).replace(/\p{White_Space}/gu, '')
}

function validateSourceFact(fact, path, errors) {
  if (!checkObject(fact, path, SOURCE_FACT_KEYS, REQUIRED_SOURCE_FACT_KEYS, errors)) return
  checkString(fact.id, `${path}.id`, errors, { nonEmpty: true })
  checkString(fact.field, `${path}.field`, errors, { nonEmpty: true })
  if (
    !['string', 'number', 'boolean'].includes(typeof fact.value)
    || (typeof fact.value === 'number' && !Number.isFinite(fact.value))
    || (typeof fact.value === 'string' && !fact.value.trim())
  ) {
    addError(errors, `${path}.value must be a non-empty JSON scalar`)
  }
  checkEnum(fact.sourceKind, `${path}.sourceKind`, ['jsonld', 'og', 'manual'], errors)
  if (fact.sourceUrl !== undefined) checkUrl(fact.sourceUrl, `${path}.sourceUrl`, errors)
  if (fact.jsonPathOrProperty !== undefined) {
    checkString(fact.jsonPathOrProperty, `${path}.jsonPathOrProperty`, errors, { nonEmpty: true })
  }
  checkString(fact.fetchedAt, `${path}.fetchedAt`, errors, { nonEmpty: true })
  checkEnum(fact.verification, `${path}.verification`, ['page-asserted', 'user-asserted'], errors)
  checkEnum(fact.trust, `${path}.trust`, ['untrusted-web-data'], errors)
}

function validateProduct(product, errors) {
  if (!isRecord(product)) {
    addError(errors, '$.product must be an object')
    return { selectedProductImageIds: new Set(), manualFactIds: null }
  }

  const crawl = product.mode === 'crawl'
  const manual = product.mode === 'manual'
  if (!crawl && !manual) addError(errors, '$.product.mode must be "crawl" or "manual"')

  const keys = crawl
    ? ['mode', 'snapshotId', 'selectedImageIds']
    : ['mode', 'title', 'sku', 'sourceUrl', 'facts', 'attachmentIds']
  const required = crawl ? keys : keys.filter((key) => !['sku', 'sourceUrl'].includes(key))
  checkObject(product, '$.product', keys, required, errors)

  if (crawl) {
    checkString(product.snapshotId, '$.product.snapshotId', errors, { nonEmpty: true })
    if (checkArray(product.selectedImageIds, '$.product.selectedImageIds', errors, { min: 1, max: 5 })) {
      checkUniqueStrings(product.selectedImageIds, '$.product.selectedImageIds', errors)
    }
    return {
      selectedProductImageIds: new Set(Array.isArray(product.selectedImageIds) ? product.selectedImageIds : []),
      manualFactIds: null,
    }
  }

  checkString(product.title, '$.product.title', errors, { nonEmpty: true })
  if (product.sku !== undefined) checkString(product.sku, '$.product.sku', errors, { nonEmpty: true })
  if (product.sourceUrl !== undefined) checkUrl(product.sourceUrl, '$.product.sourceUrl', errors)

  const manualFactIds = new Set()
  if (checkArray(product.facts, '$.product.facts', errors, { min: 1, max: 30 })) {
    for (let index = 0; index < product.facts.length; index += 1) {
      const fact = product.facts[index]
      validateSourceFact(fact, `$.product.facts[${index}]`, errors)
      if (typeof fact?.id === 'string') {
        if (manualFactIds.has(fact.id)) addError(errors, `duplicate source fact id ${fact.id}`)
        manualFactIds.add(fact.id)
      }
    }
  }
  if (checkArray(product.attachmentIds, '$.product.attachmentIds', errors, { min: 1, max: 5 })) {
    checkUniqueStrings(product.attachmentIds, '$.product.attachmentIds', errors)
  }
  return {
    selectedProductImageIds: new Set(Array.isArray(product.attachmentIds) ? product.attachmentIds : []),
    manualFactIds,
  }
}

function validateFactDecisions(decisions, manualFactIds, errors) {
  const decisionByFactId = new Map()
  if (!checkArray(decisions, '$.factDecisions', errors)) return decisionByFactId

  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index]
    const path = `$.factDecisions[${index}]`
    if (!checkObject(
      decision,
      path,
      ['sourceFactId', 'decision', 'confirmedAt'],
      ['sourceFactId', 'decision', 'confirmedAt'],
      errors,
    )) continue
    checkString(decision.sourceFactId, `${path}.sourceFactId`, errors, { nonEmpty: true })
    checkEnum(decision.decision, `${path}.decision`, ['allowed', 'excluded'], errors)
    checkString(decision.confirmedAt, `${path}.confirmedAt`, errors, { nonEmpty: true })

    if (typeof decision.sourceFactId === 'string') {
      if (decisionByFactId.has(decision.sourceFactId)) {
        addError(errors, `duplicate fact decision for ${decision.sourceFactId}`)
      }
      decisionByFactId.set(decision.sourceFactId, decision.decision)
      if (manualFactIds && !manualFactIds.has(decision.sourceFactId)) {
        addError(errors, `${path}.sourceFactId references unknown manual fact ${decision.sourceFactId}`)
      }
    }
  }
  return decisionByFactId
}

function validateProhibitedClaims(prohibitedClaims, errors) {
  const normalized = []
  const ids = new Set()
  if (!checkArray(prohibitedClaims, '$.prohibitedClaims', errors)) return normalized

  for (let index = 0; index < prohibitedClaims.length; index += 1) {
    const prohibited = prohibitedClaims[index]
    const path = `$.prohibitedClaims[${index}]`
    if (!checkObject(prohibited, path, ['id', 'text', 'reason'], ['id', 'text', 'reason'], errors)) continue
    checkString(prohibited.id, `${path}.id`, errors, { nonEmpty: true })
    checkString(prohibited.text, `${path}.text`, errors, { nonEmpty: true })
    checkString(prohibited.reason, `${path}.reason`, errors, { nonEmpty: true })
    if (typeof prohibited.id === 'string') {
      if (ids.has(prohibited.id)) addError(errors, `duplicate prohibited claim id ${prohibited.id}`)
      ids.add(prohibited.id)
    }
    if (typeof prohibited.text === 'string' && prohibited.text.trim()) {
      normalized.push({ id: prohibited.id, text: normalizeClaimCoverageText(prohibited.text) })
    }
  }
  return normalized
}

function validatePersona(persona, errors) {
  if (!checkObject(persona, '$.persona', PERSONA_KEYS, PERSONA_KEYS, errors)) return
  for (const key of ['id', 'name', 'appearance']) {
    checkString(persona[key], `$.persona.${key}`, errors, { nonEmpty: true })
  }
  checkEnum(persona.role, '$.persona.role', ['presenter'], errors)
  checkEnum(persona.gender, '$.persona.gender', ['female', 'male'], errors)
  checkEnum(persona.ageBand, '$.persona.ageBand', ['20s', '30s', '40s', '50s', '60s'], errors)
  checkEnum(persona.ethnicity, '$.persona.ethnicity', ['Korean'], errors)
}

function validateCreative(creative, errors) {
  if (!checkObject(creative, '$.creative', CREATIVE_KEYS, CREATIVE_KEYS, errors)) return
  checkEnum(creative.templateId, '$.creative.templateId', ['price-info-v1', 'problem-info-v1'], errors)
  checkEnum(creative.styleId, '$.creative.styleId', ['shopping-ugc-presenter-v1'], errors)
}

function validateGeneration(generation, errors) {
  if (!checkObject(generation, '$.generation', GENERATION_KEYS, GENERATION_KEYS, errors)) return
  const constants = {
    provider: 'google',
    imageModel: 'gemini-3.1-flash-image',
    videoModel: 'veo-3.1-fast-generate-preview',
    aspectRatio: '9:16',
    videoResolution: '720p',
    speechMode: 'veo-native-ko',
    productStillAudio: 'none',
    subtitleTiming: 'scene-block',
    dialoguePolicyVersion: 'shopping-veo-dialogue-v1',
  }
  for (const [key, expected] of Object.entries(constants)) {
    checkEnum(generation[key], `$.generation.${key}`, [expected], errors)
  }
  checkString(generation.videoSeedBase, '$.generation.videoSeedBase', errors, { nonEmpty: true })
}

function validateClaims(claims, decisionByFactId, errors) {
  const claimById = new Map()
  if (!checkArray(claims, '$.claims', errors, { min: 1 })) return claimById

  for (let index = 0; index < claims.length; index += 1) {
    const claim = claims[index]
    const path = `$.claims[${index}]`
    if (!checkObject(claim, path, CLAIM_KEYS, REQUIRED_CLAIM_KEYS, errors)) continue
    checkString(claim.id, `${path}.id`, errors, { nonEmpty: true })
    checkString(claim.text, `${path}.text`, errors, { nonEmpty: true })
    if (!ALLOWED_CLAIM_TYPES.has(claim.claimType)) {
      addError(errors, `${path}.claimType ${String(claim.claimType)} is not allowed`)
    }

    if (checkArray(claim.sourceFactIds, `${path}.sourceFactIds`, errors)) {
      checkUniqueStrings(claim.sourceFactIds, `${path}.sourceFactIds`, errors)
      if (FACT_REQUIRED_CLAIM_TYPES.has(claim.claimType) && claim.sourceFactIds.length === 0) {
        addError(errors, `${path}.${claim.claimType} requires at least one sourceFactId`)
      }
      for (const sourceFactId of claim.sourceFactIds) {
        if (!decisionByFactId.has(sourceFactId)) {
          addError(errors, `${path} references missing fact decision ${sourceFactId}`)
        } else if (decisionByFactId.get(sourceFactId) !== 'allowed') {
          addError(errors, `${path} references excluded fact ${sourceFactId}`)
        }
      }
    }

    if (claim.claimType === 'derived_numeric') {
      checkString(claim.formula, `${path}.formula`, errors, { nonEmpty: true })
      if (typeof claim.formula !== 'string' || !claim.formula.trim()) {
        addError(errors, `${path} derived_numeric requires a non-empty formula`)
      }
    } else if (claim.formula !== undefined) {
      addError(errors, `${path}.formula is only allowed for derived_numeric`)
    }

    if (typeof claim.id === 'string') {
      if (claimById.has(claim.id)) addError(errors, `duplicate claim id ${claim.id}`)
      else claimById.set(claim.id, claim)
    }
  }
  return claimById
}

function validateSceneShape(scene, index, selectedProductImageIds, errors) {
  const path = `$.scenes[${index}]`
  if (!checkObject(scene, path, SCENE_KEYS, SCENE_KEYS, errors)) return
  checkString(scene.sceneKey, `${path}.sceneKey`, errors, { nonEmpty: true })
  const expectedSceneKey = `S${String(index + 1).padStart(2, '0')}`
  if (scene.sceneKey !== expectedSceneKey) {
    addError(errors, `${path}.sceneKey must be ${expectedSceneKey}`)
  }
  checkEnum(scene.visualType, `${path}.visualType`, ['product_still', 'persona_i2v'], errors)
  checkString(scene.visualDescription, `${path}.visualDescription`, errors, { nonEmpty: true })
  checkString(scene.productImageId, `${path}.productImageId`, errors, { nonEmpty: true })
  if (typeof scene.productImageId === 'string' && !selectedProductImageIds.has(scene.productImageId)) {
    addError(errors, `${path}.productImageId must reference a selected product image`)
  }
  checkString(scene.dialogueText, `${path}.dialogueText`, errors)
  checkString(scene.subtitleText, `${path}.subtitleText`, errors)
  if (checkArray(scene.claimIds, `${path}.claimIds`, errors, { min: 1 })) {
    checkUniqueStrings(scene.claimIds, `${path}.claimIds`, errors)
  }
  checkInteger(scene.timelineDurationMs, `${path}.timelineDurationMs`, errors)
  checkInteger(scene.generationDurationSec, `${path}.generationDurationSec`, errors)
  checkString(scene.videoPrompt, `${path}.videoPrompt`, errors)

  if (scene.trim !== null && checkObject(
    scene.trim,
    `${path}.trim`,
    ['startMs', 'endMs'],
    ['startMs', 'endMs'],
    errors,
  )) {
    checkInteger(scene.trim.startMs, `${path}.trim.startMs`, errors)
    checkInteger(scene.trim.endMs, `${path}.trim.endMs`, errors)
  }
}

function validateProductStill(scene, index, errors) {
  const path = `$.scenes[${index}]`
  if (scene.dialogueText !== '') addError(errors, `${path}.dialogueText must be empty for product_still`)
  if (scene.generationDurationSec !== 0) addError(errors, `${path}.generationDurationSec must be 0 for product_still`)
  if (scene.trim !== null) addError(errors, `${path}.trim must be null for product_still`)
  if (scene.videoPrompt !== '') addError(errors, `${path}.videoPrompt must be empty for product_still`)
  if (!Number.isInteger(scene.timelineDurationMs) || scene.timelineDurationMs < 1000 || scene.timelineDurationMs > 3000) {
    addError(errors, `${path}.timelineDurationMs must be between 1000 and 3000 for product_still`)
  }
  if (typeof scene.subtitleText !== 'string' || !scene.subtitleText.trim()) {
    addError(errors, `${path}.subtitleText must be non-empty for product_still`)
  }
}

function validatePersonaScene(scene, index, errors) {
  const path = `$.scenes[${index}]`
  if (scene.subtitleText !== scene.dialogueText) {
    addError(errors, `${path}.subtitleText must equal dialogueText for persona_i2v`)
  }
  if (!GRAPHEME_LIMITS.has(scene.generationDurationSec)) {
    addError(errors, `${path}.generationDurationSec must be 4, 6, or 8 for persona_i2v`)
  }
  if (scene.timelineDurationMs !== scene.generationDurationSec * 1000) {
    addError(errors, `${path}.timelineDurationMs must equal generationDurationSec * 1000 for persona_i2v`)
  }
  if (
    !isRecord(scene.trim)
    || scene.trim.startMs !== 0
    || scene.trim.endMs !== scene.timelineDurationMs
  ) {
    addError(errors, `${path}.trim must cover the full timeline for persona_i2v`)
  }

  if (typeof scene.videoPrompt === 'string') {
    if (
      typeof scene.dialogueText !== 'string'
      || countExactOccurrences(scene.videoPrompt, scene.dialogueText) !== 1
    ) {
      addError(errors, `${path}.videoPrompt must contain exact dialogueText exactly once`)
    }
    for (const phrase of PROMPT_PHRASES) {
      if (!scene.videoPrompt.includes(phrase)) {
        addError(errors, `${path}.videoPrompt must include "${phrase}"`)
      }
    }
  }

  const limit = GRAPHEME_LIMITS.get(scene.generationDurationSec)
  if (limit && typeof scene.dialogueText === 'string' && countNonWhitespaceGraphemes(scene.dialogueText) > limit) {
    addError(errors, `${path}.dialogueText exceeds ${limit} non-whitespace graphemes`)
  }
}

function validateScenes(scenes, claimById, prohibitedClaims, selectedProductImageIds, errors) {
  if (!checkArray(scenes, '$.scenes', errors, { min: 5, max: 8 })) return

  const sceneKeys = new Set()
  const claimUseCount = new Map()
  const timeline = []
  let cursor = 0
  let stillRunMs = 0

  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]
    validateSceneShape(scene, index, selectedProductImageIds, errors)
    if (!isRecord(scene)) continue

    if (sceneKeys.has(scene.sceneKey)) addError(errors, `duplicate sceneKey ${scene.sceneKey}`)
    sceneKeys.add(scene.sceneKey)

    if (scene.visualType === 'product_still') {
      validateProductStill(scene, index, errors)
      stillRunMs += Number.isInteger(scene.timelineDurationMs) ? scene.timelineDurationMs : 0
      if (stillRunMs > 5000) addError(errors, `consecutive product_still run exceeds 5000ms at $.scenes[${index}]`)
    } else if (scene.visualType === 'persona_i2v') {
      validatePersonaScene(scene, index, errors)
      stillRunMs = 0
    }

    const duration = Number.isInteger(scene.timelineDurationMs) ? scene.timelineDurationMs : 0
    const entry = { scene, index, startMs: cursor, endMs: cursor + duration }
    timeline.push(entry)
    cursor = entry.endMs

    const expectedClaimText = []
    for (const claimId of Array.isArray(scene.claimIds) ? scene.claimIds : []) {
      const claim = claimById.get(claimId)
      if (!claim) {
        addError(errors, `$.scenes[${index}] references unknown claim ${claimId}`)
        continue
      }
      expectedClaimText.push(typeof claim.text === 'string' ? claim.text : '')
      const count = (claimUseCount.get(claimId) || 0) + 1
      claimUseCount.set(claimId, count)
      if (count > 1) addError(errors, `claim ${claimId} is referenced more than once`)
      if (scene.visualType === 'persona_i2v' && claim.claimType === 'performance_proof') {
        addError(errors, `$.scenes[${index}] persona_i2v cannot be product performance evidence`)
      }
    }

    const expected = expectedClaimText.map(normalizeClaimCoverageText).join('')
    const approvedTexts = scene.visualType === 'persona_i2v'
      ? [scene.dialogueText, scene.subtitleText]
      : [scene.subtitleText]
    for (const approvedText of approvedTexts) {
      if (typeof approvedText === 'string' && normalizeClaimCoverageText(approvedText) !== expected) {
        addError(errors, `$.scenes[${index}] claim coverage mismatch`)
      }
    }

    for (const approvedText of approvedTexts) {
      if (typeof approvedText !== 'string') continue
      const normalizedApproved = normalizeClaimCoverageText(approvedText)
      for (const prohibited of prohibitedClaims) {
        if (prohibited.text && normalizedApproved.includes(prohibited.text)) {
          addError(errors, `$.scenes[${index}] overlaps prohibited claim ${prohibited.id}`)
        }
      }
      for (const phrase of FORBIDDEN_EVIDENCE_PHRASES) {
        if (normalizedApproved.includes(normalizeClaimCoverageText(phrase))) {
          addError(errors, `$.scenes[${index}] contains forbidden experience/social-proof language`)
        }
      }
    }
  }

  for (const claimId of claimById.keys()) {
    if (!claimUseCount.has(claimId)) addError(errors, `claim ${claimId} is not referenced by a scene`)
  }

  if (cursor >= 60000) addError(errors, 'total timeline must be less than 60000ms')

  const substantiveHook = timeline.some(({ scene, startMs }) => (
    startMs < 2000
    && (Array.isArray(scene.claimIds) ? scene.claimIds : [])
      .some((claimId) => FACT_REQUIRED_CLAIM_TYPES.has(claimById.get(claimId)?.claimType))
  ))
  if (!substantiveHook) addError(errors, 'first 2000ms must contain an approved product/problem/price hook')

  const ctaCutoff = cursor - 3000
  const hasFinalCta = timeline.some(({ scene, endMs }) => (
    endMs > ctaCutoff
    && (Array.isArray(scene.claimIds) ? scene.claimIds : [])
      .some((claimId) => claimById.get(claimId)?.claimType === 'cta')
  ))
  if (!hasFinalCta) addError(errors, 'CTA must occur within the final 3000ms')
}

export function validateShoppingPlanDraft(draft) {
  const errors = []
  if (!checkObject(draft, '$', PLAN_KEYS, PLAN_KEYS, errors)) return { valid: false, errors }

  checkEnum(draft.schemaVersion, '$.schemaVersion', ['shopping-plan/3-appnative'], errors)
  const { selectedProductImageIds, manualFactIds } = validateProduct(draft.product, errors)
  const decisionByFactId = validateFactDecisions(draft.factDecisions, manualFactIds, errors)
  const prohibitedClaims = validateProhibitedClaims(draft.prohibitedClaims, errors)
  validatePersona(draft.persona, errors)
  validateCreative(draft.creative, errors)
  validateGeneration(draft.generation, errors)
  const claimById = validateClaims(draft.claims, decisionByFactId, errors)
  validateScenes(draft.scenes, claimById, prohibitedClaims, selectedProductImageIds, errors)

  return { valid: errors.length === 0, errors }
}
