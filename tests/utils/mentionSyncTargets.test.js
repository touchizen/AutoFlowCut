/**
 * 동기화 대상 선정 — 개별 씬 생성이 "무엇을 동기화하면 되는가"를 정하는 곳.
 *
 * 여기서 잘못 고르면 사용자는 눌러도 아무것도 바뀌지 않는 모달을 반복해서 보게 된다.
 */
import { describe, it, expect } from 'vitest'
import { selectMentionSyncTargets } from '../../src/utils/mentionSyncTargets'

const ch = (name, over = {}) => ({
  id: name, type: 'character', name,
  entityId: `e-${name}`, workflowId: `w-${name}`, mediaId: `m-${name}`,
  flowNameSyncStatus: 'synced', filePath: `/p/${name}.png`,
  ...over,
})

describe('selectMentionSyncTargets', () => {
  it('프리플라이트: 씬이 멘션한 캐릭터 중 미동기화만 고른다', () => {
    const refs = [ch('박씨'), ch('문지기', { flowNameSyncStatus: 'failed' })]
    const scene = { prompt: '@문지기 가 @박씨 를 막아선다' }

    const targets = selectMentionSyncTargets({ scene, references: refs })

    expect(targets.map(r => r.name)).toEqual(['문지기'])
  })

  it('프리플라이트: 멘션되지 않은 미동기화 캐릭터는 건드리지 않는다', () => {
    const refs = [ch('문지기', { flowNameSyncStatus: 'failed' }), ch('행인', { flowNameSyncStatus: 'failed' })]
    const scene = { prompt: '@문지기 등장' }

    expect(selectMentionSyncTargets({ scene, references: refs }).map(r => r.name)).toEqual(['문지기'])
  })

  it('동기화할 게 없으면 빈 배열 — 호출부는 모달 없이 진행한다', () => {
    const refs = [ch('박씨')]
    expect(selectMentionSyncTargets({ scene: { prompt: '@박씨 등장' }, references: refs })).toEqual([])
  })

  // 엔진이 미해결로 거절했다면 우리 기록이 옛것일 수 있다 — synced 라고 걸러내면 복구가 불가능해진다.
  it('이름이 주어지면 우리 기록이 synced 여도 대상으로 삼는다', () => {
    const refs = [ch('문지기')]  // 기록상 synced

    const targets = selectMentionSyncTargets({ names: ['문지기'], references: refs })

    expect(targets.map(r => r.name)).toEqual(['문지기'])
  })

  // 프리플라이트도 recovery 와 같은 규칙이어야 한다. 예전엔 프리플라이트만 소문자 매칭이라
  // `@hero` 가 미해결인데 다른 ref 'Hero' 를 골라 동기화시키고, 그래도 프롬프트는 안 풀렸다.
  it('프리플라이트도 대소문자를 구분한다', () => {
    const refs = [ch('Hero', { flowNameSyncStatus: 'failed' })]

    expect(selectMentionSyncTargets({ scene: { prompt: '@hero 등장' }, references: refs })).toEqual([])
    expect(selectMentionSyncTargets({ scene: { prompt: '@Hero 등장' }, references: refs }).map(r => r.name)).toEqual(['Hero'])
  })

  // 동기화로 고칠 수 없는 오타 멘션으로 모달을 띄우면 사용자는 눌러도 같은 실패를 본다.
  it('어느 ref 와도 맞지 않는 멘션은 대상이 아니다', () => {
    const refs = [ch('문지기', { flowNameSyncStatus: 'failed' })]

    expect(selectMentionSyncTargets({ scene: { prompt: '@문지기x 등장' }, references: refs })).toEqual([])
  })

  // Flow 멘션 해석은 대소문자를 구분한다. 소문자로 뭉개면 @hero 가 미해결인데 다른 ref 'Hero' 를
  // 골라 "동기화는 했는데 프롬프트는 그대로"인 모달을 반복하게 된다.
  it('이름 대조는 대소문자를 구분한다', () => {
    const refs = [ch('Hero')]

    expect(selectMentionSyncTargets({ names: ['hero'], references: refs })).toEqual([])
    expect(selectMentionSyncTargets({ names: ['Hero'], references: refs }).map(r => r.name)).toEqual(['Hero'])
  })

  // 고칠 수 없는 ref(이미지도 등록정보도 없음)로 모달을 띄우면 눌러도 아무 일이 없다.
  it('수리 불가능한 ref 는 대상에서 뺀다', () => {
    const broken = { id: 'x', type: 'character', name: '유령', entityId: null, workflowId: null, mediaId: null }

    expect(selectMentionSyncTargets({ names: ['유령'], references: [broken] })).toEqual([])
    expect(selectMentionSyncTargets({ scene: { prompt: '@유령 등장' }, references: [broken] })).toEqual([])
  })

  it('캐릭터가 아닌 같은 이름의 ref 는 고르지 않는다', () => {
    const sceneRef = { id: 's', type: 'scene', name: '문지기', mediaId: 'm', filePath: '/p.png' }

    expect(selectMentionSyncTargets({ names: ['문지기'], references: [sceneRef] })).toEqual([])
  })

  it('입력이 없어도 터지지 않는다', () => {
    expect(selectMentionSyncTargets()).toEqual([])
    expect(selectMentionSyncTargets({})).toEqual([])
  })

  // 배치 게이트도 같은 셀렉터를 써야 한다 — 여러 씬의 합집합(중복 없이).
  it('여러 씬의 대상을 합집합으로 모은다', () => {
    const refs = [
      ch('문지기', { flowNameSyncStatus: 'failed' }),
      ch('박씨', { flowNameSyncStatus: 'failed' }),
      ch('변호사'),
    ]
    const scenes = [{ prompt: '@문지기 등장' }, { prompt: '@박씨 와 @문지기' }, { prompt: '@변호사 등장' }]

    const targets = scenes.flatMap(scene => selectMentionSyncTargets({ scene, references: refs }))
    const unique = [...new Set(targets)]

    expect(unique.map(r => r.name).sort()).toEqual(['문지기', '박씨'].sort())
  })
})
