import { randomUUID } from 'node:crypto'

/** Ask the submitting app renderer for current scene state at the native click
 * gate. No Flow-page execution. Missing/stale replies refuse the unpaid click. */
export function requestFlowSubmissionCheck(ipcMain, sender, submissionRequestId, signal) {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const checkId = randomUUID()
    let timer
    const finish = allowed => {
      clearTimeout(timer)
      ipcMain.removeListener('flow:image-submit-check-result', reply)
      signal?.removeEventListener('abort', abort)
      resolve(allowed)
    }
    const abort = () => finish(false)
    const reply = (event, data) => {
      if (event.sender === sender && data?.checkId === checkId) finish(data.allowed === true)
    }
    ipcMain.on('flow:image-submit-check-result', reply)
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(abort, 3000)
    try { sender.send('flow:image-submit-check', { checkId, submissionRequestId }) }
    catch { finish(false) }
  })
}
