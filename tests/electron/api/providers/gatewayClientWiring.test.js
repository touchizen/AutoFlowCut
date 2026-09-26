import { describe, expect, it, vi } from 'vitest'

const factoryCalls = vi.hoisted(() => [])

vi.mock('../../../../electron/api/providers/gatewayClient.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createGatewayClient(config) {
      factoryCalls.push(config)
      return actual.createGatewayClient(config)
    },
  }
})

await import('../../../../electron/api/providers/wavespeedClient.js')
await import('../../../../electron/api/providers/higgsfieldClient.js')

describe('shared gateway client wiring', () => {
  it('WaveSpeed and Higgsfield both instantiate the shared transport with provider deltas', () => {
    expect(factoryCalls.map((config) => config.providerName)).toEqual(['WaveSpeed', 'Higgsfield'])
    for (const config of factoryCalls) {
      expect(config).toMatchObject({
        baseUrl: expect.stringMatching(/^https:\/\//),
        buildAuthHeaders: expect.any(Function),
        submitPath: expect.any(Function),
        pollPath: expect.any(Function),
        classifyError: expect.any(Function),
      })
    }
  })
})
