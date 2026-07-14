import { describe, it, expect } from 'vitest'
import { mergeReferences } from '../../src/utils/parsers'
import { planCharacterSync } from '../../src/utils/flowCharacterSync'

/**
 * #R37: 레퍼런스 CSV 를 다시 임포트해 **이미지를 갈아끼우면** 옛 Flow entity 를 비워야 한다.
 *
 * 안 비우면 이미지만 새것이고 entityId 는 옛 캐릭터를 가리킨다. 그 상태로 Sync 하면
 * planCharacterSync 가 'repair-registration' 으로 가서 **옛 entity 만 다시 등록**하고,
 * 새 이미지는 영영 업로드되지 않는다 — 씬이 계속 옛 얼굴로 생성된다.
 *
 * (ReferenceCard #R31-3 / useReferenceGeneration 의 entityPatchForNewImage 와 동일한 불변식:
 *  "새 이미지는 옛 entity 를 갖지 않는다". CSV 경로만 이 규칙에서 빠져 있었다.)
 */
const syncedChar = {
  id: 1, name: 'Zed', type: 'character', prompt: 'old prompt',
  imagePath: '/old.png', mediaId: 'm-old',
  entityId: 'OLD', workflowId: 'OLDW', registered: true, flowNameSyncStatus: 'synced',
}

describe('mergeReferences — 새 이미지를 가져오면 옛 entity 를 비운다', () => {
  it('imagePath 가 바뀌면 entityId/workflowId 를 비운다', () => {
    const merged = mergeReferences([syncedChar], [{ name: 'Zed', type: 'character', imagePath: '/new.png' }])
    const zed = merged.find(r => r.name === 'Zed')

    expect(zed.imagePath).toBe('/new.png')
    expect(zed.entityId).toBeFalsy()
    expect(zed.workflowId).toBeFalsy()
    expect(zed.flowNameSyncStatus).toBeFalsy()
    // 그래서 Sync 는 repair 가 아니라 업로드로 간다 — 새 이미지가 실제로 올라간다.
    expect(planCharacterSync(zed)).toBe('upload')
  })

  it('data(base64)로 이미지를 가져와도 마찬가지다', () => {
    const merged = mergeReferences([syncedChar], [{ name: 'Zed', type: 'character', data: 'data:image/png;base64,NEW' }])
    const zed = merged.find(r => r.name === 'Zed')
    expect(zed.entityId).toBeFalsy()
    expect(planCharacterSync(zed)).toBe('upload')
  })

  // 이미지가 안 바뀌었으면 건드리면 안 된다 — 멀쩡한 동기화를 깨고 재업로드(=중복 entity)를 유발한다.
  it('프롬프트만 바뀌면 entity 를 유지한다 (불필요한 재업로드 = 중복 entity 방지)', () => {
    const merged = mergeReferences([syncedChar], [{ name: 'Zed', type: 'character', prompt: 'new prompt' }])
    const zed = merged.find(r => r.name === 'Zed')

    expect(zed.prompt).toBe('new prompt')
    expect(zed.entityId).toBe('OLD')
    expect(zed.flowNameSyncStatus).toBe('synced')
    expect(planCharacterSync(zed)).toBe('repair-registration')
  })

  it('같은 이미지 경로를 다시 줘도 entity 를 유지한다', () => {
    const merged = mergeReferences([syncedChar], [{ name: 'Zed', type: 'character', imagePath: '/old.png' }])
    const zed = merged.find(r => r.name === 'Zed')
    expect(zed.entityId).toBe('OLD')
  })
})

/**
 * 리뷰 지적 — 경로가 바뀌었는데 옛 base64(data)가 남으면, syncRefToFlow 는 data 를 경로보다
 * 우선하므로(flowCharacterSync.js) **옛 이미지를 새 entity 로 업로드**한다. 이미지는 그대로인데
 * Flow 에 캐릭터만 하나 더 생기는 것 — 정확히 이 작업이 없애려는 중복이다.
 */
describe('mergeReferences — 경로가 바뀌면 옛 base64 를 비운다', () => {
  const withData = {
    id: 1, name: 'Zed', type: 'character', prompt: 'p',
    imagePath: '/old.png', data: 'data:image/png;base64,OLD',
    entityId: 'OLD', workflowId: 'OLDW', flowNameSyncStatus: 'synced',
  }

  it('imagePath 만 바뀌면 옛 data 를 남기지 않는다 (옛 이미지 재업로드 방지)', () => {
    const merged = mergeReferences([withData], [{ name: 'Zed', type: 'character', imagePath: '/new.png' }])
    const zed = merged.find(r => r.name === 'Zed')
    expect(zed.imagePath).toBe('/new.png')
    expect(zed.data).toBeFalsy()          // 옛 base64 가 남으면 그게 업로드된다
    expect(zed.entityId).toBeFalsy()
  })

  it('새 data 를 주면 그걸 쓴다', () => {
    const merged = mergeReferences([withData], [{ name: 'Zed', type: 'character', data: 'data:image/png;base64,NEW' }])
    const zed = merged.find(r => r.name === 'Zed')
    expect(zed.data).toBe('data:image/png;base64,NEW')
    expect(zed.entityId).toBeFalsy()
  })

  it('이미지를 안 주면 기존 data 를 유지한다', () => {
    const merged = mergeReferences([withData], [{ name: 'Zed', type: 'character', prompt: 'new p' }])
    const zed = merged.find(r => r.name === 'Zed')
    expect(zed.data).toBe('data:image/png;base64,OLD')
    expect(zed.entityId).toBe('OLD')
  })
})
