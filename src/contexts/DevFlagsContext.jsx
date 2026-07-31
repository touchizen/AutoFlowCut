import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const CLOSED_FLAGS = Object.freeze({
  chatgptTargetCombo: false,
  resolved: false,
})

const DevFlagsContext = createContext(CLOSED_FLAGS)

export function DevFlagsProvider({
  children,
  electronAPI = globalThis.window?.electronAPI,
}) {
  const [flags, setFlags] = useState(CLOSED_FLAGS)

  useEffect(() => {
    let active = true
    if (typeof electronAPI?.getDevFlags !== 'function') {
      setFlags({ chatgptTargetCombo: false, resolved: true })
      return () => { active = false }
    }

    Promise.resolve(electronAPI.getDevFlags())
      .then((result) => {
        if (!active) return
        setFlags({
          chatgptTargetCombo: result?.chatgptTargetCombo === true,
          resolved: true,
        })
      })
      .catch(() => {
        if (active) setFlags({ chatgptTargetCombo: false, resolved: true })
      })

    return () => { active = false }
  }, [electronAPI])

  const value = useMemo(() => flags, [flags])
  return <DevFlagsContext.Provider value={value}>{children}</DevFlagsContext.Provider>
}

export function useDevFlags() {
  return useContext(DevFlagsContext)
}

export default DevFlagsProvider
