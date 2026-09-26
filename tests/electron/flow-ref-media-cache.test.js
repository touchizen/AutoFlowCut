// @vitest-environment node
//
// M3-6 — 레퍼런스 mediaId 캐시(계획서 2026-09-25 M3 D6 · 사용자 결정 2). 키 = `${doc}|${projectId}|${sha256}` — doc 은 캡처 주입의 문서 nonce
//   (문서마다 새 값)라 페이지 로드·내비게이션 커밋이면 저절로 전부 miss(앞 세션 업로드는 애셋 창 썸네일이 불투명해 쓸 수 없다, PR P5).
//   메모리 전용(Map, 상한 200 — 가장 오래된 것부터 버림), 디스크에 쓰지 않는다. 캐시는 힌트 — 애셋 창 사전 스캔이 확인한다(D7).
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { refMediaCache, REF_MEDIA_CACHE_MAX } from '../../electron/flow-ref-media-cache.js'
import { maskedUuid as U } from '../fixtures/flow-batchexecute-samples.js'

const DOC_A = 'a'.repeat(32)
const DOC_B = 'b'.repeat(32)
const P1 = '134cf5b5-6a64-47b8-8709-6de4c6b0e44c'
const P2 = 'ffffffff-6a64-47b8-8709-6de4c6b0e44c'
const sha = (s) => createHash('sha256').update(Buffer.from(String(s))).digest('hex')
const SHA = sha('king-bytes')

beforeEach(() => refMediaCache.clear())

describe('refMediaCache — 페이지 세션(문서) 범위, 메모리 전용', () => {
  it('set → get 같은 (doc, project, sha) → hit; delete → miss', () => {
    refMediaCache.set(DOC_A, P1, SHA, U(3))
    expect(refMediaCache.get(DOC_A, P1, SHA)).toBe(U(3))
    refMediaCache.delete(DOC_A, P1, SHA)
    expect(refMediaCache.get(DOC_A, P1, SHA)).toBeNull()
  })

  it('다른 doc(새 페이지 세션) → miss', () => {
    refMediaCache.set(DOC_A, P1, SHA, U(3))
    expect(refMediaCache.get(DOC_B, P1, SHA)).toBeNull()
  })

  it('다른 프로젝트 → miss', () => {
    refMediaCache.set(DOC_A, P1, SHA, U(3))
    expect(refMediaCache.get(DOC_A, P2, SHA)).toBeNull()
  })

  it('같은 바이트 다른 이름(ref 둘) → hit — 키는 바이트의 sha 뿐이다', () => {
    const kingA = { name: 'king', bytes: Buffer.from('same-picture') }
    const kingB = { name: '왕', bytes: Buffer.from('same-picture') }
    refMediaCache.set(DOC_A, P1, sha(kingA.bytes), U(7))
    expect(refMediaCache.get(DOC_A, P1, sha(kingB.bytes))).toBe(U(7))
  })

  it(`상한 ${REF_MEDIA_CACHE_MAX}+1 → 가장 오래된 것부터 버린다`, () => {
    expect(REF_MEDIA_CACHE_MAX).toBe(200)
    for (let i = 0; i <= REF_MEDIA_CACHE_MAX; i++) refMediaCache.set(DOC_A, P1, sha('img-' + i), U(1000 + i))
    expect(refMediaCache.get(DOC_A, P1, sha('img-0'))).toBeNull()
    expect(refMediaCache.get(DOC_A, P1, sha('img-1'))).toBe(U(1001))
    expect(refMediaCache.get(DOC_A, P1, sha('img-' + REF_MEDIA_CACHE_MAX))).toBe(U(1000 + REF_MEDIA_CACHE_MAX))
    expect(refMediaCache.size()).toBe(REF_MEDIA_CACHE_MAX)
  })

  it('doc 이 없거나(null — 캡처 nonce 를 못 읽음) 모양이 틀린 키 → 기록도 조회도 안 한다(= 업로드)', () => {
    refMediaCache.set(null, P1, SHA, U(3))
    expect(refMediaCache.get(null, P1, SHA)).toBeNull()
    expect(refMediaCache.size()).toBe(0)
    refMediaCache.set('xyz', P1, SHA, U(3))
    refMediaCache.set(DOC_A, '', SHA, U(3))
    refMediaCache.set(DOC_A, P1, 'not-a-sha', U(3))
    refMediaCache.set(DOC_A, P1, SHA, 'not-a-uuid')
    expect(refMediaCache.size()).toBe(0)
  })

  it('소스 핀 — fs 를 import 하지 않는다(영속 없음)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../electron/flow-ref-media-cache.js', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/from\s+['"](node:)?fs(\/promises)?['"]/)
    expect(src).not.toMatch(/require\(\s*['"](node:)?fs/)
    expect(src).not.toMatch(/import\(\s*['"](node:)?fs/)
  })
})
