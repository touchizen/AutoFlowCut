/**
 * Per-target auth readiness in the Header (the Flow bug useTargetAuthReady fixed):
 * in login mode the auth chip must read authReadyByTarget[sessionTarget], never the
 * mode-level authReady prop — so another mode/target's readiness cannot relabel Flow's chip.
 */
import { it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../src/hooks/useI18n', () => ({ useI18n: () => ({
  t: (k) => ({
    'header.flowLogin': '로그인',
    'header.flowAuthenticated': 'Flow 로그인됨',
    'header.apiKey': 'API 키',
  }[k] || k),
  // ⚠️ 빈 배열 금지: Header 는 LanguagePicker 를 무조건 렌더하고
  //    LanguagePicker 는 `languages.find(...) || languages[0]` 의 `.country` 를 읽는다.
  lang: 'ko', changeLang: vi.fn(), languages: [{ code: 'ko', name: 'KO', country: 'kr' }],
}) }))
vi.mock('../../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { listProjects: vi.fn().mockResolvedValue({ success: true, projects: [] }) } }))
vi.mock('../../../src/components/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('../../../src/components/ModeToggle', () => ({ default: () => null }))
vi.mock('../../../src/components/SideDrawer', () => ({ SideDrawer: () => null }))
vi.mock('../../../src/components/Modal', () => ({ default: () => null }))
vi.mock('../../../src/components/ExportSplitButton', () => ({ default: () => null }))
vi.mock('../../../src/components/Toast', () => ({ toast: { info: vi.fn() } }))
vi.mock('../../../src/contexts/ModeContext', () => ({ useMode: () => ({ mode: 'flow', sessionTarget: 'flow' }) }))

import Header from '../../../src/components/Header.jsx'

it('login-mode auth chip reads the per-target readiness map, not the mode-level prop', async () => {
  window.electronAPI = { onFlowStatus: vi.fn(() => () => {}) }
  const { container } = render(
    <Header
      authReady={true} // stale mode-level value — must NOT drive the chip in login mode
      authReadyByTarget={{ flow: false }}
      onSettings={vi.fn()}
      onAuthRecovered={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /로그인/ })).toBeTruthy())
  expect(container.querySelector('.auth-badge.authenticated')).toBeNull()
})

it('shows the authenticated chip when the Flow target itself is ready', async () => {
  window.electronAPI = { onFlowStatus: vi.fn(() => () => {}) }
  const { container } = render(
    <Header
      authReady={false}
      authReadyByTarget={{ flow: true }}
      onSettings={vi.fn()}
      onAuthRecovered={vi.fn()}
    />,
  )
  await waitFor(() => expect(container.querySelector('.auth-badge.authenticated')).toBeTruthy())
  expect(container.querySelector('.auth-badge.authenticated').getAttribute('data-tooltip'))
    .toBe('Flow 로그인됨')
})
