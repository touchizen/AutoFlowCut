import { isRefSynced } from './flowCharacterSync'
import { resolveMentions, stripMentionsForNames } from './mentionParser'
import { normalizeTagKey } from './tagMatch'

export function sourceAvailable(ref) {
  return !!(ref?.data || ref?.filePath || ref?.imagePath)
}

export function flowImageInjectable(ref) {
  return !!ref?.mediaId
}

export function flowMentionEligible(ref) {
  return isRefSynced(ref)
}

export function flowRegistrationRepairable(ref) {
  return !!(ref?.entityId && ref?.workflowId)
}

export function flowSyncable(ref) {
  return flowRegistrationRepairable(ref) ||
    (!flowImageInjectable(ref) && sourceAvailable(ref))
}

export function flowTagCharacterNeedsSync(ref) {
  return !flowImageInjectable(ref) && sourceAvailable(ref)
}

function m1RefKey(ref) {
  if (ref?.id != null) return `id:${String(ref.id)}`
  return `${ref?.type || ''}:${normalizeTagKey(ref?.name)}`
}

export function collectM1FlowReferenceExclusions(
  scenes = [],
  getMatchingReferences = () => [],
  options = {}
) {
  const filter = options.filter || (() => true)
  const exclusions = []
  const mentionNamesBySceneId = {}

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex]
    if (!filter(scene, sceneIndex)) continue

    const matchedRefs = getMatchingReferences(scene) || []
    const characterRefs = matchedRefs.filter(ref => ref?.type === 'character')
    const { matched: mentionedCharacters } = resolveMentions(
      scene?.prompt || '',
      characterRefs
    )
    const mentionedSet = new Set(mentionedCharacters)
    const seen = new Set()

    for (const ref of matchedRefs) {
      if (!ref) continue
      const refKey = m1RefKey(ref)
      if (seen.has(refKey)) continue
      seen.add(refKey)

      const mentioned = mentionedSet.has(ref)
      const usableAsMention = mentioned && (
        flowMentionEligible(ref) ||
        flowImageInjectable(ref) ||
        flowSyncable(ref)
      )
      const usableAsImage = flowImageInjectable(ref) || (
        ref.type !== 'character' && flowSyncable(ref)
      )

      if (usableAsMention || usableAsImage) continue

      exclusions.push({
        sceneId: scene.id,
        sceneIndex,
        refId: ref.id ?? null,
        refName: String(ref.name || ''),
      })

      if (mentioned && ref.name) {
        const names = mentionNamesBySceneId[scene.id] || []
        names.push(String(ref.name))
        mentionNamesBySceneId[scene.id] = names
      }
    }
  }

  return { exclusions, mentionNamesBySceneId }
}

export function applyM1MentionExclusions(
  scene,
  mentionNamesBySceneId = {}
) {
  if (!scene) return scene
  const names = mentionNamesBySceneId?.[scene.id] || []
  if (names.length === 0) return scene

  return {
    ...scene,
    prompt: stripMentionsForNames(scene.prompt || '', names),
  }
}

export function buildM1FlowReferenceExclusionToast(
  exclusions = [],
  maxSceneGroups = 3
) {
  if (exclusions.length === 0) return null

  const grouped = new Map()
  for (const item of exclusions) {
    let group = grouped.get(item.sceneIndex)
    if (!group) {
      group = { sceneIndex: item.sceneIndex, names: [] }
      grouped.set(item.sceneIndex, group)
    }
    if (!group.names.includes(item.refName)) group.names.push(item.refName)
  }

  const limit = Number.isFinite(maxSceneGroups)
    ? Math.max(1, Math.floor(maxSceneGroups))
    : 3
  const shownGroups = [...grouped.values()].slice(0, limit)
  const details = shownGroups
    .map(group => `#${group.sceneIndex + 1}: ${group.names.join(', ')}`)
    .join(' · ')
  const shownCount = shownGroups.reduce(
    (sum, group) => sum + group.names.length,
    0
  )
  const more = exclusions.length - shownCount

  if (more > 0) {
    return {
      key: 'toast.unusableRefsExcludedMore',
      params: { count: exclusions.length, details, more },
    }
  }

  return {
    key: 'toast.unusableRefsExcluded',
    params: { count: exclusions.length, details },
  }
}
