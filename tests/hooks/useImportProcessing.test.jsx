import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportProcessingOverlay from '../../src/components/ImportProcessingOverlay'
import {
  IMPORT_SPINNER_DELAY_MS,
  useImportProcessing,
} from '../../src/hooks/useImportProcessing'

function Harness({ action }) {
  const processing = useImportProcessing()

  return (
    <>
      <button onClick={() => { processing.runImportProcessing(action).catch(() => {}) }}>
        Run
      </button>
      <ImportProcessingOverlay
        processing={processing.processing}
        spinnerVisible={processing.spinnerVisible}
        label="Importing scenes…"
      />
    </>
  )
}

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function paintThenStartWork() {
  await advance(16)
  await advance(1)
}

describe('useImportProcessing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback) => (
      setTimeout(() => callback(performance.now()), 16)
    ))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('commits processing DOM before synchronous heavy work begins', async () => {
    let processingWasCommitted = false
    const action = vi.fn(() => {
      processingWasCommitted = Boolean(document.querySelector('[data-import-processing="true"]'))
    })

    render(<Harness action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(action).not.toHaveBeenCalled()
    expect(document.querySelector('[data-import-processing="true"]')).toBeInTheDocument()

    await advance(16)
    expect(action).not.toHaveBeenCalled()

    await advance(1)

    expect(action).toHaveBeenCalledTimes(1)
    expect(processingWasCommitted).toBe(true)
  })

  it('shows the accessible spinner after 150 ms for slow work', async () => {
    let finish
    const action = vi.fn(() => new Promise(resolve => { finish = resolve }))

    render(<Harness action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await paintThenStartWork()

    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await advance(IMPORT_SPINNER_DELAY_MS - 18)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await advance(1)
    expect(screen.getByRole('status')).toHaveTextContent('Importing scenes…')

    await act(async () => { finish() })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('never exposes the spinner for work that finishes before the delay', async () => {
    const action = vi.fn()

    render(<Harness action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await paintThenStartWork()

    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(document.querySelector('[data-import-processing="true"]')).not.toBeInTheDocument()

    await advance(IMPORT_SPINNER_DELAY_MS)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clears processing state when the action throws', async () => {
    const action = vi.fn(() => { throw new Error('import failed') })

    render(<Harness action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await paintThenStartWork()

    expect(action).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-import-processing="true"]')).not.toBeInTheDocument()
  })
})
