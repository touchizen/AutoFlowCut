import { sharedVideoStartOptions } from './videoStartOptions'

export function buildVideoI2VStartOptions({
  settings = {},
  framePairs,
  projectName,
  seed,
} = {}) {
  const {
    saveMode,
    videoResolution,
    ...trailingSharedOptions
  } = sharedVideoStartOptions(settings)

  return {
    mode: 'i2v',
    framePairs,
    projectName,
    saveMode,
    videoResolution,
    videoModel: settings.videoModelF2V,
    videoProvider: settings.generation?.video?.i2v?.provider ?? 'google',
    ...trailingSharedOptions,
    seed,
  }
}
