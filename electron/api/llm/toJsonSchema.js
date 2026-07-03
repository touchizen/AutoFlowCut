/** Gemini responseSchema(대문자 타입)를 JSON Schema(소문자)로 재귀 변환. */
const TYPE_MAP = {
  OBJECT: 'object', ARRAY: 'array', STRING: 'string',
  INTEGER: 'integer', NUMBER: 'number', BOOLEAN: 'boolean',
}

export function toJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out.type = TYPE_MAP[v] || v.toLowerCase()
    else if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toJsonSchema(pv)]))
    } else if (k === 'items') out.items = toJsonSchema(v)
    else out[k] = v
  }
  return out
}
