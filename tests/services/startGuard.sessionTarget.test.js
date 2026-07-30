import { it, expect, vi } from 'vitest'
import { runOuterStartAuthPreflight } from '../../src/services/startGuard.js'

it('flow+chatgpt skips Flow access-token preflight', async () => {
  const getAccessToken = vi.fn()
  expect(await runOuterStartAuthPreflight({ appMode: 'flow', sessionTarget: 'chatgpt', getAccessToken }))
    .toBe(true)
  expect(getAccessToken).not.toHaveBeenCalled()
})

it('missing target preserves legacy Flow preflight', async () => {
  const getAccessToken = vi.fn().mockResolvedValue('token')
  expect(await runOuterStartAuthPreflight({ appMode: 'flow', getAccessToken })).toBe(true)
  expect(getAccessToken).toHaveBeenCalledOnce()
})
