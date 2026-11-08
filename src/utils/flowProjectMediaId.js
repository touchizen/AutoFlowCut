// Saved Flow media can be selected without the local original. Older opaque API IDs
// are not Flow media UUIDs and still need a local source.
export function isFlowProjectMediaId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
}
