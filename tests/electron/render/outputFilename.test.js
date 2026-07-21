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
})
