/** Diagnostic evidence only. Serialized into isolated world 994; shared DOM is
 * never changed. Node IDs are local to this document, NOT request ownership. */
export function observeLiveGallery(doc, pageUrl) {
  const selector = 'flow-image-tile, flow-video-tile, [data-tile-id], a[href*="/edit/"]'
  const observerId = doc.defaultView.crypto.randomUUID()
  const ids = new WeakMap()
  let nextId = 0, disconnected = false, truncated = false, dropped = 0
  let remainingChars = 256 * 1024, remainingNodes = 1000
  let changes = []
  const nodeId = node => node ? (ids.get(node) || (ids.set(node, ++nextId), nextId)) : null
  const clip = (value, max = 8192) => {
    const text = String(value || '')
    const limit = Math.min(max, remainingChars)
    if (text.length > limit) truncated = true
    const result = text.slice(0, limit)
    remainingChars -= result.length
    return result
  }
  const safeUrl = value => {
    try {
      const url = new URL(value, pageUrl)
      if (url.protocol !== 'https:') return '[non-https]'
      const params = new URLSearchParams()
      for (const key of ['name', 'id']) if (url.searchParams.has(key)) params.set(key, url.searchParams.get(key))
      return url.origin + url.pathname + (params.size ? '?' + params : '')
    } catch { return '[invalid-url]' }
  }
  const summary = node => {
    const attributes = {}
    let size = 0
    for (const attr of node.attributes || []) {
      if (!/^(?:data-|aria-|id$|class$|role$|alt$|title$|href$|src$)/.test(attr.name)
        || /token|auth|cookie|nonce|secret/i.test(attr.name)) continue
      const value = clip(/^(href|src)$/.test(attr.name) ? safeUrl(attr.value) : attr.value)
      if ((size += value.length) > 16384) { truncated = true; break }
      attributes[attr.name] = value
    }
    return { id: nodeId(node), parentId: nodeId(node.parentElement), tag: node.localName,
      connected: node.isConnected, attributes,
      text: clip([...node.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('')),
      ...(node.localName === 'img' ? { currentSrc: clip(safeUrl(node.currentSrc || node.getAttribute('src') || '')),
        width: node.naturalWidth, height: node.naturalHeight } : {}) }
  }
  const inside = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest(selector)
  const containsGallery = node => node?.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))
  const collect = (root, limit = 600, galleryOnly = false) => {
    const nodes = []
    const walk = node => {
      if (node.nodeType !== 1 || node.matches('input, textarea, script, style, flow-rich-text-editor, [contenteditable="true"]')) return
      if (galleryOnly && !inside(node) && !containsGallery(node)) return
      if (nodes.length >= limit || remainingNodes <= 0) { truncated = true; return }
      remainingNodes--
      nodes.push({ ...summary(node), ...(!inside(node) ? { text: '' } : {}) })
      for (const child of node.children) walk(child)
    }
    walk(root)
    return nodes
  }
  const process = records => {
    for (const m of records) {
      if (m.type === 'attributes' && !/^(?:data-|aria-|id$|class$|role$|alt$|title$|href$|src$)/.test(m.attributeName)) continue
      const targetInside = !!inside(m.target)
      if (!targetInside && ![...m.addedNodes, ...m.removedNodes].some(containsGallery)) continue
      if (changes.length >= 200) { truncated = true; dropped++; continue }
      const nodes = list => [...list].flatMap(n => {
        if (n.nodeType === 3 && targetInside) {
          if (remainingNodes <= 0) { truncated = true; return [] }
          remainingNodes--
          return [{ id: nodeId(n), parentId: nodeId(m.target), tag: '#text', text: clip(n.nodeValue), attributes: {} }]
        }
        return n.nodeType === 1 && (targetInside || containsGallery(n)) ? collect(n, 30, !targetInside) : []
      })
      changes.push({ at: Date.now(), type: m.type, targetId: nodeId(m.target), parentId: nodeId(m.target.parentElement),
        attribute: m.attributeName, oldValue: m.type === 'attributes'
          ? (/token|auth|cookie|nonce|secret/i.test(m.attributeName) ? '[redacted]'
            : clip(/^(href|src)$/.test(m.attributeName) ? safeUrl(m.oldValue) : m.oldValue))
          : m.type === 'characterData' ? clip(m.oldValue) : null,
        ...(m.type === 'characterData' ? { text: clip(m.target.nodeValue) } : {}),
        added: nodes(m.addedNodes), removed: nodes(m.removedNodes) })
    }
  }
  const observer = new doc.defaultView.MutationObserver(process)
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true,
    attributeOldValue: true, characterData: true, characterDataOldValue: true })
  return {
    read() {
      if (disconnected) return { disconnected: true, cards: [], mutations: [] }
      process(observer.takeRecords())
      const roots = [...doc.querySelectorAll(selector)].filter(n => !n.parentElement?.closest(selector))
      if (roots.length > 30) truncated = true
      const cards = roots.slice(0, 30).map(root => {
        const ancestors = []
        for (let node = root.parentElement; node && node !== doc.body && ancestors.length < 8; node = node.parentElement) {
          // Do not copy sibling text/user content from gallery containers.
          ancestors.push({ ...summary(node), text: '' })
        }
        return { rootId: nodeId(root), ancestors, nodes: collect(root) }
      })
      const result = { at: Date.now(), observerId, timeOrigin: doc.defaultView.performance.timeOrigin,
        page: safeUrl(pageUrl), cards, mutations: changes, truncated, dropped }
      changes = []; truncated = false; dropped = 0
      remainingChars = 256 * 1024; remainingNodes = 1000
      return result
    },
    disconnect() { disconnected = true; observer.disconnect(); changes = [] },
  }
}

export function liveGalleryCode(token, action = 'read') {
  const slot = `globalThis[${JSON.stringify(token)}]`
  if (action === 'stop') return `(() => { ${slot}?.disconnect(); delete ${slot}; return true })()`
  return `(() => { ${slot} ||= (${observeLiveGallery.toString()})(document, location.href); return ${slot}.read() })()`
}
