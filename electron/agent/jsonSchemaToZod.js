import { z } from 'zod'

/** 툴 표의 JSON-Schema → zod. adapter와 main이 이 한 함수를 함께 쓴다. */
export function zodFromJson(schema) {
  const describe = (converted, node) => typeof node?.description === 'string'
    ? converted.describe(node.description)
    : converted

  const convert = (node = {}) => {
    if (Array.isArray(node.oneOf) && node.oneOf.length) return describe(z.union(node.oneOf.map(convert)), node)
    if (Array.isArray(node.anyOf) && node.anyOf.length) return describe(z.union(node.anyOf.map(convert)), node)
    if (Object.hasOwn(node, 'const')) return describe(z.literal(node.const), node)
    if (Array.isArray(node.enum) && node.enum.length) return describe(z.enum(node.enum), node)
    if (node.type === 'number') return describe(z.number(), node)
    if (node.type === 'boolean') return describe(z.boolean(), node)
    if (node.type === 'null') return describe(z.null(), node)
    if (node.type === 'array') return describe(z.array(node.items ? convert(node.items) : z.any()), node)
    if (node.type === 'string') {
      let string = z.string()
      if (Number.isInteger(node.minLength) && node.minLength >= 0) string = string.min(node.minLength)
      if (typeof node.pattern === 'string') string = string.regex(new RegExp(node.pattern))
      return describe(string, node)
    }
    if (node.type !== 'object') {
      throw new Error(`Unsupported JSON Schema: ${JSON.stringify(node)}`)
    }

    const shape = {}
    for (const [key, prop] of Object.entries(node.properties ?? {})) {
      let child = convert(prop)
      if (!(node.required ?? []).includes(key)) child = child.optional()
      shape[key] = child
    }
    if (!Object.keys(node.properties ?? {}).length && node.additionalProperties !== false) {
      const value = node.additionalProperties && typeof node.additionalProperties === 'object'
        ? convert(node.additionalProperties)
        : z.any()
      return describe(z.record(z.string(), value), node)
    }
    const object = node.additionalProperties === false
      ? z.object(shape).strict()
      : node.additionalProperties && typeof node.additionalProperties === 'object'
        ? z.object(shape).catchall(convert(node.additionalProperties))
        : z.object(shape).passthrough()
    const rule = node.dependentPropertyWhitelist
    if (!rule) return describe(object, node)
    return describe(object.superRefine((value, ctx) => {
      const allowed = rule.allowed?.[value?.[rule.discriminator]]
      const target = value?.[rule.target]
      if (!Array.isArray(allowed) || target === undefined) return
      for (const key of Object.keys(target)) {
        if (allowed.includes(key)) continue
        ctx.addIssue({
          code: 'custom',
          path: [rule.target, key],
          message: `${key} is not allowed for ${value[rule.discriminator]}`,
        })
      }
    }), node)
  }
  return convert(schema)
}

/** Zod의 union 중첩 issue를 기존 `{ params: ['field'] }` 반환 계약으로 접는다. */
export function invalidParamNames(error) {
  const names = new Set()

  function collect(issue, prefix = []) {
    const path = [...prefix, ...(issue.path ?? [])]
    if (issue.code === 'invalid_union' && Array.isArray(issue.errors)) {
      for (const branch of issue.errors) {
        for (const nested of branch) collect(nested, path)
      }
      return
    }
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      for (const key of issue.keys) names.add(String(key))
      return
    }
    names.add(String(path.at(-1) ?? '$'))
  }

  for (const issue of error?.issues ?? []) collect(issue)
  return [...names].sort()
}
