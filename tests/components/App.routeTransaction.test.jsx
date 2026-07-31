import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCallback, useState } from 'react'
import * as AppModule from '../../src/App.jsx'

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

const requestInjectedRoute = (route) => {
  let pending
  act(() => { pending = injectedRequest(route) })
  return pending.then(async (result) => {
    await act(async () => {})
    return result
  })
}

const currentRoute = () => renderedRoute
const currentEngine = () => renderedEngine

beforeEach(() => {
  localStorage.clear()
  injectedRequest = null
  renderedRoute = null
  renderedEngine = null
})

afterEach(() => cleanup())

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
