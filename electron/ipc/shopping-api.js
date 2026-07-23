/**
 * Shopping pipeline IPC. Mirrors Story's project-path and token session rules
 * without sharing either workflow's active machine.
 */
import * as fs from 'node:fs/promises'
import path from 'node:path'

import { safeHttpFetch } from '../api/net/safeHttpFetch.js'
import { createContentAddressedStaging, createFetchProduct } from '../shopping/fetchProduct.js'
import { createPlanMachine } from '../shopping/planMachine.js'
import { createShoppingPlanStore } from '../shopping/shoppingPlanStore.js'

function hasParentSegment(value) {
  return value.split(/[\\/]/).includes('..')
}

async function validateProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath) return false
  if (!path.isAbsolute(projectPath) || hasParentSegment(projectPath)) return false
  const normalized = path.normalize(projectPath)
  if (hasParentSegment(normalized)) return false
  try {
    return (await fs.stat(normalized)).isDirectory()
  } catch {
    return false
  }
}

function isWithinWorkFolder(projectPath, workFolder) {
  const relative = path.relative(workFolder, projectPath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

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
} = {}) {
  let machine = null
  let projectToken = null
  let openLock = Promise.resolve()

  const fetchProductFn = fetchProduct || createFetchProduct({
    httpFetch,
    imageFetch,
    staging: staging || createContentAddressedStaging({ fs }),
    now,
  })

  const emitState = async (operationId) => {
    const win = getWindow?.()
    if (!win || win.isDestroyed()) return
    const state = await machine.getState()
    win.webContents.send('shopping:state', { projectToken, operationId, state })
  }

  const guarded = (handler) => async (_event, payload = {}) => {
    if (!machine || payload.projectToken !== projectToken) return { error: 'stale-token' }
    return handler(payload)
  }

  ipcMain.handle('shopping:open', (_event, { projectPath } = {}) => {
    const task = openLock.then(async () => {
      if (!(await validateProjectPath(projectPath))) return { error: 'invalid-project-path' }
      const activeWorkFolder = getActiveWorkFolder()
      if (activeWorkFolder && !isWithinWorkFolder(projectPath, activeWorkFolder)) {
        return { error: 'invalid-project-path' }
      }

      if (machine && projectToken) await machine.abort(projectToken)
      machine = null
      projectToken = null

      const deps = {
        fetchProduct: fetchProductFn,
        generatePlan: unavailableInThisSlice,
        materialize: unavailableInThisSlice,
        generate: unavailableInThisSlice,
        now,
        ...(randomUUID ? { randomUUID } : {}),
      }
      const nextMachine = createMachine({ store: createStore(projectPath), deps })
      const opened = await nextMachine.open(projectPath)
      machine = nextMachine
      projectToken = opened.projectToken
      return opened
    })
    openLock = task.then(() => undefined, () => undefined)
    return task
  })

  ipcMain.handle('shopping:get-state', guarded(() => machine.getState()))
  ipcMain.handle('shopping:submit-product', guarded(async ({ url }) => {
    const result = await machine.submitProduct(projectToken, url)
    if (result?.ok) await emitState(result.operationId)
    return result
  }))
  ipcMain.handle('shopping:abort', guarded(() => machine.abort(projectToken)))
}
