// tests/utils/sceneMentions.test.js
//
// B1: scene ref 프롬프트의 `@이름` 을 등록된 character ref 와 매칭해
// 멘션 주입 순서(segments)와 멘션 목록을 뽑는 순수 함수.
// 멘션 후보 precondition(F9): type==='character' + entityId + name.trim() + flowNameSyncStatus==='synced'.
import { describe, it, expect } from 'vitest'
import { parseSceneMentions } from '../../src/utils/sceneMentions'
import { iterateMentions } from '../../src/utils/mentionParser'

const synced = (name, entityId) => ({ type: 'character', name, entityId, flowNameSyncStatus: 'synced' })

describe('parseSceneMentions', () => {
  it('선두 @멘션 + 텍스트 → mention/text segments + mentions', () => {
    const refs = [synced('회사원3', 'E1')]
    const r = parseSceneMentions('@회사원3 이 회사 앞에서 제품을 소개하는 장면', refs)
    expect(r.hasMention).toBe(true)
    expect(r.mentions).toEqual([{ name: '회사원3', entityId: 'E1' }])
    expect(r.segments).toEqual([
      { type: 'mention', name: '회사원3', entityId: 'E1' },
      { type: 'text', text: ' 이 회사 앞에서 제품을 소개하는 장면' },
    ])
  })

  it('멘션 없음 → hasMention false, 전체 text 한 덩어리', () => {
    const r = parseSceneMentions('그냥 풍경 장면', [synced('회사원3', 'E1')])
    expect(r.hasMention).toBe(false)
    expect(r.mentions).toEqual([])
    expect(r.segments).toEqual([{ type: 'text', text: '그냥 풍경 장면' }])
  })

  it('P2: character 있는 프로젝트에서 매칭 안 되는 @이름(오타/없는 이름) → unresolved (조용한 통과 방지)', () => {
    const r = parseSceneMentions('@없는캐릭 배경', [synced('회사원3', 'E1')])
    expect(r.hasMention).toBe(false)
    expect(r.unresolved).toEqual([{ name: '없는캐릭' }])
    expect(r.segments).toEqual([{ type: 'text', text: '@없는캐릭 배경' }]) // 텍스트는 보존
  })

  it('P2: character 가 전혀 없는 프로젝트면 @토큰은 일반 텍스트(멘션 비활성)', () => {
    const r = parseSceneMentions('@anything 배경', [])
    expect(r.hasMention).toBe(false)
    expect(r.unresolved).toEqual([])
  })

  it('P2: 단어중간 @(이메일 등)는 멘션 시도로 안 봄', () => {
    const r = parseSceneMentions('mail a@b.com 배경', [synced('회사원3', 'E1')])
    expect(r.unresolved).toEqual([])
  })

  it('R4-P2: 단어중간 @동기화이름 도 멘션으로 둔갑 안 함 (eligible 에도 prevOk)', () => {
    const r = parseSceneMentions('mail a@회사원3.com 배경', [synced('회사원3', 'E1')])
    expect(r.hasMention).toBe(false)
    expect(r.mentions).toEqual([])
  })

  it('R5-P2: 괄호/구두점 뒤 @회사원3 은 정상 멘션 (whitespace-only 경계 완화)', () => {
    const r = parseSceneMentions('장면(@회사원3) 등장', [synced('회사원3', 'E1')])
    expect(r.hasMention).toBe(true)
    expect(r.mentions).toEqual([{ name: '회사원3', entityId: 'E1' }])
  })

  it('미동기화/entityId 없는 캐릭터는 후보 제외', () => {
    const refs = [
      { type: 'character', name: '대기중', entityId: 'E2', flowNameSyncStatus: 'pending' },
      { type: 'character', name: '미등록', flowNameSyncStatus: 'synced' },
    ]
    const r = parseSceneMentions('@대기중 @미등록 장면', refs)
    expect(r.hasMention).toBe(false)
  })

  it('긴 이름 우선 매칭 (회사원3 vs 회사원)', () => {
    const refs = [synced('회사원', 'E_SHORT'), synced('회사원3', 'E_LONG')]
    const r = parseSceneMentions('@회사원3 장면', refs)
    expect(r.mentions).toEqual([{ name: '회사원3', entityId: 'E_LONG' }])
  })

  it('여러 멘션 + 중간 텍스트 → 순서 보존, mentions 중복 제거', () => {
    const refs = [synced('A', 'EA'), synced('B', 'EB')]
    const r = parseSceneMentions('@A 와 @B 가 만나고 @A 떠남', refs)
    expect(r.segments).toEqual([
      { type: 'mention', name: 'A', entityId: 'EA' },
      { type: 'text', text: ' 와 ' },
      { type: 'mention', name: 'B', entityId: 'EB' },
      { type: 'text', text: ' 가 만나고 ' },
      { type: 'mention', name: 'A', entityId: 'EA' },
      { type: 'text', text: ' 떠남' },
    ])
    expect(r.mentions).toEqual([{ name: 'A', entityId: 'EA' }, { name: 'B', entityId: 'EB' }])
  })

  it('braced 공백 이름을 exact mention segment로 만든다', () => {
    const r = parseSceneMentions('@{도둑 우두머리}A young man', [synced('도둑 우두머리', 'BOSS')])
    expect(r.hasMention).toBe(true)
    expect(r.mentions).toEqual([{ name: '도둑 우두머리', entityId: 'BOSS' }])
    expect(r.segments).toEqual([
      { type: 'mention', name: '도둑 우두머리', entityId: 'BOSS' },
      { type: 'text', text: 'A young man' },
    ])
    expect(r.unresolved).toEqual([])
  })

  it('미해결 braced mention은 full inner name과 exactness를 보고하고 원문을 보존한다', () => {
    const r = parseSceneMentions('@{도둑 우두머리} 등장', [synced('회사원', 'E1')])
    expect(r.hasMention).toBe(false)
    expect(r.unresolved).toEqual([{ name: '도둑 우두머리', exact: true }])
    expect(r.segments).toEqual([{ type: 'text', text: '@{도둑 우두머리} 등장' }])
  })

  it('plain과 braced mention을 한 prompt에서 순서대로 처리한다', () => {
    const refs = [synced('회사원', 'WORKER'), synced('도둑 우두머리', 'BOSS')]
    const r = parseSceneMentions('@회사원과 @{도둑 우두머리}가 대치한다', refs)
    expect(r.mentions).toEqual([
      { name: '회사원', entityId: 'WORKER' },
      { name: '도둑 우두머리', entityId: 'BOSS' },
    ])
    expect(r.unresolved).toEqual([])
  })

  it.each([
    ['@{a}@{b}', ['a', 'b']],
    ['@{a}@bob', ['a', 'bob']],
  ])('keeps parser parity for adjacent mentions: %s', (prompt, names) => {
    const refs = names.map((name, index) => synced(name, `E${index}`))
    const editorNames = [...iterateMentions(prompt)].map(({ name }) => name)
    const flowNames = parseSceneMentions(prompt, refs).mentions.map(({ name }) => name)

    expect(editorNames).toEqual(names)
    expect(flowNames).toEqual(names)
  })

  it('does not let a non-boundary malformed brace swallow a later mention', () => {
    const prompt = 'x@{ then @bob runs'
    const expected = ['bob']

    expect([...iterateMentions(prompt)].map(({ name }) => name)).toEqual(expected)
    expect(parseSceneMentions(prompt, [synced('bob', 'BOB')]).mentions.map(({ name }) => name)).toEqual(expected)
  })

  it('ends an unclosed braced candidate at newline so the next line can contain mentions', () => {
    const prompt = '@{oops\n@bob walks'
    const expected = ['bob']

    expect([...iterateMentions(prompt)].map(({ name }) => name)).toEqual(expected)
    expect(parseSceneMentions(prompt, [synced('bob', 'BOB')]).mentions.map(({ name }) => name)).toEqual(expected)
  })

  it('braced mention 내부에는 조사 로직을 적용하지 않는다', () => {
    const r = parseSceneMentions('@{철수가} 달린다', [synced('철수', 'C1')])
    expect(r.hasMention).toBe(false)
    expect(r.unresolved).toEqual([{ name: '철수가', exact: true }])
  })

  it('keeps Flow-side eligible braced matching case-sensitive', () => {
    const r = parseSceneMentions('@{BOB} walks', [synced('Bob', 'BOB')])

    expect(r.hasMention).toBe(false)
    expect(r.mentions).toEqual([])
    expect(r.unresolved).toEqual([{ name: 'BOB', exact: true }])
  })

  it.each([
    ['@철수 @{철수}', [{ name: '철수' }]],
    ['@{철수} @철수', [{ name: '철수', exact: true }]],
  ])('dedupes unresolved names regardless of plain/braced exactness: %s', (prompt, expected) => {
    const r = parseSceneMentions(prompt, [synced('영희', 'YOUNGHEE')])

    expect(r.unresolved).toEqual(expected)
  })

  it.each(['@{ }', '@{ \t }'])('treats an all-whitespace braced name as malformed plain text: %s', (prompt) => {
    expect([...iterateMentions(prompt)]).toEqual([])

    const r = parseSceneMentions(prompt, [synced('영희', 'YOUNGHEE')])
    expect(r.hasMention).toBe(false)
    expect(r.mentions).toEqual([])
    expect(r.unresolved).toEqual([])
    expect(r.segments).toEqual([{ type: 'text', text: prompt }])
  })

  it.each([
    '@{닫히지 않음',
    '@{}',
    '@{중첩{이름}}',
    '@{줄바꿈\n이름}',
    '@{닫히지 않은 @회사원',
    '@{중첩{@회사원}}',
  ]) (
    '비정상 braced syntax는 unresolved 없이 plain text로 둔다: %s',
    (prompt) => {
      const r = parseSceneMentions(prompt, [synced('회사원', 'E1')])
      expect(r.hasMention).toBe(false)
      expect(r.unresolved).toEqual([])
      expect(r.segments).toEqual([{ type: 'text', text: prompt }])
    }
  )

  it('빈/널 프롬프트 안전', () => {
    expect(parseSceneMentions('', [synced('A', 'EA')])).toMatchObject({ hasMention: false, mentions: [], segments: [] })
    expect(parseSceneMentions(null, [])).toMatchObject({ hasMention: false, mentions: [], segments: [] })
  })

  it('P1-6: 토큰경계 — 회사원만 동기화됐는데 @회사원3 이면 부분일치로 회사원 고르지 않음', () => {
    const refs = [synced('회사원', 'E_SHORT')]
    const r = parseSceneMentions('@회사원3 장면', refs)
    expect(r.hasMention).toBe(false)                          // 회사원 으로 잘못 매칭 안 함
    expect(r.unresolved).toEqual([{ name: '회사원3' }])       // 미해결(오타/없는 이름)로 보고 → block
  })

  it('P1-6: 경계 정상 — @회사원3<공백> 은 매칭', () => {
    const r = parseSceneMentions('@회사원3 장면', [synced('회사원3', 'E1')])
    expect(r.hasMention).toBe(true)
    expect(r.mentions).toEqual([{ name: '회사원3', entityId: 'E1' }])
  })

  it('P1-5: @대상이 character 인데 미동기화 → unresolved 로 보고(조용히 image 로 안 떨어지게)', () => {
    const refs = [{ type: 'character', name: '회사원3', entityId: 'E1', flowNameSyncStatus: 'pending' }]
    const r = parseSceneMentions('@회사원3 장면', refs)
    expect(r.hasMention).toBe(false)
    expect(r.unresolved).toEqual([{ name: '회사원3' }])
  })

  it('P1-5: 해결된 멘션만 있으면 unresolved 빈 배열', () => {
    const r = parseSceneMentions('@회사원3 장면', [synced('회사원3', 'E1')])
    expect(r.unresolved).toEqual([])
  })

  // ─── 한글 조사 자동분리 (@queen이, @철수가) ───
  it('조사: @queen이 → queen 멘션 + "이" 텍스트로 분리', () => {
    const r = parseSceneMentions('@queen이 정원을 거닐다', [synced('queen', 'Q1')])
    expect(r.hasMention).toBe(true)
    expect(r.mentions).toEqual([{ name: 'queen', entityId: 'Q1' }])
    expect(r.segments).toEqual([
      { type: 'mention', name: 'queen', entityId: 'Q1' },
      { type: 'text', text: '이 정원을 거닐다' },
    ])
    expect(r.unresolved).toEqual([])
  })

  it('조사: 한글 이름 + 조사 @철수가 → 철수 멘션', () => {
    const r = parseSceneMentions('@철수가 달린다', [synced('철수', 'C1')])
    expect(r.mentions).toEqual([{ name: '철수', entityId: 'C1' }])
    expect(r.segments[0]).toEqual({ type: 'mention', name: '철수', entityId: 'C1' })
    expect(r.unresolved).toEqual([])
  })

  it('조사: 미동기화 @queen이 → unresolved 는 조사 뗀 "queen"(전체 토큰 아님)', () => {
    const refs = [{ type: 'character', name: 'queen', entityId: null }]
    const r = parseSceneMentions('@queen이 정원', refs)
    expect(r.hasMention).toBe(false)
    expect(r.unresolved).toEqual([{ name: 'queen' }])
  })

  it('조사 아님: 영문/숫자 연속(@queen2)은 떼지 않음 — 다른 토큰으로 본다', () => {
    const r = parseSceneMentions('@queen2 정원', [synced('queen', 'Q1')])
    expect(r.mentions).toEqual([])
    expect(r.unresolved).toEqual([{ name: 'queen2' }])
  })

  it('조사 아님: synced 이름이 더 긴 미등록 한글 이름의 접두(@철수빈)면 가로채지 않고 unresolved', () => {
    // 철수 는 synced. 철수빈 은 등록 안 됨. "빈" 은 조사가 아니므로 철수 로 잘못 해석하면 안 됨.
    const r = parseSceneMentions('@철수빈이 달린다', [synced('철수', 'C1')])
    expect(r.hasMention).toBe(false)
    expect(r.mentions).toEqual([])
    expect(r.unresolved).toEqual([{ name: '철수빈' }])
  })
})
