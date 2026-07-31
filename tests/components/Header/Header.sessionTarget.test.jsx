import { beforeEach, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const headerState = vi.hoisted(() => ({ sessionTarget: 'chatgpt' }))

vi.mock('../../../src/hooks/useI18n', () => ({ useI18n: () => ({
  t: (k) => ({
    'header.chatgptLogin': 'ChatGPT 로그인',
    'header.chatgptAuthenticated': 'ChatGPT 로그인됨',
    'header.flowLogin': 'Flow 로그인',
    'header.flowAuthenticated': 'Flow 로그인됨',
    'header.apiKey': 'API 키',
  }[k] || k),
  // ⚠️ 빈 배열 금지: Header 는 LanguagePicker 를 무조건 렌더하고
  //    LanguagePicker 는 `languages.find(...) || languages[0]` 의 `.country` 를 읽는다 →
  //    빈 배열이면 두 테스트가 단언 전에 render 에서 TypeError 로 죽는다.
  //    기존 Header.authAction.test.jsx:28 과 같은 fixture 를 쓴다.
  lang: 'ko', changeLang: vi.fn(), languages: [{ code: 'ko', name: 'KO', country: 'kr' }],
}) }))
vi.mock('../../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { listProjects: vi.fn().mockResolvedValue({ success: true, projects: [] }) } }))
vi.mock('../../../src/components/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('../../../src/components/ModeToggle', () => ({ default: () => null }))
vi.mock('../../../src/components/SideDrawer', () => ({ SideDrawer: () => null }))
vi.mock('../../../src/components/Modal', () => ({ default: () => null }))
vi.mock('../../../src/components/ExportSplitButton', () => ({ default: () => null }))
vi.mock('../../../src/components/Toast', () => ({ toast: { info: vi.fn() } }))
vi.mock('../../../src/contexts/ModeContext', () => ({ useMode: () => ({ mode: 'flow', sessionTarget: headerState.sessionTarget }) }))

import Header from '../../../src/components/Header.jsx'

beforeEach(() => { headerState.sessionTarget = 'chatgpt' })

it('ChatGPT target shows its label and never calls legacy Flow reattach', () => {
  window.electronAPI = { setRoute: vi.fn(), setLayout: vi.fn(), onFlowStatus: vi.fn(() => () => {}) }
  render(<Header authReady={false} onSettings={vi.fn()} onAuthRecovered={vi.fn()} />)
  // 버튼은 `{authActionIcon} {authActionLabel}`(Header.jsx:350)을 렌더해 접근성 이름이
  // '👤 ChatGPT 로그인' 이다 — 정확 문자열 매칭은 절대 안 맞는다(기존 테스트도 정규식을 쓴다).
  fireEvent.click(screen.getByRole('button', { name: /ChatGPT 로그인/ }))
  expect(window.electronAPI.setRoute).not.toHaveBeenCalled()
  expect(window.electronAPI.setLayout).not.toHaveBeenCalled()
})

it('keeps Flow readiness out of the ChatGPT auth chip on a target round-trip', async () => {
  window.electronAPI = { onFlowStatus: vi.fn(() => () => {}) }
  headerState.sessionTarget = 'flow'
  const authReadyByTarget = { flow: true, chatgpt: false }
  const { container, rerender } = render(
    <Header authReadyByTarget={authReadyByTarget} onSettings={vi.fn()} onAuthRecovered={vi.fn()} />,
  )
  await waitFor(() => expect(container.querySelector('.auth-badge.authenticated')).toBeTruthy())
  expect(container.querySelector('.auth-badge.authenticated').getAttribute('data-tooltip'))
    .toBe('Flow 로그인됨')

  headerState.sessionTarget = 'chatgpt'
  rerender(<Header authReadyByTarget={authReadyByTarget} onSettings={vi.fn()} onAuthRecovered={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: /ChatGPT 로그인/ })).toBeTruthy())
  expect(container.querySelector('.auth-badge.authenticated')).toBeNull()
})
