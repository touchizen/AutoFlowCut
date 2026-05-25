/**
 * parseCSVText — review R23 fix
 *
 * 마지막 행이 ',,' (모두 빈 컬럼) 일 때 누락되던 버그 — 뉴라인 유무에 따른
 * 일관성 결함. 새 가드: fields.length > 1 (다중 컬럼) 이거나 단일 필드라도 내용
 * 있으면 유효 행.
 */
import { describe, it, expect } from 'vitest'
import { parseCSVText } from '../../src/utils/csvParser'

describe('R23 — parseCSVText 끝자리 빈 컬럼 일관 처리', () => {
  it('파일 끝 ",," (뉴라인 없음) → 빈 행 보존', () => {
    const text = 'a,b,c\n,,'
    expect(parseCSVText(text)).toEqual([
      ['a', 'b', 'c'],
      ['', '', ''],
    ])
  })

  it('파일 끝 ",,\\n" (뉴라인 있음) → 동일 결과', () => {
    const text = 'a,b,c\n,,\n'
    expect(parseCSVText(text)).toEqual([
      ['a', 'b', 'c'],
      ['', '', ''],
    ])
  })

  it('단일 필드 행이 빈 문자열이면 drop (trailing newline 처리)', () => {
    // 'a\n' → 한 행 ['a']. 두번째 빈 '' 는 trailing newline 잔여로 drop.
    const text = 'a\n'
    expect(parseCSVText(text)).toEqual([['a']])
  })

  it('단일 필드 행에 내용 있으면 보존', () => {
    expect(parseCSVText('a\nb')).toEqual([['a'], ['b']])
  })

  it('빈 입력 → 빈 결과', () => {
    expect(parseCSVText('')).toEqual([])
  })
})
