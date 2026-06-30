import { describe, expect, it, vi } from 'vitest'
import { buildVideoTextStartPayload, prepareVideoTextStartScenes } from '../../src/services/videoTextStart'

describe('videoTextStart', () => {
  it('logs unresolved video @mentions without blocking scene preparation', () => {
    const warn = vi.fn()
    const { scenes, didWarnReferenceLimit } = prepareVideoTextStartScenes({
      videoScenes: [{ id: 'vscene_1', prompt: 'A wizard @ghost walks' }],
      references: [],
      warn,
    })

    expect(scenes[0].prompt).toBe('A wizard @ghost walks')
    expect(didWarnReferenceLimit).toBe(false)
    expect(warn).toHaveBeenCalledWith('[VideoText]', 'vscene_1', 'unknown @mentions:', 'ghost')
  })

  it('warns about the reference limit once and keeps the first three video refs', () => {
    const warn = vi.fn()
    const onReferenceLimitWarning = vi.fn()
    const references = ['a', 'b', 'c', 'd'].map((name) => ({
      id: `ref_${name}`,
      name,
      category: 'character',
      data: `data:image/png;base64,${name.toUpperCase()}`,
      filePath: null,
    }))

    const { scenes, didWarnReferenceLimit } = prepareVideoTextStartScenes({
      videoScenes: [
        { id: 'vscene_1', prompt: '@a @b @c @d walk' },
        { id: 'vscene_2', prompt: '@a @b @c @d run' },
      ],
      references,
      warn,
      onReferenceLimitWarning,
    })

    expect(scenes[0].referenceImages.map(r => r.name)).toEqual(['a', 'b', 'c'])
    expect(scenes[1].referenceImages.map(r => r.name)).toEqual(['a', 'b', 'c'])
    expect(didWarnReferenceLimit).toBe(true)
    expect(onReferenceLimitWarning).toHaveBeenCalledTimes(1)
    expect(onReferenceLimitWarning).toHaveBeenCalledWith(3)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('builds the App video-text start payload with seed, settings, cleaned prompt, and refs', () => {
    const ref = {
      id: 'ref_hero',
      name: 'hero',
      category: 'character',
      data: 'data:image/png;base64,REF',
      filePath: null,
    }

    const { startOptions, runningStyle } = buildVideoTextStartPayload({
      videoScenes: [{ id: 'vscene_1', prompt: 'A wizard @hero walks', targetDuration: 4 }],
      references: [ref],
      effectiveStyleId: 'style_noir',
      settings: {
        seedLocked: true,
        seedNo: 123,
        saveMode: 'memory',
        videoResolution: '1080p',
        videoModelT2V: 'veo-3.1-fast-generate-preview',
        videoBatchCount: 2,
        videoConcurrency: 3,
      },
      projectName: 'demo',
      styleLabel: 'Noir',
      warn: vi.fn(),
    })

    expect(runningStyle).toEqual({ styleId: 'style_noir', label: 'Noir', applies: true })
    expect(startOptions).toMatchObject({
      mode: 't2v',
      seed: 123,
      projectName: 'demo',
      saveMode: 'memory',
      videoResolution: '1080p',
      videoModel: 'veo-3.1-fast-generate-preview',
      videoBatchCount: 2,
      concurrency: 3,
    })
    expect(startOptions.scenes[0]).toMatchObject({
      id: 'vscene_1',
      prompt: 'A wizard hero walks',
      referenceImages: [expect.objectContaining({ name: 'hero', data: 'data:image/png;base64,REF' })],
      targetDuration: 4,
    })
  })

  it('keeps 720p no-reference scenes on scene duration even if a prior generated video was 8s', () => {
    const { startOptions } = buildVideoTextStartPayload({
      videoScenes: [{
        id: 'vscene_1',
        prompt: 'A slow camera pan',
        duration: 3,
        videoT2VDuration: 8,
      }],
      references: [],
      settings: {
        saveMode: 'memory',
        videoResolution: '720p',
        videoModelT2V: 'veo-3.1-fast-generate-preview',
      },
      projectName: 'demo',
      warn: vi.fn(),
    })

    expect(startOptions.videoResolution).toBe('720p')
    expect(startOptions.scenes[0]).toMatchObject({
      id: 'vscene_1',
      prompt: 'A slow camera pan',
      referenceImages: [],
      targetDuration: 3,
    })
  })
})
