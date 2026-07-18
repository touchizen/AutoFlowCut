import { resolveMentions } from './mentionParser'
import { normalizeTagKey, splitTags } from './tagMatch'

function collectMentionNamesToAppend(scene, characterRefs) {
  const chars = (characterRefs || []).filter(ref => ref?.type === 'character')
  const { matched } = resolveMentions(scene?.prompt || '', chars)
  const existing = new Set(splitTags(scene?.characters || ''))
  const addedNames = []

  for (const ref of matched) {
    const name = String(ref?.name || '')
    const key = normalizeTagKey(name)
    if (!key || existing.has(key)) continue
    existing.add(key)
    addedNames.push(name)
  }

  return addedNames
}

function appendCharacterNames(currentValue, addedNames) {
  const current = typeof currentValue === 'string' ? currentValue : ''
  if (addedNames.length === 0) return null
  if (!current.trim()) return addedNames.join(', ')
  return `${current}, ${addedNames.join(', ')}`
}

export function mergeMentionsIntoCharacters(scene, characterRefs = []) {
  const addedNames = collectMentionNamesToAppend(scene, characterRefs)
  return appendCharacterNames(scene?.characters, addedNames)
}

export function planMentionTagMerges(
  scenes = [],
  references = [],
  options = {}
) {
  const filter = options.filter || (() => true)
  const characterRefs = (references || []).filter(ref => ref?.type === 'character')
  const patches = []
  const scenePatchesById = {}

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex]
    if (!filter(scene, sceneIndex)) continue

    const addedNames = collectMentionNamesToAppend(scene, characterRefs)
    const characters = appendCharacterNames(scene?.characters, addedNames)
    if (characters == null) continue

    const patch = {
      sceneId: scene.id,
      sceneIndex,
      characters,
      addedNames,
    }
    patches.push(patch)
    scenePatchesById[scene.id] = { characters }
  }

  return { patches, scenePatchesById }
}
