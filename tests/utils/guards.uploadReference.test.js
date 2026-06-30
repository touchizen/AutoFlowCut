/**
 * #R5-4b — Manual reference upload guard: flowProjectReady gate.
 *
 * The inline wrapper in App.jsx around onUpload={genAPI.uploadReference}:
 *   async (...args) => {
 *     const readyCheck = checkFlowProjectReady(flowProjectReady, t)
 *     if (!readyCheck.ok) return { success: false, error: 'flow_project_not_ready' }
 *     return genAPI.uploadReference(...args)
 *   }
 *
 * We test the gate logic in isolation using checkFlowProjectReady directly
 * (unit-tests the guard that the wrapper delegates to), plus we verify the
 * wrapper contract via a simulated factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const toastWarning = vi.fn()
vi.mock('../../src/components/Toast', () => ({
  toast: { warning: (...a) => toastWarning(...a) },
}))

// fileSystemAPI is imported by guards.js but not used by checkFlowProjectReady
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {},
}))

import { checkFlowProjectReady } from '../../src/utils/guards'

// ── Helpers ───────────────────────────────────────────────────────────────────

const t = (k, opts) => opts?.defaultValue || k

/**
 * Simulates the inline wrapper App.jsx wraps around genAPI.uploadReference.
 */
function makeUploadHandler(flowProjectReady, uploadReference) {
  return async (...args) => {
    const readyCheck = checkFlowProjectReady(flowProjectReady, t)
    if (!readyCheck.ok) return { success: false, error: 'flow_project_not_ready' }
    return uploadReference(...args)
  }
}

beforeEach(() => {
  toastWarning.mockClear()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('upload reference guard — flowProjectReady (#R5-4b)', () => {
  it('flow + !flowProjectReady: uploadReference NOT called, returns error sentinel', async () => {
    const uploadReference = vi.fn().mockResolvedValue({ success: true, mediaId: 'x' })
    const handler = makeUploadHandler(false, uploadReference)

    const result = await handler('base64data', { category: 'MEDIA_CATEGORY_SUBJECT' })

    expect(uploadReference).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false, error: 'flow_project_not_ready' })
  })

  it('flow + !flowProjectReady: shows warning toast', async () => {
    const handler = makeUploadHandler(false, vi.fn())
    await handler('base64data', {})
    expect(toastWarning).toHaveBeenCalled()
  })

  it('flowProjectReady=true: uploadReference IS called with original args', async () => {
    const uploadReference = vi.fn().mockResolvedValue({ success: true, mediaId: 'abc' })
    const handler = makeUploadHandler(true, uploadReference)

    const result = await handler('b64', { category: 'MEDIA_CATEGORY_SUBJECT', name: 'char' })

    expect(uploadReference).toHaveBeenCalledWith('b64', { category: 'MEDIA_CATEGORY_SUBJECT', name: 'char' })
    expect(result).toEqual({ success: true, mediaId: 'abc' })
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('api mode (flowProjectReady=true always): uploadReference IS called', async () => {
    const uploadReference = vi.fn().mockResolvedValue({ success: true, mediaId: 'y' })
    const handler = makeUploadHandler(true, uploadReference)  // api mode: always true

    await handler('b64', {})

    expect(uploadReference).toHaveBeenCalledTimes(1)
    expect(toastWarning).not.toHaveBeenCalled()
  })
})
