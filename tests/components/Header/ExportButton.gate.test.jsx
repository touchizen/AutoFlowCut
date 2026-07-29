/**
 * Header — 내보내기 버튼 접근 게이트 계약 (스펙 v9 §3.3 / §7.3)
 *
 * App 이 `hasExportAccess(scenes)` 를 넘기는지는 App.exportWiring 이 문다.
 * 여기서는 그 반대편 — Header 가 그 불리언을 **실제로 버튼 비활성화에 매핑**하는지.
 * 둘 다 있어야 "전부 pending 인 프로젝트가 내보내기 버튼에 도달한다" 가 성립한다.
 * (사건 당시엔 버튼이 비활성이라 모달에 닿지도 못했다 — 그게 §3.3 이 존재하는 이유다.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

vi.mock('../../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', changeLang: vi.fn(), languages: [{ code: 'ko', name: 'KO', country: 'kr' }] }),
  LANGUAGES: [{ code: 'ko', name: 'KO', country: 'kr' }],
}))
vi.mock('../../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { listProjects: vi.fn().mockResolvedValue({ success: true, projects: [] }) },
}))
vi.mock('../../../src/components/UserMenu', () => ({ UserMenu: () => <div /> }))
vi.mock('../../../src/components/ModeToggle', () => ({ default: () => <div /> }))
vi.mock('../../../src/components/SideDrawer', () => ({ SideDrawer: () => <div /> }))
vi.mock('../../../src/components/Modal', () => ({ default: () => null }))
vi.mock('../../../src/components/Toast', () => ({ toast: { info: vi.fn() } }))
vi.mock('../../../src/contexts/ModeContext', () => ({ useMode: () => ({ mode: 'api' }) }))

// prop 캡처 스텁 — Header 가 hasImages 를 무엇으로 바꿔 넘기는지가 관심사다.
const captured = {}
vi.mock('../../../src/components/ExportSplitButton', () => ({
  default: (props) => { captured.props = props; return <div /> },
}))

import Header from '../../../src/components/Header'

beforeEach(() => {
  captured.props = undefined
  window.electronAPI = { setMode: vi.fn(), setLayout: vi.fn(), onFlowStatus: vi.fn().mockReturnValue(() => {}) }
})
afterEach(cleanup)

const renderHeader = (hasImages) =>
  render(<Header onSettings={vi.fn()} authReady onAuthRecovered={vi.fn()} onExport={vi.fn()} hasImages={hasImages} />)

describe('Header — hasImages → 내보내기 버튼 활성화', () => {
  it('hasImages=true 면 버튼이 활성이다', () => {
    renderHeader(true)

    expect(captured.props.disabled).toBe(false)
  })

  it('hasImages=false 면 버튼이 비활성이다', () => {
    renderHeader(false)

    expect(captured.props.disabled).toBe(true)
  })

  it('매핑을 지우거나 뒤집으면 잡힌다 — 두 값이 반드시 갈린다', () => {
    renderHeader(true)
    const enabled = captured.props.disabled
    cleanup()
    renderHeader(false)

    expect(enabled).not.toBe(captured.props.disabled)
  })
})
