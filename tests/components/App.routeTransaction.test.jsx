import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCallback, useEffect, useState } from 'react'
import * as AppModule from '../../src/App.jsx'
import { ModeProvider, useMode } from '../../src/contexts/ModeContext.jsx'
import ModeToggle from '../../src/components/ModeToggle.jsx'
import {
  MODE_STORAGE_KEY,
  SESSION_TARGET_STORAGE_KEY,
} from '../../src/config/appRoute.js'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key) => key }),
}))

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const flowRoute = () => ({ mode: 'flow', sessionTarget: 'flow' })
const chatgptRoute = () => ({ mode: 'flow', sessionTarget: 'chatgpt' })
const apiRoute = () => ({ mode: 'api', sessionTarget: 'flow' })

let injectedRequest = null
let renderedRoute = null
let renderedEngine = null
let routeCommitEvents = []

const routeFailureHarness = ({ initialRoute, result }) => {
  let mainRoute = initialRoute
  let attachedView = initialRoute.mode === 'flow' ? initialRoute.sessionTarget : null
  return {
    setRoute: vi.fn(async () => result),
    mainRoute: () => mainRoute,
    attachedView: () => attachedView,
  }
}

const concurrentRouteHarness = () => {
  const calls = []
  let mainRoute = flowRoute()
  let attachedView = 'flow'
  let revision = 1
  const setRoute = vi.fn((route) => {
    const gate = deferred()
    calls.push({ route, gate })
    return gate.promise
  })
  const resolve = (index, result) => {
    if (result.ok && result.revision > revision) {
      revision = result.revision
      mainRoute = result.route
      attachedView = result.route.mode === 'flow' ? result.route.sessionTarget : null
    }
    calls[index].gate.resolve(result)
  }
  return {
    setRoute,
    mainRoute: () => mainRoute,
    attachedView: () => attachedView,
    resolveFirst: (result) => resolve(0, result),
    resolveSecond: (result) => resolve(1, result),
  }
}

function RouteTransactionProbe({ electronAPI, initialRoute }) {
  const [route, setRoute] = useState(initialRoute)
  const commitRoute = useCallback((next) => {
    routeCommitEvents.push(next)
    localStorage.setItem('route', JSON.stringify(next))
    setRoute(next)
  }, [])
  const useAppRouteTransaction = AppModule.useAppRouteTransaction
  const transactionalRequest = typeof useAppRouteTransaction === 'function'
    ? useAppRouteTransaction({ route, commitRoute, setRoute: electronAPI.setRoute })
    : null
  const legacyRequest = useCallback(async (next) => {
    commitRoute(next)
    return electronAPI.setRoute(next)
  }, [commitRoute, electronAPI])
  injectedRequest = transactionalRequest || legacyRequest
  renderedRoute = route
  renderedEngine = { routeOwner: route.mode === 'api' ? 'api' : route.sessionTarget }
  return <div data-testid="current-route">{route.mode}+{route.sessionTarget}</div>
}

const renderApp = ({ electronAPI, initialRoute }) => {
  localStorage.setItem('route', JSON.stringify(initialRoute))
  render(<RouteTransactionProbe electronAPI={electronAPI} initialRoute={initialRoute} />)
}

const requestInjectedRoute = (route, options) => {
  let pending
  act(() => { pending = injectedRequest(route, options) })
  return pending.then(async (result) => {
    await act(async () => {})
    return result
  })
}

const currentRoute = () => renderedRoute
const currentEngine = () => renderedEngine

function AppOwnedModeToggle({ setRoute }) {
  const modeState = useMode()
  useEffect(() => {
    if (!modeState.route) modeState.setRoute(flowRoute())
  }, [modeState.route, modeState.setRoute])
  const requestRoute = AppModule.useAppRouteTransaction({
    route: modeState.route,
    commitRoute: modeState.setRoute,
    setRoute,
  })
  return <ModeToggle onRouteRequest={requestRoute} />
}

beforeEach(() => {
  localStorage.clear()
  injectedRequest = null
  renderedRoute = null
  renderedEngine = null
  routeCommitEvents = []
})

afterEach(() => cleanup())

