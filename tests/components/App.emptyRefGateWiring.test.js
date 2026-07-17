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

const countOccurrences = (text, token) => text.split(token).length - 1

const flowBlockContainingCoordinator = (text) => {
  const callIndex = text.indexOf('runEmptyRefGateFlow(')
  const guardIndex = text.lastIndexOf(
    "if (modeRef.current === 'flow') {",
    callIndex
  )
  if (callIndex < 0 || guardIndex < 0) return null

  const braceIndex = text.indexOf('{', guardIndex)
  let depth = 0
  for (let i = braceIndex; i < text.length; i++) {
    if (text[i] === '{') depth += 1
    if (text[i] !== '}') continue
    depth -= 1
    if (depth === 0) {
      return callIndex < i ? text.slice(guardIndex, i + 1) : null
    }
  }
  return null
}

const handleStartImpl = sliceBetween('const handleStartImpl', 'const handleStart =')
const emptyRefDepsFactory = sliceBetween(
  'const getEmptyRefGateDeps',
  'const handleStartImpl'
)
const directImageCases = sliceBetween(
  "case 'text':",
  "case 'video-text':",
  source.indexOf('const handleStartImpl')
)
const tagProceed = sliceBetween(
  'const handleTagValidationProceed',
  'const handleTagValidationCancel'
)
const syncProceed = sliceBetween(
  'const handleSyncGateProceed',
  'const handleSyncGateCancel'
)
const stylePicker = sliceBetween('<StylePicker', '{showAudioResult &&')
const emptyRefModal = sliceBetween(
  '{emptyRefGate && (',
  '{/* #R34: 생성 전 미동기화'
)
const handleStopImpl = sliceBetween(
  'const handleStop =',
  '// MCP HTTP 서버'
)
const referencePanel = sliceBetween(
  '<ReferencePanel',
  '<PreviewMonitor'
)

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
    for (const handler of [directImageCases, tagProceed]) {
      const flowBlock = flowBlockContainingCoordinator(handler)

      expect(countOccurrences(handler, 'runEmptyRefGateFlow(')).toBe(1)
      expect(flowBlock).not.toBeNull()
      expect(flowBlock).toContain('runEmptyRefGateFlow(')
    }
  })

  it('Flow guard 밖의 coordinator 호출은 wiring 검증을 통과하지 못한다', () => {
    const misplaced = `
      if (modeRef.current === 'flow') {
        prepareFlow()
      }
      runEmptyRefGateFlow({})
    `

    expect(flowBlockContainingCoordinator(misplaced)).toBeNull()
  })

  it('project invariant는 useAppSettings의 live projectNameRef를 읽는다', () => {
    expect(source).toContain(
      'const { settings, setSettings, updateSetting, ensureProjectName, projectNameRef } = useAppSettings()'
    )
    expect(source).toContain('getProjectName: () => projectNameRef.current')
    expect(source).not.toContain('getProjectName: ensureProjectName')
  })

  it('두 Flow 이미지 시작 경로 모두 no-live-targets를 기존 완료 안내로 알린다', () => {
    for (const handler of [directImageCases, tagProceed]) {
      const flowBlock = flowBlockContainingCoordinator(handler)

      expect(flowBlock).toContain('const gateResult = await runEmptyRefGateFlow(')
      expect(flowBlock).toContain("if (gateResult.reason === 'no-live-targets')")
      expect(flowBlock).toContain("toast.warning(t('toast.allScenesGenerated'))")
    }
  })

  it('caller source로 MCP는 non-interactive gate view, UI는 modal view를 선택한다', () => {
    expect(source).toContain(
      "gateView: source === 'mcp' ? nonInteractiveGateView : emptyRefGateView"
    )
    expect(emptyRefDepsFactory).toMatch(
      /buildEmptyRefGateDeps\(\{\s*source,/
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

  // busy 에는 모달 자체가 없다 — 모달이 열려 있으면 layout.js 가 Flow WebContentsView 를 0×0 으로
  // 줄여 sendInputEvent 기반 DOM 자동화가 죽는다(자기가 기다리는 생성을 자기가 막는 데드락).
  // 큐 대기/아이템 preflight 에서는 refBatchRunning 이 잠시 false 여도 gate phase 는 계속 busy 다.
  it('gate busy 중지는 ref batch lifecycle flag의 빈틈에서도 앱 Stop으로 도달한다', () => {
    expect(emptyRefModal).not.toContain('onStop=')
    expect(handleStopImpl).toContain("emptyRefGate?.phase === 'busy'")
    expect(handleStopImpl).toContain('stopGenerateAllRefs()')
  })

  it('gate pending latch를 ReferencePanel 진입점 비활성화에 전달한다', () => {
    expect(referencePanel).toContain('hasPendingBatch={hasPendingBatch}')
  })
})
