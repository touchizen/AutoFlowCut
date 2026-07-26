/**
 * Shopping pipeline IPC. Shares Story's main-owned session coordinator so only
 * one workflow machine/token can remain active across workflow transitions.
 */
import * as fs from 'node:fs/promises'

import { safeHttpFetch } from '../api/net/safeHttpFetch.js'
import { createContentAddressedStaging, createFetchProduct } from '../shopping/fetchProduct.js'
import { createPlanMachine } from '../shopping/planMachine.js'
import { createShoppingPlanStore } from '../shopping/shoppingPlanStore.js'
import { createWorkflowSessionCoordinator } from './workflowSessionCoordinator.js'
import { resolveWorkflowProjectContext } from './workflowProjectContext.js'

const unavailableInThisSlice = async () => {
  throw new Error('shopping-plan-step-not-available')
}

export function registerShoppingIPC(ipcMain, {
  getWindow,
  getActiveWorkFolder = () => null,
  fetchProduct,
  httpFetch = safeHttpFetch,
  imageFetch = safeHttpFetch,
  staging,
  now = () => new Date(),
  randomUUID,
  createStore = createShoppingPlanStore,
  createMachine = createPlanMachine,
  workflowSessions = createWorkflowSessionCoordinator(),
} = {}) {
  const fetchProductFn = fetchProduct || createFetchProduct({
    httpFetch,
    imageFetch,
    staging: staging || createContentAddressedStaging({ fs }),
    now,
  })

  const emitState = async (session, operationId) => {
    const win = getWindow?.()
    if (!win || win.isDestroyed()) return
    const state = await session.machine.getState()
    if (!workflowSessions.isCurrent(session) || win.isDestroyed()) return
    win.webContents.send('shopping:state', {
      projectToken: session.token,
      operationId,
      state,
    })
  }

  const guarded = (handler) => async (_event, payload = {}) => {
    const session = workflowSessions.capture('shopping', payload.projectToken)
    if (!session) return { error: 'stale-token' }
    return handler(payload, session)
  }

  ipcMain.handle('shopping:open', (_event, { projectPath } = {}) =>
    workflowSessions.open('shopping', {
      validate: () => resolveWorkflowProjectContext({
        projectPath,
        getActiveWorkFolder,
        expectedWorkflowType: 'shopping-short',
      }),
      create: async ({ context }) => {
        const deps = {
          fetchProduct: fetchProductFn,
          generatePlan: unavailableInThisSlice,
          materialize: unavailableInThisSlice,
          generate: unavailableInThisSlice,
          now,
          ...(randomUUID ? { randomUUID } : {}),
        }
        const nextMachine = createMachine({ store: createStore(context.projectPath), deps })
        const opened = await nextMachine.open(context.projectPath)
        return {
          machine: nextMachine,
          token: opened.projectToken,
          abort: () => nextMachine.abort(opened.projectToken),
          result: opened,
        }
      },
    }))

  ipcMain.handle('shopping:get-state', guarded((_payload, session) => session.machine.getState()))
  ipcMain.handle('shopping:submit-product', guarded(async ({ url }, session) => {
    const result = await session.machine.submitProduct(session.token, url)
    if (result?.ok) await emitState(session, result.operationId)
    return result
  }))
  ipcMain.handle('shopping:abort', (_event, { projectToken } = {}) =>
    workflowSessions.abort('shopping', projectToken))
}
