import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { QuotaExhaustedModalProvider } from '../../src/components/QuotaExhaustedModal'
import { emitQuotaStop, __resetQuotaStopForTests } from '../../src/utils/quotaStop'
import { act } from 'react'

describe('QuotaExhaustedModalProvider without I18nProvider', () => {
  it('does not crash and falls back to locale keys', () => {
    __resetQuotaStopForTests()

    render(<QuotaExhaustedModalProvider><div>child</div></QuotaExhaustedModalProvider>)

    act(() => {
      emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'Test' })
    })

    expect(screen.getByText('quotaExhausted.title')).toBeTruthy()
    expect(screen.getByText('quotaExhausted.message')).toBeTruthy()
    expect(screen.getByText('quotaExhausted.ok')).toBeTruthy()
  })
})
