import { it, expect, vi } from 'vitest'
import { runOuterStartAuthPreflight } from '../../src/services/startGuard.js'

it('api mode skips the Flow access-token preflight (per-provider credentials resolve later)', async () => {
  const getAccessToken = vi.fn()
  expect(await runOuterStartAuthPreflight({ appMode: 'api', sessionTarget: 'flow', getAccessToken }))
    .toBe(true)
  expect(getAccessToken).not.toHaveBeenCalled()
})

it('the Flow target runs the outer access-token preflight and fails closed without a token', async () => {
  const denied = vi.fn().mockResolvedValue(null)
  expect(await runOuterStartAuthPreflight({ appMode: 'flow', sessionTarget: 'flow', getAccessToken: denied }))
    .toBe(false)
  const granted = vi.fn().mockResolvedValue('token')
  expect(await runOuterStartAuthPreflight({ appMode: 'flow', sessionTarget: 'flow', getAccessToken: granted }))
    .toBe(true)
})

it('missing target preserves legacy Flow preflight', async () => {
  const getAccessToken = vi.fn().mockResolvedValue('token')
  expect(await runOuterStartAuthPreflight({ appMode: 'flow', getAccessToken })).toBe(true)
  expect(getAccessToken).toHaveBeenCalledOnce()
})
