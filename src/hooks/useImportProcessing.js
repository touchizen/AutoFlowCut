import { useCallback, useState } from 'react'

export const IMPORT_SPINNER_DELAY_MS = 150

function afterBrowserPaint() {
  const scheduleFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback) => setTimeout(() => callback(Date.now()), 16)

  return new Promise(resolve => {
    scheduleFrame(() => setTimeout(resolve, 0))
  })
}

export function useImportProcessing() {
  const [processing, setProcessing] = useState(false)
  const [spinnerVisible, setSpinnerVisible] = useState(false)

  const runImportProcessing = useCallback(async (action) => {
    setProcessing(true)
    setSpinnerVisible(false)

    const spinnerTimer = setTimeout(() => {
      setSpinnerVisible(true)
    }, IMPORT_SPINNER_DELAY_MS)

    try {
      // React must commit the processing shell and the browser must get a paint
      // opportunity before synchronous parsing/normalization occupies the thread.
      await afterBrowserPaint()
      return await action()
    } finally {
      clearTimeout(spinnerTimer)
      setSpinnerVisible(false)
      setProcessing(false)
    }
  }, [])

  return { processing, spinnerVisible, runImportProcessing }
}
