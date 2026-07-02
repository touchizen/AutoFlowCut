/**
 * Story 파이프라인 IPC — 스펙 §6. 프로젝트당 하나의 스텝 머신 인스턴스.
 * 모든 R→M 명령은 projectToken 검증, 불일치 시 { error: 'stale-token' }.
 */
import { createStepMachine } from '../story/stepMachine.js'
import * as llmGemini from '../api/llm/llmGemini.js'

export function registerStoryIPC(ipcMain, { keyStore, getWindow, llm = llmGemini }) {
  let machine = null
  let openLock = Promise.resolve()

  const emit = (channel, payload) => {
    const win = getWindow?.()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const guarded = (fn) => async (_e, payload = {}) => {
    if (!machine || payload.projectToken !== machine.projectToken) return { error: 'stale-token' }
    return fn(payload)
  }

  ipcMain.handle('story:open', (_e, { projectPath } = {}) => {
    // 동시 open 레이스 방지 — 직렬화(promise 체인): 이전 open이 끝나야 다음 open이 실행된다
    const task = openLock.then(async () => {
      if (machine) await machine.abort()
      machine = createStepMachine({ projectPath, llm, emit, getApiKey: () => keyStore.getKey() })
      return machine.open()
    })
    openLock = task.then(() => undefined, () => undefined)
    return task
  })

  ipcMain.handle('story:get-state', guarded(async () => machine.getState()))
  ipcMain.handle('story:start', guarded(({ step, params }) => machine.start(step, params)))
  ipcMain.handle('story:abort', guarded(() => machine.abort()))
  ipcMain.handle('story:push-ack', guarded(({ operationId, pushRevision, ok, reason }) =>
    machine.ackPush({ operationId, pushRevision, ok, reason })))
}
