/**
 * Firebase Mock (Desktop)
 */
import { vi } from 'vitest'

export const mockCallableFunction = vi.fn()

export function setupFunctionMocks(overrides = {}) {
  const defaults = {
    initializeUser: { success: true },
    getAppStatus: { status: 'active' },
    getPricing: { plans: [] },
    createCheckoutSession: { url: 'https://checkout.stripe.com/test' },
    createPortalSession: { url: 'https://billing.stripe.com/test' },
    exportCapcutPackageCloud: { success: true, targetPath: '/tmp/test' }
  }

  const merged = { ...defaults, ...overrides }

  mockCallableFunction.mockImplementation((name) => {
    return async (data) => {
      if (merged[name]) {
        return typeof merged[name] === 'function' ? merged[name](data) : { data: merged[name] }
      }
      return { data: { success: true } }
    }
  })
}

export function resetFunctionMocks() {
  mockCallableFunction.mockReset()
}

// Mock firebase/functions module
vi.mock('../../src/firebase/functions', () => ({
  getAppStatus: vi.fn().mockResolvedValue({ status: 'active' }),
  exportCapcutPackageCloud: vi.fn().mockResolvedValue({ success: true })
}))
