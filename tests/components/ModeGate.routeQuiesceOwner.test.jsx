import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createModeController } from '../../electron/ipc/mode.js'
import { ModeProvider } from '../../src/contexts/ModeContext.jsx'
import { I18nProvider } from '../../src/hooks/useI18n.jsx'
import ModeGate from '../../src/components/ModeGate.jsx'
import { toast } from '../../src/components/Toast.jsx'

const createRouteHarness = ({ liveFlowRoute = false } = {}) => {
  const handlers = {}
  const listeners = {}
  const events = []
  const flowView = { id: 'picker-flow-view-27' }
  const contentView = {
    addChildView: (view) => events.push(`attach:${view.id}`),
    removeChildView: (view) => events.push(`detach:${view.id}`),
  }
  const sender = {
    send: (channel, payload) => {
      events.push(`${channel}:${payload.requestId}`)
      sentRequests.push({ channel, payload })
    },
  }
  const sentRequests = []
  const controller = createModeController(
    () => ({ contentView, webContents: sender }),
    () => flowView,
    {
      sessionJobs: {
        cancelAll: async () => events.push('session-jobs:cancel'),
        awaitIdle: async () => events.push('session-jobs:idle'),
      },
      requireRendererQuiesce: true,
      quiesceTimeoutMs: liveFlowRoute ? 607 : 31,
      ...(liveFlowRoute ? {
        initialRoute: { mode: 'flow', sessionTarget: 'flow' },
        initialAttachedView: flowView,
        initialRevision: 17,
      } : {}),
      updateViewBounds: (_window, view) => events.push(`bounds:${view.id}`),
    },
  )
  controller.register({
    handle: (channel, handler) => { handlers[channel] = handler },
    on: (channel, listener) => { listeners[channel] = listener },
  })
  return { controller, events, handlers, listeners, sender, sentRequests }
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  localStorage.setItem('autoflowcut_lang', 'en')
  window.electronAPI = {
    setModalVisible: vi.fn(async () => ({ ok: true })),
  }
})

describe('ModeGate route quiesce ownership', () => {
  it('mounts the app after a first-run route change when no renderer quiesce owner is registered', async () => {
    const harness = createRouteHarness()
    window.electronAPI.setRoute = (route) => (
      harness.handlers['route:set']({ sender: harness.sender }, route)
    )

    render(
      <I18nProvider>
        <ModeProvider>
          <ModeGate>
            <div data-testid="picker-transition-app">APP</div>
          </ModeGate>
        </ModeProvider>
      </I18nProvider>,
    )

    fireEvent.click(screen.getByTestId('mode-select-flow'))

    expect(await screen.findByTestId('picker-transition-app', {}, { timeout: 400 })).toBeTruthy()
    expect(screen.queryByTestId('mode-selector')).toBeNull()
    expect(harness.controller.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(harness.events).toContain('attach:picker-flow-view-27')
  })

  it('waits for a registered live owner receipt before detaching the Flow view', async () => {
    const harness = createRouteHarness({ liveFlowRoute: true })
    const ownerListener = harness.listeners['route:quiesce-owner']
    expect(typeof ownerListener).toBe('function')
    ownerListener({ sender: harness.sender }, { present: true })

    let settled = false
    const pending = harness.handlers['route:set'](
      { sender: harness.sender },
      {
        requestId: 'registered-owner-switch-83',
        fromRevision: 17,
        to: { mode: 'api', sessionTarget: 'flow' },
      },
    ).finally(() => { settled = true })

    await waitFor(() => {
      expect(harness.sentRequests).toHaveLength(1)
    })
    expect(harness.events).toEqual([
      'route:quiesce-request:registered-owner-switch-83',
    ])
    expect(harness.events).not.toContain('detach:picker-flow-view-27')
    expect(settled).toBe(false)

    const request = harness.sentRequests[0].payload
    harness.listeners['route:quiesce-receipt'](
      { sender: harness.sender },
      {
        requestId: request.requestId,
        fromRevision: request.fromRevision,
        ok: true,
      },
    )
    const result = await pending

    expect(result).toMatchObject({
      ok: true,
      route: { mode: 'api', sessionTarget: 'flow' },
      revision: 18,
    })
    expect(harness.events).toEqual([
      'route:quiesce-request:registered-owner-switch-83',
      'session-jobs:cancel',
      'session-jobs:idle',
      'detach:picker-flow-view-27',
    ])
  })

  it('surfaces a rejected first-run route instead of silently leaving the picker open', async () => {
    const errorToast = vi.spyOn(toast, 'error')
    window.electronAPI.setRoute = vi.fn().mockRejectedValue(
      new Error('picker-route-rejected-59'),
    )

    render(
      <I18nProvider>
        <ModeProvider>
          <ModeGate>
            <div data-testid="unreachable-app">APP</div>
          </ModeGate>
        </ModeProvider>
      </I18nProvider>,
    )

    fireEvent.click(screen.getByTestId('mode-select-flow'))

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        'Could not switch generation mode: picker-route-rejected-59',
      )
    })
    expect(screen.getByTestId('mode-selector')).toBeTruthy()
    expect(screen.queryByTestId('unreachable-app')).toBeNull()
  })
})
