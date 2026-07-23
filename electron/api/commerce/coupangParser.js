const TRUST = 'untrusted-web-data'

const LIMITS = Object.freeze({
  htmlBytes: 2 * 1024 * 1024,
  jsonLdChars: 512 * 1024,
  jsonLdScripts: 32,
  metaValuesPerProperty: 20,
  depth: 32,
  nodes: 10_000,
  arrayLength: 1_000,
  images: 20,
  sourceUrl: 2_048,
  name: 500,
  sku: 200,
  description: 5_000,
  url: 2_048,
  availability: 500,
  currency: 16,
  numericText: 64,
})

const OG_PROPERTIES = new Set([
  'og:title',
  'og:description',
  'og:image',
  'product:price:amount',
  'product:price:currency',
  'og:url',
])

const STRIKETHROUGH_PRICE_TYPES = new Set([
  'StrikethroughPrice',
  'https://schema.org/StrikethroughPrice',
  'http://schema.org/StrikethroughPrice',
])

const IMAGE_EXTENSIONS = new Set(['jpeg', 'jpg', 'png', 'webp'])

function unsupported(reason) {
  return { status: 'unsupported', trust: TRUST, reason }
}

function boundedString(value, maxLength) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) return undefined
  return normalized
}

function finiteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
      ? value
      : undefined
  }
  const text = boundedString(value, LIMITS.numericText)
  if (!text || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    return undefined
  }
  const parsed = Number(text)
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER
    ? parsed
    : undefined
}

function positiveNumber(value) {
  const number = finiteNumber(value)
  return number != null && number > 0 ? number : undefined
}

function ratingCount(value) {
  const number = finiteNumber(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined
}

function currencyCode(value) {
  const text = boundedString(value, LIMITS.currency)
  return text && /^[a-z]{3}$/i.test(text) ? text.toUpperCase() : undefined
}

function decodeHtmlEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (entity, body) => {
    if (body[0] !== '#') return named[body.toLowerCase()] || entity
    const hexadecimal = body[1]?.toLowerCase() === 'x'
    const codePoint = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
    if (!Number.isInteger(codePoint) || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return entity
    }
    return String.fromCodePoint(codePoint)
  })
}

