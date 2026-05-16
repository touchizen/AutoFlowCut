/**
 * flowDOMClient — aspect ratio applied before image generation
 *
 * The app must set Flow's aspect-ratio tab to the project format (16:9 / 9:16)
 * before each generation. generateImageDOM / submitGenerationDOM call
 * domSetAspectRatio for a valid ratio (skipping an absent/invalid one).
 *
 * If applying the ratio FAILS, generation is aborted: a 9:16 project must not
 * silently produce a 16:9 image (wrong output + wasted quota) — the failure is
 * surfaced so the user can retry.
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

  it('aborts generation when the aspect ratio cannot be applied', async () => {
    window.electronAPI.domSetAspectRatio.mockResolvedValue({ success: false, error: 'tab did not switch' })
    const result = await generateImageDOM('a prompt', [], { aspectRatio: '9:16' })
    expect(window.electronAPI.generateImage).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error).toContain('9:16')
  })

  it('aborts generation when domSetAspectRatio throws', async () => {
    window.electronAPI.domSetAspectRatio.mockRejectedValue(new Error('ipc down'))
    const result = await generateImageDOM('a prompt', [], { aspectRatio: '9:16' })
    expect(window.electronAPI.generateImage).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
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

  it('aborts the submit when the aspect ratio cannot be applied', async () => {
    window.electronAPI.domSetAspectRatio.mockResolvedValue({ success: false, error: 'tab did not switch' })
    const result = await submitGenerationDOM('a prompt', [], { aspectRatio: '9:16' })
    expect(window.electronAPI.generateImage).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })
})
