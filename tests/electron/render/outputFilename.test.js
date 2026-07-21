import { describe, it, expect } from 'vitest'
import { sanitizeOutputName } from '../../../electron/render/outputFilename.js'

describe('sanitizeOutputName', () => {
  it('프로젝트명에 .mp4 를 붙인다', () => {
    expect(sanitizeOutputName('MyProject')).toBe('MyProject.mp4')
  })

  it('한글 프로젝트명을 보존한다', () => {
    expect(sanitizeOutputName('원더풀스')).toBe('원더풀스.mp4')
  })

  it('OS 금지 문자만 _ 로 치환한다', () => {
    expect(sanitizeOutputName('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i.mp4')
  })

  it('공백을 정리하고 앞뒤를 trim 한다', () => {
    expect(sanitizeOutputName('  hello   world  ')).toBe('hello world.mp4')
  })

  it('빈/공백/누락 이름은 render 로 폴백한다', () => {
    expect(sanitizeOutputName('')).toBe('render.mp4')
    expect(sanitizeOutputName('   ')).toBe('render.mp4')
    expect(sanitizeOutputName(null)).toBe('render.mp4')
    expect(sanitizeOutputName(undefined)).toBe('render.mp4')
  })

  it('금지 문자만으로 된 이름도 폴백하지 않고 치환 결과를 쓴다', () => {
    expect(sanitizeOutputName('///')).toBe('___.mp4')
  })

  it('Windows 예약 장치명은 _ 접두로 회피한다', () => {
    expect(sanitizeOutputName('CON')).toBe('_CON.mp4')
    expect(sanitizeOutputName('nul')).toBe('_nul.mp4')
    expect(sanitizeOutputName('COM1')).toBe('_COM1.mp4')
    expect(sanitizeOutputName('LPT9')).toBe('_LPT9.mp4')
  })

  it('확장자가 붙은 Windows 예약 장치명도 _ 접두로 회피한다', () => {
    expect(sanitizeOutputName('CON.txt')).toBe('_CON.txt.mp4')
    expect(sanitizeOutputName('NUL.mp4')).toBe('_NUL.mp4.mp4')
  })

  it('출력 base 를 96자로 제한한 뒤 .mp4 를 붙인다', () => {
    expect(sanitizeOutputName('x'.repeat(200))).toBe(`${'x'.repeat(96)}.mp4`)
  })

  it('예약명을 포함할 뿐인 정상 이름은 건드리지 않는다', () => {
    expect(sanitizeOutputName('console')).toBe('console.mp4')
    expect(sanitizeOutputName('com10')).toBe('com10.mp4')
  })
})
