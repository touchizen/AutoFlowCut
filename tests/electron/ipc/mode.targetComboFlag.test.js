// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createModeController } from '../../../electron/ipc/mode.js'

function setup(chatgptP2Flag) {
  const handlers = {}
  const sender = { send: vi.fn() }
  const controller = createModeController(
    () => ({ webContents: sender, contentView: {} }),
    vi.fn(),
    {
      chatgptDevGate: {
        platform: 'darwin',
        isPackaged: false,
        viteDevServerUrl: '',
        chatgptP2Flag,
      },
    },
  )
  controller.register({
    handle: (channel, handler) => { handlers[channel] = handler },
    on: vi.fn(),
  })
  return { handlers, sender }
}

describe('app:get-dev-flags', () => {
  it('keeps the combo flag false without the exact gate and returns true for the positive control', async () => {
    const negative = setup(undefined)
    await expect(negative.handlers['app:get-dev-flags']({ sender: negative.sender }))
      .resolves.toEqual({ chatgptTargetCombo: false })

    const positive = setup('1')
    await expect(positive.handlers['app:get-dev-flags']({ sender: positive.sender }))
      .resolves.toEqual({ chatgptTargetCombo: true })
  })

  it('fails closed for an untrusted renderer and has a trusted positive control', async () => {
    const setupResult = setup('1')
    await expect(setupResult.handlers['app:get-dev-flags']({ sender: {} }))
      .resolves.toEqual({ chatgptTargetCombo: false })
    await expect(setupResult.handlers['app:get-dev-flags']({ sender: setupResult.sender }))
      .resolves.toEqual({ chatgptTargetCombo: true })
  })
})
