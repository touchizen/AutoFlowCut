import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModeToggle from '../../src/components/ModeToggle.jsx'
import SceneTab from '../../src/components/settings/SceneTab.jsx'
import DisplayTab from '../../src/components/settings/DisplayTab.jsx'

const t = (key) => ({
  'modeInfo.flow.name': '로그인 모드',
  'modeInfo.api.name': 'API 키 모드',
  'sessionTarget.flow': 'Google Flow',
  'sessionTarget.chatgpt': 'ChatGPT',
  'settings.layoutMode': '세션 화면 배치',
  'settings.layoutSplitLeft': '세션 화면 왼쪽',
  'settings.layoutSplitRight': '세션 화면 오른쪽',
  'settings.layoutSplitTop': '세션 화면 상단',
  'settings.layoutSplitBottom': '세션 화면 하단',
}[key] || key)

vi.mock('../../src/contexts/ModeContext.jsx', () => ({
  useMode: () => ({ mode: 'flow', setMode: vi.fn() }),
}))
vi.mock('../../src/hooks/useI18n', () => ({ useI18n: () => ({ t }) }))

const settings = {
  generation: { image: { provider: 'google' }, video: { t2v: { provider: 'google' }, i2v: { provider: 'google' } } },
  aspectRatio: '16:9', defaultDuration: 5,
}

describe('mode/target labels', () => {
  it('ModeToggle says Login Mode, not Flow', () => {
    render(<ModeToggle />)
    expect(screen.getByText('로그인 모드')).toBeTruthy()
  })

  it('SceneTab labels chatgpt target without a false Flow price link', () => {
    render(<SceneTab localSettings={settings} setLocalSettings={vi.fn()} t={t} appMode="flow" sessionTarget="chatgpt" imageModels={[]} videoModels={[]} />)
    expect(screen.getAllByText('ChatGPT').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Google Flow')).toBeNull()
    expect(document.querySelector('[title*="one.google.com"]')).toBeNull()
  })

  it('DisplayTab uses neutral session view labels in login mode', () => {
    window.electronAPI = { getPreventSleep: vi.fn().mockResolvedValue({ enabled: false }), getLayout: vi.fn().mockResolvedValue({ mode: 'split-left' }) }
    render(<DisplayTab t={t} appMode="flow" />)
    expect(screen.getByText('세션 화면 왼쪽')).toBeTruthy()
  })
})
