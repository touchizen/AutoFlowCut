// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  new URL('../../src/App.jsx', import.meta.url),
  'utf8'
)
const coordinatorSource = fs.readFileSync(
  new URL('../../src/services/emptyRefGate.js', import.meta.url),
  'utf8'
)
const implStart = source.indexOf('const handleStartImpl')
const implEnd = source.indexOf('const handleStart =', implStart)
const handleStartImpl = source.slice(implStart, implEnd)
const tagProceedStart = source.indexOf('const handleTagValidationProceed')
const tagProceedEnd = source.indexOf(
  'const handleTagValidationCancel',
  tagProceedStart
)
const tagProceed = source.slice(tagProceedStart, tagProceedEnd)
const depsStart = source.indexOf('const getEmptyRefGateDeps')
const depsEnd = source.indexOf('const handleStartImpl', depsStart)
const depsWiring = source.slice(depsStart, depsEnd)
const coordinatorStart = coordinatorSource.indexOf(
  'export async function runEmptyRefGateFlow'
)
const coordinator = coordinatorSource.slice(coordinatorStart)

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

  it('wires the existing matcher and coordinator carries run-local mention exclusions into final startOptions', () => {
    expect(depsWiring).toContain(
      'getMatchingReferences: scenesHook.getMatchingReferences'
    )
    expect(coordinator).toContain(
      'collectM1FlowReferenceExclusions('
    )
    expect(coordinator).toContain(
      'm1ExcludedMentionNamesBySceneId: m1Result.mentionNamesBySceneId'
    )
  })

  it('coordinator emits one final M1 exclusion event and App renders its primary warning', () => {
    expect(coordinator.match(/deps\.toastM1Exclusions\(m1Result\.exclusions\)/g))
      .toHaveLength(1)
    expect(depsWiring).toContain(
      'buildM1FlowReferenceExclusionToast(exclusions)'
    )
    expect(depsWiring).toContain(
      'toast.warning(t(warning.key, warning.params))'
    )
  })

  it('both direct and tag-proceed delegate to the coordinator that strips M1 mentions before sync selection', () => {
    expect(handleStartImpl).toContain('runEmptyRefGateFlow(')
    expect(tagProceed).toContain('runEmptyRefGateFlow(')
    expect(coordinator).toContain('applyM1MentionExclusions(')
    // 수리 불가능한 ref 걸러내기는 selectMentionSyncTargets 안으로 들어갔다(씬 경로와 같은
    // 셀렉터를 쓰기 위해). 그 동작은 tests/utils/mentionSyncTargets.test.js 가 실행해서 검증한다.
    expect(coordinator).toContain('selectMentionSyncTargets(')
  })
})