function findTagEnd(html, start) {
  let quote
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index]
    if (quote) {
      if (character === quote) quote = undefined
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

function parseAttributes(tag, start) {
  const attributes = Object.create(null)
  let index = start

  while (index < tag.length - 1) {
    while (/\s/.test(tag[index])) index += 1
    if (index >= tag.length - 1 || tag[index] === '/') break

    const nameStart = index
    while (index < tag.length - 1 && !/[\s=/>]/.test(tag[index])) index += 1
    const name = tag.slice(nameStart, index).toLowerCase()
    if (!name) {
      index += 1
      continue
    }

    while (/\s/.test(tag[index])) index += 1
    let value = ''
    if (tag[index] === '=') {
      index += 1
      while (/\s/.test(tag[index])) index += 1
      const quote = tag[index] === '"' || tag[index] === "'" ? tag[index] : undefined
      if (quote) {
        index += 1
        const valueStart = index
        while (index < tag.length - 1 && tag[index] !== quote) index += 1
        value = tag.slice(valueStart, index)
        if (tag[index] === quote) index += 1
      } else {
        const valueStart = index
        while (index < tag.length - 1 && !/[\s>]/.test(tag[index])) index += 1
        value = tag.slice(valueStart, index)
      }
    }

    if (!Object.hasOwn(attributes, name)) attributes[name] = decodeHtmlEntities(value)
  }

  return attributes
}

function parseOpeningTag(tag) {
  let index = 1
  while (/\s/.test(tag[index])) index += 1
  if (!tag[index] || tag[index] === '/' || tag[index] === '!' || tag[index] === '?') return undefined

  const nameStart = index
  while (index < tag.length - 1 && /[a-z\d:-]/i.test(tag[index])) index += 1
  const name = tag.slice(nameStart, index).toLowerCase()
  if (!name) return undefined
  return { name, attributes: parseAttributes(tag, index) }
}

function findClosingScript(lowerHtml, start) {
  let index = lowerHtml.indexOf('</script', start)
  while (index !== -1) {
    const character = lowerHtml[index + 8]
    if (character === '>' || /\s/.test(character)) return index
    index = lowerHtml.indexOf('</script', index + 8)
  }
  return -1
}

function scanAllowedMarkup(html) {
  const jsonLdBlocks = []
  const metaValues = new Map()
  const lowerHtml = html.toLowerCase()
  let cursor = 0

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor)
    if (tagStart === -1) break
    const tagEnd = findTagEnd(html, tagStart)
    if (tagEnd === -1) break

    const tag = parseOpeningTag(html.slice(tagStart, tagEnd + 1))
    if (!tag) {
      cursor = tagEnd + 1
      continue
    }

    if (tag.name === 'script') {
      const closeStart = findClosingScript(lowerHtml, tagEnd + 1)
      if (closeStart === -1) break
      const closeEnd = findTagEnd(html, closeStart)
      if (closeEnd === -1) break

      const mediaType = tag.attributes.type?.split(';', 1)[0].trim().toLowerCase()
      const contentLength = closeStart - tagEnd - 1
      if (
        mediaType === 'application/ld+json'
        && jsonLdBlocks.length < LIMITS.jsonLdScripts
        && contentLength <= LIMITS.jsonLdChars
      ) {
        jsonLdBlocks.push(html.slice(tagEnd + 1, closeStart))
      }
      cursor = closeEnd + 1
      continue
    }

    if (tag.name === 'meta') {
      const property = boundedString(tag.attributes.property, 100)?.toLowerCase()
      const content = boundedString(tag.attributes.content, LIMITS.description)
      if (property && content && OG_PROPERTIES.has(property)) {
        const values = metaValues.get(property) || []
        if (values.length < LIMITS.metaValuesPerProperty) values.push(content)
        metaValues.set(property, values)
      }
    }

    cursor = tagEnd + 1
  }

  return { jsonLdBlocks, metaValues }
}

function jsonPathProperty(path, property) {
  return /^[a-z_$][a-z\d_$]*$/i.test(property)
    ? `${path}.${property}`
    : `${path}[${JSON.stringify(property)}]`
}

function inspectJsonLd(root) {
  const stack = [{ value: root, depth: 0, path: '$' }]
  let nodes = 0
  let product

  while (stack.length > 0) {
    const current = stack.pop()
    nodes += 1
    if (nodes > LIMITS.nodes || current.depth > LIMITS.depth) return undefined

    if (Array.isArray(current.value)) {
      if (current.value.length > LIMITS.arrayLength) return undefined
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
        })
      }
      continue
    }

    if (!current.value || typeof current.value !== 'object') continue
    const type = current.value['@type']
    const isProduct = Array.isArray(type) ? type.includes('Product') : type === 'Product'
    if (!product && isProduct) product = current

    const entries = Object.entries(current.value)
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [property, value] = entries[index]
      stack.push({
        value,
        depth: current.depth + 1,
        path: jsonPathProperty(current.path, property),
      })
    }
  }

  return product
}

function findProduct(jsonLdBlocks) {
  for (const block of jsonLdBlocks) {
    let parsed
    try {
      parsed = JSON.parse(block)
    } catch {
      continue
    }
    const product = inspectJsonLd(parsed)
    if (product) return product
  }
  return undefined
}

