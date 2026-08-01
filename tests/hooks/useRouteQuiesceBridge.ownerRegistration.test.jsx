import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { useRouteQuiesceBridge } from '../../src/App.jsx'

function BridgeHarness({ electronAPI }) {
  const ownerRef = useRef({
    stop: vi.fn(),
    awaitIdle: vi.fn(async () => {}),
  })
  useRouteQuiesceBridge(ownerRef, electronAPI)
  return null
}

describe('useRouteQuiesceBridge owner registration', () => {
  it('registers only after installing the receipt listener and unregisters before removing it', () => {
    const events = []
    const electronAPI = {
      onRouteQuiesceRequest: vi.fn(() => {
        events.push('listener:installed-41')
        return () => events.push('listener:removed-41')
      }),
      setRouteQuiesceOwner: vi.fn((present) => {
        events.push(`owner:${present}:41`)
      }),
    }

    const view = render(<BridgeHarness electronAPI={electronAPI} />)

    expect(events).toEqual(['listener:installed-41', 'owner:true:41'])
    view.unmount()
    expect(events).toEqual([
      'listener:installed-41',
      'owner:true:41',
      'owner:false:41',
      'listener:removed-41',
    ])
  })
})
