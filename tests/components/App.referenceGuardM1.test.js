// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  new URL('../../src/App.jsx', import.meta.url),
  'utf8'
)
const implStart = source.indexOf('const handleStartImpl')
const implEnd = source.indexOf('const handleStart =', implStart)
const handleStartImpl = source.slice(implStart, implEnd)

describe('App handleStart M1 reference guard wiring', () => {
  it('persists mention tag merges before auth and other asynchronous preflight', () => {
    const mergeIndex = handleStartImpl.indexOf('planMentionTagMerges(')
    const authIndex = handleStartImpl.indexOf('genAPI.getAccessToken(')

    expect(mergeIndex).toBeGreaterThan(-1)
    expect(authIndex).toBeGreaterThan(-1)
    expect(mergeIndex).toBeLessThan(authIndex)
    expect(handleStartImpl).toContain(
      'scenesHook.updateScene(patch.sceneId, { characters: patch.characters })'
    )
  })

  it('uses the existing matcher and carries run-local mention exclusions into startOptions', () => {
    expect(handleStartImpl).toContain(
      'collectM1FlowReferenceExclusions('
    )
    expect(handleStartImpl).toContain(
      'scenesHook.getMatchingReferences'
    )
    expect(handleStartImpl).toContain(
      'm1ExcludedMentionNamesBySceneId: m1FlowGuard.mentionNamesBySceneId'
    )
  })

  it('shows one primary warning from the M1 exclusion summary', () => {
    expect(handleStartImpl).toContain(
      'buildM1FlowReferenceExclusionToast(m1FlowGuard.exclusions)'
    )
    expect(handleStartImpl).toContain(
      'toast.warning(t(exclusionToast.key, exclusionToast.params))'
    )
  })

  it('strips excluded mentions before direct and tag-proceed sync selection', () => {
    const tagProceedStart = source.indexOf(
      'const handleTagValidationProceed'
    )
    const tagProceedEnd = source.indexOf(
      'const handleTagValidationCancel',
      tagProceedStart
    )
    const tagProceed = source.slice(tagProceedStart, tagProceedEnd)

    expect(handleStartImpl).toContain('applyM1MentionExclusions(')
    expect(handleStartImpl).toContain('.filter(flowSyncable)')
    expect(tagProceed).toContain('applyM1MentionExclusions(')
    expect(tagProceed).toContain('.filter(flowSyncable)')
  })
})
