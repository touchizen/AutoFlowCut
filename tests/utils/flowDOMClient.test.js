/**
 * flowDOMClient — aspect ratio applied before image generation
 *
 * The Flow image UI has an aspect-ratio combobox that the app must set to the
 * project's format (16:9 longform / 9:16 shortform) before each generation —
 * otherwise generated images keep whatever ratio Flow last had. generateImageDOM
 * and submitGenerationDOM call domSetAspectRatio for a valid ratio, and skip it
 * for an absent/invalid one (leaving Flow's current setting untouched).
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
    domSetAspectRatio: vi.fn().mockResolvedValue({ success: true }),
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [] }),
  }
})

describe('generateImageDOM — aspect ratio', () => {
  it('sets the aspect ratio before generating for 9:16', async () => {
    await generateImageDOM('a prompt', [], { aspectRatio: '9:16' })

    expect(window.electronAPI.domSetAspectRatio).toHaveBeenCalledWith({ aspectRatio: '9:16' })
    // ordering: aspect ratio must be set BEFORE the generate call
    expect(window.electronAPI.domSetAspectRatio.mock.invocationCallOrder[0])
      .toBeLessThan(window.electronAPI.generateImage.mock.invocationCallOrder[0])
  })

  it('sets the aspect ratio for 16:9', async () => {
    await generateImageDOM('a prompt', [], { aspectRatio: '16:9' })
    expect(window.electronAPI.domSetAspectRatio).toHaveBeenCalledWith({ aspectRatio: '16:9' })
  })

  it('does not touch the aspect ratio when none is given', async () => {
    await generateImageDOM('a prompt', [])
    expect(window.electronAPI.domSetAspectRatio).not.toHaveBeenCalled()
    expect(window.electronAPI.generateImage).toHaveBeenCalledTimes(1)
  })

  it('ignores an unsupported aspect ratio value', async () => {
    await generateImageDOM('a prompt', [], { aspectRatio: '4:3' })
    expect(window.electronAPI.domSetAspectRatio).not.toHaveBeenCalled()
  })

  it('still generates when setting the aspect ratio fails', async () => {
    window.electronAPI.domSetAspectRatio.mockResolvedValue({ success: false, error: 'no combobox' })
    const result = await generateImageDOM('a prompt', [], { aspectRatio: '9:16' })
    expect(window.electronAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
  })
})

describe('submitGenerationDOM — aspect ratio', () => {
  it('sets the aspect ratio before submitting for 9:16', async () => {
    await submitGenerationDOM('a prompt', [], { aspectRatio: '9:16' })

    expect(window.electronAPI.domSetAspectRatio).toHaveBeenCalledWith({ aspectRatio: '9:16' })
    expect(window.electronAPI.domSetAspectRatio.mock.invocationCallOrder[0])
      .toBeLessThan(window.electronAPI.generateImage.mock.invocationCallOrder[0])
  })

  it('does not touch the aspect ratio when none is given', async () => {
    await submitGenerationDOM('a prompt', [])
    expect(window.electronAPI.domSetAspectRatio).not.toHaveBeenCalled()
  })
})
