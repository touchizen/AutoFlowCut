export const ROSTER_GATED_INPUT_TYPES = new Set(['title', 'pasted', 'storyboard'])

export function isRosterGatedInputType(type) {
  return ROSTER_GATED_INPUT_TYPES.has(type)
}

export function synopsisModeForInputType(type) {
  if (type === 'pasted' || type === 'storyboard') return 'pasted'
  if (type === 'title') return 'title'
  return null
}
