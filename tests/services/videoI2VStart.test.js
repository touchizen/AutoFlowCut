import { describe, expect, it } from 'vitest'
import { buildVideoI2VStartOptions } from '../../src/services/videoI2VStart'

describe('buildVideoI2VStartOptions', () => {
  it('builds the provider-aware App I2V scalar start options', () => {
    const settings = {
      saveMode: 'memory',
      videoResolution: '1080p',
      videoModelF2V: 'grok-imagine-video',
      generation: { video: { i2v: { provider: 'grok' } } },
      videoBatchCount: 2,
      videoConcurrency: 3,
      flowPacingMinMs: 5000,
      flowPacingMaxMs: 12000,
    }
    const framePairs = [{ id: 'fp_1' }]

    const options = buildVideoI2VStartOptions({
      settings,
      framePairs,
      projectName: 'demo',
      seed: 123,
    })

    expect(options).toEqual({
      mode: 'i2v',
      framePairs,
      projectName: 'demo',
      saveMode: 'memory',
      videoResolution: '1080p',
      videoModel: settings.videoModelF2V,
      videoProvider: 'grok',
      generationSettings: settings,
      videoBatchCount: 2,
      concurrency: 3,
      flowPacingMinMs: 5000,
      flowPacingMaxMs: 12000,
      seed: 123,
    })
    expect(options.generationSettings).toBe(settings)
    expect(options.videoModel).toBe(settings.videoModelF2V)
  })

  it('preserves the existing I2V defaults and null seed', () => {
    const settings = {
      saveMode: 'folder',
      videoResolution: '',
      videoModelF2V: 'veo-3.1-fast-generate-preview',
      generation: { video: { i2v: { provider: null } } },
      videoBatchCount: 0,
      videoConcurrency: 0,
    }

    expect(buildVideoI2VStartOptions({
      settings,
      framePairs: [],
      projectName: 'demo',
      seed: null,
    })).toEqual({
      mode: 'i2v',
      framePairs: [],
      projectName: 'demo',
      saveMode: 'folder',
      videoResolution: '720p',
      videoModel: settings.videoModelF2V,
      videoProvider: 'google',
      generationSettings: settings,
      videoBatchCount: 1,
      concurrency: 4,
      flowPacingMinMs: undefined,
      flowPacingMaxMs: undefined,
      seed: null,
    })
  })

  it('returns exactly the scalar option keys App passes before onItemUpdate', () => {
    const options = buildVideoI2VStartOptions({
      settings: {},
      framePairs: [],
      projectName: '',
      seed: 0,
    })

    expect(Object.keys(options)).toEqual([
      'mode',
      'framePairs',
      'projectName',
      'saveMode',
      'videoResolution',
      'videoModel',
      'videoProvider',
      'generationSettings',
      'videoBatchCount',
      'concurrency',
      'flowPacingMinMs',
      'flowPacingMaxMs',
      'seed',
    ])
  })
})
