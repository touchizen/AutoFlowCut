/**
 * MCP load_csv(update-references) 병합 — CSV 에 없는 런타임 필드를 보존한다.
 *
 * CSV 는 prompt/type/category 의 authoritative 소스지만, 생성이 카드에 남긴 런타임 사실
 * (이미지 포인터, Flow entityId, 쓰인 스타일)은 CSV 에 없다. 보존 목록에서 빠지면 병합이
 * 그 사실을 조용히 지운다 — 스토리 파이프라인 W6/W7 QA 루프가 생성 도중 load_csv 를 부르므로
 * 실제로 밟는 경로다.
 */
import { describe, it, expect } from 'vitest'
import { mergeReferencesPreservingRuntime } from '../../src/hooks/useMcpServer'

const existing = {
  id: 1, name: '준호', type: 'character', prompt: '옛 프롬프트',
  data: 'BASE64', filePath: '/p/준호.png', dataStorage: 'file',
  mediaId: 'media-1', status: 'done', errorMessage: null,
  entityId: 'ent-1', workflowId: 'wf-1', registered: true, flowNameSyncStatus: 'synced',
  styleId: 'ref:3',
}
const incoming = { id: 1, name: '준호', type: 'character', prompt: '새 프롬프트', category: 'MEDIA_CATEGORY_SUBJECT' }

describe('mergeReferencesPreservingRuntime', () => {
  const merged = () => mergeReferencesPreservingRuntime([existing], [incoming])[0]

  it('CSV 가 authoritative 인 필드는 덮어쓴다', () => {
    expect(merged().prompt).toBe('새 프롬프트')
  })

  it('이미지 포인터를 보존한다 (기존 계약)', () => {
    expect(merged()).toMatchObject({ data: 'BASE64', filePath: '/p/준호.png', mediaId: 'media-1', status: 'done' })
  })

  it('Flow entity 바인딩을 보존한다 — 지워지면 @멘션이 끊기고 재동기화가 필요해진다', () => {
    expect(merged()).toMatchObject({ entityId: 'ent-1', workflowId: 'wf-1', registered: true, flowNameSyncStatus: 'synced' })
  })

  it('카드가 기억한 스타일을 보존한다 — 지워지면 재생성이 전역 스타일로 샌다', () => {
    expect(merged().styleId).toBe('ref:3')
  })

  it("styleId:null('무스타일로 생성됨')도 보존한다 — undefined(레거시)로 되돌리면 안 된다", () => {
    const m = mergeReferencesPreservingRuntime([{ ...existing, styleId: null }], [incoming])[0]
    expect(m.styleId).toBeNull()
    expect('styleId' in m).toBe(true)
  })

  it('이름 없는 incoming 은 매칭하지 않는다', () => {
    const m = mergeReferencesPreservingRuntime([existing], [{ name: '', prompt: 'p' }])[0]
    expect(m.data).toBeUndefined()
  })
})

// MCP load_csv 는 {name,type,category,prompt} 만 보낸다(mcp-server/index.js) — incoming 에 id 가 없다.
// id 를 보존하지 않으면 모든 ref 의 id 가 undefined 가 되고, 보존해둔 styleId:'ref:1' 이 가리킬
// 스타일 카드를 못 찾아 조용히 무스타일로 생성된다. 씬 병합은 이미 id:matched.id 로 고쳐져 있다.
describe('mergeReferencesPreservingRuntime — id 안정성', () => {
  const csvRow = (name, prompt) => ({ name, type: 'character', category: 'MEDIA_CATEGORY_SUBJECT', prompt })

  it('이름이 매칭되면 기존 id 를 유지한다 (incoming 에 id 가 없다)', () => {
    const m = mergeReferencesPreservingRuntime([existing], [csvRow('준호', 'p')])[0]
    expect(m.id).toBe(1)
  })

  it('보존된 styleId 가 가리키는 스타일 카드의 id 도 살아남는다', () => {
    const style = { id: 3, name: '수채화', type: 'style', prompt: 'watercolor' }
    const merged = mergeReferencesPreservingRuntime([style, existing], [csvRow('수채화', 'watercolor'), csvRow('준호', 'p')])
    expect(merged[0].id).toBe(3)               // styleId:'ref:3' 이 여전히 유효
    expect(merged[1].styleId).toBe('ref:3')
  })

  it('incoming 이 엉뚱한 id 를 들고 와도 기존 id 가 이긴다 (씬 병합 R9 와 동일)', () => {
    const m = mergeReferencesPreservingRuntime([existing], [{ ...csvRow('준호', 'p'), id: 99 }])[0]
    expect(m.id).toBe(1)
  })

  it('신규 ref 에는 기존 최대 id 위로 새 id 를 발급한다', () => {
    const merged = mergeReferencesPreservingRuntime([existing], [csvRow('준호', 'p'), csvRow('태수', 'q'), csvRow('영수', 'r')])
    expect(merged[0].id).toBe(1)
    expect(merged[1].id).toBe(2)
    expect(merged[2].id).toBe(3)
  })

  // 씬 병합은 매칭된 항목을 소비(consume)하고 taken 집합으로 중복을 막는다(R15). 레퍼런스 병합에
  // id 보존을 넣으면서 같은 가드가 없으면, CSV 의 중복 이름 두 행이 같은 id 를 받는다 —
  // ReferencePanel 의 id 기반 갱신이 두 카드를 동시에 건드린다.
  it('CSV 에 같은 이름이 두 번 나와도 id 가 겹치지 않는다', () => {
    const merged = mergeReferencesPreservingRuntime([existing], [csvRow('준호', 'p'), csvRow('준호', 'q')])
    expect(merged[0].id).toBe(1)                 // 첫 행만 기존 카드에 매칭
    expect(merged[1].id).not.toBe(1)             // 두 번째는 새 카드
    expect(merged[1].data).toBeUndefined()       // 런타임 필드도 복제되지 않는다
  })

  it('매칭 안 된 incoming 의 id 는 신뢰하지 않는다 (기존 id 와 충돌 가능)', () => {
    const merged = mergeReferencesPreservingRuntime([{ id: 1, name: 'A' }], [csvRow('A', 'p'), { ...csvRow('B', 'q'), id: 1 }])
    expect(merged[0].id).toBe(1)
    expect(merged[1].id).not.toBe(1)
  })

  it('발급된 id 는 서로 겹치지 않고 숫자다', () => {
    const merged = mergeReferencesPreservingRuntime([{ id: 7, name: 'a' }], [csvRow('b', 'p'), csvRow('c', 'q')])
    const ids = merged.map(r => r.id)
    expect(ids.every(id => typeof id === 'number')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Math.min(...ids)).toBeGreaterThan(7)
  })
})
