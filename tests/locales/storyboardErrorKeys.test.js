import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STORYBOARD_ERROR_CODES } from '../../electron/story/storyboardInput'
import ko from '../../src/locales/ko'
import en from '../../src/locales/en'

const validatorSource = readFileSync(
  join(process.cwd(), 'electron', 'story', 'storyboardInput.js'),
  'utf8',
)
const emittedStoryboardErrorCodes = [...new Set(Object.values(STORYBOARD_ERROR_CODES))].sort()
const registryMemberNames = Object.keys(STORYBOARD_ERROR_CODES).sort()
const localeKeyForCode = (code) => code.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
const emittedErrorExpressions = [...validatorSource.matchAll(/error:\s*([^,\n}]+)/g)]
  .map((match) => match[1].trim())
const emittedRegistryMemberNames = emittedErrorExpressions
  .map((expression) => /^STORYBOARD_ERROR_CODES\.([A-Z_]+)$/.exec(expression)?.[1])

describe('storyboard ImportModal error locale ledger', () => {
  it('모든 validator error 반환이 authoritative storyboard error registry를 참조한다', () => {
    expect(validatorSource).toContain('export const STORYBOARD_ERROR_CODES')
    expect(emittedRegistryMemberNames).not.toContain(undefined)
    expect(emittedRegistryMemberNames.every((memberName) => (
      registryMemberNames.includes(memberName)
    ))).toBe(true)
  })

  it('registry의 모든 storyboard error code가 validator return에서 실제 참조된다', () => {
    expect([...new Set(emittedRegistryMemberNames)].sort()).toEqual(registryMemberNames)
  })

  it('validator emits the complete storyboard error-ledger codes', () => {
    expect(emittedStoryboardErrorCodes).toHaveLength(12)
  })

  it.each(emittedStoryboardErrorCodes)('%s has non-empty KO/EN strings', (code) => {
    const key = localeKeyForCode(code)
    expect(ko.import[key]).toEqual(expect.any(String))
    expect(ko.import[key].trim()).not.toBe('')
    expect(en.import[key]).toEqual(expect.any(String))
    expect(en.import[key].trim()).not.toBe('')
  })
})
