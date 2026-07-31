export function createTargetRegistry(definitions = {}) {
  const table = Object.assign(Object.create(null), definitions)
  const has = (name) => Object.hasOwn(table, name)
  const get = (name) => has(name) ? table[name] : null
  const create = (name, method, args) => {
    const definition = get(name)
    if (!definition || typeof definition[method] !== 'function') return null
    return definition[method](...args)
  }

  return {
    table,
    has,
    get,
    createView: (name, ...args) => create(name, 'createView', args),
    createAdapter: (name, ...args) => create(name, 'createAdapter', args),
  }
}

export default createTargetRegistry
