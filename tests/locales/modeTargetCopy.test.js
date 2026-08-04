import { it, expect } from 'vitest'
import ko from '../../src/locales/ko.js'
import en from '../../src/locales/en.js'

// Flow is the only login-mode session target again — the copy must say so honestly.
it('mode copy names Flow as the login mode in both locales', () => {
  expect(ko.modeInfo.flow.name).toBe('Flow 로그인 모드')
  expect(en.modeInfo.flow.name).toBe('Flow Login Mode')
  expect(ko.modeInfo.flow.desc).toBe('Google Flow 로그인으로 생성')
  expect(en.modeInfo.flow.desc).toBe('Generate via Google Flow login')
  expect(ko.settings.layoutSplitLeft).toBe('Flow 왼쪽')
  expect(en.settings.layoutSplitLeft).toBe('Flow Left')
  expect(ko.header.flowLogin).toBe('로그인')
  expect(en.header.flowLogin).toBe('Login')
})

it('carries no session-target picker copy and no ChatGPT strings', () => {
  expect(ko.sessionTarget).toBeUndefined()
  expect(en.sessionTarget).toBeUndefined()
  expect(ko.targetCombo).toBeUndefined()
  expect(en.targetCombo).toBeUndefined()
  for (const locale of [ko, en]) {
    expect(JSON.stringify(locale).toLowerCase()).not.toContain('chatgpt')
  }
})
