// @vitest-environment jsdom
import React, { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from '../../../src/components/agent/ChatPanel.jsx'
import { useAppSettings } from '../../../src/hooks/useAppSettings.js'

afterEach(() => { cleanup(); localStorage.clear() })

function RealHarness({ appMode = 'api' }) {
  const { settings, updateSetting } = useAppSettings()
  return (
    <div className="app">
      <ChatPanel
        open
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
  it('클릭하면 실제 updateSetting을 거쳐 패널이 floating→slide로 바뀐다', async () => {
    window.electronAPI = { agentListModels: vi.fn(async () => []), onAgentEvent: vi.fn(()=>()=>{}), onToolBridgeRequest: vi.fn(()=>()=>{}) }
    const user = userEvent.setup()
    const { container } = render(<RealHarness appMode="api" />)
    const panel = container.querySelector('.agent-chat-panel')
    expect(panel).toHaveClass('mode-floating')

    const toggle = screen.getByRole('button', { name: 'Slide panel mode' })
    expect(toggle).toBeEnabled()
    await user.click(toggle)

    expect(panel).toHaveClass('mode-slide')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })
})
