import { describe, expect, it } from 'vitest'
import { buildVideoI2VStartOptions } from '../../src/services/videoI2VStart'
import { sharedVideoStartOptions } from '../../src/services/videoStartOptions'
import { buildVideoTextStartPayload } from '../../src/services/videoTextStart'

const SHARED_VIDEO_START_KEYS = [
  'saveMode',
  'videoResolution',
  'generationSettings',
  'videoBatchCount',
  'concurrency',
  'flowPacingMinMs',
  'flowPacingMaxMs',
  'aspectRatio',
]

function expectedSharedOptions(settings) {
  return {
    saveMode: settings.saveMode,
    videoResolution: settings.videoResolution || '720p',
    generationSettings: settings,
    videoBatchCount: settings.videoBatchCount || 1,
    concurrency: settings.videoConcurrency || 4,
    flowPacingMinMs: settings.flowPacingMinMs,
    flowPacingMaxMs: settings.flowPacingMaxMs,
    aspectRatio: settings.aspectRatio,
  }
}

describe('sharedVideoStartOptions', () => {
  it('settings에서 일곱 공통 video start option을 동일 참조와 값으로 만든다', () => {
    const settings = {
      saveMode: 'memory',
      videoResolution: '1080p',
      videoBatchCount: 2,
      videoConcurrency: 3,
      flowPacingMinMs: 5000,
      flowPacingMaxMs: 12000,
    }

    const options = sharedVideoStartOptions(settings)

    expect(Object.keys(options)).toEqual(SHARED_VIDEO_START_KEYS)
    expect(options).toEqual(expectedSharedOptions(settings))
    expect(options.generationSettings).toBe(settings)
  })

  it('빈 settings에 기존 720p/1/4 fallback과 undefined pacing을 보존한다', () => {
    const settings = {}

    expect(sharedVideoStartOptions(settings)).toEqual({
      saveMode: undefined,
      videoResolution: '720p',
      generationSettings: settings,
      videoBatchCount: 1,
      concurrency: 4,
      flowPacingMinMs: undefined,
      flowPacingMaxMs: undefined,
      aspectRatio: undefined,
    })
  })

  it.each([
    ['T2V', (settings) => buildVideoTextStartPayload({
      settings,
      videoScenes: [],
      references: [],
      warn: () => {},
    }).startOptions],
    ['I2V', (settings) => buildVideoI2VStartOptions({
      settings,
      framePairs: [],
      projectName: '',
      seed: null,
    })],
  ])('%s builder가 helper의 모든 공통 키를 포함한다 (anti-drift)', (_stage, buildOptions) => {
    const settings = {
      saveMode: 'memory',
      videoResolution: '1080p',
      videoBatchCount: 2,
      videoConcurrency: 3,
      flowPacingMinMs: 5000,
      flowPacingMaxMs: 12000,
    }
    const sharedOptions = sharedVideoStartOptions(settings)
    const options = buildOptions(settings)

    expect(Object.keys(sharedOptions)).toEqual(SHARED_VIDEO_START_KEYS)
    expect(Object.fromEntries(
      SHARED_VIDEO_START_KEYS.map((key) => [key, options[key]])
    )).toEqual(expectedSharedOptions(settings))
    expect(options).toMatchObject(sharedOptions)
  })
})
