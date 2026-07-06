/** Gemini responseSchema(대문자 타입)를 JSON Schema(소문자)로 재귀 변환. */
const TYPE_MAP = {
  OBJECT: 'object', ARRAY: 'array', STRING: 'string',
  INTEGER: 'integer', NUMBER: 'number', BOOLEAN: 'boolean',
}

function nullable(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const out = { ...schema }
  if (Array.isArray(out.type)) {
    out.type = out.type.includes('null') ? out.type : [...out.type, 'null']
  } else if (typeof out.type === 'string') {
    out.type = [out.type, 'null']
  } else if (Array.isArray(out.anyOf)) {
    out.anyOf = [...out.anyOf, { type: 'null' }]
  } else {
    out.anyOf = [{ ...out }, { type: 'null' }]
  }
  if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null]
  return out
}

export function toJsonSchema(schema, { openAiStrict = false } = {}) {
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  const sourceRequired = new Set(Array.isArray(schema.required) ? schema.required : [])
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out.type = TYPE_MAP[v] || v.toLowerCase()
    else if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => {
        const converted = toJsonSchema(pv, { openAiStrict })
        return [pk, openAiStrict && !sourceRequired.has(pk) ? nullable(converted) : converted]
      }))
    } else if (k === 'items') out.items = toJsonSchema(v, { openAiStrict })
    else out[k] = v
  }
  if (openAiStrict && out.type === 'object') {
    const propertyNames = Object.keys(out.properties || {})
    if (propertyNames.length > 0) out.required = propertyNames
    out.additionalProperties = false
  }
  return out
}

export function toOpenAiJsonSchema(schema) {
  return toJsonSchema(schema, { openAiStrict: true })
}
