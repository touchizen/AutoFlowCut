import { describe, it, expect } from 'vitest'
import { entityPatchForNewImage } from '../../src/utils/refEntityRegistration'
import { planCharacterSync } from '../../src/utils/flowCharacterSync'
import fs from 'node:fs'
import path from 'node:path'

/**
 * #R37 배선 회귀 방지.
 *
 * 순수 함수만 테스트하면 배선을 한 줄 되돌려도 전 테스트가 초록이다(실제로 리뷰에서 지적당했다).
 * 여기서는 (a) 재생성 경로가 실제로 entityPatchForNewImage 를 쓰는지, (b) MCP clear 경로가
 * clearedImageFields 를 쓰는지, (c) IPC 가 엔드포인트에 맞는 stale 판정을 쓰는지 소스로 고정한다.
 *
 * 왜 이렇게까지 하나: 이 세 배선이 각각 아래 버그를 되살린다.
 *   (a) API 모드 재생성 → 옛 entityId 잔존 → 새 이미지가 영영 업로드 안 되고 옛 얼굴로 @멘션
 *   (b) MCP 이미지 제거 → entityId 잔존 → 지운 이미지의 옛 entity 를 다시 등록
 *   (c) 옛 predicate(INVALID_ARGUMENT) → 삭제된 entity 가 stale 로 안 잡혀 self-heal 불가 → ref 벽돌
 */
const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8')

describe('#R37 배선 — 순수 함수가 실제로 호출부에 꽂혀 있다', () => {
  it('재생성(useReferenceGeneration)이 entityPatchForNewImage 를 쓴다', () => {
    const src = read('src/hooks/useReferenceGeneration.js')
    expect(src).toContain('entityPatchForNewImage')
    // 옛 패턴이 되살아나면 실패시킨다 — fresh entity 가 없을 때 entity 를 안 비우던 코드.
    expect(src).not.toMatch(/genResult\?\.entityId\s*\n?\s*\?\s*applyEntityRegistrationPatch/)
  })

  it('MCP 이미지 제거 경로가 clearedImageFields 를 쓴다', () => {
    const src = read('src/hooks/useMcpServer.js')
    const clearHandlers = src.match(/clear-(all-)?reference-images?\'\)\s*\{[\s\S]{0,400}?\n\s*\}/g) || []
    expect(clearHandlers.length).toBeGreaterThanOrEqual(2)
    for (const h of clearHandlers) expect(h).toContain('clearedImageFields')
  })

  it('등록 복구 IPC 가 엔드포인트에 맞는 stale 판정을 쓴다 (reroll 전용 predicate 아님)', () => {
    const src = read('electron/ipc/character.js')
    const handler = src.slice(src.indexOf("ipcMain.handle('flow:register-character-entity'"))
      .slice(0, 2000)
    expect(handler).toContain('isStaleRegistrationResponse')
    // reroll(400/INVALID_ARGUMENT) 전용 predicate 를 이 엔드포인트에 쓰면 404 를 놓친다.
    expect(handler).not.toContain('isStaleEntityErrorBody')
  })
})

/**
 * 재생성 시나리오를 함수 조합으로 재현 — 배선이 맞다면 이 순서가 성립해야 한다.
 */
describe('#R37 — API 모드 재생성 후 Sync 가 새 이미지를 올린다', () => {
  it('옛 entityId 를 든 캐릭터를 API 모드로 재생성하면 repair 가 아니라 upload 로 간다', () => {
    const synced = { id: 1, type: 'character', name: 'Zed', mediaId: 'old', entityId: 'OLD', workflowId: 'OLDW', flowNameSyncStatus: 'synced' }
    expect(planCharacterSync(synced)).toBe('repair-registration')   // 재생성 전: 정상적으로 repair

    // API 모드 재생성 결과에는 entityId 가 없다.
    const regenerated = { ...synced, ...entityPatchForNewImage(synced, { mediaId: 'new' }), data: 'NEW_IMAGE' }

    // 새 이미지에는 옛 entity 가 없어야 하고, 따라서 Sync 는 업로드로 가야 한다.
    expect(regenerated.entityId).toBe(null)
    expect(planCharacterSync(regenerated)).toBe('upload')
  })
})

/**
 * 리뷰 지적: MCP 의 imagePath 감지를 되돌려도 전 테스트가 초록이었다. 배선을 소스로 고정한다.
 * 이미지 소스는 data / filePath / **imagePath** 세 가지다 — 하나라도 빠지면 그 경로로 갈아낀 새
 * 이미지가 옛 entity 를 물고 있어, Sync 가 옛 entity 만 재등록하고 씬은 옛 얼굴로 생성된다.
 */
describe('#R37 배선 — imagePath 가 이미지 소스로 인정된다', () => {
  it('MCP update-reference 의 새 이미지 감지가 imagePath 를 포함한다', () => {
    const src = read('src/hooks/useMcpServer.js')
    const line = src.split('\n').find(l => l.includes('bringsNewImage'))
    expect(line).toBeTruthy()
    for (const f of ['data', 'filePath', 'imagePath']) expect(line).toContain(`'${f}' in data.fields`)
  })

  it('CSV 머지(mergeReferences)가 이미지 변경 시 entity 를 무효화한다', () => {
    const src = read('src/utils/parsers.js')
    expect(src).toContain('imageChanged')
    expect(src).toMatch(/imageChanged[\s\S]{0,200}entityId: null/)
  })
})
