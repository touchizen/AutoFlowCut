// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validatePromptMentions } from '../../../electron/story/promptMentions.js'

describe('validatePromptMentions', () => {
  it('실제 parser/resolve 경로로 known plain + braced token을 해결한다', () => {
    expect(validatePromptMentions(
      'A slow dolly toward @{Mina Kim} while @민수가 opens the letter',
      ['Mina Kim', '민수'],
    )).toEqual({
      text: 'A slow dolly toward @{Mina Kim} while @민수가 opens the letter',
      unknown: [],
      missing: [],
    })
  })

  it('unknown plain + braced token의 이름 문자열은 보존하고 mention sigil만 제거한다', () => {
    expect(validatePromptMentions(
      'Behind @{없는 캐릭터}, @ghost waits',
      ['민수'],
      [],
    )).toEqual({
      text: 'Behind 없는 캐릭터, ghost waits',
      unknown: ['없는 캐릭터', 'ghost'],
      missing: [],
    })
  })

  it('required portable mention 누락을 보고하되 본문은 유지한다', () => {
    expect(validatePromptMentions(
      'An empty alley at night',
      ['민수', '도둑 우두머리'],
    )).toEqual({
      text: 'An empty alley at night',
      unknown: [],
      missing: ['민수', '도둑 우두머리'],
    })
  })

  it('token=null 이름은 required roster에 있어도 missing mention으로 요구하지 않는다', () => {
    expect(validatePromptMentions(
      'John {Smith} opens the door',
      ['John {Smith}'],
    )).toEqual({
      text: 'John {Smith} opens the door',
      unknown: [],
      missing: [],
    })
  })

  it('unclosed `@{` 잔재는 sigil만 제거하고 본문을 보존한다 — literal `@{` 가 엔진 프롬프트로 새지 않게(스펙 §4.3)', () => {
    const malformed = 'A slow pan toward @{도둑 우두머리'
    expect(() => validatePromptMentions(malformed, ['도둑 우두머리'])).not.toThrow()
    expect(validatePromptMentions(malformed, ['도둑 우두머리'])).toEqual({
      text: 'A slow pan toward 도둑 우두머리',
      unknown: [],
      missing: ['도둑 우두머리'],
    })
    expect(() => validatePromptMentions(null, null)).not.toThrow()
    expect(validatePromptMentions(null, null)).toEqual({ text: '', unknown: [], missing: [] })
  })

  it('빈/공백 braces(`@{}`, `@{ }`)는 통째로 제거하고, 같은 줄의 valid token은 보존한다', () => {
    const r = validatePromptMentions('@{Mina} waves @{} and @{ } smiles\nnext @{broken line', ['Mina'])
    expect(r.text).toBe('@{Mina} waves  and  smiles\nnext broken line')
    expect(r.unknown).toEqual([])
  })

  it('이메일류 비경계 `a@{`는 건드리지 않는다', () => {
    const r = validatePromptMentions('mail a@{x and @{Mina} go', ['Mina'])
    expect(r.text).toBe('mail a@{x and @{Mina} go')
  })
})
