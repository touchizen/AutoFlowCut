/**
 * csvParser — review R7 fix
 *
 * RFC-식 character-stream parser. escaped quote, multiline field, CRLF 처리.
 */
import { describe, it, expect } from 'vitest'
import { parseCSVText, parseCSVTextToRows } from '../../src/utils/csvParser'

describe('parseCSVText', () => {
  it('단순 CSV 파싱', () => {
    expect(parseCSVText('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('escaped double quote (""→") 처리', () => {
    const text = 'a,b\n"He said ""hi""",end'
    expect(parseCSVText(text)).toEqual([
      ['a', 'b'],
      ['He said "hi"', 'end'],
    ])
  })

  it('quoted multiline field 보존', () => {
    const text = 'a,b\n"line1\nline2","x"'
    expect(parseCSVText(text)).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ])
  })

  it('CRLF 처리', () => {
    expect(parseCSVText('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('quoted comma 보존', () => {
    expect(parseCSVText('a,b\n"x,y",z')).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ])
  })

  it('빈 입력 → 빈 결과', () => {
    expect(parseCSVText('')).toEqual([])
  })

  it('unquoted field 중간의 홀수 quote를 literal로 보존하고 다음 행을 삼키지 않는다', () => {
    const text = `scene,speaker,subtitle
1,narrator,ok
2,narrator,he said " something
3,narrator,three
4,narrator,four`

    expect(parseCSVText(text)).toEqual([
      ['scene', 'speaker', 'subtitle'],
      ['1', 'narrator', 'ok'],
      ['2', 'narrator', 'he said " something'],
      ['3', 'narrator', 'three'],
      ['4', 'narrator', 'four'],
    ])
  })

  it('unquoted field 중간의 짝수 quote도 제거하지 않고 literal로 보존한다', () => {
    expect(parseCSVText('subtitle\nHe said "hi" ok')).toEqual([
      ['subtitle'],
      ['He said "hi" ok'],
    ])
  })

  it('quoted field가 닫히지 않은 채 EOF면 typed parse error를 던진다', () => {
    let thrown
    try {
      parseCSVText('scene,subtitle\n1,"never closed')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'CSVParseError',
      code: 'csv-unterminated-quoted-field',
    })
  })

  it('정상 quoted field의 comma, newline, escaped quote를 함께 보존한다', () => {
    const text = 'scene,subtitle\n1,"comma, newline\nand ""quote"""'

    expect(parseCSVText(text)).toEqual([
      ['scene', 'subtitle'],
      ['1', 'comma, newline\nand "quote"'],
    ])
  })
})

describe('parseCSVTextToRows', () => {
  it('첫 행 headers, 이후 row objects', () => {
    const result = parseCSVTextToRows('name,age\nAlice,30\nBob,25')
    expect(result.headers).toEqual(['name', 'age'])
    expect(result.rows).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ])
  })

  it('BOM 제거', () => {
    const result = parseCSVTextToRows('﻿a,b\n1,2')
    expect(result.headers).toEqual(['a', 'b'])
  })

  it('escaped quotes in row values', () => {
    const result = parseCSVTextToRows('scene,subtitle\n1,"He said ""hi"" then left"')
    expect(result.rows[0].subtitle).toBe('He said "hi" then left')
  })

  it('multiline subtitle preserved', () => {
    const result = parseCSVTextToRows('scene,subtitle\n1,"line A\nline B"')
    expect(result.rows[0].subtitle).toBe('line A\nline B')
  })
})