function normalizeHttpsUrl(value) {
  const text = boundedString(value, LIMITS.url)
  if (!text) return undefined
  const candidate = text.startsWith('//') ? `https:${text}` : text
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function normalizeImageUrl(value) {
  const normalized = normalizeHttpsUrl(value)
  if (!normalized) return undefined
  const extension = new URL(normalized).pathname.toLowerCase().match(/\.([a-z\d]+)$/)?.[1]
  return extension && !IMAGE_EXTENSIONS.has(extension) ? undefined : normalized
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstRecord(value) {
  if (isRecord(value)) return { value, suffix: '' }
  if (!Array.isArray(value)) return undefined
  const index = value.findIndex(isRecord)
  return index === -1 ? undefined : { value: value[index], suffix: `[${index}]` }
}

function makeState(sourceUrl) {
  return {
    sourceUrl,
    product: {},
    imageUrls: [],
    imageSet: new Set(),
    sourceFacts: [],
    listCandidate: undefined,
  }
}

function addFact(state, field, value, jsonPathOrProperty, sourceKind) {
  state.sourceFacts.push({
    field,
    value,
    sourceKind,
    sourceUrl: state.sourceUrl,
    jsonPathOrProperty,
    verification: 'page-asserted',
    trust: TRUST,
  })
}

function setProductField(state, field, value, jsonPathOrProperty, sourceKind) {
  if (value === undefined || Object.hasOwn(state.product, field)) return false
  state.product[field] = value
  addFact(state, field, value, jsonPathOrProperty, sourceKind)
  return true
}

function addImage(state, value, jsonPathOrProperty, sourceKind) {
  if (state.imageUrls.length >= LIMITS.images) return
  const normalized = normalizeImageUrl(value)
  if (!normalized || state.imageSet.has(normalized)) return
  state.imageSet.add(normalized)
  state.imageUrls.push(normalized)
  addFact(state, 'imageUrls', normalized, jsonPathOrProperty, sourceKind)
}

function addJsonLdImages(state, value, path) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      addImage(state, value[index], `${path}[${index}]`, 'jsonld')
    }
  } else {
    addImage(state, value, path, 'jsonld')
  }
}

function extractJsonLd(productNode, state) {
  if (!productNode) return
  const node = productNode.value
  const path = productNode.path

  setProductField(state, 'name', boundedString(node.name, LIMITS.name), `${path}.name`, 'jsonld')
  setProductField(state, 'sku', boundedString(node.sku, LIMITS.sku), `${path}.sku`, 'jsonld')
  setProductField(
    state,
    'description',
    boundedString(node.description, LIMITS.description),
    `${path}.description`,
    'jsonld',
  )
  addJsonLdImages(state, node.image, `${path}.image`)

  if (isRecord(node.aggregateRating)) {
    const rating = {}
    const value = finiteNumber(node.aggregateRating.ratingValue)
    const count = ratingCount(node.aggregateRating.ratingCount)
    if (value != null && value >= 0) {
      rating.value = value
      addFact(state, 'rating.value', value, `${path}.aggregateRating.ratingValue`, 'jsonld')
    }
    if (count != null) {
      rating.count = count
      addFact(state, 'rating.count', count, `${path}.aggregateRating.ratingCount`, 'jsonld')
    }
    if (Object.keys(rating).length > 0) state.product.rating = rating
  }

  const selectedOffer = firstRecord(node.offers)
  if (!selectedOffer) return
  const offer = selectedOffer.value
  const offerPath = `${path}.offers${selectedOffer.suffix}`
  setProductField(state, 'priceKrw', positiveNumber(offer.price), `${offerPath}.price`, 'jsonld')
  setProductField(
    state,
    'currency',
    currencyCode(offer.priceCurrency),
    `${offerPath}.priceCurrency`,
    'jsonld',
  )
  setProductField(
    state,
    'availability',
    boundedString(offer.availability, LIMITS.availability),
    `${offerPath}.availability`,
    'jsonld',
  )

  const specifications = Array.isArray(offer.priceSpecification)
    ? offer.priceSpecification
    : [offer.priceSpecification]
  for (let index = 0; index < specifications.length; index += 1) {
    const specification = specifications[index]
    const priceType = isRecord(specification)
      ? boundedString(specification.priceType, LIMITS.url)
      : undefined
    const price = isRecord(specification) ? positiveNumber(specification.price) : undefined
    if (!STRIKETHROUGH_PRICE_TYPES.has(priceType) || price == null) continue
    const suffix = Array.isArray(offer.priceSpecification) ? `[${index}]` : ''
    state.listCandidate = {
      value: price,
      currency: currencyCode(specification.priceCurrency),
      path: `${offerPath}.priceSpecification${suffix}.price`,
      sourceKind: 'jsonld',
    }
    break
  }
}

