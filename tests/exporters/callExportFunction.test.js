// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

const callableSpy = vi.fn(async (payload) => ({ data: { ok: true, echo: payload } }))
const httpsCallableSpy = vi.fn(() => callableSpy)
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: (...args) => httpsCallableSpy(...args),
}))
vi.mock('../../src/firebase/config', () => ({ APP_ID: 'autoflowcut' }))

import { callExportFunction } from '../../src/exporters/callExportFunction'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('callExportFunction', () => {
  it('calls the _test-suffixed callable (dev default) with appId and sanitized JSON', async () => {
    const data = await callExportFunction('generateThingJson', { scenes: [1, 2], a: undefined, b: NaN })

    expect(httpsCallableSpy).toHaveBeenCalledWith(expect.anything(), 'generateThingJson_test')
    const payload = callableSpy.mock.calls[0][0]
    expect(payload.appId).toBe('autoflowcut')
    expect(payload.a).toBeNull()  // undefined → null (httpsCallable 은 JSON-safe 만 허용)
    expect(payload.b).toBeNull()  // NaN → null
    expect(data).toMatchObject({ ok: true })
  })

  it('runs the validate hook against the response and propagates its error', async () => {
    callableSpy.mockResolvedValueOnce({ data: { bad: true } })
    const validate = vi.fn((d) => { if (d.bad) throw new Error('bad response') })

    await expect(callExportFunction('generateThingJson', {}, { validate })).rejects.toThrow('bad response')
    expect(validate).toHaveBeenCalledWith({ bad: true })
  })
})
