// @vitest-environment jsdom
import React, { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from '../../../src/components/agent/ChatPanel.jsx'
import { effectiveAgentPanelMode } from '../../../src/components/agent/agentPanelLayout.js'
import { useAppSettings } from '../../../src/hooks/useAppSettings.js'

afterEach(() => { cleanup(); localStorage.clear() })

function RealHarness({ appMode = 'api' }) {
  const { settings, updateSetting } = useAppSettings()
  const [open, setOpen] = useState(true)
  const isAgentDocked = open
    && effectiveAgentPanelMode(appMode, settings.agentPanelMode) === 'docked'
  return (
    <div className={`app${isAgentDocked ? ' agent-docked' : ''}`}>
      <ChatPanel
        open={open}
        onOpen={() => setOpen(true)}
        onDismiss={() => setOpen(false)}
        appMode={appMode}
        agentPanelMode={settings.agentPanelMode}
        onAgentPanelModeChange={(m) => updateSetting('agentPanelMode', m)}
        projectKey="p"
        batchStatusSources={{ automation:{isRunning:false,status:'done'}, scenes:[], references:[], generatingRefs:[], refBatchRunning:false }}
      />
    </div>
  )
}

describe('mode-toggle REAL round-trip (App wiring)', () => {
  it('floating↔docked round-trip이 App reserve class까지 함께 바꾼다', async () => {
    window.electronAPI = { agentListModels: vi.fn(async () => []), onAgentEvent: vi.fn(()=>()=>{}), onToolBridgeRequest: vi.fn(()=>()=>{}) }
    const user = userEvent.setup()
    const { container } = render(<RealHarness appMode="api" />)
    const app = container.querySelector('.app')
    const panel = container.querySelector('.agent-chat-panel')
    expect(panel).toHaveClass('mode-floating')
    expect(app).not.toHaveClass('agent-docked')

    const toggle = screen.getByRole('button', { name: 'Dock panel mode' })
    expect(toggle).toBeEnabled()
    await user.click(toggle)

    expect(panel).toHaveClass('mode-docked')
    expect(app).toHaveClass('agent-docked')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await user.click(toggle)
    expect(panel).toHaveClass('mode-floating')
    expect(app).not.toHaveClass('agent-docked')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('docked panel을 dismiss하면 App reserve class가 사라진다', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ agentPanelMode: 'docked' }))
    window.electronAPI = { agentListModels: vi.fn(async () => []), onAgentEvent: vi.fn(()=>()=>{}), onToolBridgeRequest: vi.fn(()=>()=>{}) }
    const user = userEvent.setup()
    const { container } = render(<RealHarness appMode="api" />)
    const app = container.querySelector('.app')

    expect(app).toHaveClass('agent-docked')
    await user.click(screen.getByRole('button', { name: 'Dismiss agent' }))
    expect(app).not.toHaveClass('agent-docked')
  })
})