function firstMetaValue(metaValues, property, transform) {
  for (const value of metaValues.get(property) || []) {
    const transformed = transform(value)
    if (transformed !== undefined) return transformed
  }
  return undefined
}

function fillFromOg(metaValues, state) {
  setProductField(
    state,
    'name',
    firstMetaValue(metaValues, 'og:title', (value) => boundedString(value, LIMITS.name)),
    'og:title',
    'og',
  )
  setProductField(
    state,
    'description',
    firstMetaValue(metaValues, 'og:description', (value) => boundedString(value, LIMITS.description)),
    'og:description',
    'og',
  )
  if (state.imageUrls.length === 0) {
    const image = firstMetaValue(metaValues, 'og:image', normalizeImageUrl)
    if (image) addImage(state, image, 'og:image', 'og')
  }
  setProductField(
    state,
    'priceKrw',
    firstMetaValue(metaValues, 'product:price:amount', positiveNumber),
    'product:price:amount',
    'og',
  )
  setProductField(
    state,
    'currency',
    firstMetaValue(metaValues, 'product:price:currency', currencyCode),
    'product:price:currency',
    'og',
  )
  setProductField(
    state,
    'url',
    firstMetaValue(metaValues, 'og:url', normalizeHttpsUrl),
    'og:url',
    'og',
  )
}

function finalizeDerivedFields(state) {
  const saleCurrency = state.product.currency
  const listCurrency = state.listCandidate?.currency || saleCurrency
  if (
    state.listCandidate
    && (!state.listCandidate.currency || !saleCurrency || state.listCandidate.currency === saleCurrency)
  ) {
    setProductField(
      state,
      'listPriceKrw',
      state.listCandidate.value,
      state.listCandidate.path,
      state.listCandidate.sourceKind,
    )
  }

  const salePrice = state.product.priceKrw
  const listPrice = state.product.listPriceKrw
  if (
    salePrice > 0
    && listPrice > salePrice
    && saleCurrency
    && listCurrency === saleCurrency
  ) {
    state.product.discountPercent = Math.round(((listPrice - salePrice) / listPrice) * 100)
  }
}

/**
 * Parses allowlisted product facts from Coupang HTML without executing scripts or using the network.
 *
 * @param {string} html
 * @param {{ sourceUrl: string }} options
 * @returns {{
 *   status: 'ok'|'unsupported',
 *   trust: 'untrusted-web-data',
 *   product?: object,
 *   sourceFacts?: Array<{
 *     field: string,
 *     value: unknown,
 *     sourceKind: 'jsonld'|'og',
 *     sourceUrl: string,
 *     jsonPathOrProperty: string,
 *     verification: 'page-asserted',
 *     trust: 'untrusted-web-data',
 *   }>,
 *   imageUrls?: string[],
 *   reason?: string,
 * }}
 * Source fact id and fetchedAt are stamped by M1c, which owns the actual fetch.
 */
export function parseCoupangProduct(html, options = {}) {
  const sourceUrl = boundedString(options?.sourceUrl, LIMITS.sourceUrl)
  if (typeof html !== 'string' || !sourceUrl) return unsupported('Invalid parser input')
  if (Buffer.byteLength(html, 'utf8') > LIMITS.htmlBytes) return unsupported('HTML exceeds parser limit')

  const { jsonLdBlocks, metaValues } = scanAllowedMarkup(html)
  const state = makeState(sourceUrl)
  extractJsonLd(findProduct(jsonLdBlocks), state)
  fillFromOg(metaValues, state)
  finalizeDerivedFields(state)

  if (!state.product.name || state.imageUrls.length === 0) {
    return unsupported('Required product name or image is unavailable')
  }

  return {
    status: 'ok',
    trust: TRUST,
    product: state.product,
    sourceFacts: state.sourceFacts,
    imageUrls: state.imageUrls,
  }
}
