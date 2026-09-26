/**
 * 동기화 대상 선정 — M3(계획서 docs/plans/2026-09-25-flow-M3-references-plan.md D15)에서 퇴역.
 *
 * 새 Flow(flow.google.com)엔 캐릭터 entity 동기화가 없고, 엔진은 @멘션을 로컬 이미지 인라인 멘션으로 붙인다(planFlowReferenceComposition —
 * parseSceneMentions 를 쓰지 않는다). "파서가 둘이면 어긋난다" — 그래서 대상은 항상 없다: 프리플라이트(emptyRefGate·App)는 모달 없이 통과하고,
 * 엔진이 미해결로 거절한 뒤의 복구(names)도 고칠 대상이 없다(오타·없는 이름은 동기화로 고칠 수 없다). MCP 의 비대화 게이트도 멘션 배치를 취소하지 않는다.
 */
import { describe, it, expect } from 'vitest'
import { selectMentionSyncTargets } from '../../src/utils/mentionSyncTargets'

const ch = (name, over = {}) => ({
  id: name, type: 'character', name,
  entityId: `e-${name}`, workflowId: `w-${name}`, mediaId: `m-${name}`,
  flowNameSyncStatus: 'synced', filePath: `/p/${name}.png`,
  ...over,
})

describe('selectMentionSyncTargets (M3 — 퇴역: 항상 [])', () => {
  it('프리플라이트: 미동기화 캐릭터를 멘션해도 [] — 옛 entity 동기화 모달을 띄우지 않는다', () => {
    const refs = [ch('박씨'), ch('문지기', { flowNameSyncStatus: 'failed' })]
    expect(selectMentionSyncTargets({ scene: { prompt: '@문지기 가 @박씨 를 막아선다' }, references: refs })).toEqual([])
  })

  it('이름이 주어져도(엔진 거절 뒤 복구) [] — 동기화로 고칠 수 있는 게 없다', () => {
    const refs = [ch('문지기', { flowNameSyncStatus: 'failed' })]
    expect(selectMentionSyncTargets({ names: ['문지기'], references: refs })).toEqual([])
  })

  it('여러 씬을 합쳐도 [] · 입력이 없어도 터지지 않는다', () => {
    const refs = [ch('문지기', { flowNameSyncStatus: 'failed' }), ch('박씨', { flowNameSyncStatus: 'failed' })]
    const scenes = [{ prompt: '@문지기 등장' }, { prompt: '@박씨 와 @문지기' }]
    expect(scenes.flatMap(scene => selectMentionSyncTargets({ scene, references: refs }))).toEqual([])
    expect(selectMentionSyncTargets()).toEqual([])
    expect(selectMentionSyncTargets({})).toEqual([])
  })
})
