/**
 * flowDOMClient — aspect ratio forwarded to image generation
 *
 * The project aspect ratio is enforced by injecting `imageAspectRatio` into the
 * batchGenerateImages request body (CDP Fetch interception in main.js /
 * flow-api.js) — NOT by clicking Flow's UI (the control moved into a collapsed
 * dropdown and broke). flowDOMClient just forwards the chosen ratio to the
 * generateImage IPC, which sets the pending value the interceptor injects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generateImageDOM,
  submitGenerationDOM,
  resetDOMSession,
} from '../../src/utils/flowDOMClient'

beforeEach(() => {
  resetDOMSession() // clear cached project URL between tests
  window.electronAPI = {
    // already inside a Flow project → ensureFlowProject short-circuits
    domGetUrl: vi.fn().mockResolvedValue({
      success: true,
      url: 'https://labs.google/fx/tools/flow/project-123',
    }),
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [] }),
  }
})

describe('generateImageDOM — aspect ratio', () => {
  it('forwards 9:16 to the generateImage IPC', async () => {
    await generateImageDOM('a prompt', [], { aspectRatio: '9:16' })

    expect(window.electronAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.generateImage.mock.calls[0][0].aspectRatio).toBe('9:16')
  })

  it('forwards 16:9 to the generateImage IPC', async () => {
    await generateImageDOM('a prompt', [], { aspectRatio: '16:9' })

    expect(window.electronAPI.generateImage.mock.calls[0][0].aspectRatio).toBe('16:9')
  })

  it('forwards undefined when no aspect ratio is given', async () => {
    await generateImageDOM('a prompt', [])

    expect(window.electronAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.generateImage.mock.calls[0][0].aspectRatio).toBeUndefined()
  })
})

describe('submitGenerationDOM — aspect ratio', () => {
  it('forwards 9:16 to the generateImage IPC', async () => {
    await submitGenerationDOM('a prompt', [], { aspectRatio: '9:16' })

    expect(window.electronAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.generateImage.mock.calls[0][0].aspectRatio).toBe('9:16')
  })

  it('forwards undefined when no aspect ratio is given', async () => {
    await submitGenerationDOM('a prompt', [])

    expect(window.electronAPI.generateImage.mock.calls[0][0].aspectRatio).toBeUndefined()
  })
})