it('keeps the real mode toggle on non-default Flow until App adopts a successful route', async () => {
  localStorage.setItem(MODE_STORAGE_KEY, 'flow')
  localStorage.setItem(SESSION_TARGET_STORAGE_KEY, 'flow')
  const failed = deferred()
  const setRoute = vi.fn(() => failed.promise)
  render(
    <ModeProvider>
      <AppOwnedModeToggle setRoute={setRoute} />
    </ModeProvider>,
  )

  fireEvent.click(await screen.findByTestId('mode-toggle-api'))
  expect(screen.getByTestId('mode-toggle-flow')).toHaveAttribute('aria-pressed', 'true')
  expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('flow')

  failed.resolve({ ok: false, error: 'route-quiesce-failed', route: flowRoute(), revision: 1 })
  await waitFor(() => expect(setRoute).toHaveBeenCalledTimes(1))
  expect(screen.getByTestId('mode-toggle-flow')).toHaveAttribute('aria-pressed', 'true')
  expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('flow')

  setRoute.mockResolvedValueOnce({ ok: true, route: apiRoute(), revision: 2 })
  fireEvent.click(screen.getByTestId('mode-toggle-api'))
  await waitFor(() => expect(screen.getByTestId('mode-toggle-api')).toHaveAttribute('aria-pressed', 'true'))
  expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('api')
})

it('keeps renderer context, storage, main view, and engine on non-default Flow when route:set fails', async () => {
  const api = routeFailureHarness({
    initialRoute: { mode: 'flow', sessionTarget: 'flow' },
    result: { ok: false, error: 'route-quiesce-failed', route: { mode: 'flow', sessionTarget: 'flow' } },
  })
  renderApp({ electronAPI: api, initialRoute: flowRoute() })
  await requestInjectedRoute(chatgptRoute())
  expect(screen.getByTestId('current-route')).toHaveTextContent('flow+flow')
  expect(localStorage.getItem('route')).toBe(JSON.stringify(flowRoute()))
  expect(api.mainRoute()).toEqual(flowRoute())
  expect(api.attachedView()).toBe('flow')
  expect(currentEngine().routeOwner).toBe('flow')
})

it('reconciles a failed stored-route boot to the main route without weakening interactive failure preservation', async () => {
  const storedRoute = { mode: 'flow', sessionTarget: 'flow' }
  const mainRoute = { mode: 'api', sessionTarget: 'flow' }
  const api = routeFailureHarness({
    initialRoute: mainRoute,
    result: { ok: false, error: 'route-quiesce-failed', route: mainRoute, revision: 0 },
  })
  renderApp({ electronAPI: api, initialRoute: storedRoute })

  await requestInjectedRoute(storedRoute, { reconcileOnFailure: true, boot: true })

  expect(screen.getByTestId('current-route')).toHaveTextContent('api+flow')
  expect(localStorage.getItem('route')).toBe(JSON.stringify(mainRoute))
  expect(currentEngine().routeOwner).toBe('api')
  expect(api.mainRoute()).toEqual(mainRoute)
  expect(api.attachedView()).toBeNull()
})

it.each([
  ['the route API is unavailable', undefined],
  ['the route IPC rejects', vi.fn(async () => { throw new Error('route-ipc-rejected') })],
])('does not reconcile a failed stored-route boot from the renderer echo when %s', async (_label, setRoute) => {
  const storedRoute = chatgptRoute()
  const mainRoute = apiRoute()
  const api = {
    setRoute,
    mainRoute: () => mainRoute,
    attachedView: () => null,
  }
  renderApp({ electronAPI: api, initialRoute: storedRoute })

  const result = await requestInjectedRoute(storedRoute, { reconcileOnFailure: true, boot: true })

  expect(result).toEqual(expect.objectContaining({ ok: false }))
  expect(result).not.toHaveProperty('route')
  expect(routeCommitEvents).toEqual([])
  expect(screen.getByTestId('current-route')).toHaveTextContent('flow+chatgpt')
  expect(localStorage.getItem('route')).toBe(JSON.stringify(storedRoute))
  expect(currentEngine().routeOwner).toBe('chatgpt')
  expect(api.mainRoute()).toEqual(mainRoute)
  expect(api.attachedView()).toBeNull()
})

it('commits and persists only the latest adopted success route', async () => {
  const api = concurrentRouteHarness()
  renderApp({ electronAPI: api, initialRoute: flowRoute() })
  const first = requestInjectedRoute(chatgptRoute())
  const second = requestInjectedRoute(apiRoute())
  api.resolveSecond({ ok: true, route: apiRoute(), revision: 3 })
  api.resolveFirst({ ok: true, route: chatgptRoute(), revision: 2 })
  await Promise.all([first, second])
  expect(currentRoute()).toEqual(apiRoute())
  expect(localStorage.getItem('route')).toBe(JSON.stringify(apiRoute()))
  expect(api.mainRoute()).toEqual(apiRoute())
  expect(api.attachedView()).toBeNull()
})
