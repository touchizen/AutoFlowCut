// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  new URL('../../src/App.jsx', import.meta.url),
  'utf8'
)

const sliceBetween = (startToken, endToken, from = 0) => {
  const start = source.indexOf(startToken, from)
  const end = source.indexOf(endToken, start)
  return source.slice(start, end)
}

const handleStartImpl = sliceBetween('const handleStartImpl', 'const handleStart =')
const tagProceed = sliceBetween(
  'const handleTagValidationProceed',
  'const handleTagValidationCancel'
)
const syncProceed = sliceBetween(
  'const handleSyncGateProceed',
  'const handleSyncGateCancel'
)
const stylePicker = sliceBetween('<StylePicker', '{showAudioResult &&')

describe('App empty reference gate wiring', () => {
  it('direct 이미지 시작과 tag-proceed가 모두 같은 coordinator를 호출한다', () => {
    expect(handleStartImpl).toContain('runEmptyRefGateFlow(')
    expect(tagProceed).toContain('runEmptyRefGateFlow(')
  })

  it('tag-proceed는 pendingStartOptions의 stale M1 map/scene 객체를 재사용하지 않는다', () => {
    expect(tagProceed).toContain('scenesHook.scenesRef.current')
    expect(tagProceed).not.toContain('opts.m1ExcludedMentionNamesBySceneId')
    expect(tagProceed).not.toContain('__m1ExclusionToast')
    expect(tagProceed).not.toContain('initialTargetScenes:')
  })

  it('sync-proceed의 authoritative seed는 referencesRef.current다', () => {
    expect(syncProceed).toContain('let patchedRefs = referencesRef.current')
    expect(syncProceed).not.toContain('let patchedRefs = scenesHook.references')
  })

  it('M2 coordinator는 Flow 이미지 배치에서만 호출된다', () => {
    for (const handler of [handleStartImpl, tagProceed]) {
      const callIndex = handler.indexOf('runEmptyRefGateFlow(')
      const flowGuardIndex = handler.lastIndexOf(
        "if (modeRef.current === 'flow')",
        callIndex
      )

      expect(callIndex).toBeGreaterThan(-1)
      expect(flowGuardIndex).toBeGreaterThan(-1)
      expect(callIndex - flowGuardIndex).toBeLessThan(1200)
    }
  })

  it('caller source로 MCP는 non-interactive gate view, UI는 modal view를 선택한다', () => {
    expect(source).toContain(
      "gateView: source === 'mcp' ? nonInteractiveGateView : emptyRefGateView"
    )
    expect(handleStartImpl).toContain("const { force = false, source = 'ui' } = options")
    expect(handleStartImpl).toContain('getEmptyRefGateDeps(source)')
    expect(tagProceed).toContain('getEmptyRefGateDeps(__startSource)')
  })

  it('StylePicker 선택은 handleStart로 재진입해 M2 guard를 다시 통과한다 (§11.8)', () => {
    expect(stylePicker).toContain(
      'handleStart(id, { force: pendingStyleForceRef.current })'
    )
    expect(stylePicker).toContain(
      'handleStart(null, { force: pendingStyleForceRef.current })'
    )
    expect(stylePicker).not.toContain('automationStartRef.current(')
  })
})
