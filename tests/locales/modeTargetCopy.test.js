import { it, expect } from 'vitest'
import ko from '../../src/locales/ko.js'
import en from '../../src/locales/en.js'

it('keeps mode and target copy separate in both locales', () => {
  expect(ko.modeInfo.flow.name).toBe('로그인 모드')
  expect(en.modeInfo.flow.name).toBe('Login Mode')
  expect(ko.sessionTarget).toEqual({ flow: 'Google Flow', chatgpt: 'ChatGPT' })
  expect(en.sessionTarget).toEqual({ flow: 'Google Flow', chatgpt: 'ChatGPT' })
  expect(ko.header.chatgptAuthenticated).toBe('ChatGPT 로그인됨')
  expect(en.header.chatgptAuthenticated).toBe('ChatGPT logged in')
  expect(ko.settings.layoutSplitLeft).toBe('세션 화면 왼쪽')
  expect(en.settings.layoutSplitLeft).toBe('Session view left')
})
